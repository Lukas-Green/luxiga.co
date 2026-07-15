import {
  activeProvider, providerStatus, buildAudience, dispatch,
  verifyUnsubToken, unsubPageHtml,
} from './campaigns.js';
import {
  workRequestNotifyHtml, workRequestReceiptHtml, internalDigestHtml,
} from './emails.js';

/**
 * LUXIGA — CRM + Airtable proxy Worker (hardened, CF Access aware)
 *
 * The API + email engine behind the LUXIGA CRM admin. Ported from the Golden
 * Goose Construction worker; affiliates / QR scans / lead-pipeline logic dropped,
 * retargeted for a solo software/product-design studio (Lukas Green, LUXIGA LLC).
 *
 * Deploy:   npx wrangler deploy
 * Secrets:  npx wrangler secret put AIRTABLE_TOKEN        <-- Airtable PAT (was AIRTABLE_API_KEY in GGC)
 *           npx wrangler secret put AIRTABLE_BASE_ID
 *           npx wrangler secret put ADMIN_TOKEN           <-- legacy bearer fallback (optional)
 *
 *           # Cloudflare Access auth (protects /api/admin/*):
 *           npx wrangler secret put CF_ACCESS_TEAM_DOMAIN <-- e.g. luxiga.cloudflareaccess.com
 *           npx wrangler secret put CF_ACCESS_AUD         <-- Application Audience tag from the Access app
 *
 *           # Resend (transactional + digest email):
 *           npx wrangler secret put RESEND_API_KEY
 *           npx wrangler secret put NOTIFY_FROM           <-- e.g. "Lukas Green · LUXIGA <lukas@lukasdgreen.com>"
 *           npx wrangler secret put NOTIFY_TO             <-- where internal notices land (lukas@lukasdgreen.com)
 *
 * Routes (Cloudflare dashboard → Workers Routes):
 *   - luxiga.co/api/*  → luxiga-crm-api
 *
 * Auth model:
 *   - Public POSTs (/api/work-request, /api/lead): no auth, rate-limited + honeypot.
 *   - Admin reads/updates (/api/admin/*):
 *       1) PRIMARY: Cloudflare Access JWT in Cf-Access-Jwt-Assertion header.
 *          CF attaches this automatically once the Worker is on luxiga.co/api/*
 *          and the matching Access app covers those paths.
 *       2) FALLBACK: Authorization: Bearer ADMIN_TOKEN (legacy, optional).
 *          To remove: npx wrangler secret put DISABLE_ADMIN_TOKEN  (value: true)
 *
 * Hardening:
 *   - CORS locked to CORS_ALLOWED_ORIGIN (same-origin luxiga.co needs no CORS)
 *   - In-memory IP rate limiting (30 req/min per IP, per Worker instance)
 *   - Payload size cap (10 KB)
 *   - Input validation + field allowlist (prevents Airtable schema pollution)
 *   - Honeypot detection (silent success for known bot fields)
 *
 * Known limits:
 *   - Rate limit is per-Worker-instance — not global. For real DDoS protection
 *     use Cloudflare WAF rate-limiting rules at the zone level.
 *   - Worker-side CF Access JWT validation fetches public keys from
 *     ${CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs and caches them 1h.
 */

const CORS_ALLOWED_ORIGIN = 'https://luxiga.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': CORS_ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const LIMITS = {
  MAX_BODY_BYTES: 10 * 1024,      // 10 KB
  RATE_WINDOW_MS: 60 * 1000,      // 1 minute
  RATE_MAX_REQS: 30,              // per IP, per Worker instance
};

// --- In-memory rate limiter (per Worker instance) ---
// Map<ip, { count, windowStart }>
const rateBucket = new Map();

function rateLimit(ip) {
  if (!ip) return { ok: true };
  const now = Date.now();
  const entry = rateBucket.get(ip);
  if (!entry || now - entry.windowStart > LIMITS.RATE_WINDOW_MS) {
    rateBucket.set(ip, { count: 1, windowStart: now });
    return { ok: true };
  }
  entry.count++;
  if (entry.count > LIMITS.RATE_MAX_REQS) {
    const retryAfter = Math.ceil((LIMITS.RATE_WINDOW_MS - (now - entry.windowStart)) / 1000);
    return { ok: false, retryAfter };
  }
  return { ok: true };
}

// Opportunistic cleanup so the Map doesn't grow unbounded over the Worker's lifetime
function cleanupRateBucket() {
  if (rateBucket.size < 1000) return;
  const now = Date.now();
  for (const [ip, entry] of rateBucket) {
    if (now - entry.windowStart > LIMITS.RATE_WINDOW_MS * 2) rateBucket.delete(ip);
  }
}

// --- Field allowlists (prevents attackers from injecting arbitrary Airtable fields) ---
// A Contact is the person; an Interaction is one logged touch (call/text/note).
// 'contact' on Interactions is an Airtable link field (array of record ids).
// 'created_at' is an Airtable "created time" field — auto-populated, never
// written by us, so it's intentionally absent here.
const CONTACT_FIELDS = new Set([
  'name', 'phone', 'email', 'address', 'city', 'stage', 'source', 'owner',
  'next_follow_up_date', 'last_contacted', 'notes',
  // Marketing/compliance (campaign engine): whether this contact may be mailed,
  // their consent level, and when they opted out. See campaigns.js.
  'email_status', 'consent', 'unsub_at',
]);
const INTERACTION_FIELDS = new Set([
  'contact', 'type', 'direction', 'date', 'summary', 'next_action', 'logged_by',
]);
// Marketing campaigns. A Campaign is a saved audience filter + email content +
// send status. `audience` is a JSON string (segment definition). Provider is
// whichever channel actually sent it (dryrun/mailchimp/resend). See campaigns.js.
const CAMPAIGN_FIELDS = new Set([
  'name', 'subject', 'preview_text', 'body', 'status', 'provider',
  'audience', 'recipient_count', 'sent_count', 'sent_at', 'notes',
]);
// Do-not-email list. Contact-independent so an opt-out survives even if the
// contact record is deleted/recreated. Audience builds always exclude these.
const SUPPRESSION_FIELDS = new Set([
  'email', 'reason', 'source_campaign', 'added_at',
]);

