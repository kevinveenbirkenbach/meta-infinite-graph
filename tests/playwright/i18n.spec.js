const { test, expect } = require('@playwright/test');

async function quiet(page) {
  await page.route(/\/(roles|git|infinito_meta)\//, route => route.abort());
}

async function languageOf(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.dir), { timeout: 30000 })
    .not.toBe('');
  return page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
}

test('every catalogue translates every key into all 184 languages', async ({ page }) => {
  await quiet(page);
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const load = path => fetch(path).then(response => (response.ok ? response.json() : null));
    const index = await load('locales/index.json');
    const english = await load('locales/en.json');
    const holes = text => [...new Set(text.match(/\{\w+\}/g) || [])].sort().join(',');
    const problems = [];
    for (const { code, name } of index) {
      const own = await load(`locales/${code}.json`);
      if (!own) {
        problems.push(`${code}: no catalogue`);
        continue;
      }
      if (!name) problems.push(`${code}: no native name in index.json`);
      const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
      let same = 0;
      for (const [key, source] of Object.entries(english)) {
        const value = own[key];
        if (value === undefined) {
          problems.push(`${code}: ${key} missing`);
          continue;
        }
        if (typeof source === 'object') {
          for (const category of categories) {
            if (typeof value !== 'object' || typeof value[category] !== 'string' || !value[category].trim()) {
              problems.push(`${code}: ${key} lacks the plural form ${category}`);
            }
          }
          if (typeof value === 'object' && holes(value.other || '') !== holes(source.other)) {
            problems.push(`${code}: ${key} placeholders differ`);
          }
          same += typeof value === 'object' && value.other === source.other;
        } else {
          if (typeof value !== 'string' || !value.trim()) problems.push(`${code}: ${key} is empty`);
          else if (holes(value) !== holes(source)) problems.push(`${code}: ${key} placeholders differ`);
          same += value === source;
        }
      }
      for (const key of Object.keys(own)) {
        if (!(key in english)) problems.push(`${code}: ${key} is not a key of en.json`);
      }
      if (code !== 'en' && same / Object.keys(english).length > 0.4) {
        problems.push(`${code}: ${same} texts left in English`);
      }
    }
    return { languages: index.length, keys: Object.keys(english).length, problems };
  });
  expect(report.languages, 'ISO 639-1 names 184 languages').toBe(184);
  expect(report.keys).toBeGreaterThan(200);
  expect(report.problems).toEqual([]);
});

test('the page renders every static text in each of the 184 languages', async ({ page }) => {
  test.setTimeout(900000);
  await quiet(page);
  await page.goto('/');
  const index = await page.evaluate(() => fetch('locales/index.json').then(response => response.json()));
  const wrong = [];
  for (const { code, dir } of index) {
    await page.evaluate(language => localStorage.setItem('mig-language', language), code);
    await page.goto('/');
    const seen = await languageOf(page);
    if (seen.lang !== code || seen.dir !== (dir || 'ltr')) wrong.push(`${code}: page says ${seen.lang}/${seen.dir}`);
    const mismatches = await page.evaluate(async language => {
      const catalogue = await fetch(`locales/${language}.json`).then(response => response.json());
      return [...document.querySelectorAll('[data-i18n]')]
        .filter(element => element.textContent !== catalogue[element.getAttribute('data-i18n')])
        .map(element => element.getAttribute('data-i18n'));
    }, code);
    if (mismatches.length) wrong.push(`${code}: ${mismatches.slice(0, 5).join(', ')}`);
  }
  expect(wrong).toEqual([]);
});

test.describe('a German browser', () => {
  test.use({ locale: 'de-DE' });

  test('gets German without being asked', async ({ page }) => {
    await quiet(page);
    await page.goto('/');
    expect((await languageOf(page)).lang).toBe('de');
    const german = await page.evaluate(() => fetch('locales/de.json').then(response => response.json()));
    await expect(page.locator('label[for="view-forks"]')).toHaveText(german['view.forks']);
    await expect(page.locator('#design-language')).toHaveValue('auto');
  });
});

test.describe('a browser in a language without a catalogue', () => {
  test.use({ locale: 'tlh' });

  test('falls back to English', async ({ page }) => {
    await quiet(page);
    await page.goto('/');
    expect((await languageOf(page)).lang).toBe('en');
    await expect(page.locator('label[for="view-forks"]')).toHaveText('Timeline');
  });
});

test('the dropdown overrides the browser and survives a reload', async ({ page }) => {
  await quiet(page);
  await page.goto('/');
  expect((await languageOf(page)).lang).toBe('en');
  const french = await page.evaluate(() => fetch('locales/fr.json').then(response => response.json()));

  await page.locator('#btn-design').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#design-language').selectOption('fr')]);
  expect((await languageOf(page)).lang).toBe('fr');
  await expect(page.locator('label[for="view-forks"]')).toHaveText(french['view.forks']);

  await page.reload();
  expect((await languageOf(page)).lang).toBe('fr');
  await expect(page.locator('#design-language')).toHaveValue('fr');

  await page.locator('#btn-design').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#design-language').selectOption('auto')]);
  expect((await languageOf(page)).lang, 'automatic gives the browser its language back').toBe('en');
});

for (const language of ['de', 'ar', 'ja']) {
  test(`the whole app boots and draws its views in ${language}`, async ({ page }) => {
    test.slow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(code => localStorage.setItem('mig-language', code), language);
    await page.goto('/?view=matrix');
    await expect.poll(() => page.evaluate(() => Boolean(window.__mig)), { timeout: 120000 }).toBe(true);
    await expect.poll(() => page.locator('table.role-matrix tbody tr').count(), { timeout: 120000 })
      .toBeGreaterThan(0);
    const catalogue = await page.evaluate(code => fetch(`locales/${code}.json`).then(response => response.json()), language);
    await expect(page.locator('.matrix-section h2')).toHaveText(catalogue['view.matrix']);
    for (const view of ['bond', 'tests', 'commits']) {
      await page.evaluate(name => {
        const input = document.getElementById(`view-${name}`);
        input.checked = true;
        input.dispatchEvent(new Event('change'));
      }, view);
      await expect(page.locator('#tables .table-note').first()).not.toBeEmpty({ timeout: 120000 });
    }
    expect(errors, 'no page error in any view').toEqual([]);
  });
}

test('a right-to-left language turns the page and its stylesheet', async ({ page }) => {
  await quiet(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('mig-language', 'ar'));
  await page.goto('/');
  expect(await languageOf(page)).toEqual({ lang: 'ar', dir: 'rtl' });
  await expect(page.locator('link[href="vendor/bootstrap.rtl.min.css"]')).toHaveCount(1);
});
