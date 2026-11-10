const { test, expect } = require('@playwright/test');

// index.html has a meta CSP with script-src 'self': only the external files in
// assets/js/ may run. If someone adds an inline script, the browser silently
// refuses it: the page still renders, but the nav, form and theme toggle are dead.
// This spec is the tripwire for that.

const CSP_PATTERN = /Content Security Policy|Content-Security-Policy|Refused to/i;

test.describe('Homepage CSP', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no CSP violations and the inline page JS actually ran', async ({ page }) => {
    const problems = [];
    page.on('console', msg => {
      if (CSP_PATTERN.test(msg.text())) problems.push(`console.${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', err => problems.push(`pageerror: ${err.message}`));

    await page.goto('/');
    await page.waitForLoadState('load');

    // boot.js (head): adds class js to <html>.
    await expect(page.locator('html')).toHaveClass(/(^|\s)js(\s|$)/);

    // site.js (body): wires the hamburger.
    const mobileNav = page.locator('.mobile-nav');
    await expect(mobileNav).not.toBeVisible();
    await page.locator('.hamburger').click();
    await expect(mobileNav).toBeVisible();
    await expect(page.locator('.hamburger')).toHaveAttribute('aria-expanded', 'true');

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
