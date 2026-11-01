// @ts-check
// What the app (main.js) and the languages page (languages-page.js) share: localStorage, the interface language
// they start in, their own texts (data-t, data-plural, and links marked data-keep-lang that carry ?lang=), and
// the language menu in the header.

import { langTag } from '../deck/fields.js';
import { bind, fillNodes, relabel } from './dom.js';
import { LANGUAGE_KEY, UI_LANGUAGES, language, languageTag, pickLanguage, plural, t, useLanguage } from './i18n.js';

/** @typedef {import('./i18n.js').Translation} Translation */
/** @typedef {ReturnType<typeof import('../data/loader.js').createLoader>} Loader */
/** @typedef {(meta: any) => { title: string, description: string }} Head  the page's title and description, in the interface language */

export function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null; // storage disabled: the URL hash still holds the config
  }
}

/** @param {Storage | null} storage @param {string} key */
export function stored(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Switch the page's texts to a language: the strings, the lang and dir attributes (Arabic is right to left), the
 * title and description.
 * @param {any} meta @param {string} code @param {Translation | null} translation @param {Head} head
 */
function useTexts(meta, code, translation, head) {
  const reg = meta.languages.languages[code];
  useLanguage(code, { tag: code === 'en' ? 'en' : langTag(reg, code, 'cyrl'), locale: reg?.locale ?? code }, translation);
  const { title, description } = head(meta);
  document.documentElement.lang = languageTag();
  document.documentElement.dir = reg?.dir === 'rtl' ? 'rtl' : 'ltr';
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
}

/**
 * The page's own texts follow the language: data-t="key" names a text of ui/strings.js (its {placeholders} are
 * the elements marked data-part), data-plural="key" one counted by the number of languages. A link marked
 * data-keep-lang names the interface language (?lang=), so the page it opens speaks it too.
 * @param {any} meta
 */
function bindPage(meta) {
  for (const el of document.querySelectorAll('[data-t]')) {
    const key = /** @type {string} */ (/** @type {HTMLElement} */ (el).dataset.t);
    const parts = Object.fromEntries([...el.querySelectorAll('[data-part]')].map((p) => [/** @type {HTMLElement} */ (p).dataset.part, p]));
    if (Object.keys(parts).length) bind(el, (node) => node.replaceChildren(...fillNodes(t(key), parts)));
    else bind(el, (node) => (node.textContent = t(key)));
  }
  for (const el of document.querySelectorAll('[data-plural]')) {
    const key = /** @type {string} */ (/** @type {HTMLElement} */ (el).dataset.plural);
    bind(el, (node) => (node.textContent = plural(key, meta.languages.active.length)));
  }
  for (const link of document.querySelectorAll('a[data-keep-lang]')) {
    const href = /** @type {string} */ (link.getAttribute('href'));
    bind(link, (a) => {
      const url = new URL(href, location.href);
      url.searchParams.set('lang', language());
      a.setAttribute('href', url.href);
    });
  }
}

/**
 * Start a page in the visitor's interface language (pickLanguage): load it with the meta files, then fill in
 * the page's texts. A translation that could not load leaves the page in English.
 * @param {{ loader: Loader, storage: Storage | null, head: Head }} opts
 */
export async function startPage({ loader, storage, head }) {
  const wanted = pickLanguage({
    param: new URLSearchParams(location.search).get('lang'),
    saved: stored(storage, LANGUAGE_KEY),
    browser: navigator.languages ?? [navigator.language],
  });
  const [meta, loaded] = await Promise.all([loader.getMeta(), wanted === 'en' ? null : loader.getUiTexts(wanted)]);
  const translation = loaded?.ui ? loaded : null;
  useTexts(meta, translation ? wanted : 'en', translation, head);
  bindPage(meta);

  return {
    meta,
    /**
     * The language menu in the header (ui/locale.js, loaded now: call this after the first render). Choosing a
     * language loads it, relabels the page and remembers the choice; then onSwitch redoes the rest.
     * @param {HTMLElement} root @param {() => void} onSwitch
     */
    mountMenu(root, onSwitch) {
      /** @param {string} code */
      async function choose(code) {
        const next = code === 'en' ? null : await loader.getUiTexts(code);
        if (next && !next.ui) throw new Error(`could not load the ${code} texts`); // the page stays as it is
        useTexts(meta, code, next, head);
        relabel();
        try {
          storage?.setItem(LANGUAGE_KEY, code);
        } catch {
          // storage disabled: the address still names the language
        }
        onSwitch();
      }
      const registry = meta.languages.languages;
      const choices = UI_LANGUAGES.filter((code) => registry[code]).map((code) => ({
        code,
        native: registry[code].native,
        name: registry[code].name,
        country: registry[code].flag ?? registry[code].country, // the flag image: a language without a country has one
        tag: langTag(registry[code], code, 'cyrl'),
      }));
      import('./locale.js').then(({ mountLocale }) => mountLocale(root, { choices, choose }), () => {});
    },
  };
}
