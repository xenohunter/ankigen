// The languages added in November 2026 (SPEC §1): what their cards show, on a few entries written here for the
// golden sample's concepts (the sample itself covers en, ru, ja, de, sr). The staged languages are made active in
// a copy of the meta, as their activation will do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck } from '../src/deck/deck.js';
import { deckContext } from '../src/deck/fields.js';
import { createSearch } from '../src/deck/search.js';
import { validate } from '../src/state.js';
import { fixtureInput } from './helpers/fixtures.mjs';

const base = await fixtureInput({ learn: 'de', know: 'en' });
const meta = { ...base.meta, languages: { ...base.meta.languages, active: [...base.meta.languages.active, ...base.meta.languages.staged] } };
const fixture = { de: base.learnData, en: base.knowData };

/** @param {Record<string, any>} entries @param {Record<string, any[]>} [ex] */
const language = (entries, ex = {}) => ({ lang: new Map(Object.entries(entries)), ex: new Map(Object.entries(ex)), ipa: new Map(), etym: new Map() });

const ar = language(
  {
    'word-water': { w: 'مَاء', g: 'm', rom: 'māʾ', forms: { pl: 'مِيَاه' }, def: 'سائل شفاف تتكون منه البحار والأنهار.' },
    'word-eat': { w: 'أَكَلَ', rom: 'akala', forms: { pres: 'يَأْكُلُ', vn: 'أَكْل' }, def: 'تناول الطعام.' },
  },
  { 'word-water': [{ t: 'شربت {الْمَاءَ} البارد.' }] },
);
const uk = language({ 'word-water': { w: 'вода́', g: 'f', forms: { gen: 'води́', pl: 'во́ди' }, def: 'Прозора рідина.' } });
const sv = language({
  'word-water': { w: 'vatten', g: 'n', forms: { def: 'vattnet' }, def: 'En genomskinlig vätska.' },
  'word-hand': { w: 'händer', g: 'pl', def: 'Kroppsdelar.' },
});
const vi = language({
  'word-water': { w: 'nước', def: 'Chất lỏng trong suốt.' },
  'word-hand': { w: 'tay', mw: 'bàn', def: 'Bộ phận của cơ thể.' },
  'word-drink': { w: 'đồ uống', def: 'Thứ để uống.' },
});
const it = language({ 'word-water': { w: 'acqua', g: 'f', art: "l'", def: 'Liquido trasparente.' } });
const el = language({ 'word-water': { w: 'νερό', g: 'n', forms: { gen: 'νερού', pl: 'νερά' }, def: 'Διάφανο υγρό.' } });
const data = /** @type {Record<string, any>} */ ({ ...fixture, ar, uk, sv, vi, it, el });

/** @param {Record<string, any>} partial */
function deck(partial) {
  const config = validate({ modules: ['core-1', 'food', 'family', 'health', 'time', 'phrases'], ...partial }, meta);
  const input = { meta, concepts: base.concepts, config, learnData: data[partial.learn], knowData: data[partial.know === '=' ? partial.learn : partial.know], audio: null, css: '' };
  return { ...input, ...buildDeck(input) };
}

/** @param {ReturnType<typeof deck>} d @param {string} id */
const fieldsOf = (d, id) => {
  const note = d.notes.find((n) => n.conceptIds.includes(id));
  assert.ok(note, `${id} in the deck`);
  return note.fields;
};

test('Arabic: vowel marks on by default, the row hides them, and the typed answer never needs them', () => {
  const on = fieldsOf(deck({ learn: 'ar', know: 'en' }), 'word-water');
  assert.equal(on.Word, 'مَاء <span class="g" lang="en-US" dir="ltr">m.</span>');
  assert.equal(on.Romanization, 'māʾ');
  assert.match(on.Forms, /مِيَاه/);
  assert.match(on.Examples, /<b class="t">الْمَاءَ<\/b>/);
  const off = fieldsOf(deck({ learn: 'ar', know: 'en', fields: { vowels: 'off' } }), 'word-water');
  assert.equal(off.Word, 'ماء <span class="g" lang="en-US" dir="ltr">m.</span>');
  assert.match(off.Forms, /مياه/);
  assert.match(off.Examples, /<b class="t">الماء<\/b>/);
  assert.equal(fieldsOf(deck({ learn: 'ar', know: 'en', reverse: true, type: true }), 'word-water').TypeTarget, 'ماء');
  assert.equal(fieldsOf(deck({ learn: 'de', know: 'ar' }), 'word-water').Translation, 'ماء', 'Arabic speakers read their own language without the marks');
});

