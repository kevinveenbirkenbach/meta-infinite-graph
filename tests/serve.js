// Minimal static server mirroring the container: serves src/ at the root and
// exposes the infinito roles/ tree with a JSON autoindex plus the repository's
// meta/ directory, so the Playwright suite drives the exact code paths the
// nginx image does. No dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8099);
const SRC = path.resolve(__dirname, '../src');
const ROLES = path.resolve(
  __dirname,
  '..',
  process.env.INFINITO_ROLES_DIR || '../infinito-nexus-core/roles'
);
const META = path.resolve(
  __dirname,
  '..',
  process.env.INFINITO_META_DIR || '../infinito-nexus-core/meta'
);

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function autoindex(dir) {
  return JSON.stringify(
    fs.readdirSync(dir, { withFileTypes: true }).map(d => ({
      name: d.name,
      type: d.isDirectory() ? 'directory' : 'file',
    }))
  );
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    try {
      if (url === '/roles/' || url.startsWith('/roles/')) {
        const rel = url.replace(/^\/roles\/?/, '');
        const target = path.join(ROLES, rel);
        if (url.endsWith('/')) {
          // Read before answering: a missing directory must reach the catch
          // below, not throw after the 200 head is already on the wire.
          const listing = autoindex(target || ROLES);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(listing);
        }
        const body = fs.readFileSync(target);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'text/plain' });
        return res.end(body);
      }
      if (url === '/gh-config.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ proxy: Boolean(process.env.MIG_GITHUB_TOKEN) }));
      }
      if (url.startsWith('/meta/')) {
        const target = path.join(META, url.replace(/^\/meta\//, ''));
        const body = fs.readFileSync(target);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'text/plain' });
        return res.end(body);
      }
      const file = url === '/' ? '/index.html' : url;
      const target = path.join(SRC, file);
      const body = fs.readFileSync(target);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'text/plain' });
      return res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  })
  .listen(PORT, () => console.log(`serve.js on ${PORT} (roles: ${ROLES})`));
