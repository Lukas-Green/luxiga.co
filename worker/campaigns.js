/* ============================================================
   LUXIGA CRM — Campaign engine (provider-agnostic marketing sends)
   ============================================================

   Run marketing campaigns off the CRM contact list. The *delivery channel*
   is swappable so the tool is useful whether or not LUXIGA pays for a
   managed provider:

     CAMPAIGN_PROVIDER = "dryrun"    (default) render + count, send nothing
                       = "resend"    send our own batch through Resend, with
                                     our own unsubscribe + suppression
                       = "mailchimp" Marketing API: audience → campaign → send

   The rest of the CRM (audiences built from contact filters, campaign
   records, suppression list, unsubscribe handling) is identical across
   providers. Adding a fourth channel later (Postmark, SES, SendGrid) means
   writing one more `sendVia*` function and adding it to dispatch().

   Everything here is pure logic + outbound fetches. Airtable I/O and route
   wiring live in worker.js, which passes contact/suppression data in. The
   branded email shell (dark header, LUXIGA wordmark, footer) comes from
   emails.js so transactional + campaign mail share one look.
*/

import { campaignBaseHtml, unsubPageHtml } from './emails.js';

export { unsubPageHtml };

export const PROVIDERS = ['dryrun', 'mailchimp', 'resend'];
export const CAMPAIGN_STATUSES = ['Draft', 'Sending', 'Sent', 'Failed'];

// Which channel is live. Unknown/unset → dryrun, so a fresh deploy with no
// secrets can still build audiences and preview sends without touching anyone.
export function activeProvider(env) {
  const p = (env.CAMPAIGN_PROVIDER || 'dryrun').toLowerCase();
  return PROVIDERS.includes(p) ? p : 'dryrun';
}

// Reports whether the active provider is actually configured to send. Drives
// the "sending is armed / dry-run only" badge in the admin UI so Lukas knows
// whether hitting Send will really mail people.
export function providerStatus(env) {
  const provider = activeProvider(env);
  let ready = true;
  const missing = [];
  if (provider === 'resend') {
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!(env.CAMPAIGN_FROM || env.NOTIFY_FROM)) missing.push('CAMPAIGN_FROM');
  } else if (provider === 'mailchimp') {
    if (!env.MAILCHIMP_API_KEY) missing.push('MAILCHIMP_API_KEY');
    if (!env.MAILCHIMP_LIST_ID) missing.push('MAILCHIMP_LIST_ID');
    if (!(env.CAMPAIGN_FROM || env.NOTIFY_FROM)) missing.push('CAMPAIGN_FROM');
  }
  if (missing.length) ready = false;
  return {
    provider,
    ready,                       // false for dryrun (by design) and for a half-configured live provider
    live: provider !== 'dryrun' && ready,
    missing,
    from: env.CAMPAIGN_FROM || env.NOTIFY_FROM || '(unset)',
    max_per_send: maxPerSend(env),
  };
}

function maxPerSend(env) {
  const n = parseInt(env.CAMPAIGN_MAX_PER_SEND || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 200; // warmup-friendly default; surfaced, never silent
}

// ---------------------------------------------------------------------------
// Merge tags. Body/subject authored by an admin (trusted). Values are escaped
// so a contact named `<b>` can't break the HTML. Supported: {{name}},
// {{first_name}}, {{city}}, {{email}}.
// ---------------------------------------------------------------------------
const TAG_RE = /\{\{\s*(name|first_name|city|email)\s*\}\}/g;

export function renderTemplate(str, contact) {
  if (!str) return '';
  const f = contact.fields || contact || {};
  const name = f.name || '';
  const first = name.trim().split(/\s+/)[0] || 'there';
  const map = {
    name: name || 'there',
    first_name: first,
    city: f.city || '',
    email: f.email || '',
  };
  return String(str).replace(TAG_RE, (_, key) => escapeHtml(map[key] != null ? map[key] : ''));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Audience builder. Turns a segment definition (arrays of allowed values per
// dimension; an empty/absent array means "no constraint on this dimension")
// into the concrete recipient list, applying the compliance filters that no
// send may bypass: valid email, not unsubscribed, not on the suppression list.
//
// segment = {
//   stages:   ["New","Contacted"],   owners: ["Lukas"],
//   sources:  ["Web Form","Card Scan"], cities: ["Portland"],
//   consent:  ["implied","express"], requireEmail: true (always enforced)
// }
// Returns { recipients:[{id,email,name,fields}], excluded:{no_email,unsubscribed,suppressed,filtered} }
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]{1,80}@[^\s@]{1,80}\.[^\s@]{1,10}$/;

export function buildAudience(contacts, suppressionEmails, segment) {
  const seg = segment || {};
  const supp = suppressionEmails instanceof Set
    ? suppressionEmails
    : new Set((suppressionEmails || []).map((e) => String(e).trim().toLowerCase()));
  const excluded = { no_email: 0, unsubscribed: 0, suppressed: 0, filtered: 0 };
  const recipients = [];
  const seenEmail = new Set();

  const inList = (val, allowed) => {
    if (!allowed || !allowed.length) return true;       // no constraint
    return allowed.map(String).includes(String(val || ''));
  };

  for (const rec of contacts || []) {
    const f = rec.fields || rec || {};
    const email = (f.email || '').trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email)) { excluded.no_email++; continue; }
    if ((f.email_status || 'subscribed') === 'unsubscribed') { excluded.unsubscribed++; continue; }
    if (supp.has(email)) { excluded.suppressed++; continue; }

    if (!inList(f.stage || 'New', seg.stages) ||
        !inList(f.owner, seg.owners) ||
        !inList(f.source, seg.sources) ||
        !inList(f.city, seg.cities) ||
        !inList(f.consent, seg.consent)) { excluded.filtered++; continue; }

    if (seenEmail.has(email)) continue;                 // de-dupe within the send
    seenEmail.add(email);
    recipients.push({ id: rec.id || '', email, name: f.name || '', fields: f });
  }
  return { recipients, excluded };
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens (HMAC-signed). Public, so they must be unforgeable:
// nobody should be able to craft a link that suppresses an arbitrary address.
// token = base64url(payload).base64url(hmac(payload))  where payload = {c,e}.
// ---------------------------------------------------------------------------
function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToString(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(pad + '==='.slice((pad.length + 3) % 4));
}

async function hmac(env, msg) {
  const secret = env.UNSUB_SECRET || 'lx-dev-unsub-secret-change-me';
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return b64urlEncode(new Uint8Array(sig));
}

export async function signUnsubToken(env, contactId, email) {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ c: contactId || '', e: email })));
  const sig = await hmac(env, payload);
  return `${payload}.${sig}`;
}

