// Landing pages for search engines (ARCHITECTURE §10): a static page for every language pair that has words, a
// hub that lists them, and the sitemap. tools/bundle.mjs writes them into the site:
//   decks/<learning>-for-<known>-speakers/   e.g. decks/japanese-for-russian-speakers/
//   decks/                                   the hub: every page, by the language you speak
//   sitemap.xml                              the app, the hub and every page
//
// A page describes its own deck with the app's deck code: the words per module with a few samples, the card
// fields for the pair, and links that open the app with the pair (and a module) chosen. Plain HTML with the
// app's stylesheet, no scripts. Only bilingual decks get pages, and a pair without words gets none yet, so pages
// appear as the vocabulary is generated. Slugs come from the English names in data/meta/languages.json:
// renaming a language moves its pages.
//
// A page is written in the language its visitors speak (the known language) once data/landing/<code>.json holds
// a complete translation of englishTexts() for it (unit landing:<code>, docs/GENERATION.md); until then, and for
// English speakers, it is in English. The hub stays in English. The footer is the app's, with its texts from
// data/ui (tools/ui-texts.mjs); the pages in their visitors' language link to each other (hreflang), and their
// links open the app in that language (?lang=).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AUTHOR_NAME, AUTHOR_URL, BUY_ME_A_COFFEE_URL, DATA_LICENSE_URL, PATREON_URL, REPO_URL, SITE_URL } from '../src/config.js';
import { encodeHash, isFieldShown, moduleIds, validate } from '../src/state.js';
import { localTerms, moduleCounts, selectNotes } from '../src/deck/select.js';
import { deckContext, langTag, noteSummary } from '../src/deck/fields.js';
import { deckName } from '../src/deck/names.js';
import { escapeAttr, escapeHtml } from '../src/text/html.js';
import { UI_LANGUAGES } from '../src/ui/i18n.js';
import { STRINGS } from '../src/ui/strings.js';
import { fullWidthLang, hasAsciiPunctuation } from './lib/data.mjs';

/** @typedef {import('../src/data/loader.js').Concepts} Concepts */
/** @typedef {import('../src/data/loader.js').LanguageData} LanguageData */
/** @typedef {import('../src/deck/select.js').Note} Note */
/**
 * @typedef {{ meta: any, concepts: Concepts, data: Map<string, LanguageData>, translations?: Record<string, any>, ui?: Record<string, any> }} Input
 *   translations: data/landing, { code: texts }; ui: data/ui, { code: texts } (the footer)
 */

/**
 * @typedef {object} Pair  a language pair with words, and its page
 * @property {string} learn
 * @property {string} know
 * @property {string} dir      the page's directory, relative to the site root
 * @property {Note[]} notes    the deck with every module chosen
 * @property {Note[]} pool     the notes that may be samples
 * @property {Map<string, number>} counts  words per module
 * @property {Map<string, { count: number, example: string }>} local  words only the learned language has, per module
 * @property {import('../src/deck/fields.js').DeckContext} ctx
 */

/**
 * @typedef {object} Voice  what the pages of one known language are written in
 * @property {any} t        englishTexts() or its translation
 * @property {any} ui       the app's texts in that language (data/ui), or null for English
 * @property {boolean} own  the pages are in their visitors' language (translated, or for English speakers)
 * @property {string} tag   lang attribute
 * @property {boolean} rtl   written right to left (Arabic): dir="rtl" on the page
 * @property {string} lang  the interface language its links open the app in (?lang=)
 * @property {string} locale
 * @property {Intl.PluralRules} plural
 * @property {Intl.NumberFormat} number
 */

/** The languages page (languages.html, in the repository), relative to the site root. */
export const LANGUAGES_PAGE = 'languages.html';

/** The hub, relative to the site root; the pages are its subdirectories. */
export const DECKS_DIR = 'decks/';
/** Sample words per module. */
const SAMPLES = 3;
/** Never shown as samples, like the 18+ modules. */
const UNSAFE_REGISTERS = new Set(['vulgar', 'offensive']);
const NO_DATA = { lang: new Map(), ex: new Map(), ipa: new Map(), etym: new Map() };
const EXTERNAL = 'target="_blank" rel="noopener"';

/** "1 language pair", "20 language pairs", for the hub (in English). @param {number} n @param {string} one */
const count = (n, one) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;

