#!/usr/bin/env node
// Build the site for GitHub Pages (ARCHITECTURE §3, §12): the page, its code, styles and images, data/meta,
// the SEO files, the data bundles under bundles/<data version>/, and the landing pages with the sitemap
// (tools/landing.mjs, made from those bundles):
//   meta.json      languages, modules, fields, labels and version, as src/data/loader.js reads them
//   concepts.json  { module: { id: concept } } in module tree order, without the authors' notes
//   <code>.json    one per language with data: all its layers, { lang, ex, ipa, etym }, keyed by concept ID
//   ui-<code>.json one per interface language but English: its texts, from data/ui and data/landing
//                  (tools/ui-texts.mjs uiBundle)
// and, outside the versioned bundles so that they stay cached across data versions, the pronunciation audio of each
// language with clips (tools/lib/audio.mjs audioPacks): audio/<code>/<module>.<hash>.mp3 packs and an
// index.<hash>.json, which meta.json names (meta.audio). The site must stay under 900 MB (Pages allows 1 GB).
//
//   node tools/bundle.mjs [--site _site] [--data data] [--meta <data>/meta] [--limit-mb 900]
//
// --site  output directory (default _site/, which git ignores). It is replaced as a whole, so the tool
//         refuses a directory it did not build.
// --data  read concepts and layers from another directory (e.g. tests/fixtures/data); --meta defaults to data/meta
// --limit-mb  fail when the site is larger (default 900)
// Same data, same bytes. Preview the result with: python3 -m http.server -d _site 8000
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createLoader } from '../src/data/loader.js';
import { UI_LANGUAGES } from '../src/ui/i18n.js';
import { DECKS_DIR, appMeta, landingSite, readTranslations, translatedLanguages } from './landing.mjs';
import { readUiTexts, uiBundle } from './ui-texts.mjs';
import { audioPacks, languageAudio, readAudioMeta } from './lib/audio.mjs';
import { loadConcepts, loadRegistry, paths } from './lib/data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** What the site is made of, relative to the repository root. Everything else (docs, tools, tests, .env) stays out. */
export const SITE_FILES = ['index.html', 'languages.html', '404.html', 'robots.txt', 'og-image.png', 'favicon.svg', 'apple-touch-icon.png', 'css', 'img', 'src', 'vendor'];
const LAYERS = ['lang', 'ex', 'ipa', 'etym'];
/** Written into every site this tool builds; a directory without it is never replaced. */
const MARKER = '.ankigen-site';
/** GitHub Pages publishes sites up to 1 GB; the build fails above this many MB. */
export const SITE_LIMIT_MB = 900;

/**
 * The site's pronunciation audio: for each language with current clips, its packs and index (site path → bytes or
 * text), and what meta.json says of it: { voice, tier, index }.
 * @param {string} dataDir @param {string} metaDir
 */
export function makeAudio(dataDir, metaDir) {
  const p = paths(dataDir, metaDir);
  const reg = loadRegistry(p.meta);
  const concepts = loadConcepts(p, reg, []);
  const audio = readAudioMeta(metaDir);
  const ctx = { dataDir, reg, order: concepts.order, audio };
  /** @type {Record<string, { voice: string, tier: string, index: string }>} */
  const meta = {};
  /** @type {Record<string, Uint8Array | string>} */
  const files = {};
  /** @type {Record<string, { clips: number, bytes: number }>} */
  const sizes = {};
  for (const [code, setting] of Object.entries(audio.languages)) {
    if (!setting?.voice || !reg.languages.languages[code]) continue;
    const packs = audioPacks(languageAudio(ctx, code), (id) => concepts.byId.get(id)?.module ?? '');
    if (!packs) continue;
    Object.assign(files, packs.files);
    meta[code] = { voice: setting.voice, tier: setting.tier, index: packs.index };
    sizes[code] = { clips: packs.clips, bytes: packs.bytes };
  }
  return { meta, files, sizes };
}

/** The size of a directory and everything in it, in bytes. @param {string} dir */
export function dirSize(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? dirSize(file) : fs.statSync(file).size;
  }
  return bytes;
}

/** @param {string} file */
function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/**
 * The bundles of a data directory: their data version and { file name: JSON text }.
 * @param {string} dataDir @param {string} metaDir
 */
export function makeBundles(dataDir, metaDir) {
  const meta = appMeta(metaDir);
  if (!meta.version.data) throw new Error('version.json has no data version');
  const modules = meta.modules.categories.flatMap((/** @type {any} */ cat) => cat.modules.map((/** @type {any} */ m) => m.id));

  /** @type {Record<string, Record<string, any>>} */
  const concepts = {};
  for (const module of modules) {
    const file = readJson(path.join(dataDir, 'concepts', `${module}.json`));
    if (file) concepts[module] = Object.fromEntries(Object.entries(file).map(([id, { note, ...concept }]) => [id, concept]));
  }

  /** @type {Record<string, unknown>} */
  const files = { 'meta.json': meta, 'concepts.json': concepts };
  for (const code of Object.keys(meta.languages.languages)) {
    /** @type {Record<string, Record<string, unknown>>} */
    const bundle = {};
    for (const layer of LAYERS) {
      bundle[layer] = {};
      for (const module of modules) Object.assign(bundle[layer], readJson(path.join(dataDir, layer, code, `${module}.json`)));
    }
    if (LAYERS.some((layer) => Object.keys(bundle[layer]).length)) files[`${code}.json`] = bundle;
  }
  const ui = readUiTexts(dataDir);
  const landing = readTranslations(dataDir);
  for (const code of UI_LANGUAGES) {
    if (code !== 'en' && (ui[code] || landing[code])) files[`ui-${code}.json`] = uiBundle(ui[code] ?? null, landing[code] ?? null);
  }
  const audio = makeAudio(dataDir, metaDir);
  meta.audio = audio.meta;
  return {
    version: /** @type {string} */ (meta.version.data),
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, JSON.stringify(value)])),
    audio,
  };
}

