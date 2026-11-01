// The landing pages (tools/landing.mjs, ARCHITECTURE §10), made from the golden sample: a page for every
// language pair with words, built with the app's deck code; the hub; and the sitemap that lists them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTHOR_NAME, AUTHOR_URL, BUY_ME_A_COFFEE_URL, DATA_LICENSE_URL, PATREON_URL, REPO_URL, SITE_URL } from '../src/config.js';
import { decodeHash, moduleIds, validate } from '../src/state.js';
import { assembleConcepts, moduleOrder } from '../src/data/loader.js';
import { moduleCounts, selectNotes } from '../src/deck/select.js';
import { DECKS_DIR, LANGUAGES_PAGE, checkTexts, englishTexts, landingFiles, landingSite, pairPage, slug, textsSource } from '../tools/landing.mjs';
import { fixtureLoader } from './helpers/fixtures.mjs';
import { head } from './helpers/html.mjs';

const ROOT = new URL('../', import.meta.url);
const index = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const loader = fixtureLoader();
const meta = await loader.getMeta();
const concepts = await loader.getConcepts();
const files = await landingSite(loader);
const HUB = `${DECKS_DIR}index.html`;
const pages = Object.keys(files).filter((file) => file.startsWith(DECKS_DIR) && file !== HUB);
/** The languages of tests/fixtures/data, in registry order. */
const SAMPLE_LANGUAGES = /** @type {string[]} */ (meta.languages.active).filter((code) => ['en', 'ru', 'sr', 'ja', 'de'].includes(code));
/** Page file → [learn, know], for every pair of the sample languages. */
const pairOf = new Map(
  SAMPLE_LANGUAGES.flatMap((learn) => SAMPLE_LANGUAGES.filter((k) => k !== learn).map((know) => [`${pairPage(meta, learn, know).dir}index.html`, [learn, know]])),
);
/** @param {string} file */
const dirOf = (file) => file.replace(/index\.html$/, '');

test('a page for every bilingual pair with words: <learning>-for-<known>-speakers', () => {
  assert.deepEqual(pages, [...pairOf.keys()], 'each pair of the sample languages has words, in registry order');
  assert.ok(pages.includes('decks/japanese-for-russian-speakers/index.html'));
  assert.ok(!Object.keys(files).some((file) => file.includes('monolingual')), 'same-language decks get no pages');
  assert.deepEqual([slug('Portuguese (Brazil)'), slug('Español'), slug('Scottish Gaelic')], ['portuguese-brazil', 'espanol', 'scottish-gaelic']);
  const active = /** @type {string[]} */ (meta.languages.active);
  const dirs = active.flatMap((learn) => active.filter((k) => k !== learn).map((know) => pairPage(meta, learn, know).dir));
  assert.equal(new Set(dirs).size, active.length * (active.length - 1), 'every pair of the registry gets its own address');
});

test('pairs without words get no page; the hub and the sitemap list exactly the pages', () => {
  assert.ok(!Object.keys(files).some((file) => /chinese|korean/.test(file)), 'no Chinese or Korean in the sample');
  const main = files[HUB].slice(files[HUB].indexOf('<main'), files[HUB].indexOf('</main>'));
  const linked = [...main.matchAll(/<a href="([^"]+)"[^>]*>/g)].map((m) => `${DECKS_DIR}${m[1]}index.html`);
  assert.deepEqual([...linked].sort(), [...pages].sort(), 'the hub links every page once');
  assert.match(main, /<h2>For Russian speakers <span class="lp-native" lang="ru-RU">Русский<\/span><\/h2>/);
  assert.match(main, /20 language pairs of 5 languages/);

  const sitemap = files['sitemap.xml'];
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [SITE_URL, SITE_URL + LANGUAGES_PAGE, SITE_URL + DECKS_DIR, ...pages.map((file) => SITE_URL + dirOf(file))]);
});