export async function verifyUnsubToken(env, token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [payload, sig] = token.split('.');
  const expected = await hmac(env, payload);
  if (sig !== expected) return null;                    // tampered / forged
  try {
    const obj = JSON.parse(b64urlDecodeToString(payload));
    if (!obj.e) return null;
    return { contactId: obj.c || '', email: String(obj.e).trim().toLowerCase() };
  } catch { return null; }
}

export function unsubBaseUrl(env) {
  return env.PUBLIC_BASE_URL || 'https://luxiga.co';
}

function bodyToHtml(body) {
  // If the admin already wrote HTML (contains a tag), pass through. Otherwise
  // treat as plain text: escape and convert newlines to <br>.
  if (/<[a-z][\s\S]*>/i.test(body || '')) return body;
  return escapeHtml(body || '').replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// dispatch(): the one entry point worker.js calls. Picks the channel, renders
// per recipient, sends, and returns a uniform summary regardless of provider.
//   opts.dryRunOverride = true forces dryrun (used by the Preview endpoint).
// ---------------------------------------------------------------------------
export async function dispatch(env, campaign, recipients, opts = {}) {
  const provider = opts.dryRunOverride ? 'dryrun' : activeProvider(env);
  const cap = maxPerSend(env);
  let truncated = 0;
  let list = recipients;
  if (list.length > cap && provider !== 'dryrun') {
    truncated = list.length - cap;                      // surfaced in the result, never silent
    list = list.slice(0, cap);
  }

  let result;
  if (provider === 'dryrun') result = await sendViaDryrun(env, campaign, list);
  else if (provider === 'resend') result = await sendViaResend(env, campaign, list);
  else if (provider === 'mailchimp') result = await sendViaMailchimp(env, campaign, list);
  else result = { ok: false, sent: 0, failed: list.length, detail: 'unknown_provider' };

  return { ...result, provider, requested: recipients.length, truncated, cap };
}

// dryrun: render every email, send nothing, return a sample so the admin can
// eyeball the merged result and confirm the recipient count before going live.
async function sendViaDryrun(env, campaign, recipients) {
  const sample = recipients.slice(0, 3).map((r) => ({
    to: r.email,
    subject: renderTemplate(campaign.subject, r),
    body: renderTemplate(campaign.body, r),
  }));
  return { ok: true, sent: 0, failed: 0, would_send: recipients.length, sample, detail: 'dry_run_no_email_sent' };
}

// resend: batch through Resend (/emails/batch, ≤100 per call). Each message is
// wrapped in the branded LUXIGA shell (campaignBaseHtml) with its own one-click
// unsubscribe header + footer. This is the "send our own" path.
async function sendViaResend(env, campaign, recipients) {
  const from = env.CAMPAIGN_FROM || env.NOTIFY_FROM;
  if (!env.RESEND_API_KEY || !from) {
    return { ok: false, sent: 0, failed: recipients.length, detail: 'resend_not_configured' };
  }
  const base = unsubBaseUrl(env);
  const postal = env.CAMPAIGN_POSTAL_ADDRESS || 'LUXIGA LLC';
  const replyTo = env.CAMPAIGN_REPLY_TO || env.NOTIFY_TO || env.LUKAS_EMAIL;
  let sent = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const emails = await Promise.all(chunk.map(async (r) => {
      const token = await signUnsubToken(env, r.id, r.email);
      const unsubUrl = `${base}/api/unsub?t=${encodeURIComponent(token)}`;
      const html = campaignBaseHtml({
        subject: renderTemplate(campaign.subject, r),
        preview: renderTemplate(campaign.preview_text, r),
        bodyHtml: bodyToHtml(renderTemplate(campaign.body, r)),
        unsubUrl,
        postal,
      });
      const msg = {
        from,
        to: [r.email],
        subject: renderTemplate(campaign.subject, r),
        html,
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
      if (replyTo) msg.reply_to = replyTo;
      return msg;
    }));

    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emails),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        sent += chunk.length;
      } else {
        failed += chunk.length;
        errors.push({ status: res.status, data });
        console.log('resend_batch_error', { status: res.status, data });
      }
    } catch (e) {
      failed += chunk.length;
      errors.push({ detail: String(e && e.message || e) });
    }
  }
  return { ok: failed === 0, sent, failed, detail: errors.length ? errors : 'sent', channel: 'resend' };
}

