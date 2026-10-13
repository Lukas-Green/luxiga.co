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

test.describe('Homepage contact form honeypot', () => {
  test('a filled _gotcha field sends nothing to Formspree', async ({ page }) => {
    let calls = 0;
    await page.route('**formspree.io/**', route => {
      calls++;
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await page.fill('#name', 'Bot Name');
    await page.fill('#email', 'bot@example.com');
    await page.selectOption('#scope', 'AI Consulting');
    await page.fill('#message', 'Spam message body from a bot.');
    // The field is visually hidden and aria-hidden; bots fill it via the DOM.
    const hp = page.locator('#contactForm [name="_gotcha"]');
    await expect(hp).toHaveCount(1);
    await hp.evaluate(el => { el.value = 'http://spam.example'; });
    await page.click('.form-submit');
    await page.waitForTimeout(800);
    expect(calls).toBe(0);
  });
});

test.describe('Digital Readiness Audit (Pulse) assessment', () => {
  test('keyboard only: Tab to Start, answer all 7, reach results', async ({ page, browserName }) => {
    // WebKit on macOS does not move focus to buttons with Tab by default.
    test.skip(browserName === 'webkit', 'Safari Tab skips buttons unless Option+Tab');
    await page.goto('/audit/');
    const start = page.locator('#screen-intro .btn-primary');
    let found = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await start.evaluate(el => el === document.activeElement)) { found = true; break; }
    }
    expect(found, 'Start button never received focus via Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#screen-question')).toHaveClass(/active/);

    for (let q = 0; q < 7; q++) {
      await expect(page.locator('#questionStep')).toHaveText(`Question ${q + 1} of 7`);
      // renderQuestion() focuses the heading, so the next Tab lands on option 1.
      await page.keyboard.press('Tab');
      const focusedIsOption = await page.evaluate(() => document.activeElement.classList.contains('option'));
      expect(focusedIsOption, `Q${q + 1}: Tab did not land on an answer`).toBe(true);
      await page.keyboard.press(q % 2 === 0 ? 'Enter' : 'Space');
      await page.waitForTimeout(q === 6 ? 2200 : 700);
    }

    await expect(page.locator('#screen-results')).toHaveClass(/active/);
    await expect(page.locator('#recCards .rec-card')).toHaveCount(3);
  });

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
    const bookCall = page.locator('#screen-results a', { hasText: 'Book a free 30-min call' });
    await expect(bookCall).toHaveAttribute('href', CALENDLY);
  });

  test('successful retry clears the prior error text', async ({ page }) => {
    // Flow: assessment completes, first email submit fails (network blip), visitor
    // retries, second submit succeeds. Regression guard for the old bug where the
    // success path never replaced the earlier error text.
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
    await expect(page.locator('#emailSuccess')).toHaveText('Sent. Lukas will be in touch.');
    await expect(page.locator('#emailSuccess')).not.toContainText('wrong');
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