// CRM single-select Source options. The business card sends a marketing medium
// (e.g. "linkedin", "direct") that isn't one of these; work-request maps it to
// a valid option and keeps the raw medium as attribution. Card = 'Card Scan'.
const VALID_CONTACT_SOURCES = new Set([
  'Card Scan', 'Referral', 'Web Form', 'Pulse', 'Partner', 'Manual',
]);

// --- Honeypot: any field matching these names is a bot signal ---
const HONEYPOT_FIELDS = ['website', 'url_hp'];

// --- Content spam: well-formed solicitations (SEO / lead-gen / cold-outreach
// pitches) pass validation AND the honeypot because the real fields get filled
// in normally. Flag the request as spam, still write the contact so it's visible
// in admin, but skip Lukas's notification + the auto-reply.
const SPAM_PATTERNS = [
  /\bSEO\b|\bback\s?links?\b|\bguest post/i,
  /\brank (your|the) (site|website|business)\b/i,
  /\blead generation\b|\blead-gen\b/i,
  /\b(bulk|cold)[ -]?(email|outreach)\b/i,
  /\bwe (provide|offer|specialize)\b[\s\S]{0,60}\b(services?|solutions?|leads?)\b/i,
  /\bincrease (your )?(traffic|sales|revenue|ranking)\b/i,
  /\boutsourc(e|ing)\b[\s\S]{0,40}\b(developer|development|team)\b/i,
];

function isSpammy(f) {
  const haystack = [f.message, f.name].filter(Boolean).join(' ');
  if (!haystack) return false;
  return SPAM_PATTERNS.some((re) => re.test(haystack));
}

// --- Validation helpers ---
const EMAIL_RE = /^[^\s@]{1,80}@[^\s@]{1,80}\.[^\s@]{1,10}$/;

function validateString(val, max) {
  return typeof val === 'string' && val.length > 0 && val.length <= max;
}

function filterFields(obj, allowlist) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (allowlist.has(k)) out[k] = obj[k];
  }
  return out;
}

// --- Auth: accept either a valid Cloudflare Access JWT (preferred) or a valid
// ADMIN_TOKEN (legacy fallback). Once the Worker is routed under luxiga.co/api/*
// and the matching Access app paths are configured, every authenticated browser
// request from admin.html carries Cf-Access-Jwt-Assertion automatically. We
// validate it against Cloudflare's public keys at
// ${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs.
//
// To kill the fallback later, set DISABLE_ADMIN_TOKEN=true via wrangler secret.
async function checkAdminAuth(request, env) {
  // Path 1: Cloudflare Access JWT
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (cfJwt && env.CF_ACCESS_TEAM_DOMAIN) {
    const result = await verifyCfAccessJwt(cfJwt, env);
    if (result.ok) return true;
    // Fall through to ADMIN_TOKEN only if JWT was malformed/expired,
    // not if it was forged (signature failure)
    if (result.fatal) {
      console.log('cf_access_jwt_rejected', { reason: result.reason });
      return false;
    }
  }

  // Path 2: ADMIN_TOKEN bearer (legacy)
  if (env.DISABLE_ADMIN_TOKEN === 'true') return false;
  if (!env.ADMIN_TOKEN) return false;
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/);
  if (!match) return false;
  const a = match[1];
  const b = env.ADMIN_TOKEN;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- Cloudflare Access JWT verification ---
// Cloudflare signs the JWT with RS256 and publishes the public keys at
// https://<team>.cloudflareaccess.com/cdn-cgi/access/certs.
// We cache parsed keys for 1 hour (keys rotate slowly).
const CF_KEY_CACHE = new Map(); // kid -> { key: CryptoKey, expiresAt: number }
const CF_KEY_CACHE_TTL_MS = 60 * 60 * 1000;

async function verifyCfAccessJwt(token, env) {
  // Parse JWT structure
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, fatal: true, reason: 'bad_format' };
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64UrlDecodeToString(headerB64));
    payload = JSON.parse(b64UrlDecodeToString(payloadB64));
  } catch {
    return { ok: false, fatal: true, reason: 'bad_json' };
  }

  // Claim checks (cheap before signature)
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { ok: false, fatal: true, reason: 'expired' };
  if (payload.nbf && payload.nbf > now + 60) return { ok: false, fatal: true, reason: 'not_yet_valid' };
  const expectedIss = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  if (payload.iss !== expectedIss) return { ok: false, fatal: true, reason: 'bad_iss' };
  if (env.CF_ACCESS_AUD) {
    const audMatch = Array.isArray(payload.aud)
      ? payload.aud.includes(env.CF_ACCESS_AUD)
      : payload.aud === env.CF_ACCESS_AUD;
    if (!audMatch) return { ok: false, fatal: true, reason: 'bad_aud' };
  }

  // Resolve signing key
  const key = await getCfAccessKey(header.kid, env);
  if (!key) return { ok: false, fatal: true, reason: 'unknown_kid' };

  // Verify signature
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64UrlDecodeToBytes(sigB64);
  const valid = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, data);
  if (!valid) return { ok: false, fatal: true, reason: 'bad_signature' };

  return { ok: true, email: payload.email, sub: payload.sub };
}

