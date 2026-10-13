const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { ROOT, sitemapPaths, DELETED_PAGES } = require('./helpers');

const PAGES = sitemapPaths();

test.describe('Sitemap pages', () => {
  test('sitemap lists at least the core pages', () => {
    for (const p of ['/', '/audit/', '/privacy.html']) expect(PAGES).toContain(p);
  });

  for (const p of PAGES) {
    test(`${p} returns 200 and has a non-empty h1`, async ({ page }) => {
      const res = await page.goto(p);
      expect(res.status()).toBe(200);
      const h1 = page.locator('h1').first();
      await expect(h1).toHaveCount(1);
      expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    });
  }
});

test.describe('Deleted pages stay deleted', () => {
  for (const p of DELETED_PAGES) {
    test(`${p} returns 404`, async ({ request }) => {
      const res = await request.get(p);
      expect(res.status()).toBe(404);
    });
  }
});

test.describe('Social preview and meta', () => {
  for (const p of PAGES) {
    test(`${p} meta description >= 50 chars and preview images resolve`, async ({ page, request }) => {
      await page.goto(p);
      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      expect(desc, 'meta description missing').toBeTruthy();
      expect(desc.trim().length).toBeGreaterThanOrEqual(50);

      const imgs = await page.$$eval(
        'meta[property="og:image"], meta[name="twitter:image"]',
        els => els.map(e => e.getAttribute('content')).filter(Boolean)
      );
      for (const src of imgs) {
        // Production URLs are mapped onto this checkout so the check is pre-merge.
        const u = new URL(src, page.url());
        const local = u.hostname === 'luxiga.co' ? u.pathname : null;
        expect(local, `${src} is not on luxiga.co, cannot verify locally`).not.toBeNull();
        const res = await request.get(local);
        expect(res.status(), `${src} -> ${local}`).toBe(200);
        expect(res.headers()['content-type']).toMatch(/^image\//);
      }
    });
  }

  test('homepage og:image maps to a file that exists in the repo', async ({ page }) => {
    await page.goto('/');
    const src = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(src).toBeTruthy();
    const file = path.join(ROOT, new URL(src).pathname);
    expect(fs.existsSync(file), `${file} missing`).toBe(true);
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
  });
});
