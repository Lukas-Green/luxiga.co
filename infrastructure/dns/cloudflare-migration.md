# Migrating luxiga.co DNS to Cloudflare

**Goal:** Move DNS hosting from Namecheap BasicDNS to Cloudflare Free. Keep the domain registered at Namecheap. Zero downtime.

**Why:** Namecheap BasicDNS has caused one confirmed outage (DNSSEC misconfiguration, 2026-04-10). Cloudflare offers faster global DNS (anycast, ~10ms), proper DNSSEC if enabled, free analytics, and a saner UI.

**Estimated effort:** 30 minutes active work, plus up to 24 hours for nameserver propagation (during which there is **zero downtime** because both NS sets serve the same records).

---

## Prerequisites

- [ ] luxiga.co is currently resolving cleanly from multiple public resolvers (run `./infrastructure/scripts/dns-check.sh` and confirm green)
- [ ] You have access to the Namecheap account that owns luxiga.co
- [ ] You have [zone-luxiga-co.md](zone-luxiga-co.md) open as the reference for what records should exist
- [ ] You are not in the middle of a revenue deliverable that could be affected by a DNS wobble
- [ ] You have 30 uninterrupted minutes

**Do not start this migration while luxiga.co is broken or flapping.** Wait for stability first.

---

## Step 1 — Create Cloudflare account and add the zone

1. Go to https://dash.cloudflare.com/sign-up and create a free account (if you don't have one).
2. Dashboard → **Add a Site** → enter `luxiga.co` → **Continue**.
3. Select the **Free** plan ($0/mo) → **Continue**.
4. Cloudflare scans your existing DNS records from Namecheap and imports them automatically.

**Expected:** Cloudflare shows a table of imported records. The scan is not always complete — verify in Step 2.

---

## Step 2 — Verify every record imported correctly

Cross-reference the Cloudflare table with [zone-luxiga-co.md](zone-luxiga-co.md). Every record in that file must exist in Cloudflare before you proceed.

**Common gaps to check for:**

- [ ] All 4 apex A records (`185.199.108-111.153`)
- [ ] `www` CNAME → `lukas-green.github.io`
- [ ] `pulse` CNAME → `cname.vercel-dns.com`
- [ ] Both MX records (mail and mailsec)
- [ ] SPF TXT record (`v=spf1 include:_spf.protonmail.ch ~all`)
- [ ] All 3 Proton DKIM CNAMEs (`protonmail._domainkey`, `protonmail2._domainkey`, `protonmail3._domainkey`)
- [ ] Any TXT ownership/verification records (Proton verify, Google Search Console, etc.)
- [ ] DMARC TXT record at `_dmarc` if one exists

**For the apex A records and the `www` CNAME:** set the **proxy status to DNS only (grey cloud)**, not proxied (orange cloud). GitHub Pages has its own edge and its own cert — running it behind Cloudflare's proxy introduces an SSL loop risk you don't need. Grey cloud gets you Cloudflare's fast anycast DNS without the proxy.

**For `pulse` CNAME (Vercel):** also grey cloud. Vercel handles its own edge.

**For MX, TXT, DKIM records:** proxy status doesn't apply (only A/AAAA/CNAME can be proxied). Nothing to set.

Add anything missing manually. Do **not** click "Continue" / finish setup until the Cloudflare record list matches zone-luxiga-co.md exactly.

---

## Step 3 — Get the Cloudflare nameservers

After you click Continue from the record review, Cloudflare displays two nameservers assigned to your zone. They look like:

```
xxx.ns.cloudflare.com
yyy.ns.cloudflare.com
```

(The `xxx` and `yyy` are random words assigned to your account.)

**Write them down. Do not switch yet.**

---

## Step 4 — Pre-switch verification

Before changing nameservers at Namecheap, verify Cloudflare is ready to serve the zone by querying Cloudflare's NS directly:

```bash
# Replace xxx/yyy with your assigned Cloudflare nameservers
dig luxiga.co @xxx.ns.cloudflare.com +short
dig www.luxiga.co @xxx.ns.cloudflare.com +short
dig MX luxiga.co @xxx.ns.cloudflare.com +short
dig TXT luxiga.co @xxx.ns.cloudflare.com +short
```

