// Build-time data generation. Runs once (npm run gen-data) and produces the
// bundled, offline data the app consumes at runtime:
//   - src/assets/countries-110m.json   world TopoJSON (copied from world-atlas)
//   - src/data/countries.json          per-country metadata (iso, continent, area)
//   - src/i18n/locales/en.json         country names keyed by numeric ISO code
//   - src/i18n/locales/ru.json         (extensible: add more locale files here)
//
// Keys are normalised numeric ISO 3166-1 codes WITHOUT leading zeros so they
// always line up with the ids used in the world-atlas TopoJSON.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const countries = require('world-countries');

const norm = (ccn3) => {
  const n = parseInt(ccn3, 10);
  return Number.isFinite(n) ? String(n) : null;
};

const meta = [];
const en = {};
const ru = {};

for (const c of countries) {
  const id = norm(c.ccn3);
  if (!id || !c.cca2) continue; // no numeric/alpha-2 code -> not guessable
  meta.push({
    id,
    alpha2: c.cca2,
    alpha3: c.cca3,
    area: c.area, // km^2
    continent: c.region || 'Other',
    subregion: c.subregion || '',
  });
  en[id] = c.name.common;
  ru[id] = (c.translations && c.translations.rus && c.translations.rus.common) || c.name.common;
}

meta.sort((a, b) => a.id.localeCompare(b.id));

const write = (rel, data) => {
  const out = resolve(root, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 0) + '\n');
  console.log('wrote', rel, Array.isArray(data) ? `(${data.length})` : `(${Object.keys(data).length})`);
};

write('src/data/countries.json', meta);
write('src/i18n/locales/en.json', en);
write('src/i18n/locales/ru.json', ru);

// Copy the world map TopoJSON into the repo so the app is self-contained.
const topoSrc = require.resolve('world-atlas/countries-110m.json');
const topoDst = resolve(root, 'src/assets/countries-110m.json');
mkdirSync(dirname(topoDst), { recursive: true });
copyFileSync(topoSrc, topoDst);
console.log('copied countries-110m.json');