test('every page has its own title and description, its canonical address and breadcrumb', () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const file of [...pages, HUB]) {
    const html = files[file];
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
    const description = head(html, 'name', 'description');
    titles.add(title);
    descriptions.add(description);
    assert.equal(head(html, 'rel', 'canonical'), SITE_URL + dirOf(file), file);
    assert.equal(head(html, 'property', 'og:url'), SITE_URL + dirOf(file), file);
    assert.equal(head(html, 'property', 'og:title'), title);
    assert.equal(head(html, 'property', 'og:description'), description);
    assert.ok(/** @type {string} */ (description).length <= 160, `${file}: the description fits a search result`);
    const graph = JSON.parse(/** @type {string} */ (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]))['@graph'];
    const items = graph.find((/** @type {any} */ node) => node['@type'] === 'BreadcrumbList').itemListElement;
    assert.deepEqual(items.map((/** @type {any} */ i) => i.position), items.map((/** @type {any} */ _, /** @type {number} */ i) => i + 1));
    assert.deepEqual(items.map((/** @type {any} */ i) => i.item), [SITE_URL, ...(file === HUB ? [] : [SITE_URL + DECKS_DIR]), undefined], 'the last crumb is this page');
    if (file !== HUB) assert.equal(items.at(-1).name, html.match(/<h1>([^<]*)<\/h1>/)?.[1]);
    const resource = graph.find((/** @type {any} */ node) => node['@type'] === 'LearningResource');
    if (file === HUB) {
      assert.equal(resource, undefined);
      continue;
    }
    const [learn, know] = /** @type {[string, string]} */ (pairOf.get(file));
    assert.deepEqual([resource.url, resource.name, resource.description], [SITE_URL + dirOf(file), items.at(-1).name, description]);
    assert.deepEqual([resource.inLanguage, resource.about.alternateName, resource.about.name], [[learn, know], learn, meta.languages.languages[learn].name]);
    assert.deepEqual([resource.isAccessibleForFree, resource.author.url], [true, AUTHOR_URL]);
  }
  assert.equal(titles.size, pages.length + 1);
  assert.equal(descriptions.size, pages.length + 1);
  const ja = files['decks/japanese-for-russian-speakers/index.html'];
  assert.match(ja, /<title>Free Japanese Anki deck for Russian speakers — AnkiGen<\/title>/);
  assert.match(ja, /<h1>Japanese for Russian speakers<\/h1>/);
});

test('links open the app with the pair chosen, and every link resolves in the site', () => {
  for (const file of [...pages, HUB]) {
    const html = files[file];
    for (const [, attr] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = attr.replaceAll('&amp;', '&');
      if (/^https?:/.test(href)) continue;
      const url = new URL(href, new URL(file, 'https://site.test/'));
      const target = url.pathname.slice(1) + (url.pathname.endsWith('/') ? 'index.html' : '');
      assert.ok(target in files || fs.existsSync(new URL(target, ROOT)), `${file}: ${href}`);
      if (!url.hash) continue;
      assert.equal(target, 'index.html', `${file}: a hash link goes to the app`);
      const config = decodeHash(url.hash, meta);
      assert.deepEqual([config?.learn, config?.know], pairOf.get(file), `${file}: ${href}`);
      assert.equal(url.searchParams.get('lang'), config?.know, `${file}: ${href} opens the app in its visitors' language`);
      assert.equal(config?.modules.length, 1, `${file}: ${href} chooses one module`);
    }
  }
  const cta = (/** @type {string} */ file) => files[file].match(/<a class="button primary" href="([^"]+)">Build your deck<\/a>/)?.[1].replaceAll('&amp;', '&');
  assert.equal(cta('decks/japanese-for-russian-speakers/index.html'), '../../?lang=ru#v1&l=ja&k=ru&m=core-1&x=2');
  assert.equal(cta('decks/serbian-for-english-speakers/index.html'), '../../?lang=en#v1&l=sr&k=en&m=core-1&x=2&sr=c');
});

