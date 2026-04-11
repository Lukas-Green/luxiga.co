# luxiga.co — Polish Pass Plan

_Drafted: 2026-04-10 · Status: approved, pending implementation_

## Context

luxiga.co shipped 2026-04-08. This is a polish-pass (not a rebuild) driven by a
design review against references the owner flagged as standout examples:

- `moonbeam.network`
- `biotech.chipsa.design`
- `htmlburger.com/blog/tech-website-design/`

Brief from the owner: _"Make noise but not too loud or bold. Clear, concise,
memorable. I want it to stand out. The Friction hero line should be larger and
stand out more."_

The review wore three hats: brand/marketing, UX, and senior creative web dev.
The one-sentence diagnosis: **the hero has six stacked elements and the
declaration line is undersized. Invert the hierarchy — make the sentence the
moment, trim noise elsewhere to buy attention budget.**

---

## Locked decisions

- **Scope:** polish pass (surgical edits, not a rebuild)
- **Hero copy:** `"I hear friction. I build fixes."` (Lane 1 — "hear" instead
  of "listen for" drops soft syllables, hardens the opening consonant, keeps
  the receptive/listening soul of the brand, sharpens the metaphor)
- **Custom cursor:** stays. Effect budget must be found elsewhere.
- **Reference sites:** moonbeam + chipsa will be fetched during implementation
  for specific move calibration

---

## Why the hero copy changed

Original: `"I listen for the friction. I build the fix."`

- 10 words, 12 syllables
- `"listen for"` is three soft syllables before the noun; `"the"` eats another
  beat on both sides
- At display size (the whole point of the polish pass), the sentence deflates
  before the nouns land

New: `"I hear friction. I build fixes."`

- 6 words, 7 syllables
- `"hear"` is one syllable with a harder opening than `"listen"` — and it does
  real metaphor work: most people don't notice friction, Lukas does. It
  reinforces the _listening-to-what-others-miss_ positioning better than
  `"listen for"` ever did
- Drops `"the"` on both sides — nouns land in beat 2 of each half, not beat 4
- Plural `"fixes"` is slightly less precious than `"the fix"` — reads as a
  practice, not a promise

---

## Punch list

Line numbers reference `index.html` as of commit `79002aa`.

| # | Change | Section | Risk |
|---|---|---|---|
| 1 | Copy swap to `"I hear friction. I build fixes."` (line 261) | Hero | Low |
| 2 | H1 type scale → `clamp(3.2rem, 11vw, 8.5rem)`, `line-height: 0.95`, `letter-spacing: -0.03em`, `font-weight: 500` (line 80) | Hero | Low |
| 3 | **Remove stats bar** (lines 268–272) — `22+ / 14 / 100%`. `22+` relocates to About timeline; others drop | Hero | Medium — confirm if attached |
| 4 | Merge `hero-label` + `hero-subtitle` into one mono byline below h1: `"LUKAS GREEN — AI DESIGN TECHNOLOGIST — PORTLAND, OR"` (lines 260, 262) | Hero | Low |
| 5 | Move `hero-tagline` (line 263) from hero → Services section intro (cleaner hero, Services gets proper lead-in) | Hero / Services | Low |
| 6 | Stagger reveal: line 1 lands → 300ms pause → line 2 lands. Page-load, not scroll-triggered. Uses existing `reveal` infra | Hero | Low |
| 7 | Calm backdrop: particle count 55→38 (line 614), watermark opacity `.04`→`.025` (line 72) | Hero bg | Low |
| 8 | **Add `FRICTION → FIX` marquee transition** between Hero and Services — 64px tall, full-width, Space Mono ~0.8rem, muted gold, 60s/loop scroll, pauses on hover, static on `prefers-reduced-motion` | Hero / Services gap | Medium — new effect |
| 9 | Project-origin quote moves **above** h3 on each card, bumps to `1.05rem` italic (lines 121, 367–407) | Projects | Low |

Items 3 and 8 are the only subjective calls. Everything else is surgical.

---

## What is explicitly NOT touched

- Nav (works as-is)
- Custom cursor (staying per owner decision)
- Canvas animation, mesh gradient, orbs (background layer is strong — only
  the two opacity/count tweaks above)
- Pulse, Stack, About, Contact sections
- Color system, typography system, Space Grotesk + Space Mono
- Contact form (Formspree wired, functional)
- Footer (correctly minimal)

---

## The one new kinetic moment

The only _added_ effect in the whole polish pass is the `FRICTION → FIX`
marquee transition between Hero and Services. Rationale:

- The site currently has a dead scroll between Hero and Services — you leave
  the hero moment and the next section just appears
- A single kinetic element in the gap acts as a breath between sections
- The text reinforces the brand's core equation (friction in, fix out)
- Space Mono at small size in muted gold keeps it quiet — it's noise _texture_,
  not noise _volume_
- Respects `prefers-reduced-motion`

Everything else in the polish pass is _subtractive_ or _scale adjustment_ —
this is the single additive move, which honors the "make noise but not too
loud" constraint.

---

## Implementation workflow

- Work happens in the live `Lukas-Green/luxiga.co` repo (the detached
  `forge/projects/luxiga-co/` directory was resolved 2026-04-10 — see the
  SESSION entry below)
- Each punch list item should be a reviewable diff — ideally one commit per
  item, or grouped by section (hero / projects / new marquee)
- Playwright tests must still pass
- Before pushing, Lighthouse check: the polish should _raise_ scores, not
  lower them. The new marquee is the only effect that needs a perf budget
  check (should be cheap — CSS-only animation on a single text element)

---

## Open questions for implementation

None at plan time. All blocking decisions are locked.