/** "Japanese" → "japanese", "Portuguese (Brazil)" → "portuguese-brazil". @param {string} name */
export function slug(name) {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** @param {any} meta @param {string} code */
const nameOf = (meta, code) => meta.languages.languages[code]?.name ?? code;

/** A pair's page directory. @param {any} meta @param {string} learn @param {string} know */
export function pairPage(meta, learn, know) {
  return { dir: `${DECKS_DIR}${slug(nameOf(meta, learn))}-for-${slug(nameOf(meta, know))}-speakers/` };
}

/** The meta files as the app's loader returns them (getMeta), from a meta directory. @param {string} metaDir */
export function appMeta(metaDir) {
  /** @type {Record<string, any>} */
  const meta = {};
  for (const name of ['languages', 'modules', 'fields', 'labels', 'version']) {
    const file = path.join(metaDir, `${name}.json`);
    if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
    meta[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return meta;
}

// ---------------------------------------------------------------- texts and their translations

/**
 * The texts of the pages for speakers of `know`, in English: what those pages show until data/landing/<know>.json
 * translates them (and always, for English speakers). A translation has the same shape, with `plural` forms for
 * its own plural categories; {placeholders} are filled in when a page is built.
 * @param {any} meta @param {string} know
 */
export function englishTexts(meta, know) {
  const active = /** @type {string[]} */ (meta.languages.active);
  const k = nameOf(meta, know);
  return {
    texts: {
      decks: 'Decks',
      cta: 'Build your deck',
      ctaNote: 'Opens AnkiGen with this pair and {module} chosen.',
      deck: 'Anki deck: {deck}',
      intro:
        'AnkiGen builds free Anki decks right in your browser: words by topic, each with its translation and example sentences. Choose the modules and what each card shows, then download an .apkg file for Anki or AnkiDroid. No account, nothing to install.',
      cardsHeading: 'What the cards show',
      cardsIntro: 'Each card shows the word you are learning and its translation. You choose what else it shows, and on which side:',
      captions: `Card captions, such as “{caption}”, are in ${k}.`,
      modulesHeading: 'Modules',
      modulesIntro: 'A word that belongs to several modules is in the deck once. Each module opens AnkiGen with just that module chosen; you can add more there.',
      sampleWords: 'Sample words',
      local: 'Words only this language has: {count}, such as {example}. Other languages have no exact word for these, so your cards explain them in your language.',
      howHeading: 'How it works',
      step1: 'Choose the modules you want. Each one shows how many words it has for your pair.',
      step2: 'Choose what each card shows, and on which side. The preview shows real cards as you go.',
      step3: 'Download the .apkg file and open it with Anki (File → Import), or tap it on your phone to open it in AnkiDroid.',
      update: STRINGS['update.intro'],
      aboutHeading: 'About the vocabulary',
      about: `${STRINGS['head.draftHelp1']} If something looks wrong, select it on a preview card in AnkiGen and press Ctrl+Enter (⌘+Enter on a Mac), or use the Feedback button there. Every report helps fix the deck for everyone.`,
      moreHeading: 'More decks',
      moreForYou: `More decks for ${k} speakers`,
      allDecks: 'All decks by language pair',
    },
    plural: { word: { one: '{n} word', other: '{n} words' }, module: { one: '{n} module', other: '{n} modules' } },
    languages: Object.fromEntries(active.map((code) => [code, nameOf(meta, code)])),
    categories: Object.fromEntries(meta.modules.categories.map((/** @type {any} */ cat) => [cat.id, cat.name])),
    modules: Object.fromEntries(meta.modules.categories.flatMap((/** @type {any} */ cat) => cat.modules.map((/** @type {any} */ m) => [m.id, { name: m.name, desc: m.desc }]))),
    fields: Object.fromEntries(meta.fields.fields.filter((/** @type {any} */ d) => !d.fixed).map((/** @type {any} */ d) => [d.id, { label: d.label, help: d.help }])),
    options: Object.fromEntries(meta.fields.deckOptions.map((/** @type {any} */ o) => [o.id, { label: o.label, help: o.help }])),
    pairs: Object.fromEntries(
      active
        .filter((code) => code !== know)
        .map((learn) => {
          const l = nameOf(meta, learn);
          return [learn, {
            name: `${l} for ${k} speakers`,
            title: `Free ${l} Anki deck for ${k} speakers — AnkiGen`,
            description: `Free Anki deck for ${k} speakers learning ${l}: {words} in {modules}, with ${k} translations and examples, for Anki and AnkiDroid.`,
            lede: `A free Anki deck of ${l} words with ${k} translations, built in your browser.`,
            others: `${l} for speakers of other languages`,
          }];
        }),
    ),
  };
}

/** Identifies the English texts a translation was made from: when they change, the translation is redone. @param {any} meta @param {string} know */
export function textsSource(meta, know) {
  return createHash('sha256').update(JSON.stringify(englishTexts(meta, know))).digest('hex').slice(0, 12);
}

/** The {placeholders} of a text, sorted. @param {string} text */
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(' ');

/** Letters of the registry's scripts, to see that a translation is written in its language's script. */
export const SCRIPT_LETTERS = /** @type {Record<string, RegExp>} */ ({
  Latin: /\p{Script=Latin}/u,
  Cyrillic: /\p{Script=Cyrillic}/u,
  Greek: /\p{Script=Greek}/u,
  Armenian: /\p{Script=Armenian}/u,
  Hangul: /\p{Script=Hangul}/u,
  Han: /\p{Script=Han}/u,
  Japanese: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  Arabic: /\p{Script=Arabic}/u,
});

/**
 * What is wrong with a translation of englishTexts() for speakers of `know`: missing texts, changed
 * {placeholders}, missing plural forms, HTML, texts left in English or in another script, overlong titles.
 * @param {any} t @param {any} meta @param {string} know @returns {string[]}
 */
export function checkTexts(t, meta, know) {
  const { plural, ...master } = englishTexts(meta, know);
  const reg = meta.languages.languages[know];
  /** @type {string[]} */
  const problems = [];
  /** @param {any} m @param {any} v @param {string} at */
  const walk = (m, v, at) => {
    if (typeof m !== 'string') {
      if (!v || typeof v !== 'object') problems.push(`${at}: missing`);
      else for (const key of Object.keys(m)) walk(m[key], v[key], at ? `${at}.${key}` : key);
    } else if (typeof v !== 'string' || !v.trim()) problems.push(`${at}: missing`);
    else {
      if (placeholders(v) !== placeholders(m)) problems.push(`${at}: placeholders {${placeholders(v)}} instead of {${placeholders(m)}}`);
      if (/[<>]/.test(v)) problems.push(`${at}: contains < or >; write plain text`);
      if (fullWidthLang(reg) && hasAsciiPunctuation(v)) problems.push(`${at}: ASCII punctuation; use full-width ，：；！？（）`);
    }
  };
  walk(master, t, '');
  for (const noun of Object.keys(plural)) {
    for (const category of new Intl.PluralRules(reg.locale).resolvedOptions().pluralCategories) {
      const v = t?.plural?.[noun]?.[category];
      if (typeof v !== 'string' || placeholders(v) !== 'n') problems.push(`plural.${noun}.${category}: missing, or not exactly one {n}`);
    }
  }
  for (const key of /** @type {const} */ (['intro', 'cardsIntro', 'about'])) if (t?.texts?.[key] === master.texts[key]) problems.push(`texts.${key}: still in English`);
  const letters = SCRIPT_LETTERS[reg.script];
  if (letters && typeof t?.texts?.intro === 'string' && !letters.test(t.texts.intro)) problems.push(`texts.intro: not in ${reg.script} script`);
  for (const [code, p] of Object.entries(t?.pairs ?? {})) {
    if (typeof p?.title === 'string' && p.title.length > 70) problems.push(`pairs.${code}.title: longer than 70 characters`);
    if (typeof p?.description === 'string' && p.description.length > 200) problems.push(`pairs.${code}.description: longer than 200 characters`);
  }
  return problems;
}

/** A translation in the key order of englishTexts(), with the source it was made from, as written to data/landing. @param {any} t @param {any} meta @param {string} know */
export function canonicalTexts(t, meta, know) {
  /** @param {any} m @param {any} v @returns {any} */
  const order = (m, v) => (typeof m === 'string' || !v || typeof v !== 'object' ? v : Object.fromEntries(Object.keys(m).filter((k) => k in v).map((k) => [k, order(m[k], v[k])])));
  const { plural, ...master } = englishTexts(meta, know);
  return { source: textsSource(meta, know), ...order(master, t), plural: t?.plural };
}

/** The translations in a data directory, { code: texts } from data/landing/<code>.json; unreadable files are left out (the linter reports them). @param {string} dataDir */
export function readTranslations(dataDir) {
  const dir = path.join(dataDir, 'landing');
  /** @type {Record<string, any>} */
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      out[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      // reported by landingIssues()
    }
  }
  return out;
}

/** The known languages whose pages are translated: a complete translation of the current English texts. @param {any} meta @param {Record<string, any>} translations */
export function translatedLanguages(meta, translations) {
  return /** @type {string[]} */ (meta.languages.active).filter(
    (code) => code !== 'en' && translations[code]?.source === textsSource(meta, code) && !checkTexts(translations[code], meta, code).length,
  );
}

/**
 * Lint issues of data/landing (tools/lint-data.mjs): errors for unreadable files, unknown languages and
 * checkTexts() problems; a warning for a translation of older English texts (its pages stay in English, so its
 * problems, such as the texts added to the English since, are warnings too until landing:<code> runs again).
 * @param {string} dataDir @param {any} meta
 */
export function landingIssues(dataDir, meta) {
  const dir = path.join(dataDir, 'landing');
  /** @type {{ level: 'error' | 'warning', file: string, id: null, msg: string }[]} */
  const issues = [];
  if (!fs.existsSync(dir)) return issues;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const code = file.slice(0, -5);
    /** @param {'error' | 'warning'} level @param {string} msg */
    const add = (level, msg) => issues.push({ level, file: `landing/${file}`, id: null, msg });
    let t;
    try {
      t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      add('error', `invalid JSON: ${/** @type {Error} */ (e).message}`);
      continue;
    }
    if (code === 'en' || ![...meta.languages.active, ...(meta.languages.staged ?? [])].includes(code)) {
      add('error', 'not an active or staged language other than English');
      continue;
    }
    const stale = t.source !== textsSource(meta, code);
    for (const problem of checkTexts(t, meta, code)) add(stale ? 'warning' : 'error', problem);
    if (stale) add('warning', `translated from older English texts, so its pages are in English: rerun landing:${code}`);
  }
  return issues;
}

/** @param {any} meta @param {string} know @param {any} translation @param {any} [ui] @returns {Voice} */
function voice(meta, know, translation, ui = null) {
  const reg = meta.languages.languages[know];
  const [tag, locale] = translation ? [langTag(reg, know, 'cyrl'), reg.locale] : ['en', 'en-US'];
  return {
    t: translation ?? englishTexts(meta, know),
    ui: translation ? ui : null,
    own: Boolean(translation) || know === 'en',
    tag,
    rtl: Boolean(translation) && reg.dir === 'rtl',
    lang: UI_LANGUAGES.includes(know) ? know : 'en',
    locale,
    plural: new Intl.PluralRules(locale),
    number: new Intl.NumberFormat(locale),
  };
}

/** A text of the app (src/ui/strings.js) in a page's language. @param {Voice} v @param {keyof typeof STRINGS} key */
const appText = (v, key) => v.ui?.texts?.[key] ?? STRINGS[key];

/** "3,442 words", "3 442 слова": a count in the plural form its language needs. @param {Voice} v @param {'word' | 'module'} noun @param {number} n */
function counted(v, noun, n) {
  const forms = v.t.plural[noun];
  return (forms[v.plural.select(n)] ?? forms.other).replace('{n}', v.number.format(n));
}

/** A text with its {placeholders} filled in. @param {string} text @param {Record<string, string>} values */
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, key) => values[key] ?? m);
/** The HTML of a text whose {placeholders} are markup. @param {string} text @param {Record<string, string>} html */
const fillHtml = (text, html) => escapeHtml(text).replace(/\{(\w+)\}/g, (m, key) => html[key] ?? m);

