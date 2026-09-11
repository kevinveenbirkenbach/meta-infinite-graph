const { test, expect } = require('@playwright/test');
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { fill } = require('../../scripts/translate');

const SCRIPT = path.resolve(__dirname, '../../scripts/translate.js');

const ENGLISH = {
  'a.plain': 'Open {repo} now',
  'b.count': { one: '{n} fork of {repo}', other: '{n} forks of {repo}' },
  'c.kept': 'Kept',
};

function locales(catalogues) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-translate-'));
  const index = [{ code: 'en' }, ...Object.keys(catalogues).map(code => ({ code }))];
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(ENGLISH));
  for (const [code, catalogue] of Object.entries(catalogues)) {
    fs.writeFileSync(path.join(dir, `${code}.json`), JSON.stringify(catalogue));
  }
  return dir;
}

function libreTranslate(asked) {
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/languages') {
        return response.end(JSON.stringify([{ code: 'en' }, { code: 'de' }, { code: 'nl' }]));
      }
      const { q, target } = JSON.parse(body);
      asked.push(target);
      response.end(JSON.stringify({ translatedText: q.map(text => `[${target}] ${text}`) }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('make translate fills only what is missing and names the languages it cannot', async () => {
  const kept = { 'a.plain': 'Open {repo} nu', 'b.count': { one: '{n} fork van {repo}', other: '{n} forks van {repo}' }, 'c.kept': 'Bewaard' };
  const dir = locales({
    de: { 'c.kept': 'Behalten', 'b.count': { one: '{n} Fork von {repo}' } },
    nl: kept,
    kl: {},
  });
  const asked = [];
  const server = await libreTranslate(asked);
  const output = await new Promise((resolve, reject) => execFile('node', [SCRIPT, dir], {
    env: { ...process.env, LIBRETRANSLATE_URL: `http://127.0.0.1:${server.address().port}` },
  }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
  server.close();

  const german = JSON.parse(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'));
  expect(german).toEqual({
    'a.plain': '[de] Open {repo} now',
    'b.count': { one: '{n} Fork von {repo}', other: '[de] {n} forks of {repo}' },
    'c.kept': 'Behalten',
  });
  expect(Object.keys(german), 'the catalogue follows the order of en.json').toEqual(Object.keys(ENGLISH));
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'nl.json'), 'utf8')), 'a full catalogue is left alone')
    .toEqual(kept);
  expect(asked, 'one request per language that lacks something').toEqual(['de']);
  expect(output).toContain('de: 2 filled');
  expect(output).toContain('kl (4)');
});

test('a translation that loses a placeholder is reported, never written', async () => {
  const dir = locales({ de: {} });
  const report = await fill(dir, new Set(['de']), async texts => texts.map(text => text.replace('{0}', 'x')));
  expect(report.filled).toEqual({ de: 1 });
  expect(report.skipped, 'the plain message and both plural forms').toHaveLength(3);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'))).toEqual({ 'c.kept': 'Kept' });
});
