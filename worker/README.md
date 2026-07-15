# LUXIGA CRM Worker

The API + email engine behind the LUXIGA CRM admin (`luxiga.co/admin.html`).
A Cloudflare Worker that proxies Airtable, runs marketing campaigns, sends
transactional email through Resend, and captures work requests from the
business card.

Ported from the Golden Goose Construction worker, retargeted for a solo
software / product-design studio. Affiliates, QR scans, and lead-pipeline logic
were dropped.

## Files

| File | What it is |
| --- | --- |
| `worker.js` | Routing, CF Access auth, Airtable CRUD, work-request intake, digest crons |
| `campaigns.js` | Campaign engine — audience builder, provider adapters (dryrun/resend/mailchimp), unsub tokens |
| `emails.js` | Branded, email-client-safe HTML templates (runtime source of truth) |
| `setup-crm-tables.mjs` | One-time Airtable schema bootstrap |
| `wrangler.toml` | Worker config + secrets checklist |
| `package.json` | ESM marker + npm scripts |

The design-preview twins of the emails live in `../email-templates/` (regenerate
with `python3 ../email-templates/build_emails.py`). `emails.js` is what actually
ships — keep the two in step.

## Data model (Airtable)

Four tables in a base named `luxiga` (or containing `crm`):

- **Contacts** — the person. `stage` ∈ {New, Contacted, Discovery Call, Proposal
  Sent, Active Client, Repeat / Referral, Lost}. `source` ∈ {Card Scan, Referral,
  Web Form, Pulse, Partner, Manual}. `owner` = Lukas. Plus marketing fields
  (`email_status`, `consent`, `unsub_at`).
- **Interactions** — one logged touch (Call/Text/Email/Note/Meeting), linked to a
  Contact.
- **Campaigns** — saved audience + email content + send status/stats.
- **Suppression** — the do-not-email list (contact-independent).

## Endpoints

### Public (no auth — rate-limited + honeypot)
- `POST /api/work-request` — work request from the card. Body accepts **both** the
  card shape `{name, contact, message, source?, sid?}` (single combined
  `contact` = email OR phone) and the documented shape
  `{name, email, phone?, message?, source?}`. Creates/matches a Contact
  (`source: 'Card Scan'` or a provided valid CRM source, `stage: 'New'`,
  `owner: 'Lukas'`), logs an inbound Interaction, emails Lukas, and auto-replies
  to the requester.
- `POST /api/lead` — alias of `/api/work-request` (the card posts here).
- `POST /api/event` — fire-and-forget interaction beacon. Accepts + 204s; **not**
  persisted (see Divergences).
- `GET  /api/unsub?t=…` — one-click unsubscribe (HMAC-signed token).
- `GET|POST /api/mailchimp/webhook` — syncs Mailchimp opt-outs into Suppression.

### Admin (Cloudflare Access JWT or `ADMIN_TOKEN`)
- `GET  /api/admin/contacts` → `{contacts:[…], records:[…]}`
- `GET  /api/admin/interactions` → `{interactions:[…], records:[…]}`
- `POST /api/admin/contact` → created record
- `PATCH /api/admin/contact/:id` → updated record
- `POST /api/admin/interaction` → created record (also rolls the contact's
  `last_contacted` / `next_follow_up_date`)
- `POST /api/admin/import-leads-to-contacts` → `{created, updated}` (safe no-op —
  LUXIGA has no separate Leads table)
- `GET  /api/admin/campaign-config` → `{provider, ready, live, …}`
- `GET  /api/admin/campaigns` · `POST /api/admin/campaign` · `PATCH /api/admin/campaign/:id` · `DELETE /api/admin/campaign/:id`
- `POST /api/admin/campaign-preview` → `{recipients:[{name,email}], count, sample, excluded}`
- `POST /api/admin/campaign-send/:id` → `{sent_count, …}`
- `GET  /api/admin/suppression` · `POST /api/admin/suppression`
- `POST /api/admin/weekly-digest-now` · `POST /api/admin/notify-test`

CORS is locked to `https://luxiga.co`; same-origin admin calls need no CORS.

## Deploy runbook

### 0. Prereqs
- `npm i -g wrangler` (or use `npx wrangler …`)
- An Airtable base for LUXIGA (any name matching `luxiga`/`crm`, or pass the id).
- Resend account with **lukasdgreen.com verified** as a sending domain.

### 1. Create the Airtable tables
```bash
# PAT needs schema.bases:read + schema.bases:write on the LUXIGA base.
AIRTABLE_PAT=pat_xxx node worker/setup-crm-tables.mjs
# or, if you know the base id:
AIRTABLE_PAT=pat_xxx AIRTABLE_BASE_ID=appXXXX node worker/setup-crm-tables.mjs
```
Idempotent — safe to re-run. Revoke the schema PAT afterward; the Worker uses its
own runtime token.