/** og:locale: ru_RU, zh_CN; Modern Standard Arabic, of no one country, as ar_AR. @param {string} locale */
function ogLocale(locale) {
  const [lang, ...rest] = locale.split('-');
  const region = rest.find((part) => /^[A-Z]{2}$/.test(part));
  return region ? `${lang}_${region}` : lang === 'ar' ? 'ar_AR' : lang;
}

// ---------------------------------------------------------------- pairs

/**
 * Every bilingual language pair with words, in registry order.
 * @param {Input} input @returns {Pair[]}
 */
function pairs({ meta, concepts, data }) {
  const active = /** @type {string[]} */ (meta.languages.active);
  const modules = moduleIds(meta);
  const adult = new Set(meta.modules.categories.flatMap((/** @type {any} */ cat) => cat.modules.filter((/** @type {any} */ m) => m.adult).map((/** @type {any} */ m) => m.id)));
  /** Samples never come from an 18+ module or have a vulgar or offensive register. @param {Note} note */
  const clean = (note) =>
    note.conceptIds.every((id) => {
      const c = concepts.byId.get(id)?.c;
      return c && !c.mods.some((/** @type {string} */ m) => adult.has(m)) && !UNSAFE_REGISTERS.has(c.reg);
    });
  return active.flatMap((learn) =>
    active.filter((code) => code !== learn).flatMap((know) => {
      const config = validate({ learn, know, modules }, meta);
      const learnData = data.get(learn) ?? NO_DATA;
      const knowData = data.get(know) ?? NO_DATA;
      const notes = selectNotes(config, meta, concepts, learnData, knowData);
      if (!notes.length) return [];
      return [{
        learn,
        know,
        ...pairPage(meta, learn, know),
        notes,
        pool: notes.filter(clean),
        counts: moduleCounts(config, meta, concepts, learnData, knowData),
        local: localTerms(config, meta, concepts, learnData, knowData),
        ctx: deckContext({ config, meta, concepts, learnData, knowData }),
      }];
    }),
  );
}