test('a page shows the deck the app builds: its size, the words per module, samples and local words', async () => {
  const html = files['decks/japanese-for-russian-speakers/index.html'];
  const config = validate({ learn: 'ja', know: 'ru', modules: moduleIds(meta) }, meta);
  const [ja, ru] = [await loader.getLanguage('ja'), await loader.getLanguage('ru')];
  const notes = selectNotes(config, meta, concepts, ja, ru);
  assert.match(html, new RegExp(`<p class="lp-facts">${notes.length} words · 7 modules · Anki deck: AnkiGen::日本語 \\(Русский\\)</p>`));
  const counts = moduleCounts(config, meta, concepts, ja, ru);
  const listed = [...html.matchAll(/<h4><a href="[^"]*m=([\w-]+)&amp;[^"]*">[^<]*<\/a>(?: <span class="badge">18\+<\/span>)? <span class="lp-count">(\d+) words?<\/span><\/h4>/g)];
  assert.deepEqual(
    listed.map((m) => [m[1], Number(m[2])]),
    moduleIds(meta).filter((m) => counts.get(m)).map((m) => [m, counts.get(m)]),
    'the modules with words, in tree order, with the counts the app shows',
  );
  assert.match(html, /<li><span lang="ja-JP">住民票<\/span> — <span class="lp-tr" lang="ru-RU">дзюминхё: японская справка/, 'a sample, glossed');
  assert.match(html, /Words only this language has: 1 word, such as <span lang="ja-JP">住民票<\/span>\./);
  assert.match(html, /Card captions, such as “<span lang="ru-RU">Примеры<\/span>”, are in Russian\./, 'from labels.json');
  assert.ok(files['decks/russian-for-japanese-speakers/index.html'].includes(`Card captions, such as “<span lang="ja-JP">${meta.labels.labels.ja['section.examples']}</span>”, are in Japanese.`));
  assert.doesNotMatch(files['decks/russian-for-english-speakers/index.html'], /Card captions/, 'English captions need no mention');
  assert.match(files['decks/russian-for-english-speakers/index.html'], /<span lang="ru-RU">су́тки pl\. only<\/span> — <span class="lp-tr" lang="en-US">a full day of 24 hours/, 'a word only Russian has, glossed');

  // The field rows the app shows for the pair.
  const rows = (/** @type {string} */ file) => [...files[file].matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
  assert.ok(rows('decks/japanese-for-russian-speakers/index.html').includes('Reading (furigana)'));
  assert.ok(!rows('decks/german-for-russian-speakers/index.html').includes('Reading (furigana)'));
  assert.ok(rows('decks/german-for-russian-speakers/index.html').includes('Gender / article'));
  assert.ok(rows('decks/serbian-for-english-speakers/index.html').includes('Serbian script'));
  assert.ok(rows('decks/english-for-serbian-speakers/index.html').includes('Serbian script'), 'Serbian on the known side too');
  assert.ok(!rows('decks/english-for-russian-speakers/index.html').includes('Serbian script'));
  assert.ok(rows('decks/japanese-for-russian-speakers/index.html').includes('Example translations'));
  assert.ok(!rows('decks/japanese-for-russian-speakers/index.html').includes('Word'), 'not the rows every card has');
});

test('words of the 18+ modules, and vulgar or offensive ones, are never samples', () => {
  const lang = (/** @type {Record<string, any>} */ entries) => ({ lang: new Map(Object.entries(entries)), ex: new Map(), ipa: new Map(), etym: new Map() });
  const sample = assembleConcepts(moduleOrder(meta.modules), {
    'core-1': { 'word-water': { pos: 'noun', mods: ['core-1'] }, 'word-idiot': { pos: 'noun', mods: ['core-1'], reg: 'offensive' } },
    feelings: { 'word-anger': { pos: 'noun', mods: ['feelings'] } },
    profanity: { 'word-damn': { pos: 'interj', mods: ['profanity', 'feelings'] }, 'word-heck': { pos: 'interj', mods: ['profanity'] } },
  });
  const en = lang({ 'word-water': { w: 'water' }, 'word-idiot': { w: 'idiot' }, 'word-anger': { w: 'anger' }, 'word-damn': { w: 'damn' }, 'word-heck': { w: 'heck' } });
  const ru = lang({ 'word-water': { w: 'вода' }, 'word-idiot': { w: 'идиот' }, 'word-anger': { w: 'гнев' }, 'word-damn': { w: 'чёрт' }, 'word-heck': { w: 'блин' } });
  const out = landingFiles({ meta, concepts: sample, data: new Map([['en', en], ['ru', ru]]) });
  const html = out['decks/english-for-russian-speakers/index.html'];
  assert.deepEqual([...html.matchAll(/<span lang="en-US">([^<]+)<\/span>/g)].map((m) => m[1]), ['water', 'anger']);
  assert.match(html, /Core I<\/a> <span class="lp-count">2 words<\/span>/, 'the counts include them, as in the app');
  assert.match(html, /Feelings &amp; character<\/a> <span class="lp-count">2 words<\/span>/);
  assert.match(html, /Profanity<\/a> <span class="badge">18\+<\/span> <span class="lp-count">2 words<\/span><\/h4>\n<p>[^<]*<\/p>\n<\/li>/, 'listed without samples');
});

test('the pages share the app’s icons, link preview and footer; their absolute URLs come from src/config.js', () => {
  const shared = (/** @type {string} */ html) => html.match(/<meta (?:name="(?:color-scheme|theme-color|twitter:card)"|property="og:(?:type|site_name|image[^"]*|locale)")[^>]*>/g);
  const allowed = [SITE_URL, REPO_URL, PATREON_URL, BUY_ME_A_COFFEE_URL, DATA_LICENSE_URL, AUTHOR_URL, 'https://schema.org', 'http://www.sitemaps.org/schemas/sitemap/0.9'];
  for (const [file, text] of Object.entries(files)) {
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) assert.ok(allowed.some((prefix) => url.startsWith(prefix)), `${file}: ${url} is not in src/config.js`);
    if (!file.endsWith('.html')) continue;
    assert.deepEqual(shared(text), shared(index), file);
    const root = '../'.repeat(file.split('/').length - 1);
    for (const rel of ['icon', 'apple-touch-icon', 'stylesheet']) assert.equal(head(text, 'rel', rel), root + head(index, 'rel', rel), `${file}: ${rel}`);
    for (const url of [PATREON_URL, BUY_ME_A_COFFEE_URL, REPO_URL, `${REPO_URL}/blob/master/LICENSE`, DATA_LICENSE_URL, AUTHOR_URL]) assert.ok(text.includes(`href="${url}"`), `${file} links to ${url}`);
    assert.ok(text.includes(`<p class="foot-line">Created by <a href="${AUTHOR_URL}" target="_blank" rel="noopener">${AUTHOR_NAME}</a></p>`), `${file}: the author`);
    assert.doesNotMatch(text, /· App |Data \d/, `${file}: no versions in the footer, as in the app`);
    assert.equal(head(text, 'name', 'author'), AUTHOR_NAME);
    assert.doesNotMatch(text, /<script(?! type="application\/ld\+json")/, 'no scripts but the structured data');
  }
});