// mailchimp: the managed-tier path. Marketing API flow —
//   1. upsert each recipient as a subscribed member of the audience
//   2. create a static segment from exactly this recipient set
//   3. create a regular campaign targeting that segment, set content
//   4. send it
// Mailchimp owns unsubscribe/analytics from here; we still excluded our own
// suppression list at audience-build time so we never re-mail an opt-out.
async function sendViaMailchimp(env, campaign, recipients) {
  const key = env.MAILCHIMP_API_KEY;
  const listId = env.MAILCHIMP_LIST_ID;
  const from = env.CAMPAIGN_FROM || env.NOTIFY_FROM;
  if (!key || !listId || !from) {
    return { ok: false, sent: 0, failed: recipients.length, detail: 'mailchimp_not_configured' };
  }
  // Server prefix (dc) is the bit after the dash in the API key, e.g. "-us21".
  const dc = env.MAILCHIMP_SERVER_PREFIX || (key.indexOf('-') !== -1 ? key.split('-').pop() : '');
  if (!dc) return { ok: false, sent: 0, failed: recipients.length, detail: 'mailchimp_no_server_prefix' };
  const api = `https://${dc}.api.mailchimp.com/3.0`;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function mc(path, method, body) {
    const res = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }

  try {
    // 1. Upsert members. subscriber hash = md5(lowercase email).
    for (const r of recipients) {
      const hash = await md5(r.email);
      const first = (r.name || '').trim().split(/\s+/)[0] || '';
      await mc(`/lists/${listId}/members/${hash}`, 'PUT', {
        email_address: r.email,
        status_if_new: 'subscribed',
        merge_fields: first ? { FNAME: first } : {},
      });
    }

    // 2. Static segment holding exactly this audience.
    const segName = `LX:${(campaign.name || 'campaign').slice(0, 40)}:${recipients.length}`;
    const seg = await mc(`/lists/${listId}/segments`, 'POST', {
      name: segName,
      static_segment: recipients.map((r) => r.email),
    });

    // 3. Create the campaign targeting that segment.
    const created = await mc('/campaigns', 'POST', {
      type: 'regular',
      recipients: { list_id: listId, segment_opts: { saved_segment_id: seg.id } },
      settings: {
        subject_line: campaign.subject || '(no subject)',
        preview_text: campaign.preview_text || '',
        title: campaign.name || 'LUXIGA Campaign',
        from_name: env.MAILCHIMP_FROM_NAME || 'LUXIGA',
        reply_to: env.NOTIFY_TO || env.LUKAS_EMAIL || from,
      },
    });

    // 4. Content. Mailchimp requires *|UNSUB|* somewhere; it injects the footer.
    const html = bodyToHtml(campaign.body || '') +
      '<p style="font-size:12px;color:#888;"><a href="*|UNSUB|*">Unsubscribe</a></p>';
    await mc(`/campaigns/${created.id}/content`, 'PUT', { html });

    // 5. Send.
    await mc(`/campaigns/${created.id}/actions/send`, 'POST');

    return { ok: true, sent: recipients.length, failed: 0, detail: 'queued_by_mailchimp', mailchimp_campaign_id: created.id, channel: 'mailchimp' };
  } catch (e) {
    console.log('mailchimp_error', { detail: String(e && e.message || e) });
    return { ok: false, sent: 0, failed: recipients.length, detail: String(e && e.message || e), channel: 'mailchimp' };
  }
}

// md5 for Mailchimp subscriber hashes. WebCrypto has no MD5, so a compact
// implementation. Input is always a short email string.
async function md5(str) {
  // Minimal MD5 (RFC 1321). Adapted for Workers (no Node crypto).
  function toBytes(s) { return new TextEncoder().encode(s); }
  function add(a, b) { return (a + b) & 0xffffffff; }
  function rol(x, c) { return (x << c) | (x >>> (32 - c)); }
  const bytes = toBytes(str);
  const bitLen = bytes.length * 8;
  const withOne = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 8, bitLen & 0xffffffff, true);
  dv.setUint32(withOne.length - 4, Math.floor(bitLen / 0x100000000), true);

  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < withOne.length; off += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = add(add(add(F, A), K[i]), M[g]);
      A = D; D = C; C = B; B = add(B, rol(F, s[i]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true); odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  return Array.from(out).map((b) => b.toString(16).padStart(2, '0')).join('');
}