/**
 * The landing pages, the hub and the sitemap, as { path relative to the site root: content }.
 * Same data and translations, same bytes.
 * @param {Input} input
 */
export function landingFiles(input) {
  const { meta, translations = {}, ui = {} } = input;
  const list = pairs(input);
  const translated = new Set(translatedLanguages(meta, translations));
  /** @type {Map<string, Voice>} */
  const voices = new Map(meta.languages.active.map((/** @type {string} */ know) => [know, voice(meta, know, translated.has(know) ? translations[know] : null, ui[know])]));
  /** @type {Record<string, string>} */
  const files = {};
  for (const pair of list) files[`${pair.dir}index.html`] = pairHtml(pair, list, meta, voices, siblings(pair, list, voices));
  files[`${DECKS_DIR}index.html`] = hubHtml(list, meta, voices);
  files['sitemap.xml'] = sitemapXml(['', LANGUAGES_PAGE, DECKS_DIR, ...list.map((p) => p.dir)]);
  return files;
}

/**
 * The same, from the data a loader reads (tools/bundle.mjs passes one that reads the built site).
 * @param {ReturnType<typeof import('../src/data/loader.js').createLoader>} loader
 * @param {Record<string, any>} [translations] data/landing @param {Record<string, any>} [ui] data/ui
 */
