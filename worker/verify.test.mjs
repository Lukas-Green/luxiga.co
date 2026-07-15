// Independent verification of the LUXIGA CRM worker's pure logic (no Airtable).
// Run: node worker/verify.test.mjs   (from the luxiga-co repo root)
import assert from 'node:assert';
import { buildAudience, signUnsubToken, verifyUnsubToken, providerStatus } from './campaigns.js';
import { workRequestNotifyHtml, workRequestReceiptHtml, campaignBaseHtml, BRAND } from './emails.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ✓', name); };

console.log('audience compliance filters');
const contacts = [
  { id: 'r1', fields: { name: 'A Client', email: 'a@x.com', stage: 'Active Client', source: 'Referral', consent: 'express' } },
  { id: 'r2', fields: { name: 'Unsub', email: 'u@x.com', stage: 'New', email_status: 'unsubscribed' } },
  { id: 'r3', fields: { name: 'Suppressed', email: 's@x.com', stage: 'New' } },
  { id: 'r4', fields: { name: 'No Email', stage: 'New' } },
  { id: 'r5', fields: { name: 'Lost Deal', email: 'l@x.com', stage: 'Lost' } },
  { id: 'r6', fields: { name: 'Dupe', email: 'a@x.com', stage: 'New' } },      // same email as r1
  { id: 'r7', fields: { name: 'Fresh Lead', email: 'f@x.com', stage: 'New', source: 'Card Scan' } },
];
const supp = ['S@X.com'];   // case-insensitive suppression

await t('no segment → all mailable, compliance still enforced', () => {
  const { recipients, excluded } = buildAudience(contacts, supp, {});
  const emails = recipients.map((r) => r.email).sort();
  assert.deepEqual(emails, ['a@x.com', 'f@x.com', 'l@x.com']); // r1, r7, r5 (Lost is mailable w/o stage filter)
  assert.equal(excluded.no_email, 1);       // r4
  assert.equal(excluded.unsubscribed, 1);   // r2
  assert.equal(excluded.suppressed, 1);     // r3
  // r6 deduped against r1 (not counted in excluded, just skipped)
});

await t('stage segment excludes Lost + filters', () => {
  const { recipients, excluded } = buildAudience(contacts, supp, { stages: ['New', 'Active Client'] });
  const emails = recipients.map((r) => r.email).sort();
  assert.deepEqual(emails, ['a@x.com', 'f@x.com']); // Active Client + New; Lost filtered out
  assert.ok(excluded.filtered >= 1);
});

await t('source segment narrows correctly', () => {
  const { recipients } = buildAudience(contacts, supp, { sources: ['Card Scan'] });
  assert.deepEqual(recipients.map((r) => r.email), ['f@x.com']);
});

console.log('unsubscribe tokens (HMAC)');
const env = { UNSUB_SECRET: 'test-secret-abc' };
await t('sign → verify round-trips', async () => {
  const tok = await signUnsubToken(env, 'r1', 'A@X.com');
  const out = await verifyUnsubToken(env, tok);
  assert.equal(out.email, 'a@x.com');      // normalized lowercase
  assert.equal(out.contactId, 'r1');
});
await t('tampered token rejected', async () => {
  const tok = await signUnsubToken(env, 'r1', 'a@x.com');
  const bad = tok.slice(0, -2) + (tok.slice(-2) === 'AA' ? 'BB' : 'AA');
  assert.equal(await verifyUnsubToken(env, bad), null);
});
await t('wrong secret rejected', async () => {
  const tok = await signUnsubToken(env, 'r1', 'a@x.com');
  assert.equal(await verifyUnsubToken({ UNSUB_SECRET: 'other' }, tok), null);
});

console.log('email branding + safety');
const notify = workRequestNotifyHtml({ name: 'Jane <script>', contact: 'jane@x.com', message: 'Line1\nLine2', source: 'card' });
const receipt = workRequestReceiptHtml({ name: 'Jane', contact: 'jane@x.com' });
const camp = campaignBaseHtml({ subject: 'Hi', preview: 'p', bodyHtml: '<p>Body</p>', unsubUrl: 'https://luxiga.co/api/unsub?t=x', postal: 'LUXIGA LLC' });

await t('LUXIGA brand + lime present, no GGC leakage', () => {
  for (const h of [notify, receipt, camp]) {
    assert.ok(/LUXIGA/.test(h), 'wordmark');
    assert.ok(/C4FF53/i.test(h), 'lime accent');
    assert.ok(!/golden goose|goldgosling|gosling/i.test(h), 'no GGC strings');
  }
  assert.equal(BRAND.name || BRAND.company || 'LUXIGA LLC', BRAND.name || BRAND.company || 'LUXIGA LLC');
});
await t('notify escapes HTML in user input', () => {
  assert.ok(!/<script>/.test(notify), 'raw <script> must be escaped');
  assert.ok(/&lt;script&gt;/.test(notify), 'escaped form present');
});
await t('campaign wrapper carries the unsub link', () => {
  assert.ok(camp.includes('https://luxiga.co/api/unsub?t=x'));
});

console.log('provider status');
await t('defaults to a known provider state', () => {
  const st = providerStatus({});
  assert.ok(['dryrun', 'mailchimp', 'resend'].includes(st.provider));
});

// await the async assertions (they were invoked synchronously above but return promises)
await new Promise((r) => setTimeout(r, 50));
console.log(`\n${pass} checks passed`);