test('a deck with a right-to-left language marks the direction of every block; others stay as they were', () => {
  const [forward] = deck({ learn: 'ar', know: 'en' }).noteType.templates;
  assert.match(forward.qfmt, /<div class="word" lang="ar" dir="rtl" data-field="Word">/);
  assert.match(forward.afmt, /<div class="translation" lang="en-US" dir="ltr" data-field="Translation">/);
  assert.match(forward.afmt, /<div class="cap" lang="en-US" dir="ltr">/);
  const typed = deck({ learn: 'ar', know: 'en', reverse: true, type: true }).noteType.templates[1];
  assert.match(typed.qfmt, /<div class="typeans" lang="ar" dir="rtl">\{\{type:TypeTarget\}\}<\/div>/);
  assert.match(deck({ learn: 'de', know: 'ar' }).noteType.templates[0].qfmt, /<div class="word" lang="de-DE" dir="ltr"/);
  for (const t of deck({ learn: 'de', know: 'en', reverse: true, type: true }).noteType.templates) {
    assert.doesNotMatch(t.qfmt + t.afmt, / dir="/, 'no direction marks without a right-to-left language');
  }
});

test('Ukrainian: stress marks as in Russian, on the learned side only, and its national romanization', () => {
  assert.equal(fieldsOf(deck({ learn: 'uk', know: 'en' }), 'word-water').Word, 'вода́ <span class="g" lang="en-US">f.</span>');
  assert.equal(fieldsOf(deck({ learn: 'uk', know: 'en', fields: { stress: 'off' } }), 'word-water').Word, 'вода <span class="g" lang="en-US">f.</span>');
  assert.equal(fieldsOf(deck({ learn: 'uk', know: 'en', reverse: true, type: true }), 'word-water').TypeTarget, 'вода');
  assert.equal(fieldsOf(deck({ learn: 'uk', know: 'en' }), 'word-water').Romanization, '', 'off by default, as in Russian');
  assert.equal(fieldsOf(deck({ learn: 'uk', know: 'en', fields: { romanization: 'back' } }), 'word-water').Romanization, 'vodá');
  assert.equal(fieldsOf(deck({ learn: 'de', know: 'uk' }), 'word-water').Translation, 'вода');
});

test('Swedish: en/ett with the word and in the typed answer; a plural noun shows its mark', () => {
  assert.equal(fieldsOf(deck({ learn: 'sv', know: 'en' }), 'word-water').Word, '<span class="art">ett</span> vatten');
  assert.equal(fieldsOf(deck({ learn: 'sv', know: 'en', reverse: true, type: true }), 'word-water').TypeTarget, 'ett vatten');
  assert.equal(fieldsOf(deck({ learn: 'sv', know: 'en' }), 'word-hand').Word, 'händer <span class="g" lang="en-US">pl. only</span>');
  assert.match(fieldsOf(deck({ learn: 'sv', know: 'en' }), 'word-water').Forms, /def\.<\/span> vattnet/);
});

test('Italian: the elided article joins its word', () => {
  assert.equal(fieldsOf(deck({ learn: 'it', know: 'en' }), 'word-water').Word, "<span class=\"art\">l'</span>acqua");
});

test('Vietnamese: classifiers under their own caption; search finds đ typed as d', () => {
  const d = deck({ learn: 'vi', know: 'en' });
  assert.equal(fieldsOf(d, 'word-hand').MeasureWord, 'bàn');
  assert.match(d.noteType.templates[0].afmt, /<div class="cap">Classifier<\/div><div class="val" lang="vi-VN" data-field="MeasureWord">/);
  const search = createSearch(d.notes, deckContext(d));
  for (const query of ['do uong', 'đồ uống', 'Do']) assert.ok(search.filter(query).some((n) => n.conceptIds.includes('word-drink')), query);
});

test('the typed answer keeps a language’s accents: only Russian and Ukrainian stress marks go', () => {
  assert.equal(fieldsOf(deck({ learn: 'el', know: 'en', reverse: true, type: true }), 'word-water').TypeTarget, 'νερό');
});
