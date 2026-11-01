// The static files of the site (ARCHITECTURE §10): what crawlers and link previews read without running
// scripts must agree with src/config.js, the language registry and the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTHOR_NAME, AUTHOR_URL, BUY_ME_A_COFFEE_URL, DATA_LICENSE_URL, PATREON_URL, REPO_URL, SITE_URL } from '../src/config.js';
import { UI_LANGUAGES } from '../src/ui/i18n.js';
import { PLURALS, STRINGS } from '../src/ui/strings.js';
import { langTag } from '../src/deck/fields.js';
import { decodeHash } from '../src/state.js';
import { DECKS_DIR, LANGUAGES_PAGE, appMeta } from '../tools/landing.mjs';
import { head as headOf } from './helpers/html.mjs';
import { staticGraph } from './helpers/modules.mjs';

const ROOT = new URL('../', import.meta.url);
/** @param {string} file */
const read = (file) => fs.readFileSync(new URL(file, ROOT), 'utf8');
const html = read('index.html');
const registry = JSON.parse(read('data/meta/languages.json'));
const active = /** @type {string[]} */ (registry.active);
/** @param {string} attr @param {string} value */
const head = (attr, value) => headOf(html, attr, value);

test('every absolute URL in the static files comes from src/config.js', () => {
  const allowed = [SITE_URL, REPO_URL, PATREON_URL, BUY_ME_A_COFFEE_URL, DATA_LICENSE_URL, AUTHOR_URL, 'https://schema.org'];
  for (const file of ['index.html', LANGUAGES_PAGE, '404.html', 'robots.txt']) {
    for (const [url] of read(file).matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
      assert.ok(allowed.some((prefix) => url.startsWith(prefix)), `${file}: ${url} is not in src/config.js`);
    }
  }
  assert.equal(head('rel', 'canonical'), SITE_URL);
  assert.equal(head('property', 'og:url'), SITE_URL);
  assert.equal(head('property', 'og:image'), `${SITE_URL}og-image.png`);
  for (const url of [PATREON_URL, BUY_ME_A_COFFEE_URL, REPO_URL, DATA_LICENSE_URL, AUTHOR_URL]) assert.ok(html.includes(`href="${url}"`), `the footer links to ${url}`);
  assert.equal([...html.matchAll(new RegExp(`href="${PATREON_URL}"`, 'g'))].length, 2, 'the support links are in the header and the footer');
  assert.match(html, new RegExp(`Created by <a data-part="name" href="${AUTHOR_URL}"[^>]*>${AUTHOR_NAME}</a>`));
  assert.doesNotMatch(html, /id="versions"|App \d/, 'no versions in the footer');
  assert.equal(head('name', 'author'), AUTHOR_NAME);
  assert.equal(head('name', 'twitter:creator'), `@${AUTHOR_URL.split('/').pop()}`);
  assert.match(read('404.html'), new RegExp(`var home = '${SITE_URL}'`));
  assert.match(read('robots.txt'), new RegExp(`Sitemap: ${SITE_URL}sitemap.xml`)); // written by the build (tests/landing.test.mjs)
});

test('title, description and structured data agree, and count the active languages', () => {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const description = head('name', 'description');
  assert.equal(head('property', 'og:title'), title);
  assert.equal(head('property', 'og:description'), description);
  const graph = JSON.parse(/** @type {string} */ (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]))['@graph'];
  const [app, site, author] = ['WebApplication', 'WebSite', 'Person'].map((type) => graph.find((/** @type {any} */ node) => node['@type'] === type));
  assert.equal(app.url, SITE_URL);
  assert.equal(app.description, description);
  assert.deepEqual(app.inLanguage, active);
  assert.equal(app.offers.price, '0');
  assert.equal(site.url, SITE_URL);
  assert.deepEqual(site.inLanguage, active);
  assert.deepEqual([author.name, author.url], [AUTHOR_NAME, AUTHOR_URL]);
  assert.ok(author.sameAs.includes(AUTHOR_URL));
  for (const ref of [app.author, app.isPartOf, site.publisher]) assert.ok(graph.some((/** @type {any} */ node) => node['@id'] === ref['@id']), `${ref['@id']} is in the graph`);
  for (const [, n] of html.matchAll(/(\d+) languages/g)) assert.equal(Number(n), active.length, `"${n} languages" in index.html`);
  const noscript = /** @type {string} */ (html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1]);
  for (const code of active) assert.ok(noscript.includes(registry.languages[code].name), `the noscript text names ${registry.languages[code].name}`);
});

