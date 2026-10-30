import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConfig, validate, encodeHash, decodeHash, loadConfig, saveConfig, createStore, placementOf, withPlacement,
  typesAnswer, hasAudio, usesAudio, SAME, STORAGE_KEY,
} from '../src/state.js';
import { loadMeta } from './helpers/meta.mjs';

const meta = loadMeta();

/** In-memory Storage stand-in. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (/** @type {string} */ k) => data.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => data.set(k, v), data };
}
const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
};

test('defaults come from fields.json', () => {
  assert.deepEqual(defaultConfig(meta), {
    v: 1, learn: null, know: null, modules: [], fields: {}, examples: 2, reverse: false, type: false, audio: false, srScript: 'cyrl',
  });
});

test('hash round trip', () => {
  const config = validate(
    { learn: 'ja', know: 'ru', modules: ['food', 'core-2', 'core-1'], fields: { reading: 'front', forms: 'off' }, examples: 3, reverse: true, type: true },
    meta,
  );
  const hash = encodeHash(config, meta);
  assert.equal(hash, '#v1&l=ja&k=ru&m=core-1,core-2,food&f=reading:f,forms:o&x=3&r=1&t=1');
  assert.deepEqual(decodeHash(hash, meta), config);
});

test('the ARCHITECTURE example decodes; re-encoding drops what does not apply', () => {
  const config = decodeHash('#v1&l=ja&k=ru&m=core-1,core-2,food&f=reading:f,ipa:o,forms:b&x=2&r=1&t=1&sr=c', meta);
  assert.ok(config);
  assert.equal(config.learn, 'ja');
  assert.deepEqual(config.modules, ['core-1', 'core-2', 'food']);
  assert.deepEqual(config.fields, { reading: 'front', ipa: 'off', forms: 'back' });
  assert.equal(typesAnswer(config), true);
  // ipa has no row for Japanese, forms:b is the default, Serbian is not involved
  assert.equal(encodeHash(config, meta), '#v1&l=ja&k=ru&m=core-1,core-2,food&f=reading:f&x=2&r=1&t=1');
});

test('invalid values fall back to defaults and keep the rest', () => {
  const config = decodeHash('#v1&l=xx&k=ru&m=core-1,nope&f=reading:z,word:b,ipa:f,bogus:b&x=9&r=yes&t=1&sr=q&zz=1', meta);
  assert.deepEqual(config, {
    v: 1, learn: null, know: 'ru', modules: ['core-1'], fields: { ipa: 'front' }, examples: 2, reverse: false, type: false, audio: false, srScript: 'cyrl',
  });
  assert.equal(decodeHash('#v1&l=ru&k=ru', meta)?.know, null, 'cannot speak the language you learn (use Same language)');
  assert.equal(decodeHash('#v1&l=ru&x=%E0%A4', meta)?.learn, 'ru', 'a malformed escape only drops its key');
});

test('same-language mode', () => {
  const config = decodeHash('#v1&l=ru&k==', meta);
  assert.equal(config?.know, SAME);
  assert.equal(encodeHash(/** @type {any} */ (config), meta), '#v1&l=ru&k==&x=2');
  assert.equal(decodeHash('#v1&l=ru&k=%3D', meta)?.know, SAME);
  assert.equal(placementOf(meta, /** @type {any} */ (config), 'exampleTranslations'), 'off');
});

test('Serbian script is written only when Serbian is involved', () => {
  const sr = decodeHash('#v1&l=en&k=sr&sr=l', meta);
  assert.equal(sr?.srScript, 'latn');
  assert.equal(encodeHash(/** @type {any} */ (sr), meta), '#v1&l=en&k=sr&x=2&sr=l');
  assert.equal(encodeHash(validate({ learn: 'ja', know: 'ru', srScript: 'latn' }, meta), meta), '#v1&l=ja&k=ru&x=2');
});

test('field placements: per-language defaults, rows that do not apply, overrides', () => {
  const ru = validate({ learn: 'ru', know: 'en' }, meta);
  const ja = validate({ learn: 'ja', know: 'en' }, meta);
  assert.equal(placementOf(meta, ru, 'romanization'), 'off');
  assert.equal(placementOf(meta, ja, 'romanization'), 'back');
  assert.equal(placementOf(meta, ru, 'reading'), 'off');
  assert.equal(placementOf(meta, ja, 'reading'), 'back');
  assert.equal(placementOf(meta, ru, 'stress'), 'on');
  assert.equal(placementOf(meta, ja, 'word'), 'front');

  const on = withPlacement(ru, meta, 'romanization', 'back');
  assert.deepEqual(on.fields, { romanization: 'back' });
  assert.equal(encodeHash(on, meta), '#v1&l=ru&k=en&f=romanization:b&x=2');
  assert.deepEqual(withPlacement(on, meta, 'romanization', 'off').fields, {}, 'choosing the default removes the override');
  assert.equal(withPlacement(ru, meta, 'word', 'back'), ru, 'fixed rows cannot move');
  assert.equal(withPlacement(ru, meta, 'gender', 'front'), ru, 'only the listed placements are allowed');
});

