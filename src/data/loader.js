// @ts-check
// Data loading (ARCHITECTURE §3). Production reads the bundles that tools/bundle.mjs writes under
// bundles/<data version>/ (meta.json, concepts.json, <code>.json, ui-<code>.json); without bundles it reads
// the source files under data/ directly. A missing vocabulary file means "no data", never an error; only the
// meta files are required. Every getter is cached, so calling one early (e.g. on hover) prefetches.
//
// Dev override: createLoader({ dataDir: 'tests/fixtures/data' }) (from ?data=…) reads concepts and
// layers from that directory; meta always comes from data/meta.

/**
 * @typedef {object} Meta
 * @property {any} languages  data/meta/languages.json
 * @property {any} modules    data/meta/modules.json
 * @property {any} fields     data/meta/fields.json
 * @property {any} labels     data/meta/labels.json
 * @property {{ data: string, schema: number }} version
 * @property {Record<string, { voice?: string, index?: string }>} audio
 */

/**
 * @typedef {object} ConceptRecord
 * @property {string} id
 * @property {any} c         the concept: { pos, mods, grp?, emoji?, ant?, rel?, reg?, only? }
 * @property {string} module primary module (its file)
 * @property {number} rank   canonical position: module tree order, then file order
 */

/** @typedef {{ order: string[], byId: Map<string, ConceptRecord> }} Concepts */

/**
 * @typedef {object} LanguageData  one language, all layers, keyed by concept ID
 * @property {Map<string, any>} lang
 * @property {Map<string, any[]>} ex
 * @property {Map<string, string>} ipa
 * @property {Map<string, string>} etym
 */

/** @typedef {(path: string, opts?: { fresh?: boolean }) => Promise<any>} FetchJson */

export const LAYERS = /** @type {const} */ (['lang', 'ex', 'ipa', 'etym']);