### 2. Set secrets
```bash
cd worker
npx wrangler secret put AIRTABLE_TOKEN          # runtime PAT: data.records:read + data.records:write
npx wrangler secret put AIRTABLE_BASE_ID        # appXXXX

# Cloudflare Access (protects /api/admin/*)
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # e.g. luxiga.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD           # Application Audience tag from the Access app

# Resend transactional + digest email
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFY_FROM             # "Lukas Green · LUXIGA <lukas@lukasdgreen.com>"
npx wrangler secret put NOTIFY_TO               # lukas@lukasdgreen.com

# Optional legacy bearer fallback (handy before CF Access is wired)
npx wrangler secret put ADMIN_TOKEN
# ...and later, to disable it:
echo "true" | npx wrangler secret put DISABLE_ADMIN_TOKEN
```

Campaign secrets are only needed once you move off the default `dryrun` provider
— see the checklist at the bottom of `wrangler.toml`.

### 3. Deploy
```bash
cd worker
npx wrangler deploy
```

### 4. Wire the route (Cloudflare dashboard, one time)
Workers → your worker → **Triggers → Routes**: add `luxiga.co/api/*` →
`luxiga-crm-api`. Being on the same origin behind Cloudflare Access is what makes
CF attach `Cf-Access-Jwt-Assertion` automatically for admin sessions.

Add a Cloudflare **Access application** covering `luxiga.co/api/admin/*` (and
`luxiga.co/admin.html`), policy = your email. Its **Audience (AUD) tag** is the
`CF_ACCESS_AUD` value above.

### 5. Point the card at the CRM
In `../card/config.js`, set:
```js
window.LX_API = "https://luxiga.co/api";
```
The card then posts work requests to `…/api/lead` (handled here) and fires
interaction beacons to `…/api/event`.

### 6. Smoke-test
```bash
# work request (public) — creates a Contact, emails you + the requester
curl -sX POST https://luxiga.co/api/work-request \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Person","contact":"you@example.com","message":"Testing the CRM intake.","source":"linkedin"}'

# admin notify path (needs a session or ADMIN_TOKEN)
curl -sX POST https://luxiga.co/api/admin/notify-test -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Environment variables / secrets

**Required**
- `AIRTABLE_TOKEN` — runtime Airtable PAT (data.records read/write).
- `AIRTABLE_BASE_ID` — the LUXIGA base id.
- `RESEND_API_KEY` — Resend key (domain verified).
- `NOTIFY_FROM` — from address, e.g. `Lukas Green · LUXIGA <lukas@lukasdgreen.com>`.
- `NOTIFY_TO` — internal recipient for notices/digests (`lukas@lukasdgreen.com`).
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` — Cloudflare Access JWT validation.

**Optional**
- `ADMIN_TOKEN` / `DISABLE_ADMIN_TOKEN` — legacy bearer fallback and its kill switch.
- Campaigns: `CAMPAIGN_PROVIDER` (`dryrun`|`resend`|`mailchimp`), `CAMPAIGN_FROM`,
  `UNSUB_SECRET`, `CAMPAIGN_POSTAL_ADDRESS`, `CAMPAIGN_MAX_PER_SEND`,
  `CAMPAIGN_REPLY_TO`, `PUBLIC_BASE_URL`, and the `MAILCHIMP_*` set.

> **Email of record:** `lukas@lukasdgreen.com` today. When the `lukas@luxiga.co`
> mailbox is live, verify `luxiga.co` in Resend and switch `NOTIFY_FROM` /
> `NOTIFY_TO` (and the card's mailto) over to it.

## Divergences from GGC
- **Env rename:** Airtable auth is `AIRTABLE_TOKEN` (GGC used `AIRTABLE_API_KEY`),
  matching the spec and the existing `infrastructure/card-worker`.
- **Recipients:** GGC's `JUSTIN_EMAIL` + `LUKAS_EMAIL` collapse to a single
  `NOTIFY_TO` (solo studio). `LUKAS_EMAIL` is still accepted as an alias.
- **Dropped:** all affiliate/QR-scan/lead routes, tables, and emails; the
  `Leads`→`Contacts` link and backfill (now a safe no-op).
- **New:** `POST /api/work-request` (+ `/api/lead` alias) wired to the card, with
  combined-`contact` parsing (email-vs-phone split) and existing-contact
  dedupe by email/phone.
- **Emails are HTML, not plain text.** GGC sent plain-text notifications;
  transactional + campaign mail here render through the branded `emails.js`
  templates.
- **`/api/event`** is accepted and 204'd but **not persisted** — the CRM base has
  no Events table. Per-event analytics remain the standalone
  `infrastructure/card-worker` dashboard's job. Follow-up: if you want card
  analytics inside this Worker, add an Events table + persist here.
- **Contact `source`:** the card's `source` is a marketing medium (e.g.
  `linkedin`), not a CRM Source option, so work-request maps it to a valid select
  (`Card Scan` by default) and keeps the raw medium as attribution in notes /
  interaction summary.
