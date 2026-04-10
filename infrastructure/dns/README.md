# luxiga.co DNS & Infrastructure

Single source of truth for how `luxiga.co` is hosted and routed. If DNS breaks, start here.

## Current state (as of 2026-04-10)

- **Registrar:** Namecheap
- **DNS hosting:** Namecheap BasicDNS (default `dns1/dns2.registrar-servers.com`)
- **Web hosting:** GitHub Pages (this repo, `CNAME` file → `luxiga.co`)
- **Mail:** Proton Mail (custom domain)
- **Subdomain `pulse.luxiga.co`:** Vercel (LUXIGA Pulse deploy)

## Planned state

- **Registrar:** Namecheap (unchanged)
- **DNS hosting:** Cloudflare (free plan)
- **Everything else:** unchanged

Migration playbook: [cloudflare-migration.md](cloudflare-migration.md)
Declarative record list: [zone-luxiga-co.md](zone-luxiga-co.md)
Incident postmortem: [dnssec-incident-2026-04-10.md](dnssec-incident-2026-04-10.md)
Monitoring setup: [monitoring.md](monitoring.md)

## Rules — do not break these

1. **Never enable DNSSEC on Namecheap BasicDNS.** BasicDNS does not sign zones. Enabling the toggle publishes a DS record at the `.co` registry for a zone with no signatures, and every validating resolver (Cloudflare, Google, Quad9) returns SERVFAIL. This is what caused the 2026-04-10 outage. See [dnssec-incident-2026-04-10.md](dnssec-incident-2026-04-10.md).

2. **Never edit DNS in a hurry.** Every edit is a chance to break resolution. Make the change, verify with `dig @1.1.1.1`, then stop.

3. **Changes to the zone must be reflected in [zone-luxiga-co.md](zone-luxiga-co.md) in the same commit.** This file is the declarative source of truth — if the live zone and this file disagree, the file is wrong and must be updated (or the live zone was edited without discipline and must be reconciled).

4. **Run `scripts/dns-check.sh` after any DNS change.** It queries three public resolvers and fails loudly if they disagree or return SERVFAIL.

5. **Do not touch DNS while a revenue deliverable is in flight** unless the revenue deliverable is literally blocked on DNS. DNS changes take 1-4 hours to propagate in the worst case; that window is not yours to spend when a client or prospect is waiting.

## Quick health check

```bash
./infrastructure/scripts/dns-check.sh
```

Expected output when healthy: three resolvers return identical GitHub Pages A records, no SERVFAIL, DS record absent (until we're on Cloudflare and re-enable DNSSEC properly).
