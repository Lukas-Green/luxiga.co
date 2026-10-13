const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { sitemapPaths, EXTRA_A11Y_PAGES } = require('./helpers');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = [...new Set([...sitemapPaths(), ...EXTRA_A11Y_PAGES])];

function format(violations) {
  return violations
    .map(v => {
      const nodes = v.nodes
        .map(n => `    target: ${JSON.stringify(n.target)}\n    summary: ${(n.failureSummary || '').replace(/\n/g, ' | ')}`)
        .join('\n');
      return `[${v.impact}] ${v.id}: ${v.help}\n${nodes}`;
    })
    .join('\n\n');
}

async function scan(page) {
  // reducedMotion (set per describe) makes .reveal content render at full opacity
  // so contrast is measured on final colors, not mid-fade. Small settle wait for
  // any remaining transitions.
  await page.waitForTimeout(400);
  // The demos use the AOS library, which animates opacity in JS and ignores
  // prefers-reduced-motion. Measuring mid-fade produced a false contrast hit in
  // WebKit (4.46:1 on text that is 10:1 at rest), so give AOS time to finish.
  if (await page.locator('[data-aos]').count()) await page.waitForTimeout(1200);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations;
}

for (const scheme of ['dark', 'light']) {
  test.describe(`axe WCAG 2.2 AA, ${scheme} scheme`, () => {
    test.use({ colorScheme: scheme, reducedMotion: 'reduce' });

    for (const p of PAGES) {
      test(`${p} has no violations`, async ({ page }) => {
        await page.goto(p);
        const v = await scan(page);
        expect(v.map(x => x.id), `\n${p} (${scheme}):\n${format(v)}`).toEqual([]);
      });
    }
  });
}

test.describe('axe after theme toggle', () => {
  test.use({ colorScheme: 'light', reducedMotion: 'reduce' });

  test('homepage toggled to dark on a light-scheme device has no violations', async ({ page }) => {
    await page.goto('/');
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const v = await scan(page);
    expect(v.map(x => x.id), `\n/ (light device, toggled dark):\n${format(v)}`).toEqual([]);
  });
});