test('same data, same pages', async () => {
  assert.deepEqual(await landingSite(fixtureLoader()), files);
});

/** A stand-in for a Russian translation: every English text marked with Cyrillic, and Russian plural forms. */
function fakeRussian() {
  /** @param {any} v @returns {any} */
  const mark = (v) => (typeof v === 'string' ? `Ру ${v}` : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mark(x)])));
  const { plural, ...texts } = englishTexts(meta, 'ru');
  return {
    source: textsSource(meta, 'ru'),
    ...mark(texts),
    plural: {
      word: { one: '{n} слово', few: '{n} слова', many: '{n} слов', other: '{n} слова' },
      module: { one: '{n} модуль', few: '{n} модуля', many: '{n} модулей', other: '{n} модуля' },
    },
  };
}

test('with a translation, the pages for its speakers are in their language', async () => {
  const ru = fakeRussian();
  assert.deepEqual(checkTexts(ru, meta, 'ru'), []);
  /** The app's texts in Russian (data/ui): the footer's. */
  const ui = { ru: { texts: { support: 'Ру Support this project:', 'foot.decks': 'Ру Decks by language pair', 'foot.author': 'Ру Created by {name}' } } };
  const out = await landingSite(fixtureLoader(), { ru }, ui);
  const html = out['decks/japanese-for-russian-speakers/index.html'];
  assert.match(html, /^<!doctype html>\n<html lang="ru-RU">/);
  assert.match(html, /<meta property="og:locale" content="ru_RU">/);
  assert.match(html, /<title>Ру Free Japanese Anki deck for Russian speakers — AnkiGen<\/title>/);
  assert.match(html, /<h1>Ру Japanese for Russian speakers<\/h1>/);
  assert.match(html, /<p class="lp-facts">14 слов · 7 модулей · Ру Anki deck: AnkiGen::日本語 \(Русский\)<\/p>/, 'Russian plural forms');
  assert.match(html, /Ру Core I<\/a> <span class="lp-count">12 слов<\/span>/);
  assert.match(html, /Ру Time &amp; calendar<\/a> <span class="lp-count">2 слова<\/span>/);
  assert.match(html, /Ру Survival phrases<\/a> <span class="lp-count">1 слово<\/span>/);
  assert.match(html, /<h3>Ру Foundations<\/h3>/);
  assert.match(html, /<dt>Ру Reading \(furigana\)<\/dt>/);
  assert.match(html, /<li><a href="\.\.\/">Ру Decks<\/a><\/li>/, 'the breadcrumb');
  assert.match(html, /<p class="support">Ру Support this project: <span><a class="button" href="[^"]+" [^>]*>Patreon<\/a> <a class="button" href="[^"]+" [^>]*>Buy Me a Coffee<\/a><\/span><\/p>/, 'brand names stay as they are');
  assert.match(html, /<a href="\.\.\/\.\.\/decks\/">Ру Decks by language pair<\/a> · <a href="\.\.\/\.\.\/languages\.html\?lang=ru">Supported languages<\/a> · <a href="[^"]+" [^>]*>Source on GitHub<\/a>/, 'the footer, from data/ui; English where it has no text');
  assert.match(html, new RegExp(`Ру Created by <a href="${AUTHOR_URL}"[^>]*>${AUTHOR_NAME}</a>`));
  assert.match(out['decks/japanese-for-english-speakers/index.html'], /<p class="support">Support this project: /, 'pages in English have the English footer');
  assert.match(html, /<a href="\.\.\/english-for-russian-speakers\/" lang="ru-RU">Ру English<\/a>/, 'decks for the same speakers, named in their language');
  assert.match(html, /<a href="\.\.\/japanese-for-english-speakers\/" lang="en">Japanese for English speakers<\/a>/, 'pages in English are named in English');
  const en = out['decks/japanese-for-english-speakers/index.html'];
  assert.match(en, /^<!doctype html>\n<html lang="en">/, 'English speakers’ pages stay in English');
  assert.match(en, /<a href="\.\.\/japanese-for-russian-speakers\/" lang="ru-RU">Ру Japanese for Russian speakers<\/a>/);
  assert.match(out['decks/index.html'], /<a href="english-for-russian-speakers\/" lang="ru-RU">Ру English<\/a>/, 'the hub names each page in its language');
  assert.match(out['decks/index.html'], /^<!doctype html>\n<html lang="en">/, 'the hub stays in English');
});

