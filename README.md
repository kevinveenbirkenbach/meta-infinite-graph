# 🎲 Meta Infinite Graph

An interactive 3D visualization tool to explore the roles and dependencies of the [CyMaIS](https://cymais.cloud) project. Dive into your Ansible roles, see how they connect, and navigate an endless graph of dependencies in real time!

---

## 🚀 Features

- **3D force-directed graph** powered by [3d-force-graph](https://github.com/vasturiano/3d-force-graph)  
- **Lazy loading**: unfolds one role at a time, on demand or automatically  
- **Color-coded nodes** for start, selected, internal, leaf and unloaded roles  
- **Interactive sidebar** with role details, mappings, controls & legend  
- **Bootstrap & Font-Awesome** UI for clean, responsive styling  

---

## 💡 Use Case

Built to visualize the architecture of [CyMaIS](https://cymais.cloud) and to understand how its various Ansible roles relate and depend on one another.

---

## ⚙️ Installation

You can install via **Kevin’s Package Manager**:

```bash
pkgmgr install mig
```

Or simply clone and run with Docker:

```bash
git clone https://github.com/kevinveenbirkenbach/meta-infinite-graph.git
cd meta-infinite-graph
make up
```

---

## 🚀 Preparing the Data 🗂️

The Docker image generates role data during image build:

```bash
docker build -t mig-local .
```

This build step creates:

- `roles/*/meta/tree.json`
- `roles/list.json`

---

## 🧪 Test & Dev Commands

```bash
make build          # build image
make up             # run stack on port 8000
make e2e            # run end-to-end checks
make down           # stop stack
```

## 📝 Usage

1. Browse to `http://localhost:8000`
2. Select your **role** and **mapping(s)**
3. Click “▶️ Start” to auto-expand or click nodes manually
4. Zoom, pan, and inspect details in the sidebar

---

## ⚖️ License

This project is released under the **MIT License**.
Author: [Kevin Veen-Birkenbach](https://veen.world)

---

> “Visualize complexity. Explore connections. Master your infrastructure.” 🎉