async function getCfAccessKey(kid, env) {
  if (!kid) return null;
  const cached = CF_KEY_CACHE.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const url = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log('cf_access_certs_fetch_failed', { status: res.status });
      return null;
    }
    const data = await res.json();
    // The endpoint returns { keys: [{ kid, kty, alg, use, n, e }, ...] }
    for (const jwk of data.keys || []) {
      try {
        const k = await crypto.subtle.importKey(
          'jwk',
          { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        CF_KEY_CACHE.set(jwk.kid, { key: k, expiresAt: Date.now() + CF_KEY_CACHE_TTL_MS });
      } catch (e) {
        console.log('cf_access_key_import_failed', { kid: jwk.kid, err: String(e) });
      }
    }
    const cached2 = CF_KEY_CACHE.get(kid);
    return cached2 ? cached2.key : null;
  } catch (err) {
    console.log('cf_access_certs_exception', { err: String(err && err.message || err) });
    return null;
  }
}

function b64UrlDecodeToString(s) {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function b64UrlDecodeToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// --- Main handler ---
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const ip = request.headers.get('cf-connecting-ip') || '';
    const rl = rateLimit(ip);
    if (!rl.ok) {
      return json({ error: 'rate_limited', retry_after: rl.retryAfter }, 429, {
        'Retry-After': String(rl.retryAfter),
      });
    }
    cleanupRateBucket();

    const url = new URL(request.url);

    try {
      // ROUTING
      //
      // PUBLIC endpoints (no auth — used by luxiga.co/card and forms):
      //   POST /api/work-request   work requests from the business card
      //   POST /api/lead           alias of /api/work-request (card posts here)
      //   POST /api/event          fire-and-forget interaction beacon (202/204)
      //   GET  /api/unsub          one-click unsubscribe (signed token)
      //   */api/mailchimp/webhook  Mailchimp unsubscribe/cleaned sync
      //
      // ADMIN endpoints (Cloudflare Access JWT or ADMIN_TOKEN required):
      //   see /api/admin/* routes below. The /api/admin/* prefix lets Cloudflare
      //   Access protect everything admin-related with a single wildcard entry.

      // --- Public endpoints ---
      if (request.method === 'POST' && (url.pathname === '/api/work-request' || url.pathname === '/api/lead')) {
        return await handleWorkRequest(env, request, ctx);
      }
      // Interaction beacon from the card (navigator.sendBeacon). No persistence
      // in the CRM base (analytics live in the standalone card-worker dashboard);
      // we accept and 204 so the beacon never errors. Documented in README.
      if (request.method === 'POST' && url.pathname === '/api/event') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      // Public one-click unsubscribe (recipients aren't logged in). Signed token
      // in ?t= proves the address; adds it to Suppression + flags the contact.
      if (request.method === 'GET' && url.pathname === '/api/unsub') {
        return await handleUnsubscribe(env, url);
      }
      // Mailchimp webhook: syncs their native unsubscribes back into our
      // Suppression list so both channels honor the same opt-outs.
      if (url.pathname === '/api/mailchimp/webhook') {
        if (request.method === 'GET') return new Response('ok', { status: 200 });
        if (request.method === 'POST') return await handleMailchimpWebhook(env, request);
      }

      // --- Admin: digest / test ---
      if (request.method === 'POST' && url.pathname === '/api/admin/weekly-digest-now') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        ctx.waitUntil(sendWeeklyDigest(env));
        return json({ ok: true, message: 'Weekly digest queued (sending in background)' });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/notify-test') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleNotifyTest(env, ctx);
      }

      // --- Admin: CRM ---
      if (request.method === 'GET' && url.pathname === '/api/admin/contacts') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await listRecords(env, 'Contacts', 'contacts');
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/interactions') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await listRecords(env, 'Interactions', 'interactions');
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/contact') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleCreateContact(env, request);
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/interaction') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleCreateInteraction(env, request);
      }
      if (request.method === 'PATCH' && url.pathname.startsWith('/api/admin/contact/')) {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        const id = url.pathname.split('/').pop();
        return await updateRecord(env, 'Contacts', id, request);
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/import-leads-to-contacts') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleImportLeadsToContacts(env, request);
      }

      // --- Admin: marketing campaigns ---
      if (request.method === 'GET' && url.pathname === '/api/admin/campaign-config') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return json(providerStatus(env));
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/campaigns') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await listRecords(env, 'Campaigns', 'campaigns');
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/campaign') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleCreateCampaign(env, request);
      }
      if (request.method === 'PATCH' && url.pathname.startsWith('/api/admin/campaign/')) {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        const id = url.pathname.split('/').pop();
        return await updateRecord(env, 'Campaigns', id, request);
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/admin/campaign/')) {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        const id = url.pathname.split('/').pop();
        return await deleteRecord(env, 'Campaigns', id);
      }
      // Preview = build the audience and render, but send nothing (dry run).
      if (request.method === 'POST' && url.pathname === '/api/admin/campaign-preview') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleCampaignSend(env, request, { preview: true });
      }
      // Send = build audience, dispatch through the active provider, log result.
      if (request.method === 'POST' && url.pathname.startsWith('/api/admin/campaign-send/')) {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        const id = url.pathname.split('/').pop();
        return await handleCampaignSend(env, request, { campaignId: id });
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/suppression') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await listRecords(env, 'Suppression', 'suppression');
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/suppression') {
        if (!(await checkAdminAuth(request, env))) return json({ error: 'unauthorized' }, 401);
        return await handleAddSuppression(env, request);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error', detail: err.message }, 500);
    }
  },

  // Cloudflare Cron Trigger entry point. Configured in wrangler.toml.
  //   Monday 15:00 UTC → weekly digest (new contacts + follow-ups due) to Lukas.
  //   Daily  16:00 UTC → follow-ups-due nudge.
  // Both no-op safely when nothing applies or secrets are missing.
  async scheduled(event, env, ctx) {
    if (event.cron === '0 15 * * 1') {
      ctx.waitUntil(sendWeeklyDigest(env));
    } else if (event.cron === '0 16 * * *') {
      ctx.waitUntil(sendFollowupNudge(env));
    } else {
      ctx.waitUntil(sendWeeklyDigest(env));
      ctx.waitUntil(sendFollowupNudge(env));
    }
  },
};

