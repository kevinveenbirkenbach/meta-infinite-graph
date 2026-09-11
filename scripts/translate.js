const fs = require('fs');
const path = require('path');

const LOCALES = path.resolve(__dirname, '../src/locales');
const ALIASES = { zh: 'zh-Hans', no: 'nb' };
const HOLE = /\{(\w+)\}/g;

const holes = text => [...new Set(text.match(HOLE) || [])].sort().join(',');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const filled = value => typeof value === 'string' && value.trim() !== '';

// Returns: [{ key, category, source }], one per text the catalogue lacks;
//   category is null for a plain message and a plural category otherwise.
function gaps(english, own, categories) {
  const found = [];
  for (const [key, source] of Object.entries(english)) {
    if (typeof source === 'string') {
      if (!filled(own[key])) found.push({ key, category: null, source });
      continue;
    }
    for (const category of categories) {
      const have = own[key] && typeof own[key] === 'object' ? own[key][category] : undefined;
      if (!filled(have)) found.push({ key, category, source: category === 'one' ? source.one : source.other });
    }
  }
  return found;
}

// Machine translation reads {name} as a word; {0} it passes through.
function protect(text) {
  const names = [];
  const masked = text.replace(HOLE, (all, name) => {
    if (!names.includes(name)) names.push(name);
    return `{${names.indexOf(name)}}`;
  });
  return { masked, names };
}

function restore(text, names) {
  return text.replace(/\{(\d+)\}/g, (all, index) => (names[index] ? `{${names[index]}}` : all));
}

// Args:
//   dir: the locales directory holding index.json, en.json and <code>.json.
//   supported: the LibreTranslate language codes.
//   translate: (texts, target) => Promise<string[]> in the same order.
// Returns: { filled: {code: n}, skipped: [text], unsupported: {code: n} }.
async function fill(dir, supported, translate) {
  const english = read(path.join(dir, 'en.json'));
  const report = { filled: {}, skipped: [], unsupported: {} };
  for (const { code } of read(path.join(dir, 'index.json'))) {
    if (code === 'en') continue;
    const file = path.join(dir, `${code}.json`);
    const own = fs.existsSync(file) ? read(file) : {};
    const missing = gaps(english, own, new Intl.PluralRules(code).resolvedOptions().pluralCategories);
    if (!missing.length) continue;
    const target = supported.has(code) ? code : supported.has(ALIASES[code]) ? ALIASES[code] : null;
    if (!target) {
      report.unsupported[code] = missing.length;
      continue;
    }
    const masks = missing.map(gap => protect(gap.source));
    const answers = await translate(masks.map(mask => mask.masked), target);
    let count = 0;
    missing.forEach((gap, index) => {
      const text = restore(String(answers[index] || ''), masks[index].names);
      if (!filled(text) || holes(text) !== holes(gap.source)) {
        report.skipped.push(`${code} ${gap.key}${gap.category ? `.${gap.category}` : ''}: ${text}`);
        return;
      }
      if (gap.category) own[gap.key] = { ...(typeof own[gap.key] === 'object' ? own[gap.key] : {}), [gap.category]: text };
      else own[gap.key] = text;
      count += 1;
    });
    if (!count) continue;
    const ordered = Object.fromEntries(Object.keys(english).filter(key => key in own).map(key => [key, own[key]]));
    for (const key of Object.keys(own)) if (!(key in ordered)) ordered[key] = own[key];
    fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
    report.filled[code] = count;
  }
  return report;
}

async function main() {
  const url = process.env.LIBRETRANSLATE_URL;
  if (!url) throw new Error('LIBRETRANSLATE_URL is not set');
  const apiKey = process.env.LIBRETRANSLATE_API_KEY || undefined;
  const listed = await fetch(`${url}/languages`).then(response => response.json()).catch(error => {
    throw new Error(`LibreTranslate at ${url} did not answer (${error.cause?.code || error.message}); `
      + 'start one with: docker run -d -p 5000:5000 libretranslate/libretranslate');
  });
  const supported = new Set(listed.map(language => language.code));
  const translate = async (texts, target) => {
    const response = await fetch(`${url}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: texts, source: 'en', target, format: 'text', api_key: apiKey }),
    });
    if (!response.ok) throw new Error(`LibreTranslate ${response.status} for ${target}: ${await response.text()}`);
    return (await response.json()).translatedText;
  };
  const report = await fill(process.argv[2] || LOCALES, supported, translate);
  for (const [code, count] of Object.entries(report.filled)) console.log(`${code}: ${count} filled`);
  for (const line of report.skipped) console.log(`skipped, placeholders came back wrong: ${line}`);
  const open = Object.entries(report.unsupported);
  if (open.length) {
    console.log(`LibreTranslate has no model for ${open.length} languages still missing entries:`);
    console.log(open.map(([code, count]) => `${code} (${count})`).join(' '));
  }
  if (!Object.keys(report.filled).length && !open.length && !report.skipped.length) console.log('nothing missing');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { gaps, protect, restore, fill };