export async function landingSite(loader, translations = {}, ui = {}) {
  const meta = await loader.getMeta();
  const concepts = await loader.getConcepts();
  const codes = /** @type {string[]} */ (meta.languages.active);
  const data = new Map(await Promise.all(codes.map(async (code) => /** @type {[string, LanguageData]} */ ([code, await loader.getLanguage(code)]))));
  return landingFiles({ meta, concepts, data, translations, ui });
}

// ---------------------------------------------------------------- pages

/** @param {string} dir */
const depth = (dir) => dir.split('/').filter(Boolean).length;

/** The author, for the structured data. */
const AUTHOR = { '@type': 'Person', name: AUTHOR_NAME, url: AUTHOR_URL };

/**
 * The page around a body: head (canonical URL, link preview, the same page in other languages, structured
 * data), breadcrumb, footer.
 * @param {{ v: Voice, dir: string, title: string, description: string, trail: { name: string, dir: string }[], body: string,
 *   alternates?: { hreflang: string, dir: string }[], about?: object[] }} page
 *   trail: the breadcrumb after AnkiGen, ending with this page; alternates: hreflang links; about: more
 *   structured data
 */
function pageHtml({ v, dir, title, description, trail, body, alternates = [], about = [] }) {
  const root = '../'.repeat(depth(dir));
  const url = SITE_URL + dir;
  const crumbs = [{ name: 'AnkiGen', dir: '' }, ...trail];
  const last = crumbs.length - 1;
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, ...(i < last ? { item: SITE_URL + c.dir } : {}) })),
  };
  const ld = { '@context': 'https://schema.org', '@graph': [breadcrumb, ...about] };
  // Every crumb is this page or a directory above it.
  const nav = crumbs
    .map((c, i) => `<li><a href="${'../'.repeat(depth(dir) - depth(c.dir)) || './'}"${i === last ? ' aria-current="page"' : ''}>${escapeHtml(c.name)}</a></li>`)
    .join('');
  const languages = alternates.map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${SITE_URL + a.dir}">\n`).join('');
  const license = fillHtml(appText(v, 'foot.license'), {
    mit: `<a href="${REPO_URL}/blob/master/LICENSE" ${EXTERNAL}>MIT</a>`,
    cc: `<a href="${DATA_LICENSE_URL}" ${EXTERNAL}>CC&nbsp;BY-SA&nbsp;4.0</a>`,
  });
  const author = fillHtml(appText(v, 'foot.author'), { name: `<a href="${AUTHOR_URL}" ${EXTERNAL}>${escapeHtml(AUTHOR_NAME)}</a>` });
  return `<!doctype html>
<html lang="${v.tag}"${v.rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<meta name="author" content="${escapeAttr(AUTHOR_NAME)}">
<link rel="canonical" href="${url}">
${languages}<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f6f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151618" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AnkiGen">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${SITE_URL}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AnkiGen: free Anki vocabulary decks in 23 languages, with a sample card for the Japanese word 水, water.">
<meta property="og:locale" content="${ogLocale(v.locale)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:creator" content="@${AUTHOR_URL.split('/').pop()}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="${root}css/app.css">
</head>
<body class="lp-page">
<header class="site-head">
  <nav class="crumbs" aria-label="Breadcrumb"><ol>${nav}</ol></nav>
</header>

<main class="lp">
${body}
</main>

<footer class="site-foot">
  <p class="support">${escapeHtml(appText(v, 'support'))} <span><a class="button" href="${PATREON_URL}" ${EXTERNAL}>Patreon</a> <a class="button" href="${BUY_ME_A_COFFEE_URL}" ${EXTERNAL}>Buy Me a Coffee</a></span></p>
  <p class="foot-line"><a href="${root}${DECKS_DIR}">${escapeHtml(appText(v, 'foot.decks'))}</a> · <a href="${root}${LANGUAGES_PAGE}?lang=${v.lang}">${escapeHtml(appText(v, 'foot.languages'))}</a> · <a href="${REPO_URL}" ${EXTERNAL}>${escapeHtml(appText(v, 'foot.source'))}</a></p>
  <p class="foot-line">${license}</p>
  <p class="foot-line">${author}</p>
</footer>
</body>
</html>
`;
}

