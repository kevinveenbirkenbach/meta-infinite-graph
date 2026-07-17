# 🎲 Meta Infinite Graph
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-blue?logo=github)](https://github.com/sponsors/kevinveenbirkenbach) [![Patreon](https://img.shields.io/badge/Support-Patreon-orange?logo=patreon)](https://www.patreon.com/c/kevinveenbirkenbach) [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20Coffee-Funding-yellow?logo=buymeacoffee)](https://buymeacoffee.com/kevinveenbirkenbach) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://s.veen.world/paypaldonate)

An interactive 3D visualization of the [Infinito.Nexus](https://infinito.nexus) role universe. The app scans the mounted `roles/` tree of the infinito repository directly: nginx serves the tree with a JSON autoindex, the browser parses every role's `meta/*.yml` and derives the graph live. There is no generation step and no helper files.

## 🚀 Features

- **3D force-directed graph** powered by [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- **Direct meta scan**: role list from the `/roles/` autoindex, all data from parsed `meta/main.yml` / `meta/services.yml`
- **Edge kinds**: dependencies, dependents, `run_after` ordering flow, Ansible role dependencies (`meta/main.yml`)
- **Global run-after flow** view showing how services execute after one another
- **Attribute filters**: author, lifecycle, deploy mode; details panel with every scanned attribute
- **Optional edges** (group-membership gated consumption) are shown in their own color with a `0..1` label

## ⚙️ Run

The compose stack mounts the infinito repository's `roles/` directory read-only. With `infinito-nexus-core` checked out next to this repository:

```bash
make up          # http://127.0.0.1:8000
```

The first run copies `default.env` to `.env` (gitignored). Change the port
or the roles checkout there:

```bash
# .env
MIG_PORT=8207
INFINITO_ROLES_DIR=/path/to/infinito-nexus-core/roles
```

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
