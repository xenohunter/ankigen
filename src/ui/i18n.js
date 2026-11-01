// @ts-check
// The interface language (SPEC §4, ARCHITECTURE §13): the page's texts in English (ui/strings.js) or in a
// translation. data/ui/<code>.json translates the page's own texts, data/landing/<code>.json the module, field
// and option texts and the language names; whatever a translation lacks stays in English. Pure: main.js loads
// a translation (data/loader.js) and switches to it, and ui/dom.js redoes the texts already on the page.

import { PLURALS, STRINGS } from './strings.js';

/** The interface languages, in the order of the language chips: English and those with a data/ui translation. */
export const UI_LANGUAGES = ['en', 'de', 'nl', 'sv', 'zh', 'ja', 'vi', 'ko', 'es', 'fr', 'pt', 'it', 'ru', 'pl', 'uk', 'sr', 'ga', 'gd', 'ar', 'tr', 'el', 'hu', 'hy'];
/** The user's last choice, in localStorage. */
export const LANGUAGE_KEY = 'ankigen:lang';

/** @typedef {Record<string, string>} Forms  plural category (Intl.PluralRules) → text */
/** @typedef {{ label?: string, labelSame?: string, help?: string, name?: string, desc?: string }} Texts */
/**
 * A translation, as data/loader.js returns it: the parts of data/ui/<code>.json and data/landing/<code>.json
 * the page uses.
 * @typedef {object} Translation
 * @property {{ texts?: Record<string, string>, plural?: Record<string, Forms>, fields?: Record<string, Texts> } | null} [ui]
 * @property {{ languages?: Record<string, string>, categories?: Record<string, string>, modules?: Record<string, Texts>, fields?: Record<string, Texts>, options?: Record<string, Texts> } | null} [landing]
 */

const english = {
  texts: /** @type {Record<string, string>} */ ({ ...STRINGS }),
  plural: /** @type {Record<string, Forms>} */ ({ ...PLURALS }),
};

let current = { code: 'en', tag: 'en', tr: /** @type {Translation} */ ({}) };
let rules = new Intl.PluralRules('en-US');
let numbers = new Intl.NumberFormat('en-US');
let epoch = 0;

/** English texts of a module that loads later (the feedback dialog). @param {Record<string, string>} texts @param {Record<string, Forms>} [plural] */
export function addEnglish(texts, plural = {}) {
  Object.assign(english.texts, texts);
  Object.assign(english.plural, plural);
}

/**
 * Switch the interface language.
 * @param {string} code
 * @param {{ tag: string, locale: string }} names  the lang attribute, and the locale for numbers and plurals
 * @param {Translation | null} translation  null for English
 */
export function useLanguage(code, { tag, locale }, translation) {
  current = { code, tag, tr: translation ?? {} };
  rules = new Intl.PluralRules(locale);
  numbers = new Intl.NumberFormat(locale);
  epoch++;
}

export const language = () => current.code;
export const languageTag = () => current.tag;
/** Changes with every switch, so a part that keeps texts knows to redo them. */
export const languageEpoch = () => epoch;

/** A text with its {placeholders} filled in; unknown ones stay. @param {string} text @param {Record<string, string | number>} [values] */
export function fill(text, values = {}) {
  return text.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}

/** "1,734", "1 734". @param {number} n */
export const number = (n) => numbers.format(n);

/** A text in the interface language. @param {string} key @param {Record<string, string | number>} [values] */
export function t(key, values) {
  return fill(current.tr.ui?.texts?.[key] ?? english.texts[key] ?? key, values);
}

/**
 * A text with a number, in the form the interface language uses for it: "1 word", "21 слово", "5 слов".
 * @param {string} key @param {number} n @param {Record<string, string | number>} [values]
 */
export function plural(key, n, values = {}) {
  const forms = current.tr.ui?.plural?.[key];
  const text = forms?.[rules.select(n)] ?? forms?.other ?? english.plural[key]?.[n === 1 ? 'one' : 'other'] ?? key;
  return fill(text, { ...values, n: number(n) });
}

/** A language's name in the interface language. @param {string} code @param {string} name its English name */
export const languageName = (code, name) => current.tr.landing?.languages?.[code] ?? name;

/** @param {{ id: string, name: string }} category a category of modules.json */
export const categoryName = (category) => current.tr.landing?.categories?.[category.id] ?? category.name;

/** @param {{ id: string, name: string, desc: string }} m a module of modules.json */
export function moduleText(m) {
  const tr = current.tr.landing?.modules?.[m.id];
  return { name: tr?.name ?? m.name, desc: tr?.desc ?? m.desc };
}

/**
 * A field row's label and help. The fixed rows (word, translation) are translated in data/ui, the others in
 * data/landing.
 * @param {{ id: string, label: string, labelSame?: string, help: string, fixed?: boolean }} def a row of fields.json
 * @param {boolean} same same-language mode
 */
export function fieldText(def, same) {
  const tr = (def.fixed ? current.tr.ui?.fields : current.tr.landing?.fields)?.[def.id];
  const label = same && def.labelSame ? (tr?.labelSame ?? def.labelSame) : (tr?.label ?? def.label);
  return { label, help: tr?.help ?? def.help };
}

/** @param {{ id: string, label: string, help: string }} option a deck option of fields.json */
export function optionText(option) {
  const tr = current.tr.landing?.options?.[option.id];
  return { label: tr?.label ?? option.label, help: tr?.help ?? option.help };
}

/**
 * The interface language to start with: the link's ?lang=, else the user's last choice, else the first of the
 * browser's languages that the page speaks, else English. (index.html repeats this rule to hide the English
 * texts until the translation arrives.)
 * @param {{ param?: string | null, saved?: string | null, browser?: readonly string[] }} sources
 */
export function pickLanguage({ param, saved, browser = [] }) {
  for (const code of [param, saved]) if (code && UI_LANGUAGES.includes(code)) return code;
  for (const tag of browser) {
    const code = tag.toLowerCase().split('-')[0];
    if (UI_LANGUAGES.includes(code)) return code;
  }
  return 'en';
}
