const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/vendor');
const BRANDS = path.join(ROOT, 'src/role/brands.json');

// [package, file inside it, target under src/vendor]
const FILES = [
  // 3d-force-graph 1.73.4 is built against three 0.146; bump the two together.
  ['three', 'build/three.min.js', 'three.min.js'],
  ['3d-force-graph', 'dist/3d-force-graph.min.js', '3d-force-graph.min.js'],
  ['bootstrap', 'dist/js/bootstrap.bundle.min.js', 'bootstrap.bundle.min.js'],
  ['bootstrap', 'dist/css/bootstrap.min.css', 'bootstrap.min.css'],
  ['js-yaml', 'dist/js-yaml.min.js', 'js-yaml.min.js'],
  // The stylesheet reaches its fonts as ../webfonts/, so the two keep that layout.
  ['@fortawesome/fontawesome-free', 'LICENSE.txt', 'fontawesome/LICENSE.txt'],
  ['@fortawesome/fontawesome-free', 'css/all.min.css', 'fontawesome/css/all.min.css'],
  ['@fortawesome/fontawesome-free', 'webfonts/fa-brands-400.woff2', 'fontawesome/webfonts/fa-brands-400.woff2'],
  ['@fortawesome/fontawesome-free', 'webfonts/fa-regular-400.woff2', 'fontawesome/webfonts/fa-regular-400.woff2'],
  ['@fortawesome/fontawesome-free', 'webfonts/fa-solid-900.woff2', 'fontawesome/webfonts/fa-solid-900.woff2'],
  ['preact', 'dist/preact.module.js', 'preact/preact.module.js'],
  ['preact', 'hooks/dist/hooks.module.js', 'preact/hooks.module.js'],
  ['preact', 'LICENSE', 'preact/LICENSE'],
  ['htm', 'dist/htm.module.js', 'htm/htm.module.js'],
  ['htm', 'LICENSE', 'htm/LICENSE'],
  ['simple-icons', 'LICENSE.md', 'simple-icons/LICENSE.md'],
];

const icons = [...new Set(Object.values(JSON.parse(fs.readFileSync(BRANDS, 'utf8'))))]
  .map(slug => ['simple-icons', `icons/${slug}.svg`, `simple-icons/${slug}.svg`]);

fs.rmSync(OUT, { recursive: true, force: true });
for (const [pkg, file, target] of [...FILES, ...icons]) {
  const source = path.join(ROOT, 'node_modules', pkg, file);
  if (!fs.existsSync(source)) throw new Error(`${pkg} has no ${file}; run npm install`);
  const dest = path.join(OUT, target);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}
console.log(`src/vendor: ${FILES.length + icons.length} files`);