/** @type {FetchJson} */
async function httpJson(path, { fresh = false } = {}) {
  try {
    const res = await fetch(path, { cache: fresh ? 'no-cache' : 'default' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** @param {string} path */
async function httpText(path) {
  try {
    const res = await fetch(path);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Accept only a plain relative directory for the dev override (no scheme, no //host, no ..). @param {string | null | undefined} dir */
export function safeDataDir(dir) {
  return dir && /^[\w.-]+(?:\/[\w.-]+)*\/?$/.test(dir) && !dir.split('/').includes('..') ? dir.replace(/\/$/, '') : null;
}

/** @param {any} modulesTree @returns {string[]} */
export function moduleOrder(modulesTree) {
  return modulesTree.categories.flatMap((/** @type {any} */ cat) => cat.modules.map((/** @type {any} */ m) => m.id));
}

/**
 * Canonical concept order from per-module concept objects (same rule as tools/lib/data.mjs).
 * @param {string[]} modules @param {Record<string, Record<string, any> | null>} files
 * @returns {Concepts}
 */
export function assembleConcepts(modules, files) {
  /** @type {Map<string, ConceptRecord>} */
  const byId = new Map();
  for (const module of modules) {
    for (const [id, c] of Object.entries(files[module] ?? {})) {
      if (!byId.has(id)) byId.set(id, { id, c, module, rank: byId.size });
    }
  }
  return { order: [...byId.keys()], byId };
}

/** @param {Record<string, any> | null | undefined} obj */
const toMap = (obj) => new Map(Object.entries(obj ?? {}));

/**
 * @param {{ fetchJson?: FetchJson, fetchText?: (path: string) => Promise<string | null>, dataDir?: string | null }} [opts]
 */
export function createLoader({ fetchJson = httpJson, fetchText = httpText, dataDir = null } = {}) {
  const dir = safeDataDir(dataDir);
  const dataBase = dir ? `${dir}/` : 'data/';
  /** @type {Map<string, Promise<any>>} */
  const cache = new Map();
  /** @template T @param {string} key @param {() => Promise<T>} fn @returns {Promise<T>} */
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return /** @type {Promise<T>} */ (cache.get(key));
  };

  /** Bundle base path, or null when reading source files. */
  const bundleBase = () =>
    once('bundle', async () => {
      if (dir) return null;
      const version = await fetchJson('data/meta/version.json', { fresh: true });
      if (!version?.data) return null;
      const base = `bundles/${version.data}/`;
      const meta = await fetchJson(`${base}meta.json`);
      return meta ? { base, meta } : null;
    });

  /** @returns {Promise<Meta>} */
  const getMeta = () =>
    once('meta', async () => {
      const bundle = await bundleBase();
      if (bundle) return bundle.meta;
      const names = ['languages', 'modules', 'fields', 'labels', 'version', 'audio'];
      const [languages, modules, fields, labels, version, audio] = await Promise.all(names.map((n) => fetchJson(`data/meta/${n}.json`)));
      if (!languages || !modules || !fields) throw new Error('Could not load data/meta');
      return { languages, modules, fields, labels: labels ?? { keys: [], labels: {} }, version: version ?? { data: '', schema: 1 }, audio: audio?.languages ?? {} };
    });

  /** @returns {Promise<Concepts>} */
  const getConcepts = () =>
    once('concepts', async () => {
      const [bundle, meta] = await Promise.all([bundleBase(), getMeta()]);
      const modules = moduleOrder(meta.modules);
      if (bundle) return assembleConcepts(modules, (await fetchJson(`${bundle.base}concepts.json`)) ?? {});
      const files = await Promise.all(modules.map((m) => fetchJson(`${dataBase}concepts/${m}.json`)));
      return assembleConcepts(modules, Object.fromEntries(modules.map((m, i) => [m, files[i]])));
    });

  /** @param {string} code @returns {Promise<LanguageData>} */
  const getLanguage = (code) =>
    once(`lang:${code}`, async () => {
      const [bundle, meta] = await Promise.all([bundleBase(), getMeta()]);
      if (bundle) {
        const b = (await fetchJson(`${bundle.base}${code}.json`)) ?? {};
        return { lang: toMap(b.lang), ex: toMap(b.ex), ipa: toMap(b.ipa), etym: toMap(b.etym) };
      }
      const modules = moduleOrder(meta.modules);
      const layers = await Promise.all(
        LAYERS.map(async (layer) => {
          const files = await Promise.all(modules.map((m) => fetchJson(`${dataBase}${layer}/${code}/${m}.json`)));
          return new Map(files.flatMap((f) => Object.entries(f ?? {})));
        }),
      );
      const [lang, ex, ipa, etym] = layers;
      return { lang, ex, ipa, etym };
    });

  /** A JSON file, cached (data/clips.js reads the audio indexes with it). @param {string} path */
  const getJson = (path) => once(path, () => fetchJson(path));

  /** The card stylesheet, embedded verbatim in the note type. */
  const getCardCss = () => once('css', async () => (await fetchText('css/card.css')) ?? '');

  /**
   * The page's texts in a language (ui/i18n.js): data/ui/<code>.json and data/landing/<code>.json, or their
   * bundle. Without `ui` the load failed; it is not cached, so the next call tries again.
   * @param {string} code @returns {Promise<import('../ui/i18n.js').Translation>}
   */
  const getUiTexts = (code) => {
    const key = `ui:${code}`;
    const texts = once(key, async () => {
      const bundle = await bundleBase();
      if (bundle) return (await fetchJson(`${bundle.base}ui-${code}.json`)) ?? {};
      const [ui, landing] = await Promise.all([fetchJson(`data/ui/${code}.json`), fetchJson(`data/landing/${code}.json`)]);
      return { ui, landing };
    });
    texts.then((t) => t.ui || cache.delete(key), () => cache.delete(key));
    return texts;
  };

  return { getMeta, getConcepts, getLanguage, getCardCss, getUiTexts, getJson, dataBase };
}
