# 🎲 Meta Infinite Graph
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-blue?logo=github)](https://github.com/sponsors/kevinveenbirkenbach) [![Patreon](https://img.shields.io/badge/Support-Patreon-orange?logo=patreon)](https://www.patreon.com/c/kevinveenbirkenbach) [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20Coffee-Funding-yellow?logo=buymeacoffee)](https://buymeacoffee.com/kevinveenbirkenbach) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://s.veen.world/paypaldonate)

An interactive visualization of the [Infinito.Nexus](https://infinito.nexus) role universe, as a 3D graph and as three tables. The app scans the mounted `roles/` tree of the infinito repository directly: nginx serves the tree with a JSON autoindex, the browser parses every role's `meta/*.yml` and derives both the 3D graph and the 2D tables live. There is no generation step and no helper files.

## 🚀 Features

### 3D graph

- **3D force-directed graph** powered by [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- **Direct meta scan**: role list from the `/roles/` autoindex, all data from parsed `meta/main.yml` / `meta/services.yml`
- **Edge kinds**: dependencies, dependents, `run_after` ordering flow, Ansible role dependencies (`meta/main.yml`)
- **Global run-after flow** view showing how services execute after one another
- **Attribute filters**: author, lifecycle, deploy mode; details panel with every scanned attribute
- **Optional edges** (group-membership gated consumption) are shown in their own color with a `0..1` label

### Both modes

- **Six views** in the top bar: Cosmos, Bond, Ressources, Complexity, Timeline, Tests. Switching
  never hides the previous one; the active view lies over the idle one and only
  the front one takes the pointer.
- **Filter** (🔍) and **Design** (🎨) open the two side panels. The filter panel
  holds the data switches and the author, lifecycle and deploy-mode facets,
  which narrow the tables and the graph alike, plus the graph's own controls
  when the graph is up. The design panel sets the theme, the font size and
  family, whether role names read as text or as icons, and how far the idle
  view shows through the active one.
- **A bottom navigator** carries the loading status and the project credits.
- **Every switch is in the URL.** View, start role, facets, edge kinds, the
  variant and symbol switches, theme, font size, font family and the
  transparency all round-trip through the query string, so a reload or a shared
  link reproduces the page exactly. Values left at their default are left out,
  so the plain URL stays clean.
- **Day/night** on Bootstrap 5.3's native `data-bs-theme`, set in the design
  panel. The system preference decides on first visit; an explicit choice is
  stored and wins until it is set back to "follow the system".
- **Variant awareness** (🧬) reads every role's `meta/variants.yml`. The tables
  gain one row per variant, and the 3D graph keeps only the dependencies a
  variant still enables. `bond` itself is constant across variants; what a
  variant changes is which bonds it deploys.
- **Symbols instead of names** (🔤 / 🔡) swaps every role name for its mark:
  the Simple Icons brand where the entity name matches one (81 of 266 roles),
  otherwise the Font Awesome class from `meta/info.yml`, otherwise a neutral
  circle.
- **Role cards** with description, weight, lifecycle, provides, modes,
  services, tags, author, license, homepage and the video playing inline where
  the URL names a single video or a playlist (37 of 62 do; a channel or a
  vendor's video index keeps the link). They replace the sidebar's old details
  panel.

  Hovering a role opens one, in the tables and on a graph node alike. Cards
  are independent: opening a second one never closes the first, each opens
  where its role is and stacks over whatever is already there, and each
  carries its own close button. A card fades in over 0.1s, lingers half a
  second after the pointer leaves and fades out over another half. Clicking a
  graph node pins its card to the node and it follows it until it is closed.

### Tests

One row per role, variant and test. The **Tests** menu holds the two suites a
role can ship, **Playwright** and **CLI**, the way **Roles** holds its views;
`?view=playwright` and `?view=cli` open them, and an older `?view=tests` link
opens Playwright.

**Playwright** answers which of a role's tests actually runs in which
`meta/variants.yml` variant, and which service flag decides it.

The chain the parser follows is the one the deploy follows:

- `templates/playwright.env.j2` declares `<NAME>_SERVICE_ENABLED`, mostly as
  `lookup('config', application_id, 'services.<key>.enabled')`
- `files/playwright/*.spec.js` are the entry points, because the deploy copies
  the whole directory into `tests/` and the config collects
  `**/*.@(spec|test).js`. Each entry pulls in its `require("./test-…")`
  siblings, which is where most roles keep their scenarios
- a test is gated by `skipUnlessServiceEnabled`, `safeSkipUnlessEnabled` or
  `requireService`, directly or through a shared persona flow. The service name
  becomes an env key the same way `service-gating.js` derives it
- `meta/variants.yml` pins the flag per variant

`isServiceEnabled`, `safeIsEnabled` and `isServiceDisabledReason` are listed
separately as branch gates: they change what a test does without skipping it.

A cell is one of three states, never two. `meta/services.yml` may leave a flag
as `{{ 'web-app-x' in group_names }}`, which only the deployed closure settles,
so those rows read ❓ rather than guessing. ⛔ is reserved for a flag a variant
pins off.

**CLI** is the other suite: one `files/test/test.sh` per role, 29 of them. It has
no counterpart to the service gates, so a row is a whole run rather than a case
and no service switches one off. The columns show what a role does declare
instead: the `cli.timeout` from `meta/tests.yml`, the `*_ENABLED` keys of
`templates/test.env.j2`, and the shared harnesses under
`roles/test-e2e-cli/files/shared` the script sources.

#### Gate filter

Also under **Order** in the filter panel, `?gate=` in the URL. It narrows the
table to one of the four marks:

- ✅ **runs**, every skip gate is on
- ⛔ **never, in no variant**: the gate is off in *every* variant of the role, so
  the test cannot run at all
- ➖ **not in this variant**: off here, but the same test runs in another variant
- ❓ **always maybe, never certain**: no variant settles the gate, so nothing in
  the repository can say whether the test runs
- ❔ **maybe in this variant**: open here, settled in another variant

Both pairs split the same way, and both splits are worth having. A test skipped
in one variant is the design working, that is what a variant is for; a test
skipped in every variant is a test nothing ever proves. Likewise a gate left open
in one variant is normal, while one no variant ever closes means the matrix can
never tell you whether that test ran.

The two splits fall out very differently. Skips are almost all local, 127 rows
against 2 — the two being `web-app-joomla`'s LDAP scenario, whose
`meta/services.yml` pins `ldap.enabled: false` and whose variants never override
it. Uncertainty is the other way round, 106 rows always open against 10 local
ones, because those gates read role variables such as `CHECKMK_SSO_ENABLED` or
the `mcp.enabled` topic, none of which live in a variant.

Whether a test can run at all, or can ever be known to run, is a property of the
whole role, so the view decides it only after every variant's rows exist; the
parser itself answers per variant and stays unaware of both distinctions.

The note keeps counting all rows and adds how many the filter left, so the totals
stay comparable across settings. CLI rows are all ✅, so the other three empty
that table, which is the honest answer rather than a bug.

#### Sort order

The selector sits in the filter panel under **Order**. Two orders, and `?sort=`
carries the choice:

- **role name ▲**, the default
- **CI chunk order**, the order a sweep deploys the rows in, with the chunk each
  one lands in

The CI order is read from `meta/ci-order.json`, which the core checkout writes
with `make ci-order`. It is not recomputed here, because it cannot be: the last
key of `INFINITO_DISCOVERY_SORT` is drawn per invocation unless
`INFINITO_DISCOVERY_SEED` is set, `covered_by` comes out of a greedy set-cover
pass that runs after the sort, and the candidate list is filtered on columns
(`test_compose` and its siblings) that live outside `meta/`. `cli/meta/ci/query.py`
says as much: every human-facing view of that list goes through the CLI rather
than re-deriving the sort, or it shows an order no run will ever take.

The note under the table carries the snapshot's timestamp and commit, so a stale
artefact is visible rather than silently wrong. Without the file the view still
works and the CI option says what to run. Rows the sweep does not plan keep name
order behind the planned ones; they still have tests.

### Timeline

The only view that leaves the mounted `roles/` tree: it reads the GitHub API
directly from the browser and draws the repository and its forks as lines on
one time axis. Clicking a repository's name opens its branches as rows directly
beneath it, each carrying the commits its trunk lacks; a fork that is forked
again brings its own forks along. The design panel switches the commit lanes,
on by default, and the version tags.

Versions come from `/tags`, not `/releases`. `infinito-nexus/core` carries 68
tags and zero releases, and `/releases/latest` answers 404 there, so a releases
call per repository would spend quota on an empty list.

The rate limit shapes the whole design. Unauthenticated GitHub allows **60
requests per hour per IP**, so:

- opening the view costs 2 requests, the repository and its fork list
- the commit lanes cost 1 request per repository, walked one at a time and
  stopped at the first refusal
- opening a repository costs 1 request for its branch list and 1 per branch
  besides the default one, plus 1 for its fork list when it is forked again; a
  repository served by the git mirror costs nothing for its branches
- answers are cached in the browser for an hour, and a reload spends nothing.
  A conditional `If-None-Match` request would not help: it answers 304 and
  still costs one unauthenticated unit, so the cache skips the request instead
  of revalidating it
- the panel shows how much quota is left, read from the response headers
  GitHub exposes to scripts
- a personal token, read-only and public scope, raises the limit to 5000 per
  hour

The root is `infinito-nexus/core` and `?repo=owner/name` points the view at
another network.

#### The token

Two ways in, and the deployment decides which one the visitor gets.

**The server holds it.** Put it in `.env`:

```
MIG_GITHUB_TOKEN=github_pat_...
```

The container writes an nginx snippet at start that adds the `Authorization`
header to a `/gh/` proxy, and serves `/gh-config.json` saying the proxy is
live. The browser then talks to `/gh/` instead of `api.github.com` and never
sees the token. The token field disappears from the filter panel, replaced by
a note that the server supplies one, and a token a visitor had stored is
dropped. Every visitor shares the one 5000 per hour budget.

The proxy only forwards what the page actually calls: `/repos/owner/name` and
its `/forks`, `/branches`, `/tags`, `/commits`, `/pulls`, `/actions/runs` and
`/security-advisories`, plus the alert paths of the [Security](#security) tab
when `MIG_GITHUB_ALERTS=true`. Anything else answers 404, so the token cannot
be borrowed for the rest of the API.

**The visitor holds it.** With `MIG_GITHUB_TOKEN` empty the browser calls
`api.github.com` directly and the filter panel offers a token field. That token
stays in the visitor's browser and never travels in the URL, so a shared link
carries the view but not the credential.

Direct calls need `https://api.github.com` in the `connect-src` of the
deployment's content security policy; without it the browser blocks every call
and only this view goes dark. A server token removes that requirement, because
then every call is same origin.

### Security

The **Security** tab lists the findings of every repository ticked in the
sources menu in one table, worst first. Above it one row per repository counts
the findings per source and links to that source's page on GitHub.

| Source | Asked for | Who can read it |
|---|---|---|
| Advisories | `/security-advisories?state=published` | anyone, no token needed |
| Dependabot | `/dependabot/alerts?state=open` | a token with read permission for Dependabot alerts |
| Code scanning | `/code-scanning/alerts?state=open` | a token with read permission for code scanning alerts |
| Secret scanning | `/secret-scanning/alerts?state=open&hide_secret=true` | a token with read permission for secret scanning alerts |

A cell reads `no access` when there is no token, the token lacks that
permission, or the feature is off for the repository. Secret scanning always
sends `hide_secret=true`, so a secret's value never reaches the page. The
findings are the current state, so the time window does not narrow them; each
source lists its first 100.

Behind a server token the proxy forwards only the advisories, and the alert
cells read `withheld`. To forward the alerts as well, set in `.env`:

```
MIG_GITHUB_ALERTS=true
```

Only the exact value `true` turns it on. Every visitor of the instance then
sees the alerts the server token can read, so set it only on an instance no one
else reaches. The proxy sends each of these paths with the query shown above
and drops the visitor's own.

### 2D tables

The tables the infinito `meta` CLI prints, recomputed in the browser from the
same scanned metadata. Read only: writing a bond back into a role stays with
the `bond` CLI, which ships its own editable server.

- **Bond matrix** (`cli.meta.roles.applications.bond`): one cell per role pair,
  row to column above column to row. A bond of `0` is the page, `1` its
  opposite, so the ink follows the theme. Hovering crosses the pair in yellow,
  a click locks the cross in violet until the next click on it
- **Ressources** (`cli.meta.roles.applications.ressources`): the compose
  footprint per role with its shared dependencies resolved recursively
- **Complexity** (`cli.meta.roles.applications.complexity`): the embedded and
  consuming closures per role and their weight

Two columns of the CLI output are not reachable from a browser and are left
out: `ressources` reads the heaviest `meta/variants.yml` variant where the 2D
mode reads the base config, and `complexity` drops the CI columns (`compose`,
`swarm`, `host`, `stack`, `test_*`, `variants`, `in_main`), which need the git
history, `default.env` and each role's `templates/` directory.

## 🌐 Languages

The interface speaks all 184 ISO 639-1 languages. It picks the first language
the browser prefers that has a catalogue and falls back to English; the
**Language** menu in the design panel overrides that and remembers the choice
in this browser. Right-to-left languages turn the page and load Bootstrap's RTL
stylesheet.

- `src/locales/index.json` lists every language with its own name and, for
  right-to-left scripts, `"dir": "rtl"`.
- `src/locales/en.json` is the source catalogue. Each other `<code>.json` holds
  the same keys. `{name}` placeholders are filled at runtime; a message that
  depends on a count is an object with one text per plural category the
  browser's `Intl.PluralRules` knows for that language.
- In code a text is `t('key', { placeholder })` from `src/i18n.js`; in
  `index.html` it is a `data-i18n`, `data-i18n-title` or `data-i18n-placeholder`
  attribute.

To add or change a text, edit `en.json` and every other catalogue with it.
`make translate` fills whatever the other catalogues lack, missing keys and
missing plural forms alike, through a LibreTranslate server:

```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
make translate                      # LIBRETRANSLATE_URL=http://127.0.0.1:5000
```

It sends one request per language, keeps every `{placeholder}`, and leaves an
entry out when a placeholder comes back changed. LibreTranslate has models for
only a few dozen of the 184 languages; the command lists the ones it could not
fill, and those still need a hand. `LIBRETRANSLATE_API_KEY` is sent along for a
server that requires one.

`make lint` fails on a key the code asks for that `en.json` lacks, and on one
nothing uses; `tests/playwright/i18n.spec.js` fails on a catalogue missing a
key, a placeholder or a plural form, and renders the page in every language.

## ⚙️ Run

The compose stack mounts the infinito repository's `roles/` and `meta/`
directories read-only. With `infinito-nexus-core` checked out next to this
repository:

```bash
make up          # http://127.0.0.1:8000
```

The libraries the page loads are pinned in `package.json`. `make up` and the
test targets first run `make vendor`, which installs them and copies the files
the page needs into `src/vendor/` (gitignored), so the host needs Node.js and
npm. The image build does the same in its own Node stage. To move a library to
a new version, change its pin in `package.json` and run `make vendor`.

The first run copies `default.env` to `.env` (gitignored). Change the port
or the checkout there:

```bash
# .env
MIG_PORT=8207
INFINITO_ROLES_DIR=/path/to/infinito-nexus-core/roles
INFINITO_META_DIR=/path/to/infinito-nexus-core/meta
MIG_GITHUB_TOKEN=
MIG_GITHUB_ALERTS=false
MIG_GIT_ROOT=infinito-nexus/core
MIG_GIT_FORKS=auto
MIG_GIT_HOME=/var/lib/mig
```

`INFINITO_META_DIR` points at the repository-root `meta/` holding
`categories.yml`. The 2D tables resolve a service key to its providing role
through the category prefixes in that file, so an `.env` predating the 2D mode
has to gain the line before `make up` starts.

`MIG_GIT_ROOT` is the repository the local mirror clones, `MIG_GIT_FORKS` is
`auto`, `off` or a space separated `owner/name` list, and `MIG_GIT_HOME` is
where the mirror lives inside the container. An `.env` without these three
lines stops `make up`; copy them from `default.env`.

Every reload reflects the current on-disk state of the roles tree.

## 🧪 Tests

Playwright drives the real app headless (boot, heaviest-role start, graph
render, facet population, auto-iteration):

```bash
make test
```

The folder layout and the types of `src/` are checked without a browser:

```bash
make lint
```

HTTP smoke against the container image:

```bash
make e2e
```

The GitHub proxy the server token builds is checked against the built image,
with a token and without one, and its routes are probed:

```bash
make nginx-verify
make nginx-probe
```

`make help` lists the rest.

## 📜 License

MIT — see the footer links in the app for author and project references.