test('audio: a=1 only where the learned language has audio; the choice survives switching; anything else is off', () => {
  const voiced = { ...meta, audio: { de: { voice: 'de-DE-Chirp3-HD-Kore' }, hy: { locale: 'hy-AM', unsupported: true } } };
  const de = decodeHash('#v1&l=de&k=en&a=1', voiced);
  assert.equal(de?.audio, true);
  assert.equal(encodeHash(/** @type {any} */ (de), voiced), '#v1&l=de&k=en&x=2&a=1');
  const hy = validate({ ...de, learn: 'hy' }, voiced);
  assert.equal(hy.audio, true, 'kept while learning a language without audio');
  assert.equal(encodeHash(hy, voiced), '#v1&l=hy&k=en&x=2', 'but not written for it');
  assert.equal(encodeHash(validate({ ...hy, learn: 'de' }, voiced), voiced), '#v1&l=de&k=en&x=2&a=1', 'back where it has effect');
  assert.equal(encodeHash(validate({ learn: 'de', know: 'sr', audio: true }, voiced), voiced), '#v1&l=de&k=sr&x=2&a=1&sr=c');
  for (const bad of ['a=0', 'a=yes', 'a=2', 'a=', 'a=%31%31']) assert.equal(decodeHash(`#v1&l=de&k=en&${bad}`, voiced)?.audio, false, bad);
  assert.equal(validate({ learn: 'de', audio: 'true' }, voiced).audio, false);
  assert.equal(decodeHash('#v1&a=1', voiced)?.audio, true, 'a hash with only a is still a config');
  assert.deepEqual(['de', 'hy', 'fr', null].map((code) => hasAudio(voiced, code)), [true, false, false, false]);
  assert.equal(hasAudio({ ...meta, audio: undefined }, 'de'), false, 'no audio.json: no audio');
  assert.equal(usesAudio(voiced, validate({ learn: 'de', audio: false }, voiced)), false);
});

test('load: hash, then local storage, then defaults', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '#v1&l=de&k=en&x=1' });
  assert.equal(loadConfig({ hash: '#v1&l=ja&k=ru', storage }, meta).learn, 'ja');
  assert.equal(loadConfig({ hash: '', storage }, meta).learn, 'de');
  assert.equal(loadConfig({ hash: '#footer', storage }, meta).learn, 'de', 'a page anchor is not a config');
  assert.equal(loadConfig({ hash: '#v2&l=ja', storage }, meta).learn, 'de', 'another format version is ignored');
  assert.equal(loadConfig({ hash: '#l=ja', storage }, meta).learn, 'ja', 'the version tag is optional');
  assert.deepEqual(loadConfig({ hash: '', storage: memoryStorage({ [STORAGE_KEY]: 'garbage' }) }, meta), defaultConfig(meta));
  assert.deepEqual(loadConfig({ hash: '', storage: throwingStorage }, meta), defaultConfig(meta));
  assert.deepEqual(loadConfig({}, meta), defaultConfig(meta));
});

test('save: writes the hash; storage errors are swallowed', () => {
  const storage = memoryStorage();
  const config = validate({ learn: 'ja', know: 'ru', modules: ['core-1'] }, meta);
  saveConfig(storage, config, meta);
  assert.equal(storage.data.get(STORAGE_KEY), '#v1&l=ja&k=ru&m=core-1&x=2');
  assert.doesNotThrow(() => saveConfig(throwingStorage, config, meta));
  assert.doesNotThrow(() => saveConfig(null, config, meta));
});

test('store notifies subscribers on change', () => {
  const store = createStore(1);
  /** @type {number[]} */
  const seen = [];
  const off = store.subscribe((v) => seen.push(v));
  store.set(2);
  store.set((v) => v + 1);
  store.set(3); // unchanged: no notification
  off();
  store.set(4);
  assert.deepEqual(seen, [2, 3]);
  assert.equal(store.get(), 4);
});
