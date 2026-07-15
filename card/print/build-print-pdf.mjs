#!/usr/bin/env node
/**
 * Builds a PRESS-READY business-card PDF for the LUXIGA card.
 *
 * The card artwork in ../index.html is authored in a 252x144 SVG viewBox.
 * That is exactly 3.5in x 2in at 72 units/inch, so 1 SVG unit == 1 PDF point.
 * We reuse that vector art untouched and lay it onto a proper print canvas:
 *
 *   Trim   3.500 x 2.000 in  (252 x 144 pt)   <- the final cut card
 *   Bleed  +0.125 in / side  (270 x 162 pt)   <- dark background extended off the cut
 *   Slug   +0.125 in / side  (288 x 180 pt)   <- white margin holding crop marks
 *
 * Output: luxiga-business-card.pdf  (page 1 = front, page 2 = back), all vector.
 * Also writes proof.png for a quick on-screen sanity check.
 *
 * Run from the luxiga-co repo root (so `playwright` resolves):
 *   node card/print/build-print-pdf.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_HTML = join(HERE, '..', 'index.html');

// ── Geometry (points) ──────────────────────────────────────────────────────
const PT = 1;                 // 1 SVG unit = 1 pt
const TRIM_W = 252, TRIM_H = 144;
const BLEED = 9;              // 0.125in
const SLUG  = 9;              // crop-mark margin beyond bleed
const MEDIA_W = TRIM_W + 2 * (BLEED + SLUG); // 306
const MEDIA_H = TRIM_H + 2 * (BLEED + SLUG); // 198
const OX = BLEED + SLUG;      // art/trim origin offset inside media = 18
const BX = SLUG;              // bleed box offset inside media = 9

// ── Pull the two card faces out of the digital card ─────────────────────────
function extractFace(html, faceClass) {
  const anchor = html.indexOf(`class="${faceClass}"`);
  if (anchor < 0) throw new Error(`face not found: ${faceClass}`);
  const start = html.indexOf('<svg', anchor);
  let depth = 0, end = -1;
  const re = /<svg\b|<\/svg>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '</svg>') { if (--depth === 0) { end = m.index + m[0].length; break; } }
    else depth++;
  }
  if (end < 0) throw new Error(`unbalanced svg: ${faceClass}`);
  const outer = html.slice(start, end);
  // inner content = strip the outer <svg ...> open tag and trailing </svg>
  return outer.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

// ── Crop marks: hairlines collinear with the trim edges, living in the white
//    SLUG band (outside the dark bleed) so they read clearly and cut off.
function cropMarks() {
  const near = 1, far = SLUG - 1;      // slug band = 1..8pt in from each media edge
  const L = OX, R = OX + TRIM_W, T = OX, B = OX + TRIM_H; // trim edges in media coords
  const topA = near, topB = far;                       // top slug band  (y 1..8)
  const botA = MEDIA_H - far, botB = MEDIA_H - near;    // bottom slug band
  const lftA = near, lftB = far;                       // left slug band (x 1..8)
  const rgtA = MEDIA_W - far, rgtB = MEDIA_W - near;    // right slug band
  const seg = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const marks = [
    // vertical marks aligned to the left & right trim edges, in top & bottom slug
    seg(L, topA, L, topB), seg(R, topA, R, topB),
    seg(L, botA, L, botB), seg(R, botA, R, botB),
    // horizontal marks aligned to the top & bottom trim edges, in left & right slug
    seg(lftA, T, lftB, T), seg(rgtA, T, rgtB, T),
    seg(lftA, B, lftB, B), seg(rgtA, B, rgtB, B),
  ].join('');
  return `<g stroke="#111111" stroke-width="0.5" stroke-linecap="butt">${marks}</g>`;
}

function page(innerArt) {
  return `<svg viewBox="0 0 ${MEDIA_W} ${MEDIA_H}" width="${MEDIA_W / 72}in" height="${MEDIA_H / 72}in"
      xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
    <rect x="0" y="0" width="${MEDIA_W}" height="${MEDIA_H}" fill="#ffffff"/>
    <rect x="${BX}" y="${BX}" width="${TRIM_W + 2 * BLEED}" height="${TRIM_H + 2 * BLEED}" fill="#080810"/>
    <g transform="translate(${OX},${OX})">${innerArt}</g>
    ${cropMarks()}
  </svg>`;
}

const html = readFileSync(CARD_HTML, 'utf8');
const front = extractFace(html, 'face front');
const back = extractFace(html, 'face back');

const doc = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: ${MEDIA_W / 72}in ${MEDIA_H / 72}in; margin: 0; }
  html,body { margin:0; padding:0; background:#fff; }
  .pg { width:${MEDIA_W / 72}in; height:${MEDIA_H / 72}in; page-break-after:always; overflow:hidden; }
  .pg:last-child { page-break-after:auto; }
  svg { display:block; }
</style></head><body>
  <div class="pg">${page(front)}</div>
  <div class="pg">${page(back)}</div>
</body></html>`;

writeFileSync(join(HERE, 'print-sheet.html'), doc);

const OUT = join(HERE, 'luxiga-business-card.pdf');
if (existsSync(OUT)) copyFileSync(OUT, join(HERE, 'luxiga-business-card.prev.pdf'));

const browser = await chromium.launch();
const p = await browser.newPage();
await p.setContent(doc, { waitUntil: 'networkidle' });
await p.pdf({
  path: OUT,
  width: `${MEDIA_W / 72}in`,
  height: `${MEDIA_H / 72}in`,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

// Proof PNG (front) at high scale for a quick visual check.
const proof = await browser.newPage({ viewport: { width: MEDIA_W * 4, height: MEDIA_H * 4 }, deviceScaleFactor: 1 });
await proof.setContent(`<!doctype html><body style="margin:0;background:#dcdce4">
  <div style="transform:scale(4);transform-origin:top left;width:${MEDIA_W}px;height:${MEDIA_H}px">
    ${page(front).replace('width="'+MEDIA_W/72+'in"','width="'+MEDIA_W+'"').replace('height="'+MEDIA_H/72+'in"','height="'+MEDIA_H+'"')}
  </div></body>`, { waitUntil: 'networkidle' });
await proof.screenshot({ path: join(HERE, 'proof-front.png'), clip: { x: 0, y: 0, width: MEDIA_W * 4, height: MEDIA_H * 4 } });

const proofB = await browser.newPage({ viewport: { width: MEDIA_W * 4, height: MEDIA_H * 4 }, deviceScaleFactor: 1 });
await proofB.setContent(`<!doctype html><body style="margin:0;background:#dcdce4">
  <div style="transform:scale(4);transform-origin:top left;width:${MEDIA_W}px;height:${MEDIA_H}px">
    ${page(back).replace('width="'+MEDIA_W/72+'in"','width="'+MEDIA_W+'"').replace('height="'+MEDIA_H/72+'in"','height="'+MEDIA_H+'"')}
  </div></body>`, { waitUntil: 'networkidle' });
await proofB.screenshot({ path: join(HERE, 'proof-back.png'), clip: { x: 0, y: 0, width: MEDIA_W * 4, height: MEDIA_H * 4 } });

await browser.close();

console.log('Wrote', OUT);
console.log(`Media ${MEDIA_W}x${MEDIA_H}pt (${MEDIA_W/72}x${MEDIA_H/72}in) · trim ${TRIM_W}x${TRIM_H}pt · bleed ${BLEED}pt · 2 pages`);
