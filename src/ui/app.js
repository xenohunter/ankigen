// @ts-check
// The page's model: the config store, the data loaded so far, and the deck view derived from both.
// No DOM, so it runs under node --test with the fixture loader; main.js and the other ui/ modules render it.

import { SAME, createStore, encodeHash, usesAudio, validate } from '../state.js';
import { localTerms, moduleCounts, selectNotes } from '../deck/select.js';
import { deckContext, noteFields } from '../deck/fields.js';
import { noteType } from '../deck/templates.js';
import { language } from './i18n.js';

/** @typedef {import('../state.js').Config} Config */
/** @typedef {import('../data/loader.js').LanguageData} LanguageData */
/** @typedef {import('../data/loader.js').Concepts} Concepts */
/** @typedef {import('../deck/select.js').Note} Note */
/** @typedef {ReturnType<typeof import('../data/loader.js').createLoader>} Loader */
/** @typedef {import('../data/clips.js').AudioIndex} AudioIndex */

/**
 * What the page shows for the current config.
 * @typedef {object} View
 * @property {Config} config
 * @property {boolean} ready  concepts and both languages are loaded
 * @property {Note[]} notes   the deck's notes, in canonical order
 * @property {number} cards   a forward card per note, plus a reverse card when reverse is on
 * @property {Map<string, number>} counts  words per module for this language pair
 * @property {Map<string, { count: number, example: string }>} local  words only some languages have, per module
 * @property {import('../deck/fields.js').DeckContext | null} ctx
 * @property {import('../deck/templates.js').NoteType | null} noteType
 * @property {Note | null} sample  the note shown in the preview
 * @property {{ clips: number, bytes: number } | { loading: true } | null} audio  the deck's clips; null: no audio
 */

/** How many notes from the start of the deck compete to be the default preview sample. */
const SAMPLE_POOL = 40;

/**
 * The default preview sample: of the first notes, the one that fills the most fields, so the preview
 * shows what the settings do. Ties go to the earlier note.
 * @param {Note[]} notes @param {import('../deck/fields.js').DeckContext} ctx
 */
function richestNote(notes, ctx) {
  let best = notes[0] ?? null;
  let bestScore = -1;
  for (const note of notes.slice(0, SAMPLE_POOL)) {
    const score = Object.values({ ...noteFields(note, ctx), Audio: '' }).filter(Boolean).length;
    if (score > bestScore) [best, bestScore] = [note, score];
  }
  return best;
}

/**
 * @param {{ loader: Loader, meta: any, initial: Config, random?: () => number }} opts
 */
