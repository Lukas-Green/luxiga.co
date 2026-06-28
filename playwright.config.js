const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    // Test the code in this checkout, not production. A pre-merge check must
    // validate the committed site, otherwise nav/content changes can never pass
    // (they would need prod to already have the change they are introducing).
    // Override with BASE_URL to point the suite at a deployed environment.
    baseURL: process.env.BASE_URL || 'http://localhost:4173',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
