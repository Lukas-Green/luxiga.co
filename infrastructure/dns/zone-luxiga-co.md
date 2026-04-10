# Zone: luxiga.co (declarative record list)

This is the **source of truth** for what DNS records should exist on `luxiga.co`. If the live zone differs from this file, one of them is wrong.

Update this file in the **same commit** as any DNS change. No exceptions.

**Last verified live:** 2026-04-10 (from Namecheap Advanced DNS screenshots during DNSSEC incident)

---

## Apex (`luxiga.co`) → GitHub Pages

| Type | Host | Value              | TTL       | Purpose            |
|------|------|--------------------|-----------|--------------------|
| A    | @    | 185.199.108.153    | Automatic | GitHub Pages edge  |
| A    | @    | 185.199.109.153    | Automatic | GitHub Pages edge  |
| A    | @    | 185.199.110.153    | Automatic | GitHub Pages edge  |
| A    | @    | 185.199.111.153    | Automatic | GitHub Pages edge  |

Authoritative list: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain

## Subdomains

| Type  | Host  | Value                                  | TTL       | Purpose                    |
|-------|-------|----------------------------------------|-----------|----------------------------|
| CNAME | www   | lukas-green.github.io.                 | Automatic | GitHub Pages www redirect  |
| CNAME | pulse | cname.vercel-dns.com.                  | Automatic | LUXIGA Pulse on Vercel     |

## Mail — Proton Mail

| Type  | Host                      | Value                                     | Priority | Purpose             |
|-------|---------------------------|-------------------------------------------|----------|---------------------|
| MX    | @                         | mail.protonmail.ch.                       | 10       | Primary mail server |
| MX    | @                         | mailsec.protonmail.ch.                    | 20       | Secondary mail      |
| TXT   | @                         | v=spf1 include:_spf.protonmail.ch ~all    | —        | SPF                 |
| CNAME | protonmail._domainkey     | (Proton-provided DKIM target)             | —        | DKIM key 1          |
| CNAME | protonmail2._domainkey    | (Proton-provided DKIM target)             | —        | DKIM key 2          |
| CNAME | protonmail3._domainkey    | (Proton-provided DKIM target)             | —        | DKIM key 3          |
| TXT   | _dmarc                    | v=DMARC1; p=none; rua=mailto:...          | —        | DMARC (verify)      |

> **TODO:** Pull exact DKIM CNAME targets from Proton dashboard and paste in place of placeholders. Verify DMARC record exists — if not, add `v=DMARC1; p=none` to start in report-only mode.

## Verification / ownership

| Type | Host | Value                    | Purpose                        |
|------|------|--------------------------|--------------------------------|
| TXT  | @    | (Proton verification)    | Domain ownership proof         |

## DNSSEC

**Status: DISABLED. Do not enable while on Namecheap BasicDNS.**

Re-enable only after migration to Cloudflare, and only via Cloudflare's "Enable DNSSEC" flow which generates a DS record to publish at the registrar. See [cloudflare-migration.md](cloudflare-migration.md) step 9.

---

## Diff vs. live zone

Run this to compare the declarative list above with what's actually in DNS:

```bash
./infrastructure/scripts/dns-check.sh --full
```

(The `--full` mode queries every record type listed above and reports mismatches.)