/**
 * The same page in other languages (hreflang): the pages for the same learned language that are written in their
 * visitors' language, this one included, and the English speakers' page for anyone else. None for a page in
 * English for speakers of another language (its translation is missing).
 * @param {Pair} pair @param {Pair[]} list @param {Map<string, Voice>} voices
 */
function siblings(pair, list, voices) {
  if (!voices.get(pair.know)?.own) return [];
  const pages = list.filter((p) => p.learn === pair.learn && voices.get(p.know)?.own).map((p) => ({ hreflang: p.know, dir: p.dir }));
  const english = pages.find((p) => p.hreflang === 'en');
  return pages.length < 2 ? [] : [...pages, ...(english ? [{ hreflang: 'x-default', dir: english.dir }] : [])];
}

/**
 * @param {Pair} pair @param {Pair[]} list @param {any} meta @param {Map<string, Voice>} voices
 * @param {{ hreflang: string, dir: string }[]} alternates
 */
function pairHtml(pair, list, meta, voices, alternates) {
  const { learn, know, ctx, notes, counts } = pair;
  const v = /** @type {Voice} */ (voices.get(know));
  const { t } = v;
  const p = t.pairs[learn];
  /** The app with this pair and these modules chosen, in the visitors' language. @param {string[]} modules */
  const appHref = (modules) => escapeAttr(`../../${UI_LANGUAGES.includes(know) ? `?lang=${know}` : ''}${encodeHash(validate({ learn, know, modules }, meta), meta)}`);
  const groups = moduleGroups(meta, counts);
  const first = groups[0].modules[0];
  const words = counted(v, 'word', notes.length);
  const modules = counted(v, 'module', groups.reduce((n, g) => n + g.modules.length, 0));
  const caption = know !== 'en' && meta.labels.labels[know] ? ctx.label('section.examples') : null;

  const body = `<h1>${escapeHtml(p.name)}</h1>
<p class="lede">${escapeHtml(p.lede)}</p>
<p class="lp-facts">${escapeHtml(`${words} · ${modules} · ${fill(t.texts.deck, { deck: deckName(ctx.config, meta) })}`)}</p>
<p class="lp-cta"><a class="button primary" href="${appHref([first.id])}">${escapeHtml(t.texts.cta)}</a> <span>${escapeHtml(fill(t.texts.ctaNote, { module: t.modules[first.id].name }))}</span></p>
<p>${escapeHtml(t.texts.intro)}</p>

<h2>${escapeHtml(t.texts.cardsHeading)}</h2>
<p>${escapeHtml(t.texts.cardsIntro)}</p>
${fieldsHtml(pair, meta, t)}${caption ? `\n<p>${fillHtml(t.texts.captions, { caption: `<span${ctx.know.attrs}>${escapeHtml(caption)}</span>` })}</p>` : ''}

<h2>${escapeHtml(t.texts.modulesHeading)}</h2>
<p>${escapeHtml(t.texts.modulesIntro)}</p>
${groups.map((g) => `<h3>${escapeHtml(t.categories[g.id])}</h3>\n<ul class="lp-mods">\n${g.modules.map((m) => moduleHtml(pair, m, appHref([m.id]), v)).join('\n')}\n</ul>`).join('\n')}

<h2>${escapeHtml(t.texts.howHeading)}</h2>
<ol>
<li>${escapeHtml(t.texts.step1)}</li>
<li>${escapeHtml(t.texts.step2)}</li>
<li>${escapeHtml(t.texts.step3)}</li>
</ol>
<p>${escapeHtml(t.texts.update)}</p>

<h2>${escapeHtml(t.texts.aboutHeading)}</h2>
<p>${escapeHtml(t.texts.about)}</p>

${moreHtml(pair, list, voices)}`;
  const description = fill(p.description, { words, modules });
  const resource = {
    '@type': 'LearningResource',
    name: p.name,
    description,
    url: SITE_URL + pair.dir,
    inLanguage: [learn, know],
    learningResourceType: 'Flashcards',
    isAccessibleForFree: true,
    about: { '@type': 'Language', name: nameOf(meta, learn), alternateName: learn },
    author: AUTHOR,
  };
  const trail = [{ name: t.texts.decks, dir: DECKS_DIR }, { name: p.name, dir: pair.dir }];
  return pageHtml({ v, dir: pair.dir, title: p.title, description, trail, body, alternates, about: [resource] });
}

