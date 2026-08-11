const { test, expect } = require('@playwright/test');

// Covers the primary money paths the existing site-audit.spec.js does not touch:
// the Calendly CTA destinations, the homepage contact form's submit/error/validation
// behavior, and the full Pulse/Digital Readiness Audit assessment flow through to
// its own lead-capture form. All network calls to the real Formspree endpoint are
// intercepted, not sent, so this suite has zero external side effects.

const CALENDLY = 'https://calendly.com/lukasgreen-ai-design';

test.describe('Book a Call CTAs', () => {
  test('every Calendly link on the homepage points to the real booking URL', async ({ page }) => {
    await page.goto('/');
    const links = page.locator(`a[href="${CALENDLY}"]`);
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i++) {
      await expect(links.nth(i)).toHaveAttribute('target', '_blank');
      await expect(links.nth(i)).toHaveAttribute('rel', 'noopener');
    }
  });
});

test.describe('Homepage contact form', () => {
  test('valid submit shows the success message and resets the form', async ({ page }) => {
    await page.route('https://formspree.io/f/mkopjjab', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    );
    await page.goto('/');
    await page.fill('#name', 'Test Name');
    await page.fill('#email', 'test@example.com');
    await page.selectOption('#scope', 'AI Consulting');
    await page.fill('#message', 'Test message for conversion flow vetting.');
    await page.click('.form-submit');
    await expect(page.locator('#formStatus')).toHaveText("Sent! I'll be in touch.");
    await expect(page.locator('#formStatus')).toHaveClass(/success/);
    await expect(page.locator('#name')).toHaveValue('');
  });

  test('server error shows an error message and leaves the form filled for retry', async ({ page }) => {
    await page.route('https://formspree.io/f/mkopjjab', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' })
    );
    await page.goto('/');
    await page.fill('#name', 'Test Name');
    await page.fill('#email', 'test@example.com');
    await page.selectOption('#scope', 'AI Consulting');
    await page.fill('#message', 'Test message for conversion flow vetting.');
    await page.click('.form-submit');
    await expect(page.locator('#formStatus')).toHaveText('Error sending message. Try emailing directly.');
    await expect(page.locator('#formStatus')).toHaveClass(/error/);
    // Should not be silently wiped, the visitor's typed message is the thing at risk of loss.
    await expect(page.locator('#message')).toHaveValue('Test message for conversion flow vetting.');
  });

  test('HTML5 required fields block submission before any network call fires', async ({ page }) => {
    let requestFired = false;
    await page.route('https://formspree.io/f/mkopjjab', route => {
      requestFired = true;
      route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/');
    // Leave every required field empty and click submit directly.
    await page.click('.form-submit');
    await page.waitForTimeout(300);
    expect(requestFired).toBe(false);
  });
});

test.describe('Digital Readiness Audit (Pulse) assessment', () => {
  test('answering all 7 questions reaches a results screen with a working CTA', async ({ page }) => {
    await page.goto('/audit/');
    await page.click('#screen-intro .btn-primary');
    await expect(page.locator('#screen-question')).toHaveClass(/active/);

    for (let q = 0; q < 7; q++) {
      await expect(page.locator('#questionStep')).toHaveText(`Question ${q + 1} of 7`);
      await page.locator('.option').first().click();
      // Auto-advance fires 400ms after the click; final question instead runs the
      // 1500ms "calculating" screen before results render.
      await page.waitForTimeout(q === 6 ? 2200 : 700);
    }

    await expect(page.locator('#screen-results')).toHaveClass(/active/);
    await expect(page.locator('#scoreDisplay')).not.toHaveText('0');
    await expect(page.locator('#tierBadge')).not.toBeEmpty();
    await expect(page.locator('#recCards .rec-card')).toHaveCount(3);
    const bookCall = page.locator('#screen-results a', { hasText: 'Book a 30-min call' });
    await expect(bookCall).toHaveAttribute('href', CALENDLY);
  });

  test('BUG: a successful retry after a failed email submit still shows the old error text', async ({ page }) => {
    // Reproduces the flow: assessment completes, first email submit fails (network
    // blip), visitor retries, second submit succeeds. handleEmail() in
    // audit/index.html only sets emailSuccess.textContent on the error path; the
    // success path just toggles display, so it never clears prior error text.
    let attempt = 0;
    await page.route('https://formspree.io/f/mkopjjab', route => {
      attempt++;
      if (attempt === 1) {
        route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await page.goto('/audit/');
    await page.click('#screen-intro .btn-primary');
    for (let q = 0; q < 7; q++) {
      await page.locator('.option').first().click();
      await page.waitForTimeout(q === 6 ? 2200 : 700);
    }
    await expect(page.locator('#screen-results')).toHaveClass(/active/);

    await page.fill('#emailInput', 'retry@example.com');
    await page.click('#emailForm button[type="submit"]');
    await expect(page.locator('#emailSuccess')).toHaveText('Something went wrong. Try again.');

    // Retry: this call succeeds.
    await page.click('#emailForm button[type="submit"]');
    await page.waitForTimeout(200);

    // Expected (correct) behavior: the form is gone AND the message reflects success.
    await expect(page.locator('#emailForm')).toBeHidden();
    await expect(page.locator('#emailSuccess')).toHaveText("Saved! We'll be in touch.");
  });
});

test.describe('Responsive layout, no horizontal scroll', () => {
  const widths = [390, 768, 1024];
  for (const width of widths) {
    test(`homepage has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test(`audit page has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/audit/');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
