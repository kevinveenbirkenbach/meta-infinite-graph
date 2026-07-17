// Playwright config: serves the app the same way the container does (static
// src/ root, roles/ symlinked to the local infinito checkout) and drives it
// headless. Override the roles source with INFINITO_ROLES_DIR.
const { defineConfig } = require('@playwright/test');

const PORT = process.env.MIG_TEST_PORT || 8099;

module.exports = defineConfig({
  testDir: './tests/playwright',
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `node tests/serve.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
