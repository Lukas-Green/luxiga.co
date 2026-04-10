# DNSSEC Incident Postmortem — 2026-04-10

**Severity:** High — luxiga.co unreachable for all validating DNS resolvers (est. ~50% of internet users including Google crawler, Cloudflare Warp users, corporate networks)
**Duration:** Several hours on 2026-04-10 (exact start unknown, ended after DS record cleared from `.co` registry post-fix)
**Root cause:** DNSSEC enabled at Namecheap for a BasicDNS zone that was not actually signed
**Detection:** User reported "site not working"; `dig` against 1.1.1.1 and 8.8.8.8 returned SERVFAIL

---

## What happened

At some point before 2026-04-10, DNSSEC was enabled on luxiga.co via the Namecheap Advanced DNS → DNSSEC toggle. This caused Namecheap to publish a DS record at the `.co` registry:

```
57851 13 1 F83A7BEA409FCB6CD2EB303C7BB064FC8D9A1A7F
```

The DS record is a cryptographic fingerprint that tells resolvers "this zone is signed — verify signatures before trusting answers." However, **Namecheap BasicDNS does not actually sign zones.** Signing is only available on Namecheap's PremiumDNS product, or via external DNS providers (Cloudflare, Route53, etc.) that support DNSSEC.

The result:
- Parent registry (`.co`): "luxiga.co is DNSSEC-signed, here is the DS record"
- Actual zone at `dns1/dns2.registrar-servers.com`: no RRSIG records, no signatures
- Validating resolvers (Cloudflare 1.1.1.1, Google 8.8.8.8, Quad9 9.9.9.9): "signatures missing, refusing to answer" → `SERVFAIL` with Extended DNS Error code 10 ("RRSIGs Missing")
- Non-validating resolvers (most mobile carriers, some ISPs): return A records anyway, site loads

This produced the confusing symptom "it works on my phone but not my laptop" because mobile carrier DNS typically doesn't validate DNSSEC, while Cloudflare/Google DNS does.

## Diagnosis timeline

1. User reports site down
2. `dig luxiga.co @1.1.1.1 +short` returns empty
3. `dig luxiga.co @8.8.8.8` returns `SERVFAIL` with EDE code 10
4. `dig luxiga.co @8.8.8.8 +cd +short` (bypass validation) returns the correct GitHub Pages A records
5. `dig DS luxiga.co @1.1.1.1 +short` returns a DS record (keytag 57851)
6. Direct HTTPS to `185.199.108.153` with Host header returns HTTP 200 from GitHub Pages — **site itself is fine**
7. Diagnosis confirmed: DNSSEC misconfiguration at registrar level

## Fix applied

User toggled DNSSEC off in Namecheap Advanced DNS → DNSSEC section. Namecheap submitted the DS record deletion to the `.co` registry. Site resumed resolving for validating resolvers once the deletion propagated (typically 30 min to 4 hours for `.co`).

## Why this happened

Unknown exact trigger. Most likely causes:

1. DNSSEC toggle accidentally enabled during a prior DNS edit session
2. DNSSEC was on from a previous DNS provider setup and never removed when switching to BasicDNS
3. Namecheap UI change surfaced a default-on setting

Investigation cannot determine which — Namecheap does not expose a DNSSEC change audit log on BasicDNS.

## Why it wasn't caught sooner

- **No uptime monitoring.** No external service was checking `https://luxiga.co` on a schedule. Detection relied on human observation.
- **Split-brain DNS behavior.** Mobile and laptop experiences diverged, making the outage hard to notice. User's own phone continued working.
- **No DNSSEC validation alert.** No tool was flagging the DNSSEC chain as broken.

## Long-term fixes

- [ ] **Migrate DNS to Cloudflare.** Cloudflare BasicDNS-equivalent offering is free, uses anycast (faster), and signs zones correctly if DNSSEC is enabled. See [cloudflare-migration.md](cloudflare-migration.md).
- [ ] **Set up UptimeRobot** (or equivalent) monitoring `https://luxiga.co` every 5 minutes with email alerts. See [monitoring.md](monitoring.md).
- [ ] **Add `dns-check.sh` script** that queries multiple public resolvers and can be run manually or on a cron before/after DNS changes. See [scripts/dns-check.sh](../scripts/dns-check.sh).
- [ ] **Document the "never enable DNSSEC on Namecheap BasicDNS" rule in the DNS README.** ✅ Done — see [README.md](README.md) rule #1.
- [ ] **Declare zone state in version control.** ✅ Done — see [zone-luxiga-co.md](zone-luxiga-co.md). Future DNS drift can now be diffed against a source of truth.

## Lessons learned

1. **DNSSEC toggles are footguns on registrars that don't sign.** A single click can take a domain down. Registrars should refuse to publish DS records for unsigned zones. They don't.
2. **"Works on my phone" is not an uptime check.** Carrier DNS hides DNSSEC failures. Always test with `dig @1.1.1.1` and `dig @8.8.8.8` when verifying DNS changes.
3. **Static sites with no monitoring can be down for hours unnoticed.** Baseline uptime monitoring is cheap and should exist from day one for any domain that matters.
4. **The DS record deletion is not instant.** Once submitted, the fix timeline is controlled by the parent registry, not by you or your registrar's UI. Budget 1-4 hours before declaring DNS "fixed."
5. **"It resolves from cellular" ≠ "it resolves globally."** Split-brain failure modes are dangerous because they feel like partial recovery.

## Commands worth remembering

```bash
# Is the site actually reachable, bypassing DNS entirely?
curl -sI --max-time 5 --resolve luxiga.co:443:185.199.108.153 https://luxiga.co

# Does the DNS chain validate?
dig luxiga.co @1.1.1.1 +short           # empty → broken, IPs → working
dig luxiga.co @1.1.1.1 +cd +short       # +cd disables validation — if this works but above doesn't, it's DNSSEC

# Is there a stale DS record at the parent?
dig DS luxiga.co @1.1.1.1 +short        # empty = no DNSSEC, any value = DNSSEC enabled

# What do the authoritative nameservers actually say?
dig NS luxiga.co @1.1.1.1 +short
dig luxiga.co @dns1.registrar-servers.com +short
```