// --- Body reader with size cap ---
async function readBody(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > LIMITS.MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (text.length > LIMITS.MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { invalid: true };
  }
}

// ===========================================================================
// Public: work request (business card → CRM)
// ===========================================================================
//
// POST /api/work-request (and /api/lead alias). Accepts BOTH:
//   - the business-card shape:  { name, contact, message, source?, sid? }
//     (the card sends one combined `contact` field — email OR phone)
//   - the documented shape:     { name, email, phone?, message?, source? }
//
// It (1) creates/matches a Contact (source 'Card Scan' or a provided valid CRM
// source, stage 'New', owner 'Lukas'); (2) logs an inbound Interaction; (3)
// emails Lukas via workRequestNotifyHtml; (4) auto-replies to the requester via
// workRequestReceiptHtml. Rate-limited (fetch-level) + honeypot.
async function handleWorkRequest(env, request, ctx) {
  const parsed = await readBody(request);
  if (parsed.tooLarge) return json({ error: 'payload_too_large' }, 413);
  if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
  const raw = parsed.body || {};

  // Honeypot — silently fake success so bots don't retry.
  for (const hp of HONEYPOT_FIELDS) {
    if (raw[hp]) {
      console.log('honeypot_triggered', { endpoint: 'work-request', field: hp });
      return json({ ok: true, id: 'hp_' + Date.now(), fake: true }, 201);
    }
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  let email = typeof raw.email === 'string' ? raw.email.trim() : '';
  let phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  const combined = typeof raw.contact === 'string' ? raw.contact.trim() : '';
  if (combined && !email && !phone) {
    if (combined.includes('@')) email = combined; else phone = combined;
  }
  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  const rawSource = typeof raw.source === 'string' ? raw.source.trim() : '';

  // Validate.
  if (!validateString(name, 100)) return json({ error: 'validation_failed', detail: 'name required (≤100 chars)' }, 400);
  if (!email && !phone) return json({ error: 'validation_failed', detail: 'email or phone required' }, 400);
  if (email && !(validateString(email, 200) && EMAIL_RE.test(email))) return json({ error: 'validation_failed', detail: 'invalid email' }, 400);
  if (phone && !validateString(phone, 40)) return json({ error: 'validation_failed', detail: 'phone too long' }, 400);
  if (message.length > 2000) return json({ error: 'validation_failed', detail: 'message too long (≤2000)' }, 400);

  // Map the card's marketing medium to a valid CRM Source select; keep the raw
  // medium as attribution. Default 'Card Scan' — the card is the channel.
  const source = VALID_CONTACT_SOURCES.has(rawSource) ? rawSource : 'Card Scan';
  const attribution = rawSource && rawSource.toLowerCase() !== 'direct' && !VALID_CONTACT_SOURCES.has(rawSource)
    ? ` (via ${rawSource})` : '';

  const when = new Date().toISOString();
  const today = when.split('T')[0];
  const spam = isSpammy({ name, message });

  // Match an existing contact by email/phone so repeat requesters don't
  // duplicate. Best-effort — on lookup failure we just create a new one.
  let contact = null;
  try {
    const contacts = await fetchAllRecords(env, 'Contacts');
    contact = findContactMatch(contacts, { email, phone });
  } catch (e) {
    console.log('work_request_contact_lookup_failed', { detail: e.message });
  }

  let contactId;
  if (contact) {
    contactId = contact.id;
    // Roll last_contacted; don't clobber an existing stage (they may already be
    // an Active Client). Only stamp a follow-up if none is set.
    const patch = { last_contacted: today };
    if (!(contact.fields || {}).next_follow_up_date) patch.next_follow_up_date = today;
    await airtablePatch(env, 'Contacts', contactId, patch);
  } else {
    const created = await airtableCreate(env, 'Contacts', {
      name,
      email: email || '',
      phone: phone || '',
      stage: 'New',
      source,
      owner: 'Lukas',
      next_follow_up_date: today,
      notes: `Work request via card${attribution}.`,
    });
    if (!created) return json({ error: 'airtable_error', detail: 'contact_create_failed' }, 502);
    contactId = created.id;
  }

  // Log the inbound touch.
  await airtableCreate(env, 'Interactions', {
    contact: [contactId],
    type: 'Note',
    direction: 'Inbound',
    date: when,
    summary: `Work request via card${attribution}${message ? ': ' + message.slice(0, 500) : ''}`,
    logged_by: 'Lukas',
  });

  // Notify Lukas + auto-reply the requester (both skipped on spam).
  if (spam) {
    console.log('work_request_flagged_spam', { name });
  } else if (ctx?.waitUntil) {
    const payload = { name, email, phone, message, source: source + attribution, when };
    ctx.waitUntil(notifyWorkRequest(env, payload));
    if (email) ctx.waitUntil(sendWorkRequestReceipt(env, { name, email }));
  }

  return json({ ok: true, id: contactId, spam: spam || undefined }, 201);
}

async function handleNotifyTest(env, ctx) {
  const d = {
    name: 'TEST — Work Request Notification Check',
    email: 'noreply@test.invalid',
    phone: '555-000-0000',
    message: 'This is a test of the work-request notification path. Safe to ignore — no real person is waiting.',
    source: 'Card Scan (test)',
    when: new Date().toISOString(),
  };
  if (ctx?.waitUntil) ctx.waitUntil(notifyWorkRequest(env, d, { isTest: true }));
  else await notifyWorkRequest(env, d, { isTest: true });
  return json({ ok: true, message: 'Test notification queued', to: internalRecipient(env) || '(NOTIFY_TO not set)' });
}

// ===========================================================================
// Airtable CRUD
// ===========================================================================
async function createRecord(env, table, fields) {
  const res = await fetch(airtableURL(env, table), {
    method: 'POST',
    headers: airtableHeaders(env),
    // typecast lets Airtable coerce strings into select options (and create new
    // ones) instead of rejecting the write.
    body: JSON.stringify({ fields, typecast: true }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: 'airtable_error', detail: data }, res.status);
  return json(data, 201);
}

// Paginate so the admin sees every record, not just the first 100. Caps at 20
// pages (2000 records). Wraps the array under a named key the frontend expects
// (e.g. { contacts: [...] }) plus `records` for compatibility.
async function listRecords(env, table, key) {
  const records = [];
  let offset = '';
  for (let page = 0; page < 20; page++) {
    const url = `${airtableURL(env, table)}?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
    const res = await fetch(url, { headers: airtableHeaders(env) });
    const data = await res.json();
    if (!res.ok) return json({ error: 'airtable_error', detail: data }, res.status);
    records.push(...(data.records || []));
    if (!data.offset) break;
    offset = data.offset;
  }
  const payload = { records };
  if (key) payload[key] = records;
  return json(payload);
}

async function deleteRecord(env, table, recordId) {
  const res = await fetch(`${airtableURL(env, table)}/${recordId}`, {
    method: 'DELETE',
    headers: airtableHeaders(env),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: 'airtable_error', detail: data }, res.status);
  return json(data);
}

async function updateRecord(env, table, recordId, request) {
  const parsed = await readBody(request);
  if (parsed.tooLarge) return json({ error: 'payload_too_large' }, 413);
  if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
  const raw = parsed.body || {};

  const fields = filterFields(raw, allowlistFor(table));
  if (Object.keys(fields).length === 0) return json({ error: 'no_valid_fields' }, 400);

  const res = await fetch(`${airtableURL(env, table)}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(env),
    body: JSON.stringify({ fields, typecast: true }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: 'airtable_error', detail: data }, res.status);
  return json(data);
}

function allowlistFor(table) {
  switch (table) {
    case 'Contacts': return CONTACT_FIELDS;
    case 'Interactions': return INTERACTION_FIELDS;
    case 'Campaigns': return CAMPAIGN_FIELDS;
    case 'Suppression': return SUPPRESSION_FIELDS;
    default: return new Set();
  }
}

// --- CRM handlers ---

// Create a Contact (person). Used for manual adds in the admin; work requests
// create contacts via handleWorkRequest.
async function handleCreateContact(env, request) {
  const parsed = await readBody(request);
  if (parsed.tooLarge) return json({ error: 'payload_too_large' }, 413);
  if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
  const raw = parsed.body || {};
  if (!validateString(raw.name, 100)) return json({ error: 'validation_failed', detail: 'name required (≤100 chars)' }, 400);

  const fields = filterFields(raw, CONTACT_FIELDS);
  fields.stage = fields.stage || 'New';
  fields.source = fields.source || 'Manual';
  fields.owner = fields.owner || 'Lukas';

  return createRecord(env, 'Contacts', fields);
}

// Log an Interaction against a Contact, and roll the contact's last_contacted
// (and optional next_follow_up_date) forward in the same call.
async function handleCreateInteraction(env, request) {
  const parsed = await readBody(request);
  if (parsed.tooLarge) return json({ error: 'payload_too_large' }, 413);
  if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
  const raw = parsed.body || {};

  const contactId = Array.isArray(raw.contact) ? raw.contact[0] : raw.contact;
  if (!contactId || typeof contactId !== 'string') return json({ error: 'validation_failed', detail: 'contact id required' }, 400);
  if (!validateString(raw.type, 40)) return json({ error: 'validation_failed', detail: 'type required' }, 400);
  if (raw.summary && typeof raw.summary === 'string' && raw.summary.length > 4000) return json({ error: 'validation_failed', detail: 'summary too long (≤4000)' }, 400);

  const fields = filterFields(raw, INTERACTION_FIELDS);
  fields.contact = [contactId];                 // Airtable link field wants an array of record ids
  fields.date = fields.date || new Date().toISOString();
  fields.logged_by = fields.logged_by || 'Lukas';

  const res = await fetch(airtableURL(env, 'Interactions'), {
    method: 'POST', headers: airtableHeaders(env),
    body: JSON.stringify({ fields, typecast: true }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: 'airtable_error', detail: data }, res.status);

  // Best-effort contact roll-forward. A failure here must not lose the logged
  // interaction, so we swallow errors and still return the created record.
  const contactPatch = { last_contacted: (fields.date).split('T')[0] };
  if (raw.next_follow_up_date) contactPatch.next_follow_up_date = raw.next_follow_up_date;
  try {
    await fetch(`${airtableURL(env, 'Contacts')}/${contactId}`, {
      method: 'PATCH', headers: airtableHeaders(env),
      body: JSON.stringify({ fields: filterFields(contactPatch, CONTACT_FIELDS), typecast: true }),
    });
  } catch (e) {
    console.log('contact_rollforward_failed', { contactId, detail: e.message });
  }

  return json(data, 201);
}

// Kept for API compatibility with the shared frontend contract. LUXIGA has no
// separate Leads table (work requests create Contacts directly), so this is a
// safe, idempotent near-no-op.
async function handleImportLeadsToContacts(env, request) {
  await readBody(request).catch(() => ({}));
  return json({
    created: 0,
    updated: 0,
    note: 'No Leads table in the LUXIGA base — work requests create Contacts directly.',
  });
}

// --- Marketing campaign handlers ---

// Create a campaign draft. `audience` may arrive as an object or a JSON string;
// we always persist it as a JSON string (Airtable long-text field).
async function handleCreateCampaign(env, request) {
  const parsed = await readBody(request);
  if (parsed.tooLarge) return json({ error: 'payload_too_large' }, 413);
  if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
  const raw = parsed.body || {};
  if (!validateString(raw.name, 120)) return json({ error: 'validation_failed', detail: 'name required (≤120 chars)' }, 400);

  const fields = filterFields(raw, CAMPAIGN_FIELDS);
  if (fields.audience && typeof fields.audience !== 'string') fields.audience = JSON.stringify(fields.audience);
  fields.status = fields.status || 'Draft';

  return createRecord(env, 'Campaigns', fields);
}

// Preview (opts.preview): build the audience from a draft in the request body,
// render, and return counts + a sample — sends nothing regardless of provider.
// Send (opts.campaignId): load the saved campaign, build the audience, dispatch
// through the active provider, and write the result back onto the record.
async function handleCampaignSend(env, request, opts = {}) {
  const [contacts, suppression] = await Promise.all([
    fetchAllRecords(env, 'Contacts'),
    getSuppressionEmails(env),
  ]);

  let campaign;
  const campaignId = opts.campaignId;
  if (opts.preview) {
    const parsed = await readBody(request);
    if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
    const raw = parsed.body || {};
    campaign = {
      name: raw.name || '(preview)',
      subject: raw.subject || '',
      preview_text: raw.preview_text || '',
      body: raw.body || '',
      audience: parseAudience(raw.audience),
    };
  } else {
    const res = await fetch(`${airtableURL(env, 'Campaigns')}/${campaignId}`, { headers: airtableHeaders(env) });
    if (!res.ok) return json({ error: 'campaign_not_found' }, 404);
    const rec = await res.json();
    const f = rec.fields || {};
    if (f.status === 'Sent') return json({ error: 'already_sent', detail: 'This campaign was already sent. Duplicate it to send again.' }, 409);
    campaign = {
      name: f.name || '', subject: f.subject || '', preview_text: f.preview_text || '',
      body: f.body || '', audience: parseAudience(f.audience),
    };
  }

  const { recipients, excluded } = buildAudience(contacts, suppression, campaign.audience);

  if (opts.preview) {
    const result = await dispatch(env, campaign, recipients, { dryRunOverride: true });
    return json({
      ok: true, mode: 'preview', active_provider: activeProvider(env),
      audience_size: recipients.length,
      recipients: recipients.slice(0, 200).map((r) => ({ name: r.name, email: r.email })),
      count: recipients.length,
      excluded, sample: result.sample || [],
    });
  }

  if (!recipients.length) {
    return json({ error: 'empty_audience', detail: 'No contacts match this audience (after removing opt-outs and contacts with no email).', excluded }, 400);
  }

  await airtablePatch(env, 'Campaigns', campaignId, { status: 'Sending' });
  const result = await dispatch(env, campaign, recipients);

  await airtablePatch(env, 'Campaigns', campaignId, {
    status: result.ok ? 'Sent' : 'Failed',
    provider: result.provider,
    recipient_count: recipients.length,
    sent_count: result.sent || 0,
    sent_at: new Date().toISOString(),
  });

  return json({
    ok: result.ok, mode: 'send', provider: result.provider,
    audience_size: recipients.length, sent_count: result.sent || 0,
    sent: result.sent, failed: result.failed,
    truncated: result.truncated, excluded, detail: result.detail,
    mailchimp_campaign_id: result.mailchimp_campaign_id,
  }, result.ok ? 200 : 502);
}

function parseAudience(a) {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return {}; }
}

// --- Suppression / unsubscribe ---

// All suppressed emails as a lowercased Set, for the audience-build exclusion.
async function getSuppressionEmails(env) {
  const recs = await fetchAllRecords(env, 'Suppression');
  return new Set(recs.map((r) => String((r.fields || {}).email || '').trim().toLowerCase()).filter(Boolean));
}

// Idempotent add: no-op if the email is already suppressed.
async function addToSuppression(env, email, reason, sourceCampaign) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return false;
  const existing = await getSuppressionEmails(env);
  if (existing.has(clean)) return true;
  await airtableCreate(env, 'Suppression', {
    email: clean,
    reason: reason || 'unsubscribe',
    source_campaign: sourceCampaign || '',
    added_at: new Date().toISOString(),
  });
  return true;
}

async function handleAddSuppression(env, request) {
  const parsed = await readBody(request);
  if (parsed.invalid) return json({ error: 'invalid_json' }, 400);
  const raw = parsed.body || {};
  if (!validateString(raw.email, 200) || !EMAIL_RE.test(raw.email)) return json({ error: 'validation_failed', detail: 'valid email required' }, 400);
  await addToSuppression(env, raw.email, raw.reason || 'manual', raw.source_campaign);
  return json({ ok: true, email: raw.email.trim().toLowerCase() }, 201);
}

// Public unsubscribe landing. Verifies the signed token, suppresses the email,
// flags the matching contact, and returns a human-readable confirmation page.
async function handleUnsubscribe(env, url) {
  const token = url.searchParams.get('t') || '';
  const decoded = await verifyUnsubToken(env, token);
  if (!decoded) {
    return new Response(unsubPageHtml('', false), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS } });
  }
  await addToSuppression(env, decoded.email, 'unsubscribe', 'one-click');
  if (decoded.contactId) {
    await airtablePatch(env, 'Contacts', decoded.contactId, {
      email_status: 'unsubscribed', unsub_at: new Date().toISOString().split('T')[0],
    });
  }
  return new Response(unsubPageHtml(decoded.email, true), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS } });
}

