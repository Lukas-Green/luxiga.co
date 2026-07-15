#!/usr/bin/env node
/**
 * Creates the LUXIGA CRM tables (Contacts, Interactions, Campaigns, Suppression)
 * in the LUXIGA Airtable base. Idempotent: skips anything that already exists.
 *
 * ── One-time setup ──────────────────────────────────────────────────────────
 * 1. Create an Airtable Personal Access Token at https://airtable.com/create/tokens
 *      Scopes:  schema.bases:write  (and schema.bases:read)
 *      Access:  the LUXIGA base (or "all current and future bases")
 * 2. Run:
 *      AIRTABLE_PAT=pat_xxx node worker/setup-crm-tables.mjs
 *    If you know the base id (starts with "app"), pass it to skip the lookup:
 *      AIRTABLE_PAT=pat_xxx AIRTABLE_BASE_ID=appXXXX node worker/setup-crm-tables.mjs
 * 3. Revoke the token afterwards if you like — the Worker uses its own secret
 *    (AIRTABLE_TOKEN), a runtime PAT scoped to data.records:read/write.
 *
 * Requires Node 18+ (global fetch).
 */

const PAT = process.env.AIRTABLE_PAT;
let BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!PAT) {
  console.error('Missing AIRTABLE_PAT. See the header of this file for setup.');
  process.exit(1);
}

const API = 'https://api.airtable.com/v0/meta';
const H = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };

async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: H });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function resolveBaseId() {
  if (BASE_ID) return BASE_ID;
  const { bases } = await api('/bases');
  if (!bases || !bases.length) throw new Error('Token can see no bases. Check the token\'s base access.');
  const match = bases.find((b) => /luxiga|crm/i.test(b.name));
  if (match) {
    console.log(`Using base "${match.name}" (${match.id}).`);
    return match.id;
  }
  console.error('Could not auto-pick a base. Re-run with AIRTABLE_BASE_ID set to one of:');
  bases.forEach((b) => console.error(`  ${b.id}  ${b.name}`));
  process.exit(1);
}

const dateOpts = { dateFormat: { name: 'iso' } };
const dateTimeOpts = { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'client' };
const sel = (names) => ({ choices: names.map((n) => ({ name: n })) });

async function ensureTable(tables, name, fields) {
  const existing = tables.find((t) => t.name === name);
  if (existing) {
    console.log(`✓ Table "${name}" already exists (${existing.id}) — skipping.`);
    return existing.id;
  }
  const created = await api(`/bases/${BASE_ID}/tables`, {
    method: 'POST',
    body: JSON.stringify({ name, fields }),
  });
  console.log(`＋ Created table "${name}" (${created.id}).`);
  return created.id;
}

async function ensureField(table, fieldName, fieldDef) {
  if (table.fields.some((f) => f.name === fieldName)) {
    console.log(`✓ Field "${table.name}.${fieldName}" already exists — skipping.`);
    return;
  }
  await api(`/bases/${BASE_ID}/tables/${table.id}/fields`, {
    method: 'POST',
    body: JSON.stringify(fieldDef),
  });
  console.log(`＋ Added field "${table.name}.${fieldName}".`);
}

