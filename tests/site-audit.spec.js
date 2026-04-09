const { test, expect } = require('@playwright/test');

// ── Page Load Tests ──

test.describe('Page loads', () => {
  const pages = [
    ['Home', '/'],
    ['Pulse', '/pulse.html'],
    ['SoloBill case study', '/case-studies/solobill.html'],
    ['CanvassKit case study', '/case-studies/canvasskit.html'],
  ];

  for (const [name, path] of pages) {
    test(`${name} page loads with 200`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);
    });
  }
});

// ── SEO & Meta ──

test.describe('SEO', () => {
  test('Home has title and meta description', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/LUXIGA/i);
    const desc = page.locator('meta[name="description"]');
    await expect(desc).toHaveCount(1);
  });
});

// ── Desktop Navigation ──

test.describe('Desktop Navigation', () => {
  test('Nav has all expected links', async ({ page }) => {
    await page.goto('/');
    const navLinks = page.locator('.nav-links a');
    await expect(navLinks).toHaveCount(6);
  });

  test('Nav brand links to home', async ({ page }) => {
    await page.goto('/');
    const brand = page.locator('.nav-brand');
    await expect(brand).toHaveAttribute('href', '#home');
  });

  test('Book a Call CTA is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.nav-cta')).toBeVisible();
  });
});

// ── Mobile Navigation ──

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Hamburger is visible on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hamburger')).toBeVisible();
    await expect(page.locator('.nav-links')).not.toBeVisible();
    await expect(page.locator('.nav-cta')).not.toBeVisible();
  });

  test('Hamburger opens mobile nav', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('.hamburger');
    const mobileNav = page.locator('.mobile-nav');
    await expect(mobileNav).not.toBeVisible();
    await hamburger.click();
    await expect(mobileNav).toBeVisible();
    // Verify all links present
    await expect(mobileNav.locator('a')).toHaveCount(7);
  });

  test('Hamburger closes on second click', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('.hamburger');
    const mobileNav = page.locator('.mobile-nav');
    await hamburger.click();
    await expect(mobileNav).toBeVisible();
    await hamburger.click();
    await expect(mobileNav).not.toBeVisible();
  });

  test('Mobile nav closes on link click', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('.hamburger');
    const mobileNav = page.locator('.mobile-nav');
    await hamburger.click();
    await expect(mobileNav).toBeVisible();
    await mobileNav.locator('a').first().click();
    await expect(mobileNav).not.toBeVisible();
  });

  test('Home link scrolls to top from scrolled position', async ({ page }) => {
    await page.goto('/');
    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(500);
    const scrolledY = await page.evaluate(() => window.scrollY);
    expect(scrolledY).toBeGreaterThan(500);
    // Open mobile nav and click Home
    await page.locator('.hamburger').click();
    await page.locator('.mobile-nav a[href="#home"]').click();
    await page.waitForTimeout(800);
    const finalY = await page.evaluate(() => window.scrollY);
    expect(finalY).toBeLessThan(50);
  });

  test('Nav brand scrolls to top on mobile', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(500);
    await page.locator('.nav-brand').click();
    await page.waitForTimeout(800);
    const finalY = await page.evaluate(() => window.scrollY);
    expect(finalY).toBeLessThan(50);
  });

  test('Hamburger has no default button border', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('.hamburger');
    const border = await hamburger.evaluate(el => getComputedStyle(el).borderStyle);
    expect(border).toBe('none');
  });
});

// ── Mobile Navigation on Subpages ──

test.describe('Subpage mobile nav', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Pulse page hamburger works', async ({ page }) => {
    await page.goto('/pulse.html');
    const hamburger = page.locator('.hamburger');
    const mobileNav = page.locator('.mobile-nav');
    await expect(hamburger).toBeVisible();
    await hamburger.click();
    await expect(mobileNav).toBeVisible();
  });

  test('Pulse page has Home link to index', async ({ page }) => {
    await page.goto('/pulse.html');
    const homeLink = page.locator('.mobile-nav a[href="index.html"]');
    await expect(homeLink).toHaveCount(1);
  });

  test('Case study has Home link to parent index', async ({ page }) => {
    await page.goto('/case-studies/solobill.html');
    const homeLink = page.locator('.mobile-nav a').filter({ hasText: 'Home' });
    await expect(homeLink).toHaveCount(1);
    const href = await homeLink.getAttribute('href');
    expect(href).toContain('index.html');
  });

  test('Case study nav brand links to home', async ({ page }) => {
    await page.goto('/case-studies/solobill.html');
    const brand = page.locator('.nav-brand');
    const href = await brand.getAttribute('href');
    expect(href).toContain('index.html');
  });
});

// ── Sections ──

test.describe('Sections', () => {
  test('All main sections exist', async ({ page }) => {
    await page.goto('/');
    const sectionIds = ['home', 'services', 'pulse', 'projects', 'about', 'contact'];
    for (const id of sectionIds) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
});
