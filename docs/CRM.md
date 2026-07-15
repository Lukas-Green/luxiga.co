# LUXIGA CRM · Email · Business Card — handoff

Internal tooling for LUXIGA LLC, modeled on the Golden Goose Construction stack and
reskinned to the LUXIGA design system (dark `#080810`, lime `#C4FF53`, violet
`#8B5CF6`, Space Grotesk / Space Mono). Three deliverables, one repo.

## 1. Business-card print PDF  ✅ ready now (no deploy)
- `card/print/luxiga-business-card.pdf` — press-ready, **front = page 1, back = page 2**,
  3.5″×2″ trim + 0.125″ bleed on every side + corner crop marks, all vector.
- Rebuild after any card edit: `node card/print/build-print-pdf.mjs`
  (reuses the vector art from `card/index.html`; also refreshes `proof-front.png` /
  `proof-back.png` for a quick visual check).
- Download page: `card/print/index.html`. Home-print PNGs: `card/print/front.png` / `back.png`.

## 2. CRM admin (frontend)
- `admin.html` + `js/admin.js` + `css/admin.css` (self-contained LUXIGA theme).
- Tabs: **Dashboard** (contact/pipeline/campaign stats), **Contacts** (search, new/edit,
  interactions timeline), **Campaigns** (compose, audience preview, send, suppression).
- Auth is at the **Cloudflare Access** perimeter — anyone who can load `admin.html` has
  already passed email OTP. No client-side password gate.
- Stages: `New · Contacted · Discovery Call · Proposal Sent · Active Client · Repeat / Referral · Lost`.
  Sources: `Card Scan · Referral · Web Form · Pulse · Partner · Manual`. Owner: Lukas.
- Browses fully in an empty state before the Worker exists (shows an amber
  "backend not reachable" notice, never a blank screen).
- Smoke test: `npx playwright test tests/admin.spec.js` (4/4).

## 3. Worker + email (backend)
- `worker/worker.js` (routing, CF Access JWT, Airtable CRUD, work-request intake, digest cron),
  `worker/campaigns.js` (audience builder + dryrun/resend/mailchimp adapters + HMAC unsub tokens),
  `worker/emails.js` (branded, email-client-safe HTML — the runtime source of truth),
  `worker/setup-crm-tables.mjs` (Airtable schema bootstrap), `worker/wrangler.toml`, `worker/README.md`.
- `email-templates/` — previews rendered by `build_emails.py`
  (`campaign-base.html`, `work-request-notify.html`, `work-request-receipt.html`).
- Logic test (no Airtable needed): `node worker/verify.test.mjs` (10/10 — audience compliance,
  unsub sign/verify + tamper rejection, brand + HTML-escape, provider status).
- Full deploy runbook + env/secrets: **`worker/README.md`**.

## Deploy order
1. Create a LUXIGA Airtable base → `AIRTABLE_PAT=… node worker/setup-crm-tables.mjs`
   (creates Contacts / Interactions / Campaigns / Suppression).
2. `cd worker && npx wrangler secret put …` for: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`,
   `RESEND_API_KEY`, `NOTIFY_FROM`, `NOTIFY_TO`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`,
   plus the optional campaign set (`CAMPAIGN_PROVIDER`, `UNSUB_SECRET`, `CAMPAIGN_POSTAL_ADDRESS`, …).
3. `npx wrangler deploy` (bundles clean at ~63 KiB, verified).
4. In the Cloudflare dashboard: route `luxiga.co/api/*` → the Worker, and put a
   **Cloudflare Access** policy over `/admin.html` **and** `/api/admin/*` (single wildcard).
5. Wire the card: set `window.LX_API = "https://luxiga.co/api"` in `card/config.js`
   so work requests land in the CRM as Contacts (`source: Card Scan`, `stage: New`) and
   email you a notify + auto-reply the requester.

## Contract seams (verified — no code changes needed)
- `POST /api/admin/interaction` sends `contact` as a bare id string; the Worker wraps it to
  Airtable's `[id]` link array (`worker.js` ~L697) and rolls `last_contacted`.
- `campaign-preview` → `{recipients, count, audience_size, excluded, sample}`;
  `campaign-send/:id` → `{sent_count, recipient_count, …}`; `contacts` → `{contacts:[…]}`.

## Pre-deploy checklist / risks
- [ ] **WARDEN**: confirm the CF Access policy covers both `/admin.html` and `/api/admin/*`.
- [ ] **Resend**: verify `lukasdgreen.com` as a sender before any mail fires (until then the
      intake path skip-and-logs email — it does not hard-fail).
- Email of record is `lukas@lukasdgreen.com`; migrate `NOTIFY_FROM`/`CAMPAIGN_FROM` to
  `lukas@luxiga.co` once that mailbox is live.
- `/api/event` beacons are accepted (204) but **not stored** — there's no Events table in the
  CRM base. Keep `infrastructure/card-worker` if you want per-event card analytics.
- `worker/emails.js` (runtime) and `email-templates/*.html` (previews) can drift; regenerate
  previews with `build_emails.py` after editing templates.
