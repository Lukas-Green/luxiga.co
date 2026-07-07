# LUXIGA card-worker

Backend for **luxiga.co/card**: captures work-request leads and interaction
events into Airtable, emails you on each new lead (Resend), and serves a private
dashboard. The card page is static (GitHub Pages); this Worker is the only moving
backend part.

## What it does

| Route | Method | Purpose |
|---|---|---|
| `/lead` | POST | Work-request form -> Airtable **Leads** + email alert |
| `/event` | POST | Interaction beacons (view, flip, click, submit) -> Airtable **Events** |
| `/dashboard` | GET | Private dashboard (prompts for token) |
| `/api/data` | GET | Dashboard data, `Authorization: Bearer <DASH_TOKEN>` |

## 1. Airtable base (5 min)

Create a base (or reuse one) with two tables. Field names must match exactly:

**Leads**
- `Name` — Single line text
- `Contact` — Single line text
- `Message` — Long text
- `Source` — Single line text
- `Session` — Single line text
- `Created` — **Created time** (Airtable adds this automatically; used for sorting)

**Events**
- `Event` — Single line text
- `Source` — Single line text
- `Session` — Single line text
- `Path` — Single line text
- `Meta` — Long text
- `Created` — **Created time**

Then create a **Personal Access Token** (Airtable → Builder hub → Personal access
tokens) with scopes `data.records:read` + `data.records:write`, granted to this base.
Note the **base id** (starts with `app…`, in the base URL).

> Airtable free tier caps a base at ~1,000 records. Leads are low-volume; events
> add up. If Events fills, clear it or we move Events to Cloudflare KV later.

## 2. Deploy the Worker (5 min)

```bash
cd infrastructure/card-worker
npx wrangler login                 # opens Cloudflare auth in your browser
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put AIRTABLE_BASE
npx wrangler secret put RESEND_KEY
npx wrangler secret put NOTIFY_EMAIL
npx wrangler secret put DASH_TOKEN   # make up a long random string
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://luxiga-card.<your-subdomain>.workers.dev`.

If `leads@luxiga.co` isn't verified in Resend, edit `FROM_EMAIL` in `wrangler.toml`
to a domain you've verified there, then redeploy.

## 3. Wire the card page

Send the Worker URL to me, or set it yourself in **`card/config.js`**:

```js
window.LX_API = "https://luxiga-card.<your-subdomain>.workers.dev";
```

Commit + push. The card form will POST to `/lead` (instead of mailto) and start
sending interaction events to `/event`.

## 4. Dashboard

Open `https://luxiga-card.<your-subdomain>.workers.dev/dashboard`, enter your
`DASH_TOKEN`. Shows lead list, totals, and activity by source.

Bookmark it. For stronger protection later, put the Worker behind Cloudflare
Access (same as the GGC admin) instead of the token.

## Source attribution

The card reads `?s=` from the URL. Tag your links so the dashboard shows where
leads come from:
- printed card QR -> `luxiga.co/card?s=print`
- email signature -> `luxiga.co/card?s=sig`
- Instagram bio  -> `luxiga.co/card?s=ig`
