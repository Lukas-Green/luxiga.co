// Rasterizes assets/img/og-template.html to a 1200x630 PNG for social previews.
// Run: node scripts/gen-og.js
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const file = 'file://' + path.resolve(__dirname, '../assets/img/og-template.html');
  await page.goto(file, { waitUntil: 'networkidle' });
  // Give web fonts a moment to settle before capture.
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.resolve(__dirname, '../assets/img/og-preview.png'),
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await browser.close();
  console.log('wrote assets/img/og-preview.png');
})();
