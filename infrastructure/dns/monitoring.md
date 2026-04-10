# Monitoring luxiga.co

Baseline uptime and health monitoring so we find out about outages before visitors do. Motivated directly by the 2026-04-10 DNSSEC incident, which was undetected for hours because no external check was running.

## Goal

Get paged within 5-10 minutes if any of these break:

1. `https://luxiga.co` returns non-200
2. `https://www.luxiga.co` returns non-200
3. `https://pulse.luxiga.co` returns non-200 (once Pulse is deployed)
4. DNS resolves inconsistently across public resolvers (SERVFAIL, empty, or split-brain)
5. TLS cert is within 14 days of expiry (GitHub Pages auto-renews, but a failed renewal is silent)

## Layers

Three monitoring layers, easiest to hardest to set up:

### Layer 1 — UptimeRobot (external HTTP, free)

The minimum viable monitoring. Sign up, add monitors, done in 5 minutes.

**Setup:**

1. https://uptimerobot.com/signUp — free account (50 monitors, 5-min interval)
2. Add New Monitor:
   - Type: **HTTPS**
   - Friendly Name: `luxiga.co apex`
   - URL: `https://luxiga.co`
   - Monitoring Interval: 5 minutes
   - Alert Contacts: your email (add Slack/Discord webhook optionally)
3. Repeat for `https://www.luxiga.co`
4. Repeat for `https://pulse.luxiga.co` (once Pulse ships)

**Alerting thresholds:**
- UptimeRobot alerts after 1 failed check by default — keep this, don't debounce to 2+
- Add a second alert contact (phone via SMS or a secondary email) in case primary mail goes through a luxiga.co inbox that is itself dependent on the DNS being up

**What UptimeRobot catches:**
- Site fully down
- GitHub Pages returning 500s
- TLS cert expired or misconfigured
- DNS not resolving (from UptimeRobot's perspective — they use their own resolvers)

**What it misses:**
- DNSSEC split-brain (UptimeRobot may use a non-validating resolver and see the site as up while validating resolvers return SERVFAIL)
- Content correctness (it only checks that HTTP 200 is returned, not that the page content is right)

### Layer 2 — dns-check.sh (manual or cron)

Script at [../scripts/dns-check.sh](../scripts/dns-check.sh) queries 1.1.1.1, 8.8.8.8, 9.9.9.9 in parallel and fails if:
- Any resolver returns SERVFAIL
- Any resolver returns empty
- Resolvers disagree with each other (split-brain)
- A DS record exists at `.co` but the zone is unsigned (the exact 2026-04-10 failure mode)

**Manual use:**
```bash
cd forge/projects/luxiga-co
./infrastructure/scripts/dns-check.sh
```

Exit code 0 = healthy, non-zero = something to investigate. Human-readable output on stderr.

**As a cron (optional):**
```bash
# crontab -e
*/10 * * * * cd ~/Documents/LG-Forge/Trees/forge/projects/luxiga-co && ./infrastructure/scripts/dns-check.sh >/dev/null 2>&1 || osascript -e 'display notification "luxiga.co DNS check failed" with title "DNS ALERT"'
```

This fires a macOS notification on failure. Crude but free and local.

### Layer 3 — DNSSEC validation monitoring (external)

Covers the exact 2026-04-10 failure mode that Layer 1 cannot detect.

**Option A: DNSViz (manual check)**
https://dnsviz.net/d/luxiga.co/dnssec/ — visualizes the DNSSEC chain. Green = good, red = broken. Not a monitor, but a diagnostic to run whenever you touch DNS.

**Option B: Internet.nl domain check**
https://internet.nl/site/luxiga.co — comprehensive DNS/mail/web standards check including DNSSEC. Run after any DNS change.

**Option C: Paid DNSSEC monitoring**
Services like DNSCheck, StatusCake DNS monitoring, or Datadog synthetic DNS checks. Skip unless monitoring is a client deliverable.

## TLS cert monitoring

GitHub Pages auto-renews via Let's Encrypt. Renewal failures are silent and show up as an expired cert ~30 days later.

**Options:**
- UptimeRobot SSL monitor (separate monitor type, free tier includes it): alerts 14 days before expiry
- https://badssl.com — manual spot-check
- `openssl s_client -connect luxiga.co:443 -servername luxiga.co 2>/dev/null | openssl x509 -noout -dates` — manual CLI check

Add one UptimeRobot SSL monitor on `luxiga.co` once you're setting them up.

## Priority

Do Layer 1 first. It's 5 minutes and catches 80% of outages. Layer 2 is already scaffolded in this repo — just run the script before/after DNS changes. Layer 3 is a nice-to-have until DNSSEC is re-enabled post-Cloudflare.

## Open items

- [ ] Create UptimeRobot account and add 3 HTTPS monitors (luxiga.co, www, pulse)
- [ ] Add UptimeRobot SSL monitor for luxiga.co
- [ ] Decide whether to cron `dns-check.sh` locally
- [ ] After Cloudflare migration: bookmark dnsviz.net and internet.nl checks for periodic spot-checks
