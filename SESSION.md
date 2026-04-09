# LUXIGA.co — SESSION
_Last updated: 2026-04-08_

---

## What This Is

LUXIGA business site — the public face of LUXIGA LLC.
Brand: **LUXIGA** — AI Design Technology Studio
Live repo: `Lukas-Green/luxiga.co`
Domain: `luxiga.co` (GitHub Pages, CNAME configured)
Entity: LUXIGA LLC — Oregon
Owner: Lukas Green

---

## Current State

**Status:** Shipped (2026-04-08)

The site is live at `luxiga.co` with:
- Homepage with hero animation (canvas node network), services, Pulse CTA, project cards, stack orbit, about, contact form (Formspree)
- Pulse page (`pulse.html`) — 7-question digital readiness assessment (lightweight version; full React SaaS at `pulse.luxiga.co`)
- Case studies: CanvassKit (`case-studies/canvasskit.html`), SoloBill (`case-studies/solobill.html`)
- Demos: CanvassKit demo (`demo/canvasskit-demo.html`), SoloBill demo (`demo/solobill-demo.html`)
- Custom SVG favicon + apple-touch-icon
- Open Graph tags on all pages
- Mobile responsive with hamburger nav
- Custom cursor (dot + ring) on desktop

---

## Build History

### 2026-04-08 — Audit fixes + favicon

- Added custom LUXIGA product favicon and apple-touch-icon (SVG)
- Fixed OG tags, footer consistency, removed dead code
- Fixed Pulse CTAs to point to live Vercel URL (`pulse.luxiga.co/audit`) instead of pending subdomain
- Linked Pulse CTAs to full React app

### 2026-04-07 — Initial build + stack redesign

- Initial LUXIGA site: homepage, Pulse assessment page, case studies (CanvassKit, SoloBill), demos
- Redesigned stack section with compact orbit layout and floating pills
- All pages built as self-contained HTML with inline styles (zero build step)

---

## Design Tokens

| Token | Value |
|---|---|
| Background | `#080810` |
| Surface | `#0D0D1A` |
| Accent (lime) | `#C4FF53` |
| Accent hover | `#d4ff73` |
| Violet | `#8B5CF6` |
| Violet hover | `#a78bfa` |
| Text primary | `#E8E8F0` |
| Text muted | `#888899` |
| Border | `#1a1a2e` |
| Font sans | Space Grotesk (Google Fonts) |
| Font mono | Space Mono (Google Fonts) |

---

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Homepage — hero, services, Pulse CTA, projects, stack, about, contact |
| `pulse.html` | Pulse digital readiness assessment (7 questions, lightweight) |
| `case-studies/canvasskit.html` | CanvassKit case study |
| `case-studies/solobill.html` | SoloBill case study |
| `demo/canvasskit-demo.html` | Interactive CanvassKit demo |
| `demo/solobill-demo.html` | Interactive SoloBill demo |
| `favicon.svg` | LUXIGA product favicon |
| `apple-touch-icon.svg` | Apple touch icon |
| `assets/img/cartoon-lukas.jpeg` | Cartoon portrait (about section) |
| `CNAME` | Contains: `luxiga.co` |

---

## Site Sections (index.html)

| Section | ID | Description |
|---|---|---|
| Hero | `#home` | Canvas node animation, tagline, dual CTAs |
| Services | `#services` | Service offerings grid |
| Pulse | `#pulse` | Digital readiness assessment CTA |
| Projects | `#projects` | Project cards (CanvassKit, SoloBill, FieldKit, GGC, RecallAI) |
| Stack | `#stack` | Tech stack orbit visualization |
| About | `#about` | Bio + cartoon avatar |
| Contact | `#contact` | Formspree contact form |

---

## Related Repos

| Repo | Purpose |
|---|---|
| `Lukas-Green/luxiga.co` | This repo — business site |
| `Lukas-Green/Lukas-Green.github.io` | Personal portfolio at `lukasdgreen.com` |
| `Lukas-Green/luxiga-pulse` | Full React SaaS Pulse app at `pulse.luxiga.co` (Vercel) |

---

## Pending

1. **Add more case studies** — FieldKit, GGC, RecallAI detail pages
2. **OG preview image** — `assets/img/og-preview.png` referenced but may not exist
3. **Contact form testing** — verify Formspree endpoint is active
4. **Analytics** — add lightweight analytics (Plausible or similar)
5. **Performance audit** — inline styles make the HTML files large; consider extracting shared CSS if adding more pages
