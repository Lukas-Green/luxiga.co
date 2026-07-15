# LUXIGA CRM — go-live runbook (Cloudflare, Option A)

The Worker is already deployed to `https://luxiga-crm-api.lukas-99c.workers.dev`
(fail-closed: `/api/admin/*` returns 401 until auth is configured). To finish the
same-origin + Cloudflare Access model, luxiga.co has to become a Cloudflare zone.
Steps you run are marked **[you]** (registrar/dashboard/secrets); code is done.

Current state of luxiga.co: **Namecheap DNS + GitHub Pages apex + ProtonMail email.**
The move must preserve the GitHub Pages A-records **and** the ProtonMail records
(don't drop these or email breaks — `lukas@luxiga.co` already resolves via Proton).

---

## Step 1 — Add luxiga.co to Cloudflare  **[you]**
1. Cloudflare dashboard → **Add a site** → `luxiga.co` → Free plan.
2. Cloudflare auto-scans existing DNS. **Verify every row below imported correctly**
   (add anything missing), matching proxy status exactly:

| Type  | Name                     | Value                                                                                   | Proxy      |
|-------|--------------------------|-----------------------------------------------------------------------------------------|------------|
| A     | `luxiga.co` (@)          | `185.199.108.153`                                                                        | **Proxied**|
| A     | `luxiga.co` (@)          | `185.199.109.153`                                                                        | **Proxied**|
| A     | `luxiga.co` (@)          | `185.199.110.153`                                                                        | **Proxied**|
| A     | `luxiga.co` (@)          | `185.199.111.153`                                                                        | **Proxied**|
| CNAME | `www`                    | `lukas-green.github.io`                                                                  | **Proxied**|
| MX    | `luxiga.co` (@)          | `mail.protonmail.ch` (priority 10)                                                       | DNS only   |
| MX    | `luxiga.co` (@)          | `mailsec.protonmail.ch` (priority 20)                                                    | DNS only   |
| TXT   | `luxiga.co` (@)          | `v=spf1 include:_spf.protonmail.ch ~all`                                                 | DNS only   |
| CNAME | `protonmail._domainkey`  | `protonmail.domainkey.dir75miw73jujd2rtgbx2nz3y2wcxaiajj7jcdq7476oiam6f327q.domains.proton.ch`  | DNS only |
| CNAME | `protonmail2._domainkey` | `protonmail2.domainkey.dir75miw73jujd2rtgbx2nz3y2wcxaiajj7jcdq7476oiam6f327q.domains.proton.ch` | DNS only |
| CNAME | `protonmail3._domainkey` | `protonmail3.domainkey.dir75miw73jujd2rtgbx2nz3y2wcxaiajj7jcdq7476oiam6f327q.domains.proton.ch` | DNS only |

3. **SSL/TLS → Overview → set mode to `Full`** (not Flexible — GitHub Pages already
   serves HTTPS; Flexible causes redirect loops).
4. Copy the two Cloudflare nameservers shown.
5. **Namecheap** → luxiga.co → Domain → Nameservers → **Custom DNS** → paste the two
   Cloudflare nameservers → save. Propagation is usually <1h (up to 24h).
6. Wait for Cloudflare to show the zone **Active**. Confirm the site still loads
   (`https://luxiga.co`) and send yourself a test email to `lukas@luxiga.co`.

> Gotcha: on the GitHub repo (Settings → Pages), custom domain stays `luxiga.co`;
> "Enforce HTTPS" can stay on. If GitHub shows a cert warning right after the switch,
> toggle the custom domain off/on once — CF proxy + Pages settle within minutes.

---

## Step 2 — Airtable base + schema  **[you]**
1. Create an Airtable base named e.g. **LUXIGA CRM**.
2. Personal Access Token at https://airtable.com/create/tokens with
   `schema.bases:write` + `schema.bases:read` on that base.
3. From `luxiga-co/`:
   ```bash
   AIRTABLE_PAT=pat_xxx node worker/setup-crm-tables.mjs
   ```
   It prints the **base id** (`appXXXX`). Note it for Step 4.

---

## Step 3 — Cloudflare Access (email-OTP admin gate)  **[you]**
1. Cloudflare **Zero Trust** → Settings → pick a **team name** →
   team domain becomes `TEAMNAME.cloudflareaccess.com` (this is `CF_ACCESS_TEAM_DOMAIN`).
2. Access → **Applications → Add → Self-hosted**. Add these two paths (one app, two
   domain entries, or two apps — either works):
   - `luxiga.co/admin.html`
   - `luxiga.co/api/admin/*`
3. Policy: **Allow**, Include → **Emails** → `lukas@lukasdgreen.com` (add others later).
   Login method: **One-time PIN**.
4. Open the app → **copy the Application Audience (AUD) Tag** → this is `CF_ACCESS_AUD`.

---

## Step 4 — Worker secrets + route  **[you]**
From `luxiga-co/worker/`:
```bash
npx wrangler secret put AIRTABLE_TOKEN         # the PAT from Step 2 (or a data-scoped one)
npx wrangler secret put AIRTABLE_BASE_ID       # appXXXX from Step 2
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN  # TEAMNAME.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD          # AUD tag from Step 3
npx wrangler secret put RESEND_API_KEY         # from resend.com (see email note below)
npx wrangler secret put NOTIFY_FROM            # Lukas Green · LUXIGA <lukas@lukasdgreen.com>
npx wrangler secret put NOTIFY_TO              # lukas@lukasdgreen.com
```
Then activate the same-origin route: in `worker/wrangler.toml` uncomment the
`routes = [{ pattern = "luxiga.co/api/*", zone_name = "luxiga.co" }]` block and:
```bash
npx wrangler deploy
```

**Email sending (Resend):** Resend must own the *sending* domain (separate from
ProtonMail receiving). Two choices:
- **Fastest:** verify `lukasdgreen.com` in Resend (add its DKIM/SPF records to that
  domain) and keep `NOTIFY_FROM = lukas@lukasdgreen.com` (the default).
- **On-brand:** verify a luxiga.co subdomain in Resend (e.g. `send.luxiga.co`), add
  Resend's records in Cloudflare DNS, and set `NOTIFY_FROM`/`CAMPAIGN_FROM` to
  `lukas@send.luxiga.co`. Keeps ProtonMail on the apex untouched.
Until a key is set, notify/receipt/campaign mail **skip-and-log** — the CRM still works.

---

## Step 5 — Wire the business card  **[you, 1 line]**
In `card/config.js` set:
```js
window.LX_API = "https://luxiga.co/api";
```
Commit + push (GitHub Pages redeploys). Now a card work-request POSTs to
`luxiga.co/api/lead` → creates a Contact (source `Card Scan`, stage `New`) → emails
you + auto-replies the requester.

---

## Step 6 — Verify live  **[you]**
- Visit `https://luxiga.co/admin.html` → Cloudflare shows the OTP screen → after PIN,
  the CRM loads with **live** data (no amber "backend not reachable" banner).
- Submit the card's work-request form → the Contact appears under Contacts, and you
  get the notify email.
- Campaigns default to **dryrun** (build + preview, send nothing) until you set
  `CAMPAIGN_PROVIDER=resend` (or `mailchimp`) + the campaign secrets (see `wrangler.toml`).
- Once CF Access is confirmed working, kill the legacy bearer fallback:
  ```bash
  echo "true" | npx wrangler secret put DISABLE_ADMIN_TOKEN
  ```

---

### What's already done (no action)
- Worker code deployed + verified (admin fail-closed 401, public endpoints inert-safe).
- Route config staged in `wrangler.toml` (commented until the zone is live).
- Business-card print PDF, CRM frontend (4/4 tests), Worker logic (10/10 tests),
  branded emails — all built and verified. See `docs/CRM.md`.

---

## Appendix A — Airtable token, exact screen
One token does both jobs (schema bootstrap **and** the Worker's runtime reads/writes).

1. Go to **https://airtable.com/create/tokens** → **Create new token**.
2. **Name**: `LUXIGA CRM`.
3. **Scopes** → click **+ Add a scope** four times and pick:
   - `schema.bases:read`
   - `schema.bases:write`   ← lets `setup-crm-tables.mjs` create the tables
   - `data.records:read`
   - `data.records:write`   ← lets the Worker read/write Contacts/Interactions/etc.
4. **Access** → **+ Add a base** → select your **LUXIGA CRM** base.
   (Or "All current and future bases in <workspace>" if you prefer.)
5. **Create token** → **copy the `pat…` string now** (Airtable shows it once).
6. Use that same value for **both**:
   - the setup script: `AIRTABLE_PAT=pat… node worker/setup-crm-tables.mjs`
   - the Worker secret: `npx wrangler secret put AIRTABLE_TOKEN` (paste the same `pat…`).

> If you'd rather split them: a setup-only token needs just the two `schema.bases:*`
> scopes; the Worker token needs just the two `data.records:*` scopes. Both must be
> granted access to the LUXIGA CRM base.

---

## Appendix B — Cloudflare Access app, exact clicks
Goal: one app, **one AUD tag**, covering both admin paths. (Two apps = two AUD tags,
and the Worker only checks one — so keep it to a single app.)

1. **https://one.dash.cloudflare.com** (Zero Trust). First time only: it asks you to
   **choose a team name** → e.g. `luxiga`. Your **team domain** becomes
   `luxiga.cloudflareaccess.com` → this is **`CF_ACCESS_TEAM_DOMAIN`**.
2. Left nav → **Access → Applications** → **Add an application** → **Self-hosted**.
3. **Application configuration**
   - **Application name**: `LUXIGA CRM Admin`
   - **Session Duration**: `24 hours` (or your taste)
   - **Public hostname** / **Application domain**: add the domain **luxiga.co**, and in
     the **Path** field type `admin.html`.
   - Click **+ Add public hostname** (or "+ Add a domain") again → domain **luxiga.co**,
     **Path** `api/admin` — this covers `/api/admin/*` (path match is prefix-based).
   - **Identity providers**: leave **One-time PIN** enabled. → **Next**.
4. **Add policy**
   - **Policy name**: `Lukas only`
   - **Action**: **Allow**
   - **Add rules → Include** → Selector **Emails** → value `lukas@lukasdgreen.com`
     (add more addresses on separate Include rows later). → **Next**.
5. **Setup** step → defaults are fine → **Add application**.
6. Open the new app → **Overview** (or **Configuration**) → copy the
   **Application Audience (AUD) Tag** (a long hex string) → this is **`CF_ACCESS_AUD`**.

Then set the two secrets and redeploy (Step 4 above):
```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # luxiga.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD           # the AUD tag you just copied
```

**Test it:** open `https://luxiga.co/admin.html` in a private window → you should hit
the Cloudflare OTP screen, get a code at `lukas@lukasdgreen.com`, and land on the CRM.
In the browser devtools Network tab, a request to `/api/admin/contacts` should return
**200** (not 401) — that confirms Access is injecting the JWT and the Worker accepts it.
If you get 401 there: the AUD/team-domain secrets don't match the app, or the Worker
route `luxiga.co/api/*` isn't active yet.
