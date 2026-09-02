# 🎲 Meta Infinite Graph
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-blue?logo=github)](https://github.com/sponsors/kevinveenbirkenbach) [![Patreon](https://img.shields.io/badge/Support-Patreon-orange?logo=patreon)](https://www.patreon.com/c/kevinveenbirkenbach) [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20Coffee-Funding-yellow?logo=buymeacoffee)](https://buymeacoffee.com/kevinveenbirkenbach) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://s.veen.world/paypaldonate)

An interactive visualization of the [Infinito.Nexus](https://infinito.nexus) role universe, in two modes. The app scans the mounted `roles/` tree of the infinito repository directly: nginx serves the tree with a JSON autoindex, the browser parses every role's `meta/*.yml` and derives both the 3D graph and the 2D tables live. There is no generation step and no helper files.

## 🚀 Features

### 3D graph

- **3D force-directed graph** powered by [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- **Direct meta scan**: role list from the `/roles/` autoindex, all data from parsed `meta/main.yml` / `meta/services.yml`
- **Edge kinds**: dependencies, dependents, `run_after` ordering flow, Ansible role dependencies (`meta/main.yml`)
- **Global run-after flow** view showing how services execute after one another
- **Attribute filters**: author, lifecycle, deploy mode; details panel with every scanned attribute
- **Optional edges** (group-membership gated consumption) are shown in their own color with a `0..1` label

### Both modes

- **Day/night switch** (🌙 / ☀️) on Bootstrap 5.3's native `data-bs-theme`.
  The system preference decides on first visit; an explicit choice is stored
  and wins until it is toggled again.
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

## ⚙️ Run

The compose stack mounts the infinito repository's `roles/` and `meta/`
directories read-only. With `infinito-nexus-core` checked out next to this
repository:

```bash
make up          # http://127.0.0.1:8000
```

The first run copies `default.env` to `.env` (gitignored). Change the port
or the checkout there:

```bash
# .env
MIG_PORT=8207
INFINITO_ROLES_DIR=/path/to/infinito-nexus-core/roles
INFINITO_META_DIR=/path/to/infinito-nexus-core/meta
```

`INFINITO_META_DIR` points at the repository-root `meta/` holding
`categories.yml`. The 2D tables resolve a service key to its providing role
through the category prefixes in that file, so an `.env` predating the 2D mode
has to gain the line before `make up` starts.

Every reload reflects the current on-disk state of the roles tree.

## 🧪 Tests

Playwright drives the real app headless (boot, heaviest-role start, graph
render, facet population, auto-iteration):

```bash
make test
```

HTTP smoke against the container image:

```bash
make e2e
```

## 📜 License

MIT — see the footer links in the app for author and project references.
