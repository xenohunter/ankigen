// The interface language (src/ui/i18n.js, ARCHITECTURE §13): which language a visitor gets, how texts, plurals
// and numbers come out, the English fallback, and the translations in data/ui (tools/ui-texts.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLoader } from '../src/data/loader.js';
import { createApp } from '../src/ui/app.js';
import { deckSize, listStatus, localTermsHelp } from '../src/ui/copy.js';
import { UI_LANGUAGES, fieldText, language, languageName, moduleText, number, optionText, pickLanguage, plural, t, useLanguage } from '../src/ui/i18n.js';
import { STRINGS } from '../src/ui/strings.js';
import { validate } from '../src/state.js';
import { appMeta } from '../tools/landing.mjs';
import { canonicalUi, checkUi, englishUi, readUiTexts, uiBundle, uiSource } from '../tools/ui-texts.mjs';
import { fixtureLoader } from './helpers/fixtures.mjs';

const ROOT = new URL('../', import.meta.url);
const meta = appMeta(new URL('data/meta', ROOT).pathname);
const translations = readUiTexts(new URL('data', ROOT).pathname);
/** @param {string} code */
const landingOf = (code) => JSON.parse(fs.readFileSync(new URL(`data/landing/${code}.json`, ROOT), 'utf8'));
/** @param {string} code */
const use = (code) => {
  const reg = meta.languages.languages[code];
  useLanguage(code, { tag: reg.locale, locale: reg.locale }, code === 'en' ? null : uiBundle(translations[code], landingOf(code)));
};

test('a visitor gets the link’s language, else their last choice, else their browser’s, else English', () => {
  assert.equal(pickLanguage({ param: 'ru', saved: 'de', browser: ['ja-JP'] }), 'ru');
  assert.equal(pickLanguage({ param: 'xx', saved: 'de', browser: ['ja-JP'] }), 'de', 'an unknown ?lang= is ignored');
  assert.equal(pickLanguage({ param: null, saved: null, browser: ['fi-FI', 'pt-BR', 'en-US'] }), 'pt', 'the first browser language the page speaks');
  assert.equal(pickLanguage({ browser: ['sr-Latn-RS'] }), 'sr');
  assert.equal(pickLanguage({ browser: ['zh-TW'] }), 'zh');
  assert.equal(pickLanguage({ browser: ['fi'] }), 'en');
  assert.equal(pickLanguage({}), 'en');
});

test('texts, plurals and numbers follow the language; what a translation lacks stays English', () => {
  use('ru');
  try {
    assert.equal(language(), 'ru');
    assert.equal(t('step.learn'), 'Я изучаю');
    assert.equal(plural('word', 1), '1 слово');
    assert.equal(plural('word', 3), '3 слова');
    assert.equal(plural('word', 25), '25 слов');
    assert.equal(plural('word', 21), '21 слово');
    assert.equal(deckSize(1734, 3468), '1\u00a0734 заметки · 3\u00a0468 карточек');
    assert.equal(number(1734), '1\u00a0734');
    assert.equal(listStatus(12, 1734, 'вода'), '12 из 1\u00a0734 слов');
    assert.match(localTermsHelp(1, '住民票'), /^1 слово здесь есть только в изучаемом языке, например 住民票\./);
    assert.equal(languageName('ja', 'Japanese'), 'Японский', 'language names come from data/landing');
    assert.equal(moduleText({ id: 'core-1', name: 'Core I', desc: '' }).name, 'Основа I');
    assert.equal(moduleText({ id: 'new-module', name: 'New', desc: 'A module added later' }).desc, 'A module added later');
    const translation = /** @type {any} */ (meta.fields.fields.find((/** @type {any} */ d) => d.id === 'translation'));
    assert.deepEqual([fieldText(translation, false).label, fieldText(translation, true).label], ['Перевод', 'Определение'], 'the fixed rows, from data/ui');
    assert.equal(optionText(/** @type {any} */ (meta.fields.deckOptions[0])).label, 'Обратные карточки');
    useLanguage('ru', { tag: 'ru-RU', locale: 'ru-RU' }, { ui: { texts: { 'step.learn': 'Учу' } } });
    assert.equal(t('step.learn'), 'Учу');
    assert.equal(t('step.know'), STRINGS['step.know'], 'a missing text is English');
    assert.equal(plural('word', 5), '5 words', 'so is a missing plural');
    assert.equal(t('no.such.key'), 'no.such.key');
  } finally {
    use('en');
  }
  assert.equal(plural('word', 1734), '1,734 words');
  assert.equal(t('lang.loading', { language: 'Japanese' }), 'Loading Japanese words…');
});