test('the link preview image is 1200×630, and the icons exist', () => {
  const png = fs.readFileSync(new URL('og-image.png', ROOT));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  assert.equal(head('property', 'og:image:width'), '1200');
  assert.equal(head('property', 'og:image:height'), '630');
  const touch = fs.readFileSync(new URL('apple-touch-icon.png', ROOT));
  assert.deepEqual([touch.readUInt32BE(16), touch.readUInt32BE(20)], [180, 180]);
  assert.match(read('favicon.svg'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('index.html preloads exactly the modules src/main.js imports, and every file it names exists (or the build makes it)', () => {
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]).sort();
  const graph = [...staticGraph().keys()].filter((file) => file !== 'src/main.js').sort();
  const missing = graph.filter((file) => !preloaded.includes(file));
  const extra = preloaded.filter((file) => !graph.includes(file));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, 'update the modulepreload links in index.html');
  for (const [, file] of html.matchAll(/(?:href|src)="(?!https?:|#)([^"]+)"/g)) {
    assert.ok(file === DECKS_DIR || fs.existsSync(new URL(file, ROOT)), `index.html names ${file}`);
  }
  assert.equal([...html.matchAll(new RegExp(`href="${DECKS_DIR}"`, 'g'))].length, 2, 'the footer and the noscript text link to the landing pages');
});

/**
 * A page's texts are the English of src/ui/strings.js, and its early language check knows the languages.
 * @param {string} page @returns {number} how many data-t texts it has
 */
