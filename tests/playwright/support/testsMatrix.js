const { expect } = require('@playwright/test');

const MANIFEST = `
const { test } = require("@playwright/test");
require("./test-baseline");
require("./personas");
`;

const BASELINE = `
const { test, expect } = require("@playwright/test");
const { runAdminFlow } = require("./personas");

test("baseline: responds on the canonical domain", async ({ page }) => {
  await page.goto("/");
});

test("administrator: app to universal logout", async ({ page }) => {
  await runAdminFlow(page);
});
`;

// The third shape found in the tree: tests registered from inside a wrapper,
// so the `test(` is indented and a line-anchored split would miss it.
const REGISTERED = `
const { test } = require("@playwright/test");
const { skipUnlessServiceEnabled } = require("./service-gating");

exports.register = function (shared) {
  test("mcp: an unauthenticated probe is rejected", async ({ request }) => {
    skipUnlessServiceEnabled("sso");
    await request.post(shared.url());
  });
};
`;

const ENV = `
SSO_SERVICE_ENABLED={{ lookup('config', application_id, 'services.sso.enabled') | string | lower }}
LOGOUT_SERVICE_ENABLED={{ lookup('config', application_id, 'services.logout.enabled') | string | lower }}
MATOMO_SERVICE_ENABLED={{ lookup('config', application_id, 'services.matomo.enabled') | string | lower }}
LDAP_SERVICE_ENABLED={{ ZAMMAD_LDAP_ENABLED | string | lower }}
`;

const ADMIN_FLOW = `
async function runAdminFlow(page, opts = {}) {
  safeIsEnabled("sso");
  safeIsEnabled("logout");
  safeIsEnabled("matomo");
}
module.exports = { runAdminFlow };
`;

async function load(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PlaywrightMatrix), null, { timeout: 60000 });
}

module.exports = { MANIFEST, BASELINE, REGISTERED, ENV, ADMIN_FLOW, load };
