const { boot: bootMirror } = require('./mirror');

// Two pull requests per repository, one inside the default window and one from
// 2021, so the range has something to exclude.
function pulls(full) {
  return [
    {
      number: 7, title: `recent in ${full}`, state: 'open', merged_at: null,
      updated_at: '2026-08-20T00:00:00Z', html_url: `https://github.com/${full}/pull/7`,
      base: { repo: { full_name: full } },
    },
    {
      number: 1, title: `ancient in ${full}`, state: 'closed', merged_at: '2021-01-02T00:00:00Z',
      updated_at: '2021-01-02T00:00:00Z', html_url: `https://github.com/${full}/pull/1`,
      base: { repo: { full_name: full } },
    },
  ];
}

const RUN_ID = { 'infinito-nexus/core': 900, 'someone/core': 901 };

function runs(full) {
  return {
    workflow_runs: [
      {
        id: RUN_ID[full], run_number: 42, name: 'test', status: 'completed', conclusion: 'success',
        created_at: '2026-08-25T00:00:00Z', html_url: `https://github.com/${full}/actions/runs/42`,
        repository: { full_name: full },
      },
      {
        run_number: 1, name: 'test', status: 'completed', conclusion: 'failure',
        created_at: '2021-02-02T00:00:00Z', html_url: `https://github.com/${full}/actions/runs/1`,
        repository: { full_name: full },
      },
    ],
  };
}

// Args:
//   calls: every GitHub path asked for and every mirror log walked.
//   options.runs: (full, url) => the /actions/runs answer, in place of runs().
//   options.urls: collects every GitHub URL with its query.
async function boot(page, calls, query = '', options = {}) {
  await page.route('https://api.github.com/**', route => {
    const url = new URL(route.request().url());
    const full = url.pathname.split('/').slice(2, 4).join('/');
    calls.push(url.pathname);
    if (options.urls) options.urls.push(url.pathname + url.search);
    const body = url.pathname.endsWith('/pulls') ? pulls(full)
      : url.pathname.endsWith('/actions/runs') ? (options.runs || runs)(full, url)
        : [];
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining',
        'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900',
      },
      body: JSON.stringify(body),
    });
  });
  await bootMirror(page, calls, query);
}

module.exports = { RUN_ID, pulls, runs, boot };