export function createApp({ loader, meta, initial, random = Math.random }) {
  const store = createStore(validate(initial, meta));
  /** @type {Map<string, LanguageData>} */
  const languages = new Map();
  /** @type {Map<string, AudioIndex>} */
  const audios = new Map();
  /** @type {typeof import('../data/clips.js') | null} */
  let clips = null;
  /** @type {Map<string, Promise<void>>} fetches in flight: language codes and 'concepts' */
  const inflight = new Map();
  /** @type {Set<string>} what could not be loaded (the page then works without it) */
  const failed = new Set();
  /** @type {Concepts | null} */
  let concepts = null;
  let css = '';
  /** @type {string | null} */
  let sampleKey = null;
  let dataVersion = 0;
  /** @type {Set<(view: View) => void>} */
  const listeners = new Set();
  /** @type {{ config: Config, dataVersion: number, sampleKey: string | null, view: View } | null} */
  let last = null;
  /** The deck for the last config and data, so changing the sample reuses its notes. @type {{ config: Config, dataVersion: number, view: View } | null} */
  let deckCache = null;
  /** @type {{ key: string, counts: Map<string, number>, local: Map<string, { count: number, example: string }> } | null} */
  let pairCache = null;

  function notify() {
    const v = view();
    for (const fn of listeners) fn(v);
  }

  /**
   * Run a fetch once per key; when it ends (either way), re-render.
   * @param {string} key @param {() => Promise<void>} fn @param {() => void} fallback what to use on failure
   */
  function track(key, fn, fallback) {
    if (inflight.has(key)) return;
    const done = fn()
      .catch(() => {
        failed.add(key);
        fallback();
      })
      .finally(() => {
        inflight.delete(key);
        dataVersion++;
        notify();
      });
    inflight.set(key, done);
  }

  /** Start loading a language (cached: hovering a chip calls this). @param {string} code */
  function prefetch(code) {
    if (languages.has(code)) return;
    track(code, async () => void languages.set(code, await loader.getLanguage(code)), () =>
      languages.set(code, { lang: new Map(), ex: new Map(), ipa: new Map(), etym: new Map() }),
    );
  }

  /** Start loading what a config needs. @param {Config} config */
  function ensure(config) {
    if (!concepts) {
      track(
        'concepts',
        async () => {
          [concepts, css] = await Promise.all([loader.getConcepts(), loader.getCardCss()]);
        },
        () => (concepts = { order: [], byId: new Map() }),
      );
    }
    for (const code of [config.learn, config.know]) if (code && code !== SAME) prefetch(code);
    const learn = /** @type {string} */ (config.learn);
    if (usesAudio(meta, config) && !audios.has(learn)) {
      const load = async () => {
        clips = await import('../data/clips.js');
        audios.set(learn, await clips.loadAudioIndex(loader, meta, learn));
      };
      track(`audio:${learn}`, load, () => audios.set(learn, { clips: new Map(), files: new Map() }));
    }
  }

  /** audio: null if none, undefined while loading. @param {Config} config @returns {{ learnData?: LanguageData, knowData?: LanguageData, audio?: AudioIndex | null }} */
  function dataFor(config) {
    const learnData = config.learn ? languages.get(config.learn) : undefined;
    const knowData = config.know === SAME ? learnData : config.know ? languages.get(config.know) : undefined;
    return { learnData, knowData, audio: usesAudio(meta, config) ? audios.get(/** @type {string} */ (config.learn)) : null };
  }

  /** The view without its sample. @param {Config} config @returns {View} */
  function deck(config) {
    const { learnData, knowData, audio } = dataFor(config);
    if (!concepts || !learnData || !knowData) {
      return { config, ready: false, notes: [], cards: 0, counts: new Map(), local: new Map(), ctx: null, noteType: null, sample: null, audio: null };
    }
    const input = { config, meta, concepts, learnData, knowData, audio };
    const pair = `${config.learn}|${config.know}|${dataVersion}`;
    if (pairCache?.key !== pair) {
      pairCache = { key: pair, counts: moduleCounts(config, meta, concepts, learnData, knowData), local: localTerms(config, meta, concepts, learnData, knowData) };
    }
    const notes = selectNotes(config, meta, concepts, learnData, knowData);
    const ctx = deckContext(input);
    return {
      config,
      ready: true,
      notes,
      cards: notes.length * (config.reverse ? 2 : 1),
      counts: pairCache.counts,
      local: pairCache.local,
      ctx,
      noteType: noteType(ctx, css),
      sample: null,
      audio: audio === null ? null : audio && clips ? clips.deckClips(notes, audio) : { loading: true },
    };
  }

  /** @param {Config} config @returns {View} */
  function derive(config) {
    if (deckCache?.config !== config || deckCache.dataVersion !== dataVersion) deckCache = { config, dataVersion, view: deck(config) };
    const base = deckCache.view;
    if (!base.ctx) return base;
    return { ...base, sample: base.notes.find((n) => n.key === sampleKey) ?? richestNote(base.notes, base.ctx) };
  }

  /** The current view (memoized until the config, the data or the sample changes). @returns {View} */
  function view() {
    const config = store.get();
    if (last && last.config === config && last.dataVersion === dataVersion && last.sampleKey === sampleKey) return last.view;
    last = { config, dataVersion, sampleKey, view: derive(config) };
    return last.view;
  }

  store.subscribe((config) => {
    ensure(config);
    notify();
  });
  ensure(store.get());

  return {
    meta,
    loader,
    store,
    view,
    prefetch,
    /** @param {string} key 'concepts' or a language code */
    isLoading: (key) => inflight.has(key),
    /** @param {string} key 'concepts' or a language code */
    hasFailed: (key) => failed.has(key),
    /** Change the config; the result is validated. @param {(config: Config) => Partial<Config>} fn */
    update(fn) {
      store.set((config) => validate({ ...config, ...fn(config) }, meta));
    },
    /** @param {(view: View) => void} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Preview this note (e.g. clicked in the card list). @param {string} key */
    setSample(key) {
      sampleKey = key;
      notify();
    },
    /** Preview a random other note of the deck. */
    randomSample() {
      const { notes, sample } = view();
      const others = notes.filter((n) => n !== sample);
      if (!others.length) return;
      sampleKey = others[Math.floor(random() * others.length)].key;
      notify();
    },
    /**
     * The page's address for the current config and interface language: `href` (the address now, which keeps
     * any other parameter) with ?lang= and the config hash.
     * @param {string} href
     */
    address(href) {
      const url = new URL(href);
      url.searchParams.set('lang', language());
      const config = store.get();
      url.hash = config.learn ? encodeHash(config, meta) : '';
      return url.href;
    },
    /** Everything buildDeck needs for the current config, or null while loading. */
    deckInput() {
      const config = store.get();
      const { learnData, knowData, audio } = dataFor(config);
      return concepts && learnData && knowData && audio !== undefined ? { config, meta, concepts, learnData, knowData, css, audio } : null;
    },
    /** Resolves once nothing is loading. */
    async settled() {
      while (inflight.size) await Promise.all(inflight.values());
    },
  };
}

/** @typedef {ReturnType<typeof createApp>} App */