/**
 * Categories with the modules that have words for the pair, in tree order.
 * @param {any} meta @param {Map<string, number>} counts
 * @returns {{ id: string, modules: { id: string, adult?: boolean, words: number }[] }[]}
 */
function moduleGroups(meta, counts) {
  return meta.modules.categories
    .map((/** @type {any} */ cat) => ({
      id: cat.id,
      modules: cat.modules.filter((/** @type {any} */ m) => counts.get(m.id)).map((/** @type {any} */ m) => ({ id: m.id, adult: m.adult, words: counts.get(m.id) })),
    }))
    .filter((/** @type {any} */ g) => g.modules.length);
}

/**
 * The field rows and deck options the app shows for the pair, with their help text; not the word and its
 * translation, which every card has.
 * @param {Pair} pair @param {any} meta @param {any} t
 */
function fieldsHtml(pair, meta, t) {
  const rows = meta.fields.fields.filter((/** @type {any} */ def) => !def.fixed && isFieldShown(def, pair.ctx.config)).map((/** @type {any} */ def) => t.fields[def.id]);
  const options = meta.fields.deckOptions.filter((/** @type {any} */ o) => !o.langs || o.langs.includes(pair.learn) || o.langs.includes(pair.know)).map((/** @type {any} */ o) => t.options[o.id]);
  const items = [...rows, ...options].map((/** @type {any} */ d) => `<dt>${escapeHtml(d.label)}</dt><dd>${escapeHtml(d.help)}</dd>`);
  return `<dl class="lp-fields">\n${items.join('\n')}\n</dl>`;
}

/**
 * A module with its word count, description, sample words and the words only the learned language has.
 * @param {Pair} pair @param {{ id: string, adult?: boolean, words: number }} m @param {string} href @param {Voice} v
 */
function moduleHtml(pair, m, href, v) {
  const { t } = v;
  const badge = m.adult ? ' <span class="badge">18+</span>' : '';
  const picks = samples(pair, m.id);
  const list = picks.length ? `\n<ul class="lp-words" aria-label="${escapeAttr(t.texts.sampleWords)}">${picks.map((note) => sampleHtml(note, pair.ctx)).join('')}</ul>` : '';
  const local = pair.local.get(m.id);
  const localText = local
    ? `\n<p class="lp-local">${fillHtml(t.texts.local, { count: escapeHtml(counted(v, 'word', local.count)), example: `<span${pair.ctx.learn.attrs}>${escapeHtml(local.example)}</span>` })}</p>`
    : '';
  return `<li class="lp-mod">
<h4><a href="${href}">${escapeHtml(t.modules[m.id].name)}</a>${badge} <span class="lp-count">${escapeHtml(counted(v, 'word', m.words))}</span></h4>
<p>${escapeHtml(t.modules[m.id].desc)}</p>${list}${localText}
</li>`;
}

/**
 * Up to SAMPLES notes of a module. Its own words (from its concept file) show it best, and of those the ones
 * with a single meaning; words it shares with other modules (Core words come first in canonical order) and
 * merged notes (one word for several concepts) only fill up.
 * @param {Pair} pair @param {string} module
 */
function samples(pair, module) {
  /** @type {Note[][]} own single-meaning, own merged, shared */
  const tiers = [[], [], []];
  for (const note of pair.pool) {
    if (!note.modules.includes(module)) continue;
    const own = note.conceptIds.some((id) => pair.ctx.concepts.byId.get(id)?.module === module);
    tiers[own ? (note.conceptIds.length === 1 ? 0 : 1) : 2].push(note);
  }
  /** @type {Note[]} */
  const picked = [];
  for (const tier of tiers) picked.push(...spread(tier, SAMPLES - picked.length));
  return picked;
}