async function main() {
  BASE_ID = await resolveBaseId();

  let { tables } = await api(`/bases/${BASE_ID}/tables`);

  // 1. Contacts. First field = primary (must be text-like). Owner is Lukas-only
  //    (solo studio). Stages + Sources per the LUXIGA CRM spec.
  const contactsId = await ensureTable(tables, 'Contacts', [
    { name: 'name', type: 'singleLineText' },
    { name: 'phone', type: 'phoneNumber' },
    { name: 'email', type: 'email' },
    { name: 'address', type: 'singleLineText' },
    { name: 'city', type: 'singleLineText' },
    { name: 'stage', type: 'singleSelect', options: sel(['New', 'Contacted', 'Discovery Call', 'Proposal Sent', 'Active Client', 'Repeat / Referral', 'Lost']) },
    { name: 'source', type: 'singleSelect', options: sel(['Card Scan', 'Referral', 'Web Form', 'Pulse', 'Partner', 'Manual']) },
    { name: 'owner', type: 'singleSelect', options: sel(['Lukas']) },
    { name: 'next_follow_up_date', type: 'date', options: dateOpts },
    { name: 'last_contacted', type: 'date', options: dateOpts },
    { name: 'notes', type: 'multilineText' },
  ]);

  // 2. Interactions. Create with scalar fields only; the `contact` link is added
  //    separately below (Airtable's Meta API rejects multipleRecordLinks options
  //    inside a table-create payload but accepts them via the fields endpoint).
  const interactionsId = await ensureTable(tables, 'Interactions', [
    { name: 'summary', type: 'singleLineText' },
    { name: 'type', type: 'singleSelect', options: sel(['Call', 'Text', 'Email', 'Note', 'Meeting']) },
    { name: 'direction', type: 'singleSelect', options: sel(['Inbound', 'Outbound']) },
    { name: 'date', type: 'dateTime', options: dateTimeOpts },
    { name: 'next_action', type: 'singleLineText' },
    { name: 'logged_by', type: 'singleSelect', options: sel(['Lukas']) },
  ]);

  // 3. Link field, added via the fields endpoint (auto-creates the reverse
  //    "Interactions" field on Contacts).
  ({ tables } = await api(`/bases/${BASE_ID}/tables`));
  const interactions = tables.find((t) => t.name === 'Interactions');
  await ensureField(interactions, 'contact', {
    name: 'contact',
    type: 'multipleRecordLinks',
    options: { linkedTableId: contactsId },
  });

  // 3b. Marketing fields on Contacts (campaign engine). email_status gates
  //     whether a contact can be mailed; consent drives regulated sends;
  //     unsub_at records the opt-out.
  const contacts = tables.find((t) => t.name === 'Contacts');
  if (contacts) {
    await ensureField(contacts, 'email_status', {
      name: 'email_status', type: 'singleSelect',
      options: sel(['subscribed', 'unsubscribed', 'cleaned']),
    });
    await ensureField(contacts, 'consent', {
      name: 'consent', type: 'singleSelect',
      options: sel(['none', 'implied', 'express']),
    });
    await ensureField(contacts, 'unsub_at', { name: 'unsub_at', type: 'date', options: dateOpts });
  }

  // 3c. Campaigns — a saved audience + email content + send status/stats.
  await ensureTable(tables, 'Campaigns', [
    { name: 'name', type: 'singleLineText' },
    { name: 'subject', type: 'singleLineText' },
    { name: 'preview_text', type: 'singleLineText' },
    { name: 'body', type: 'multilineText' },
    { name: 'status', type: 'singleSelect', options: sel(['Draft', 'Sending', 'Sent', 'Failed']) },
    { name: 'provider', type: 'singleSelect', options: sel(['dryrun', 'mailchimp', 'resend']) },
    { name: 'audience', type: 'multilineText' },      // JSON segment definition
    { name: 'recipient_count', type: 'number', options: { precision: 0 } },
    { name: 'sent_count', type: 'number', options: { precision: 0 } },
    { name: 'sent_at', type: 'dateTime', options: dateTimeOpts },
    { name: 'notes', type: 'multilineText' },
  ]);

  // 3d. Suppression — the do-not-email list. Contact-independent so an opt-out
  //     survives even if the contact row is later deleted/recreated.
  await ensureTable(tables, 'Suppression', [
    { name: 'email', type: 'singleLineText' },
    { name: 'reason', type: 'singleSelect', options: sel(['unsubscribe', 'bounce', 'complaint', 'manual']) },
    { name: 'source_campaign', type: 'singleLineText' },
    { name: 'added_at', type: 'dateTime', options: dateTimeOpts },
  ]);

  console.log('\nDone. Contacts + Interactions + Campaigns + Suppression are ready.');
  console.log(`(Contacts: ${contactsId}, Interactions: ${interactionsId})`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