Every query should return the expected values from zone-luxiga-co.md. If any query returns empty or wrong data, **fix it in Cloudflare before proceeding.** Once you switch nameservers, you cannot easily un-break things.

---

## Step 5 — Switch nameservers at Namecheap

1. Namecheap → Domain List → luxiga.co → **Manage**
2. On the **Domain** tab, find the **Nameservers** section
3. Change the dropdown from "Namecheap BasicDNS" to **"Custom DNS"**
4. Enter the two Cloudflare nameservers from Step 3
5. Click the green checkmark to save

**Expected:** Namecheap shows "Nameserver update in progress, allow 24-48 hours for propagation."

**Reality:** For `.co`, NS changes usually propagate within 1-4 hours. The 48-hour figure is worst-case.

---

## Step 6 — Watch propagation

Public resolvers will continue serving the old Namecheap NS from cache until TTL expires. During this window, some queries hit old NS, some hit Cloudflare — **both return identical records**, so the site stays up.

Verify with:

```bash
dig NS luxiga.co @1.1.1.1 +short
```

- Returns `dns1/dns2.registrar-servers.com` → still cached, Namecheap serving
- Returns `xxx.ns.cloudflare.com, yyy.ns.cloudflare.com` → Cloudflare is now authoritative

Also run the full health check:

```bash
./infrastructure/scripts/dns-check.sh
```

All three public resolvers should return identical results throughout the transition.

---

## Step 7 — Cloudflare dashboard will confirm activation

Within an hour or two of the NS switch, your Cloudflare dashboard will show the zone status change from **Pending Nameserver Update** to **Active**. Cloudflare emails you when this happens.

---

## Step 8 — Post-migration verification

Once Cloudflare shows Active:

- [ ] `./infrastructure/scripts/dns-check.sh` passes green
- [ ] `https://luxiga.co` loads in browser
- [ ] `https://www.luxiga.co` loads (and ideally redirects to apex — GitHub Pages handles this)
- [ ] `https://pulse.luxiga.co` loads if Pulse is deployed
- [ ] Send yourself a test email to your Proton address at `@luxiga.co` — arrives normally
- [ ] Cloudflare Analytics → Traffic tab → should start showing query counts

---

## Step 9 — (Optional) Enable DNSSEC properly

Only do this after the zone has been stable on Cloudflare for **at least 48 hours**.

1. Cloudflare dashboard → luxiga.co → **DNS** → **Settings** → **DNSSEC** → **Enable DNSSEC**
2. Cloudflare displays a DS record. Copy the values.
3. Namecheap → luxiga.co → Advanced DNS → DNSSEC section → add DS record with Cloudflare's values
4. Wait ~1 hour
5. Verify: `dig DS luxiga.co @1.1.1.1 +short` should return the record
6. Verify: `dig luxiga.co @1.1.1.1 +short` should still return GitHub IPs (NOT SERVFAIL)
7. Verify externally: https://dnsviz.net/d/luxiga.co/dnssec/ should show green checkmarks

**If any check fails, remove the DS record from Namecheap immediately.** A broken DNSSEC setup takes the site down for validating resolvers. See [dnssec-incident-2026-04-10.md](dnssec-incident-2026-04-10.md).

This step is **optional**. For a static marketing site, skipping DNSSEC is an acceptable tradeoff. The threat model (DNS cache poisoning targeting luxiga.co specifically) is low.

---

## Rollback

If something goes wrong during migration and you need to revert to Namecheap BasicDNS:

1. Namecheap → luxiga.co → Manage → **Domain** tab → **Nameservers** → change from "Custom DNS" back to **"Namecheap BasicDNS"**
2. Your original records are still in Namecheap's BasicDNS (the migration to Cloudflare does **not** delete them). They'll serve again within 1-4 hours.

Rollback is always available because you never delete the source records at Namecheap. The migration is purely additive until the NS switch.

---

## Commit discipline

When you actually run this migration:

1. Update [zone-luxiga-co.md](zone-luxiga-co.md) with the post-migration state (DNS provider field, any record adjustments)
2. Update [README.md](README.md) — change "Current state" from Namecheap to Cloudflare
3. Add a note to [dnssec-incident-2026-04-10.md](dnssec-incident-2026-04-10.md) closing the "long-term fix" open item
4. Commit with message: `Migrate luxiga.co DNS to Cloudflare`