/** @param {string} siteDir */
function checkReplaceable(siteDir) {
  const root = path.relative(siteDir, ROOT);
  if (!root.startsWith('..') && !path.isAbsolute(root)) throw new Error(`refusing to replace ${siteDir}: it contains the repository`);
  if (fs.existsSync(siteDir) && fs.readdirSync(siteDir).length && !fs.existsSync(path.join(siteDir, MARKER))) {
    throw new Error(`refusing to replace ${siteDir}: it is not empty and was not built by tools/bundle.mjs`);
  }
}

/** The app's loader, reading a built site the way the browser does (so it takes the bundles). @param {string} siteDir */
function siteLoader(siteDir) {
  return createLoader({ fetchJson: async (p) => readJson(path.join(siteDir, ...p.split('/'))) });
}

/**
 * @param {{ siteDir: string, dataDir: string, metaDir: string, limitMb?: number }} dirs absolute paths; limitMb: the
 *   largest site allowed (it is built anyway, then the build fails)
 */
export async function buildSite({ siteDir, dataDir, metaDir, limitMb = SITE_LIMIT_MB }) {
  checkReplaceable(siteDir);
  const { version, files, audio } = makeBundles(dataDir, metaDir);
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, MARKER), 'Built by tools/bundle.mjs; the next build replaces this whole directory.\n');
  for (const entry of SITE_FILES) {
    const from = path.join(ROOT, entry);
    if (!fs.existsSync(from)) throw new Error(`missing ${entry}`);
    fs.cpSync(from, path.join(siteDir, entry), { recursive: true });
  }
  fs.cpSync(metaDir, path.join(siteDir, 'data', 'meta'), { recursive: true });
  const bundleDir = path.join(siteDir, 'bundles', version);
  fs.mkdirSync(bundleDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(bundleDir, name), text);
  for (const [name, content] of Object.entries(audio.files)) {
    fs.mkdirSync(path.dirname(path.join(siteDir, name)), { recursive: true });
    fs.writeFileSync(path.join(siteDir, name), content);
  }
  const translations = readTranslations(dataDir);
  const pages = await landingSite(siteLoader(siteDir), translations, readUiTexts(dataDir));
  for (const [name, text] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(path.join(siteDir, name)), { recursive: true });
    fs.writeFileSync(path.join(siteDir, name), text);
  }
  const size = dirSize(siteDir);
  if (size > limitMb * 1024 * 1024) throw new Error(`the site is ${(size / 1024 / 1024).toFixed(0)} MB, over the ${limitMb} MB limit (GitHub Pages allows 1 GB)`);
  return { version, files, audio, size, pages, translated: translatedLanguages(appMeta(metaDir), translations) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @param {string} name @param {string} fallback */
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const dataDir = path.resolve(opt('--data', 'data'));
  const dirs = {
    siteDir: path.resolve(opt('--site', '_site')),
    dataDir,
    metaDir: path.resolve(opt('--meta', path.join(ROOT, 'data', 'meta'))),
    limitMb: Number(opt('--limit-mb', String(SITE_LIMIT_MB))),
  };
  try {
    const { version, files, audio, size, pages, translated } = await buildSite(dirs);
    const kb = (/** @type {number} */ n) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`;
    const mb = (/** @type {number} */ n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    const sizes = Object.entries(files).map(([name, text]) => `${name} ${kb(Buffer.byteLength(text))} (${kb(zlib.gzipSync(text).length)} gzipped)`);
    const landing = Object.keys(pages).filter((name) => name.startsWith(DECKS_DIR) && name !== `${DECKS_DIR}index.html`).length;
    const voiced = Object.entries(audio.sizes).map(([code, s]) => `${code} ${s.clips.toLocaleString('en-US')} clips ${mb(s.bytes)}`);
    console.log(`${path.relative(process.cwd(), dirs.siteDir) || '.'}: data ${version}, from ${path.relative(process.cwd(), dataDir) || '.'}\n  ${sizes.join('\n  ')}`);
    console.log(`  audio/: ${voiced.join(', ') || 'no clips yet'}`);
    console.log(`  ${DECKS_DIR}: ${landing} landing page${landing === 1 ? '' : 's'} and the hub; sitemap.xml`);
    console.log(`  landing pages in the visitor's language: ${translated.join(', ') || 'none yet'} (others in English)`);
    console.log(`  site: ${mb(size)} (limit ${dirs.limitMb} MB)`);
  } catch (error) {
    console.error(`tools/bundle.mjs: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