test('an incomplete or outdated translation leaves its pages in English', async () => {
  const incomplete = fakeRussian();
  delete incomplete.texts.cta;
  const outdated = { ...fakeRussian(), source: 'older' };
  for (const ru of [incomplete, outdated]) {
    const out = await landingSite(fixtureLoader(), { ru });
    assert.equal(out['decks/japanese-for-russian-speakers/index.html'], files['decks/japanese-for-russian-speakers/index.html']);
  }
});

test('checkTexts names what is wrong with a translation', () => {
  const ru = fakeRussian();
  ru.texts.ctaNote = 'Откроется AnkiGen';
  ru.texts.about = englishTexts(meta, 'ru').texts.about;
  ru.texts.intro = 'Latin letters only';
  ru.texts.step1 = 'Выберите <b>модули</b>';
  delete ru.plural.word.few;
  delete ru.pairs.ja;
  ru.pairs.de.title = 'Б'.repeat(71);
  assert.deepEqual(checkTexts(ru, meta, 'ru').sort(), [
    'pairs.de.title: longer than 70 characters',
    'pairs.ja: missing',
    'plural.word.few: missing, or not exactly one {n}',
    'texts.about: still in English',
    'texts.ctaNote: placeholders {} instead of {module}',
    'texts.intro: not in Cyrillic script',
    'texts.step1: contains < or >; write plain text',
  ]);
});

test('pages in their visitors’ language name each other for search engines (hreflang)', async () => {
  const alternates = (/** @type {string} */ html) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  for (const page of pages) assert.deepEqual(alternates(files[page]), [], `${page}: only English pages without translations, one per learned language`);
  const out = await landingSite(fixtureLoader(), { ru: fakeRussian() });
  const ja = [
    ['en', `${SITE_URL}decks/japanese-for-english-speakers/`],
    ['ru', `${SITE_URL}decks/japanese-for-russian-speakers/`],
    ['x-default', `${SITE_URL}decks/japanese-for-english-speakers/`],
  ];
  assert.deepEqual(alternates(out['decks/japanese-for-russian-speakers/index.html']), ja);
  assert.deepEqual(alternates(out['decks/japanese-for-english-speakers/index.html']), ja, 'both pages name both');
  assert.deepEqual(alternates(out['decks/english-for-russian-speakers/index.html']), [], 'no other page about English is in its visitors’ language');
  assert.deepEqual(alternates(out['decks/japanese-for-german-speakers/index.html']), [], 'a page in English for German speakers is nobody’s alternate');
});