// Mailchimp calls this on unsubscribe/cleaned events (form-encoded). We only
// need the email + type to keep our Suppression list in sync with theirs.
async function handleMailchimpWebhook(env, request) {
  try {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const type = params.get('type');
    const email = params.get('data[email]') || params.get('data[merges][EMAIL]') || '';
    if ((type === 'unsubscribe' || type === 'cleaned') && email) {
      await addToSuppression(env, email, type === 'cleaned' ? 'bounce' : 'unsubscribe', 'mailchimp');
    }
  } catch (e) {
    console.log('mailchimp_webhook_error', { detail: String(e && e.message || e) });
  }
  return json({ ok: true }); // always 200 so Mailchimp doesn't retry-storm
}

// ===========================================================================
// Airtable helpers
// ===========================================================================
function airtableURL(env, table) {
  return `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

function airtableHeaders(env) {
  return {
    Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

// Low-level create/patch that return record data (or null on failure) instead
// of an HTTP Response — used by paths that need the record id and must never
// throw into a public request flow.
async function airtableCreate(env, table, fields) {
  try {
    const res = await fetch(airtableURL(env, table), {
      method: 'POST', headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
async function airtablePatch(env, table, id, fields) {
  try {
    const res = await fetch(`${airtableURL(env, table)}/${id}`, {
      method: 'PATCH', headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// Airtable paginated fetch. Caps at 1000 records per table to avoid runaway.
async function fetchAllRecords(env, table) {
  const out = [];
  let offset = '';
  for (let page = 0; page < 10; page++) {
    const url = `${airtableURL(env, table)}?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`;
    const res = await fetch(url, { headers: airtableHeaders(env) });
    if (!res.ok) break;
    const data = await res.json();
    out.push(...(data.records || []));
    if (!data.offset) break;
    offset = data.offset;
  }
  return out;
}

// Last-10-digits comparison so "(503) 555-1234" and "5035551234" match.
function normPhone(p) { return (p || '').replace(/\D/g, '').slice(-10); }

// Find an existing Contact in a pre-fetched list that matches by email
// (case-insensitive) or phone (last 10 digits). Returns the record or null.
function findContactMatch(contacts, fields) {
  const email = (fields.email || '').trim().toLowerCase();
  const phone = normPhone(fields.phone);
  if (!email && !phone) return null;
  return contacts.find((c) => {
    const cf = c.fields || {};
    const cEmail = (cf.email || '').trim().toLowerCase();
    const cPhone = normPhone(cf.phone);
    return (email && cEmail && email === cEmail) || (phone && cPhone && phone === cPhone);
  }) || null;
}

// ===========================================================================
// Email via Resend
// ===========================================================================
function internalRecipient(env) {
  return env.NOTIFY_TO || env.LUKAS_EMAIL || '';
}

async function resendSend(env, payload, label) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { console.log('resend_error', { context: label, status: res.status, data }); return false; }
    console.log('email_sent', { context: label, id: data.id, to: payload.to });
    return true;
  } catch (err) {
    console.log('resend_exception', { context: label, err: String(err && err.message || err) });
    return false;
  }
}

// To Lukas on every real work request. Failures log but never throw — a Resend
// outage must not break the form submission.
async function notifyWorkRequest(env, d, opts = {}) {
  const to = internalRecipient(env);
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !to) {
    console.log('notify_work_request_skipped', {
      reason: 'missing_config', has_key: !!env.RESEND_API_KEY, has_from: !!env.NOTIFY_FROM, has_to: !!to,
    });
    return;
  }
  const prefix = opts.isTest ? '[TEST] ' : '';
  const srcTag = d.source && !/^card scan$/i.test(d.source) ? ` (${d.source})` : '';
  const payload = {
    from: env.NOTIFY_FROM,
    to: [to],
    subject: `${prefix}New work request — ${d.name}${srcTag}`,
    html: workRequestNotifyHtml(d),
  };
  // Reply straight to the requester when they left an email.
  if (d.email && d.email !== 'noreply@test.invalid') payload.reply_to = d.email;
  await resendSend(env, payload, 'work_request_notify');
}

// Auto-reply to the requester ("thanks, I got it").
async function sendWorkRequestReceipt(env, d) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !d.email) {
    console.log('work_request_receipt_skipped', { reason: 'missing_config_or_email' });
    return;
  }
  const payload = {
    from: env.NOTIFY_FROM,
    to: [d.email],
    subject: 'Got your request — LUXIGA',
    html: workRequestReceiptHtml(d),
  };
  const reply = internalRecipient(env);
  if (reply) payload.reply_to = reply;
  await resendSend(env, payload, 'work_request_receipt');
}

// ===========================================================================
// Cron: weekly digest + daily follow-up nudge (to Lukas)
// ===========================================================================

// Weekly digest: new contacts + follow-ups due this week + pipeline snapshot.
// Triggered by cron (Mon 15:00 UTC) or POST /api/admin/weekly-digest-now.
async function sendWeeklyDigest(env) {
  const to = internalRecipient(env);
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !to) { console.log('weekly_digest_skipped', { reason: 'missing_config' }); return; }
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) { console.log('weekly_digest_skipped', { reason: 'missing_airtable' }); return; }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const contacts = await fetchAllRecords(env, 'Contacts');

  // New contacts this week (Airtable stamps createdTime on every record).
  const newContacts = contacts.filter((c) => (c.createdTime || '') >= sevenAgo);
  // Follow-ups due within the next 7 days, not Lost.
  const dueSoon = contacts.filter((c) => {
    const f = c.fields || {};
    return f.next_follow_up_date && f.next_follow_up_date <= weekOut && f.stage !== 'Lost';
  }).sort((a, b) => (a.fields.next_follow_up_date || '').localeCompare(b.fields.next_follow_up_date || ''));

  // Pipeline snapshot by stage.
  const pipeline = {};
  for (const c of contacts) {
    const s = (c.fields || {}).stage || 'unspecified';
    pipeline[s] = (pipeline[s] || 0) + 1;
  }

  const listHtml = (rows, empty) => rows.length
    ? rows.map((c) => {
        const f = c.fields || {};
        const due = f.next_follow_up_date ? ` — due ${escapeHtml(f.next_follow_up_date)}` : '';
        const stage = f.stage ? ` (${escapeHtml(f.stage)})` : '';
        return `&bull; ${escapeHtml(f.name || '(no name)')}${stage}${due}`;
      }).join('<br>')
    : `<span style="color:#8b917d">${empty}</span>`;

  const pipelineHtml = Object.entries(pipeline)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, n]) => `${escapeHtml(stage)}: <b>${n}</b>`).join(' &nbsp;·&nbsp; ');

  const html = internalDigestHtml({
    title: 'LUXIGA weekly digest',
    preheader: `${newContacts.length} new contact${newContacts.length === 1 ? '' : 's'}, ${dueSoon.length} follow-up${dueSoon.length === 1 ? '' : 's'} due.`,
    headline: `Weekly summary — through ${today}`,
    statPairs: [
      ['New contacts (7d)', String(newContacts.length)],
      ['Follow-ups due (next 7d)', String(dueSoon.length)],
      ['Total contacts', String(contacts.length)],
    ],
    sections: [
      { heading: 'Follow-ups due this week', html: listHtml(dueSoon, 'Nothing due — clear week.') },
      { heading: 'New contacts this week', html: listHtml(newContacts.slice(0, 25), 'No new contacts this week.') },
      { heading: 'Pipeline', html: pipelineHtml || '<span style="color:#8b917d">Empty pipeline.</span>' },
    ],
  });

  await resendSend(env, {
    from: env.NOTIFY_FROM,
    to: [to],
    subject: `LUXIGA weekly digest — ${newContacts.length} new, ${dueSoon.length} due`,
    html,
  }, 'weekly_digest');
}

// Daily nudge: contacts whose follow-up is due today or overdue (stage != Lost).
// No email when nothing is due.
async function sendFollowupNudge(env) {
  const to = internalRecipient(env);
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !to) { console.log('followup_nudge_skipped', { reason: 'missing_config' }); return; }
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) return;

  const contacts = await fetchAllRecords(env, 'Contacts');
  const today = new Date().toISOString().split('T')[0];
  const due = contacts.filter((c) => {
    const f = c.fields || {};
    return f.next_follow_up_date && f.next_follow_up_date <= today && f.stage !== 'Lost';
  }).sort((a, b) => (a.fields.next_follow_up_date || '').localeCompare(b.fields.next_follow_up_date || ''));

  if (!due.length) { console.log('followup_nudge_none_due'); return; }

  const listHtml = due.map((c) => {
    const f = c.fields || {};
    const stage = f.stage ? ` (${escapeHtml(f.stage)})` : '';
    const ph = f.phone ? ` — ${escapeHtml(f.phone)}` : (f.email ? ` — ${escapeHtml(f.email)}` : '');
    return `&bull; due ${escapeHtml(f.next_follow_up_date)}: <b>${escapeHtml(f.name || '(no name)')}</b>${stage}${ph}`;
  }).join('<br>');

  const html = internalDigestHtml({
    title: 'LUXIGA follow-ups due',
    preheader: `${due.length} contact${due.length === 1 ? '' : 's'} need a follow-up.`,
    headline: `${due.length} follow-up${due.length === 1 ? '' : 's'} due today`,
    sections: [{ heading: 'Due now', html: listHtml }],
  });

  await resendSend(env, {
    from: env.NOTIFY_FROM,
    to: [to],
    subject: `LUXIGA follow-ups due: ${due.length}`,
    html,
  }, 'followup_nudge');
}

// Local escape for digest strings (emails.js owns template escaping; this keeps
// worker-built list fragments safe).
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