/** Up to n of the notes, spread evenly from the first one. @param {Note[]} notes @param {number} n */
function spread(notes, n) {
  const k = Math.min(n, notes.length);
  return Array.from({ length: k }, (_, i) => notes[Math.floor((i * notes.length) / k)]);
}

/** "word (caption) — translation", as the app's word list shows it. @param {Note} note @param {import('../src/deck/fields.js').DeckContext} ctx */
function sampleHtml(note, ctx) {
  const s = noteSummary(note, ctx);
  const caption = s.disambig ? ` <span class="lp-dis"${ctx.know.attrs}>(${escapeHtml(s.disambig)})</span>` : '';
  return `<li><span${ctx.learn.attrs}>${escapeHtml(s.word)}</span>${caption} — <span class="lp-tr"${ctx.know.attrs}>${escapeHtml(s.translation)}</span></li>`;
}

/**
 * Links to the other pages for the same speakers (named in their language) and for the same learned language
 * (each named in the language of its page).
 * @param {Pair} pair @param {Pair[]} list @param {Map<string, Voice>} voices
 */
function moreHtml(pair, list, voices) {
  const v = /** @type {Voice} */ (voices.get(pair.know));
  const { t } = v;
  /** @param {Pair} p @param {string} text @param {string} tag */
  const link = (p, text, tag) => `<li><a href="../${p.dir.slice(DECKS_DIR.length)}" lang="${tag}">${escapeHtml(text)}</a></li>`;
  const forYou = list.filter((p) => p.know === pair.know && p !== pair).map((p) => link(p, t.languages[p.learn], v.tag));
  const forOthers = list
    .filter((p) => p.learn === pair.learn && p !== pair)
    .map((p) => {
      const other = /** @type {Voice} */ (voices.get(p.know));
      return link(p, other.t.pairs[p.learn].name, other.tag);
    });
  const sections = [
    { heading: t.texts.moreForYou, items: forYou },
    { heading: t.pairs[pair.learn].others, items: forOthers },
  ]
    .filter((s) => s.items.length)
    .map((s) => `<h3>${escapeHtml(s.heading)}</h3>\n<ul class="lp-pairs">${s.items.join('')}</ul>\n`);
  return `<h2>${escapeHtml(t.texts.moreHeading)}</h2>\n${sections.join('')}<p><a href="../">${escapeHtml(t.texts.allDecks)}</a></p>`;
}

/** The hub, in English: every page, by the language you speak, each named in the language of its page. @param {Pair[]} list @param {any} meta @param {Map<string, Voice>} voices */
function hubHtml(list, meta, voices) {
  const active = /** @type {string[]} */ (meta.languages.active);
  const sections = active
    .map((know) => {
      const pages = list.filter((p) => p.know === know);
      if (!pages.length) return '';
      const reg = meta.languages.languages[know];
      const v = /** @type {Voice} */ (voices.get(know));
      const native = reg.native !== reg.name ? ` <span class="lp-native" lang="${langTag(reg, know, 'cyrl')}"${reg.dir === 'rtl' ? ' dir="rtl"' : ''}>${escapeHtml(reg.native)}</span>` : '';
      const links = pages.map((p) => `<li><a href="${p.dir.slice(DECKS_DIR.length)}" lang="${v.tag}">${escapeHtml(v.t.languages[p.learn])}</a></li>`);
      return `<h2>For ${escapeHtml(reg.name)} speakers${native}</h2>\n<ul class="lp-pairs">${links.join('')}</ul>`;
    })
    .filter(Boolean);
  const languages = active.filter((code) => list.some((p) => p.learn === code || p.know === code));
  const description = `Free Anki vocabulary decks for ${count(list.length, 'language pair')} of ${count(languages.length, 'language')}. Each page lists its deck’s modules with sample words.`;
  const body = `<h1>Decks by language pair</h1>
<p class="lede">Pick the language you speak, then the one you’re learning.</p>
<p>${escapeHtml(description)} Every deck is built in your browser, with no account and nothing to install.</p>
${sections.join('\n')}`;
  const english = voice(meta, 'en', null);
  return pageHtml({ v: english, dir: DECKS_DIR, title: 'Anki vocabulary decks by language pair — AnkiGen', description, trail: [{ name: english.t.texts.decks, dir: DECKS_DIR }], body });
}

/** @param {string[]} dirs relative to the site root */
function sitemapXml(dirs) {
  const urls = dirs.map((dir) => `  <url>\n    <loc>${escapeHtml(SITE_URL + dir)}</loc>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
