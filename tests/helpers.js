// Shared helpers: the sitemap is the source of truth for public pages.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function sitemapPaths() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
  if (locs.length === 0) throw new Error('sitemap.xml has no <loc> entries');
  return locs.map(u => new URL(u).pathname);
}

// Pages that are NOT in the sitemap but are still public and must be accessible.
const EXTRA_A11Y_PAGES = [
  '/card/',
  '/privacy.html',
  '/demo/solobill-demo.html',
  '/demo/canvasskit-demo.html',
  '/demo/llm-onboarding.html',
];

// Deleted in the 2026-10 audit fix. Must stay gone.
const DELETED_PAGES = [
  '/case-studies/digital-media-research.html',
  '/case-studies/research/',
];

module.exports = { ROOT, sitemapPaths, EXTRA_A11Y_PAGES, DELETED_PAGES };