function checkPageTexts(page) {
  /** The text of an element's inner HTML, with its data-part elements as {placeholders}. @param {string} inner */
  const text = (inner) =>
    inner
      .replace(/<a data-part="(\w+)"[^>]*>.*?<\/a>/g, '{$1}')
      .replace(/<[^>]+>/g, '')
      .replaceAll('&nbsp;', '\u00a0');
  const keys = [...page.matchAll(/<(\w+)[^>]* data-t="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
  for (const [, , key, inner] of keys) {
    assert.ok(key in STRINGS, `${key} is a text of src/ui/strings.js`);
    assert.equal(text(inner), STRINGS[/** @type {keyof typeof STRINGS} */ (key)], key);
  }
  for (const [, key, inner] of page.matchAll(/<p[^>]* data-plural="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    assert.equal(inner, PLURALS[/** @type {keyof typeof PLURALS} */ (key)].other.replace('{n}', String(active.length)), key);
  }
  // The inline script that hides the English while a translation loads (pickLanguage's rule).
  assert.equal(page.match(/var ui = '([^']+)'/)?.[1], UI_LANGUAGES.join(' '));
  return keys.length;
}

test('the texts of index.html are the English of src/ui/strings.js, and the early language check knows the languages', () => {
  assert.ok(checkPageTexts(html) > 15);
  assert.equal(html.match(/<title>([^<]*)<\/title>/)?.[1], PLURALS.title.other.replace('{n}', String(active.length)));
  assert.equal(head('name', 'description'), PLURALS.description.other.replace('{n}', String(active.length)));
  assert.ok(UI_LANGUAGES.every((code) => active.includes(code)), 'every interface language is active');
});

test('the languages page lists the active languages, as src/languages-page.js translates them', () => {
  const page = read(LANGUAGES_PAGE);
  const meta = appMeta(new URL('data/meta', ROOT).pathname);
  const pageHead = (/** @type {string} */ attr, /** @type {string} */ value) => headOf(page, attr, value);
  assert.ok(checkPageTexts(page) > 8);
  const title = page.match(/<title>([^<]*)<\/title>/)?.[1];
  const description = PLURALS.langsDescription.other.replace('{n}', String(active.length));
  assert.equal(title, STRINGS['langs.title']);
  assert.equal(pageHead('name', 'description'), description);
  assert.deepEqual([pageHead('property', 'og:title'), pageHead('property', 'og:description')], [title, description]);
  assert.equal(pageHead('rel', 'canonical'), SITE_URL + LANGUAGES_PAGE);
  assert.equal(pageHead('property', 'og:url'), SITE_URL + LANGUAGES_PAGE);
  assert.equal(page.match(/<footer[\s\S]*<\/footer>/)?.[0], html.match(/<footer[\s\S]*<\/footer>/)?.[0], 'the footer of index.html');

  const items = [...page.matchAll(/<li class="lang" data-code="(\w+)">([\s\S]*?)<\/li>/g)];
  assert.deepEqual(items.map((m) => m[1]), active, 'every active language, in their order');
  for (const [, code, item] of items) {
    const reg = registry.languages[code];
    assert.match(item, new RegExp(`<img class="flag" src="img/flags/${(reg.flag ?? reg.country).toLowerCase()}\\.svg"`), `${code}: its flag`);
    assert.ok(fs.existsSync(new URL(`img/flags/${(reg.flag ?? reg.country).toLowerCase()}.svg`, ROOT)), `${code}: its flag exists`);
    assert.match(item, new RegExp(`<span class="lang-native" lang="${langTag(reg, code, 'cyrl')}"${reg.dir === 'rtl' ? ' dir="rtl"' : ''}>${reg.native}</span>`), `${code}: its native name`);
    assert.match(item, new RegExp(`<span class="lang-name"${reg.native === reg.name ? ' hidden' : ''}>${reg.name}</span>`), `${code}: its English name`);
    const extras = meta.fields.fields.filter((/** @type {any} */ d) => !d.fixed && Array.isArray(d.langs) && d.langs.includes(code)).map((/** @type {any} */ d) => d.label);
    assert.ok(item.includes(`<p class="lang-extras">${STRINGS['langs.extras'].replace('{fields}', extras.join(' · '))}</p>`), `${code}: the rows only some languages have`);
    const href = item.match(/<a class="lang-build" href="([^"]+)"/)?.[1].replaceAll('&amp;', '&') ?? '';
    assert.equal(decodeHash(href.slice(href.indexOf('#')), meta)?.learn, code, `${code}: the link starts a deck in it`);
  }
  const graph = JSON.parse(/** @type {string} */ (page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]))['@graph'];
  const list = graph[0].mainEntity;
  assert.equal(list.numberOfItems, active.length);
  assert.deepEqual(list.itemListElement.map((/** @type {any} */ i) => [i.item.name, i.item.alternateName]), active.map((code) => [registry.languages[code].name, code]));
  assert.deepEqual([graph[0].url, graph[0].description], [SITE_URL + LANGUAGES_PAGE, description]);

  const preloaded = [...page.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]).sort();
  assert.deepEqual(preloaded, [...staticGraph('src/languages-page.js').keys()].filter((file) => file !== 'src/languages-page.js').sort(), 'update the modulepreload links');
  for (const [, file] of page.matchAll(/(?:href|src)="(?!https?:)([^"#?]+)/g)) assert.ok(file === './' || file === DECKS_DIR || fs.existsSync(new URL(file, ROOT)), `${LANGUAGES_PAGE} names ${file}`);
  assert.match(html, new RegExp(`<a href="${LANGUAGES_PAGE}" data-keep-lang data-t="foot.languages">`), 'the app links to it');
});
