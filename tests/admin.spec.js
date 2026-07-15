const { test, expect } = require('@playwright/test');

// Light smoke test for the LUXIGA CRM admin. No backend is required: the
// page must render cleanly on its own, with every table falling back to an
// empty state when /api/admin/* is unreachable. We block those requests so
// the run is deterministic regardless of what the Worker is doing.

test.describe('LUXIGA CRM admin', () => {
  test.beforeEach(async ({ page }) => {
    // Simulate "no backend deployed yet" — every admin API call fails fast.
    await page.route('**/api/admin/**', (route) => route.abort());
    await page.route('**/cdn-cgi/**', (route) => route.abort());
  });

  test('page loads with the CRM title and brand', async ({ page }) => {
    const response = await page.goto('/admin.html');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/LUXIGA CRM/i);
    await expect(page.locator('.brand .wordmark')).toHaveText('LUXIGA');
  });

  test('all three tabs are present and switch', async ({ page }) => {
    await page.goto('/admin.html');
    const tabs = page.locator('.admin-tab');
    await expect(tabs).toHaveCount(3);

    // Dashboard is active by default.
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await expect(page.locator('#tab-contacts')).toBeHidden();

    await page.click('.admin-tab[data-tab="contacts"]');
    await expect(page.locator('#tab-contacts')).toBeVisible();
    await expect(page.locator('#tab-dashboard')).toBeHidden();
    await expect(page.locator('.admin-tab[data-tab="contacts"]')).toHaveClass(/active/);

    await page.click('.admin-tab[data-tab="campaigns"]');
    await expect(page.locator('#tab-campaigns')).toBeVisible();
    await expect(page.locator('#tab-contacts')).toBeHidden();
  });

  test('tables render an empty state when the backend is down', async ({ page }) => {
    await page.goto('/admin.html');

    // Contacts table falls back to an empty-state row (not "Loading…", not blank).
    await page.click('.admin-tab[data-tab="contacts"]');
    await expect(page.locator('#contactsBody .table-empty')).toContainText(/No contacts yet/i);

    // Campaigns + suppression tables likewise.
    await page.click('.admin-tab[data-tab="campaigns"]');
    await expect(page.locator('#campaignsBody .table-empty')).toContainText(/No campaigns yet/i);
    await expect(page.locator('#suppressionBody .table-empty')).toContainText(/No suppressions yet/i);

    // Dashboard stat cards resolve to a number (0), never a stuck em dash.
    await page.click('.admin-tab[data-tab="dashboard"]');
    await expect(page.locator('#dashContacts')).toHaveText('0');
  });

  test('New Contact modal opens', async ({ page }) => {
    await page.goto('/admin.html');
    await page.click('.admin-tab[data-tab="contacts"]');
    await page.click('button:has-text("+ New Contact")');
    await expect(page.locator('#crmModal')).toHaveClass(/open/);
    await expect(page.locator('#modalBody')).toContainText('New Contact');
    await page.click('.modal-close');
    await expect(page.locator('#crmModal')).not.toHaveClass(/open/);
  });
});