test('every translation in data/ui is complete and follows the current English', () => {
  const codes = Object.keys(translations).sort();
  assert.deepEqual(codes, UI_LANGUAGES.filter((code) => code !== 'en').sort(), 'UI_LANGUAGES lists English and the languages with a translation');
  for (const code of UI_LANGUAGES) {
    assert.ok(meta.languages.active.includes(code), `${code} is an active language`);
    if (code === 'en') continue;
    assert.deepEqual(checkUi(translations[code], meta, code), [], code);
    assert.equal(translations[code].source, uiSource(meta), `${code}: translated from the current English (node tools/ui-texts.mjs stamp ${code})`);
    assert.deepEqual(canonicalUi(translations[code], meta, code), translations[code], `${code}: written in canonical order`);
    assert.ok(fs.existsSync(new URL(`data/landing/${code}.json`, ROOT)), `${code}: module, field and option texts in data/landing`);
  }
});

test('checkUi names what is wrong with a translation', () => {
  const ru = structuredClone(translations.ru);
  ru.texts['lang.loading'] = 'Загружаем слова…';
  ru.texts['head.draftHelp1'] = STRINGS['head.draftHelp1'];
  ru.texts['step.learn'] = 'Я <b>изучаю</b>';
  ru.texts['no.such'] = 'лишний';
  delete ru.texts['step.know'];
  delete ru.plural.word.few;
  ru.fields.word.help = '';
  assert.deepEqual(checkUi(ru, meta, 'ru').sort(), [
    'fields.word.help: missing',
    'plural.word.few: missing, or not exactly one {n}',
    'texts.head.draftHelp1: still in English',
    'texts.lang.loading: placeholders {} instead of {language}',
    'texts.no.such: not an English text',
    'texts.step.know: missing',
    'texts.step.learn: contains < or >; write plain text',
  ]);
  const ja = structuredClone(translations.ja);
  ja.texts['preview.another'] = '別の単語(次)';
  assert.deepEqual(checkUi(ja, meta, 'ja'), ['texts.preview.another: ASCII punctuation; use full-width ，：；！？（）']);
  assert.deepEqual(Object.keys(englishUi(meta).fields), ['word', 'translation']);
});

test('the page loads the same texts from the bundle as from the source files', async () => {
  const ui = { texts: { 'step.learn': 'Учу' }, plural: {}, fields: {} };
  const landing = landingOf('ru');
  /** @type {Record<string, any>} */
  const source = { 'data/ui/ru.json': ui, 'data/landing/ru.json': landing, 'data/meta/version.json': null };
  const bundled = { 'data/meta/version.json': { data: 'v' }, 'bundles/v/meta.json': meta, 'bundles/v/ui-ru.json': uiBundle(ui, landing) };
  const fromSource = createLoader({ fetchJson: async (p) => source[p] ?? null });
  const fromBundle = createLoader({ fetchJson: async (p) => /** @type {any} */ (bundled)[p] ?? null });
  const [a, b] = [await fromSource.getUiTexts('ru'), await fromBundle.getUiTexts('ru')];
  for (const translation of [a, b]) {
    useLanguage('ru', { tag: 'ru-RU', locale: 'ru-RU' }, translation);
    assert.equal(t('step.learn'), 'Учу');
    assert.equal(languageName('de', 'German'), 'Немецкий');
  }
  use('en');
  assert.deepEqual(Object.keys(/** @type {any} */ (b).landing).sort(), ['categories', 'fields', 'languages', 'modules', 'options'], 'the bundle leaves out the landing pages’ own texts');

  // Offline: a failed load is not kept, so choosing the language again tries again.
  let online = false;
  const flaky = createLoader({ fetchJson: async (p) => (online ? (source[p] ?? null) : null) });
  assert.equal((await flaky.getUiTexts('ru')).ui, null);
  online = true;
  assert.deepEqual((await flaky.getUiTexts('ru')).ui, ui);
});

test('the page’s address carries the config and the interface language', async () => {
  const app = createApp({ loader: fixtureLoader(), meta, initial: validate({}, meta) });
  assert.equal(app.address('https://example.test/ankigen/'), 'https://example.test/ankigen/?lang=en', 'no config yet: no hash');
  app.update(() => ({ learn: 'ja', know: 'ru' }));
  use('ru');
  try {
    assert.equal(app.address('https://example.test/ankigen/?lang=de#old'), 'https://example.test/ankigen/?lang=ru#v1&l=ja&k=ru&x=2');
    assert.equal(app.address('http://localhost/?data=tests%2Ffixtures%2Fdata'), 'http://localhost/?data=tests%2Ffixtures%2Fdata&lang=ru#v1&l=ja&k=ru&x=2', 'other parameters stay');
  } finally {
    use('en');
  }
  await app.settled();
});
