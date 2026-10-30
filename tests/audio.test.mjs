// Pronunciation audio: voice resolution, what is said, the cache, the speech check, the site's packs and their
// fetching, and how decks, templates, the preview and the .apkg carry the clips (tests/fixtures/data/audio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { strFromU8, unzipSync } from '../vendor/fflate.js';
import {
  audioPacks, clipKey, currentClips, defaultRules, frameGains, hasSpeech, numberedPinyin, pickVoice, planClips,
  resolveReason, settingProblems, speechInputs,
} from '../tools/lib/audio.mjs';
import { audioIndex, deckClips, fetchClips, planRequests } from '../src/data/clips.js';
import { buildApkg, mediaNames } from '../src/deck/apkg.js';
import { apkgFileName } from '../src/deck/names.js';
import { renderCard, renderTemplate } from '../src/deck/render.js';
import { loadSqlJs } from '../tools/lib/sqljs.mjs';
import { fixtureDeck, fixtureMedia } from './helpers/fixtures.mjs';
import { loadMeta } from './helpers/meta.mjs';

const REPO = new URL('..', import.meta.url);
const meta = loadMeta();
const NOW = 1_792_300_000_000;

// ---------------------------------------------------------------- voices

/** @param {string} name @param {string} [gender] */
const voice = (name, gender = 'FEMALE') => ({ name, languageCodes: [name.split('-').slice(0, 2).join('-')], ssmlGender: gender });

test('voices: exact locale only, best tier first, the preferred voice, else a female one', () => {
  const voices = [
    voice('pt-BR-Chirp3-HD-Kore'), voice('pt-PT-Standard-A'), voice('pt-PT-Wavenet-B', 'MALE'), voice('pt-PT-Wavenet-E'),
    voice('de-DE-Wavenet-A'), voice('de-DE-Neural2-C'), voice('de-DE-Chirp3-HD-Aoede'), voice('de-DE-Chirp3-HD-Kore'),
    voice('fr-FR-Neural2-B', 'MALE'), voice('fr-FR-Neural2-A'),
  ];
  assert.deepEqual(pickVoice(voices, 'pt-PT'), { voice: 'pt-PT-Wavenet-E', tier: 'wavenet' }, 'never pt-BR, never a Standard voice');
  assert.deepEqual(pickVoice(voices, 'de-DE'), { voice: 'de-DE-Chirp3-HD-Kore', tier: 'chirp3-hd' });
  assert.deepEqual(pickVoice(voices, 'fr-FR'), { voice: 'fr-FR-Neural2-A', tier: 'neural2' });
  assert.equal(pickVoice(voices, 'hy-AM'), null, 'no voice of a usable tier: no audio');
  assert.equal(pickVoice([voice('hy-AM-Standard-A')], 'hy-AM'), null);
});

test('voices are resolved for new languages, checked again while unsupported, and again when the locale changes', () => {
  assert.equal(resolveReason(undefined, 'de-DE'), 'new');
  assert.equal(resolveReason({ locale: 'hy-AM', unsupported: true }, 'hy-AM'), 'unsupported');
  assert.equal(resolveReason({ locale: 'pt-BR', voice: 'pt-BR-Chirp3-HD-Kore' }, 'pt-PT'), 'locale');
  assert.equal(resolveReason({ locale: 'de-DE', voice: 'de-DE-Chirp3-HD-Leda' }, 'de-DE'), null, 'a hand-picked voice stays');
  assert.equal(resolveReason(undefined, undefined), null, 'no TTS locale: nothing to resolve');
  assert.deepEqual(settingProblems({ locale: 'de-DE', voice: 'de-DE-Chirp3-HD-Kore', tier: 'chirp3-hd', format: 'mp3', text: { article: true } }), []);
  assert.deepEqual(settingProblems({ locale: 'hy-AM', unsupported: true }), []);
  assert.deepEqual(settingProblems({ locale: 'de-DE', voice: 'fr-FR-Neural2-A', tier: 'best', format: 'ogg', text: { loud: 1 } }), [
    'voice must be a Google voice of de-DE', 'tier must be one of chirp3-hd, neural2, wavenet', 'format must be "mp3"', 'unknown text rule "loud"',
  ]);
});

test('every active language has a TTS locale, and the rules start from the registry', () => {
  const languages = meta.languages.languages;
  for (const code of meta.languages.active) assert.match(languages[code].tts, /^[a-z]{2,3}-[A-Z]{2}$/, code);
  assert.equal(languages.zh.tts, 'cmn-CN');
  const rules = (/** @type {string} */ code) => defaultRules(languages[code], meta.fields, code);
  assert.deepEqual(rules('de'), { article: true });
  assert.deepEqual(rules('fr'), { article: true });
  assert.deepEqual(rules('ru'), { stress: false });
  assert.deepEqual(rules('pl'), {}, 'a gender marker is a caption, not something to say');
  assert.deepEqual(rules('ja'), { homographs: 'reading' });
  assert.deepEqual(rules('zh'), { homographs: 'pinyin' });
  assert.deepEqual(rules('en'), {});
});

// ---------------------------------------------------------------- what is said

test('the word as the card shows it with default settings: articles, stress, scripts, homographs', () => {
  const say = (/** @type {string} */ code, /** @type {Record<string, any>} */ entries, /** @type {Record<string, any>} */ rules) =>
    Object.fromEntries(speechInputs(new Map(Object.entries(entries)), meta.languages.languages[code], rules));
  assert.deepEqual(say('de', { a: { w: 'Wasser', g: 'n' }, b: { w: 'essen' }, c: { w: 'Ferien', g: 'pl' } }, { article: true }), {
    a: 'das Wasser', b: 'essen', c: 'die Ferien',
  });
  assert.deepEqual(say('fr', { a: { w: 'eau', g: 'f', art: "l'" }, b: { w: 'collègue', g: 'mf' } }, { article: true }), {
    a: "l'eau", b: 'le collègue, la collègue',
  }, "elision without a space; a noun of either gender gets both articles");
  assert.deepEqual(say('de', { a: { w: 'Wasser', g: 'n' } }, {}), { a: 'Wasser' }, 'no article rule, no article');
  assert.deepEqual(say('ru', { a: { w: 'вода́', g: 'f' } }, { stress: false }), { a: 'вода' });
  assert.deepEqual(say('ru', { a: { w: 'вода́', g: 'f' } }, { stress: true }), { a: 'вода́' });
  assert.deepEqual(say('sr', { a: { w: 'вода', g: 'f' } }, {}), { a: 'вода' }, 'Serbian is said in the stored Cyrillic');
  assert.deepEqual(say('pl', { a: { w: 'Pan/Pani' } }, {}), { a: 'Pan, Pani' });
  assert.deepEqual(say('tr', { a: { w: '-den/-dan' } }, {}), { a: 'den, dan' });
  assert.deepEqual(
    say('ja', { a: { w: '角', read: 'かど' }, b: { w: '角', read: 'つの' }, c: { w: '水', read: 'みず' } }, { homographs: 'reading' }),
    { a: 'かど', b: 'つの', c: '水' },
    'the reading only where another entry spells the word the same with another reading',
  );
  assert.deepEqual(say('zh', { a: { w: '还', read: 'hái' }, b: { w: '还', read: 'huán' }, c: { w: '水', read: 'shuǐ' } }, { homographs: 'pinyin' }), {
    a: '<speak><phoneme alphabet="pinyin" ph="hai2">还</phoneme></speak>',
    b: '<speak><phoneme alphabet="pinyin" ph="huan2">还</phoneme></speak>',
    c: '水',
  });
});

test('pinyin with tone marks becomes Google’s tone numbers, one syllable per character', () => {
  assert.equal(numberedPinyin('cháoyáng', '朝阳'), 'chao2 yang2');
  assert.equal(numberedPinyin('xī’ān', '西安'), 'xi1 an1', 'the apostrophe splits');
  assert.equal(numberedPinyin('nǚ', '女'), 'nü3');
  assert.equal(numberedPinyin('yìdiǎnr', '一点儿'), 'yi4 dian3 r5', 'erhua; 5 is the neutral tone');
  assert.equal(numberedPinyin('xù', 'T恤'), null, 'not all characters: sent as written');
});

// ---------------------------------------------------------------- the cache

test('cache: a clip is kept while its text, locale, voice and format stay; identical texts share one clip', () => {
  const setting = { locale: 'de-DE', voice: 'de-DE-Chirp3-HD-Kore', format: 'mp3' };
  const m = (/** @type {string} */ file, /** @type {string} */ text, v = setting.voice) => ({ file, text, voice: v, bytes: 10 });
  const manifest = {
    a: m('aaaa.mp3', 'das Wasser'),
    b: m('bbbb.mp3', 'essen'),
    c: m('cccc.mp3', 'trinken', 'de-DE-Chirp3-HD-Leda'),
    gone: m('dddd.mp3', 'weg'),
    lost: m('eeee.mp3', 'groß'),
  };
  const has = (/** @type {string} */ file) => file !== 'eeee.mp3';
  const inputs = new Map([['a', 'das Wasser'], ['a2', 'das Wasser'], ['b', 'essen!'], ['c', 'trinken'], ['lost', 'groß'], ['new1', 'klein'], ['new2', 'klein']]);
  const plan = planClips({ inputs, setting, manifest, has });
  assert.deepEqual(plan.manifest.a, manifest.a, 'unchanged');
  assert.deepEqual(plan.manifest.a2, { ...manifest.a }, 'the same text shares the clip');
  assert.equal(plan.manifest.gone, undefined, 'a concept without a word drops out');
  assert.deepEqual([...plan.todo], [['essen!', ['b']], ['trinken', ['c']], ['groß', ['lost']], ['klein', ['new1', 'new2']]]);
  assert.deepEqual(plan.manifest.c, manifest.c, 'another voice: made again, kept meanwhile');
  assert.equal(plan.manifest.lost, undefined, 'its file is missing');
  assert.notEqual(clipKey('x', 'de-DE', 'v', 'mp3'), clipKey('x', 'de-AT', 'v', 'mp3'));
  assert.notEqual(clipKey('x', 'de-DE', 'v', 'mp3'), clipKey('x', 'de-DE', 'v', 'ogg'));
  // The site serves only clips of the current text, whatever the voice.
  assert.deepEqual([...currentClips({ inputs, manifest: plan.manifest, has }).keys()], ['a', 'a2', 'c']);
});

// ---------------------------------------------------------------- the speech check

/**
 * MPEG-2 Layer III frames (24 kHz, 32 kbps, mono), each with this global gain; data = 0 makes a padding frame.
 * @param {[number, number][]} frames [global gain, audio data in bits]
 */
function mp3(frames) {
  const out = new Uint8Array(96 * frames.length);
  frames.forEach(([gain, data], i) => {
    const f = out.subarray(i * 96, (i + 1) * 96);
    f.set([0xff, 0xf3, 0x44, 0xc0]);
    /** @param {number} at first bit @param {number} n @param {number} v */
    const put = (at, n, v) => {
      for (let k = 0; k < n; k++) if ((v >> (n - 1 - k)) & 1) f[(at + k) >> 3] |= 0x80 >> ((at + k) & 7);
    };
    put(32 + 9, 12, data); // part2_3_length, after main_data_begin and the private bit
    put(32 + 9 + 12 + 9, 8, gain);
  });
  return out;
}

test('speech check: near-silence from Chirp 3 HD is caught from the frames, without decoding', () => {
  assert.deepEqual(frameGains(mp3([[140, 600], [150, 600], [210, 0]])), [140, 150], 'padding frames carry no data');
  assert.equal(hasSpeech(mp3([[150, 650], [160, 650], [155, 650], [210, 0], [210, 0]])), false);
  assert.equal(hasSpeech(mp3([[150, 650], [175, 900], [160, 650]])), true, 'a loud frame');
  assert.equal(hasSpeech(mp3([[166, 700], [167, 800], [150, 650]])), true, 'two frames at 166 or more');
  assert.equal(hasSpeech(mp3([[166, 700], [150, 650]])), false, 'one is not enough');
  // Every clip of the golden sample is real Chirp 3 HD speech.
  const dir = new URL('fixtures/data/audio/', import.meta.url);
  for (const code of fs.readdirSync(dir)) {
    for (const file of fs.readdirSync(new URL(`${code}/`, dir)).filter((f) => f.endsWith('.mp3'))) {
      assert.ok(hasSpeech(new Uint8Array(fs.readFileSync(new URL(`${code}/${file}`, dir)))), `${code}/${file}`);
    }
  }
});

// ---------------------------------------------------------------- packs and fetching

test('packs: each clip once, by the primary module of its first use, content-hashed; same clips, same bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-audio-'));
  try {
    const clip = (/** @type {string} */ name, /** @type {number} */ n) => (fs.writeFileSync(path.join(dir, name), new Uint8Array(n).fill(n)), name);
    const manifest = {
      w1: { file: clip('1111111111111111.mp3', 5), text: 'eins', voice: 'x' },
      w2: { file: clip('2222222222222222.mp3', 7), text: 'zwei', voice: 'x' },
      w3: { file: '1111111111111111.mp3', text: 'eins', voice: 'x' },
      w4: { file: clip('4444444444444444.mp3', 3), text: 'alt', voice: 'x' },
    };
    const la = {
      code: 'de', dir, manifest,
      inputs: new Map([['w1', 'eins'], ['w2', 'zwei'], ['w3', 'eins'], ['w4', 'neu']]),
      has: (/** @type {string} */ f) => fs.existsSync(path.join(dir, f)),
    };
    const primary = { w1: 'core-1', w2: 'food', w3: 'food', w4: 'food' };
    const packs = /** @type {NonNullable<ReturnType<typeof audioPacks>>} */ (audioPacks(/** @type {any} */ (la), (id) => /** @type {any} */ (primary)[id]));
    assert.equal(packs.clips, 2, 'w4 says an older text: left out');
    const index = JSON.parse(/** @type {string} */ (packs.files[packs.index]));
    assert.match(packs.index, /^audio\/de\/index\.[0-9a-f]{16}\.json$/);
    assert.deepEqual(index.packs.map((/** @type {any[]} */ p) => p[0].replace(/[0-9a-f]{16}/, 'H')), ['audio/de/core-1.H.mp3', 'audio/de/food.H.mp3']);
    assert.deepEqual(index.clips, { w1: '1111111111111111', w2: '2222222222222222', w3: '1111111111111111' });
    const loaded = audioIndex({ index });
    for (const [hash, s] of loaded.files) {
      const pack = /** @type {Uint8Array} */ (packs.files[s.url]);
      assert.deepEqual(pack.subarray(s.offset, s.offset + s.length), new Uint8Array(fs.readFileSync(path.join(dir, `${hash}.mp3`))));
      assert.equal(s.size, pack.length);
    }
    assert.deepEqual(audioPacks(/** @type {any} */ (la), (id) => /** @type {any} */ (primary)[id]), packs);
    assert.deepEqual(deckClips([{ conceptIds: ['w1', 'w3'] }, { conceptIds: ['w2'] }, { conceptIds: ['w4'] }], loaded), { clips: 2, bytes: 12 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetching clips: byte ranges where a deck needs little of a pack, the whole pack otherwise; a server without ranges works too', async () => {
  const pack = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
  const at = (/** @type {number} */ offset, length = 1000) => ({ url: 'p.mp3', offset, length, size: pack.length });
  const few = new Map([['a', at(0)], ['b', at(5000)], ['c', at(60_000)]]);
  assert.deepEqual(planRequests(few).map((r) => [r.start, r.end]), [[0, 6000], [60_000, 61_000]], 'near clips share a request');
  const most = new Map(Array.from({ length: 70 }, (_, i) => [`k${i}`, at(i * 1000)]));
  assert.deepEqual(planRequests(most).map((r) => [r.start, r.end]), [[0, 100_000]], 'most of the pack: all of it');
  assert.deepEqual(planRequests(new Map([['x', { url: 'data/audio/de/x.mp3', offset: 0, length: 9, size: 9 }]]))[0].start, 0);

  /** @param {boolean} ranges */
  const server = (ranges) => {
    /** @type {string[]} */
    const asked = [];
    /** @param {string} url @param {RequestInit} [init] */
    const get = async (url, init) => {
      const range = /** @type {any} */ (init?.headers)?.Range;
      asked.push(range ?? 'all');
      const m = ranges && range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
      if (!m) return new Response(pack, { status: 200 });
      return new Response(pack.slice(Number(m[1]), Number(m[2]) + 1), { status: 206, headers: { 'content-range': `bytes ${m[1]}-${m[2]}/${pack.length}` } });
    };
    return { get, asked };
  };
  for (const ranges of [true, false]) {
    const { get, asked } = server(ranges);
    /** @type {number[]} */
    const progress = [];
    const clips = await fetchClips(few, { fetch: get, onProgress: (got, total) => progress.push(got / total) });
    for (const [hash, s] of few) assert.deepEqual(clips.get(hash), pack.slice(s.offset, s.offset + s.length), `${hash}, ranges ${ranges}`);
    assert.equal(progress.at(-1), 1);
    assert.deepEqual(asked, ranges ? ['bytes=0-5999', 'bytes=60000-60999'] : ['bytes=0-5999'], 'without ranges the whole pack comes once');
  }
});

// ---------------------------------------------------------------- decks, templates, preview, .apkg

/** Field tags used by a template (section tags excluded). @param {string} tpl */
const fieldsIn = (tpl) => [...tpl.matchAll(/\{\{([^#^/}][^}]*)\}\}/g)].map((m) => m[1]);

test('the Audio field: the word’s clip with audio on, empty otherwise; merged notes share one clip', async () => {
  const on = await fixtureDeck({ learn: 'ru', know: 'en', modules: ['core-1'], audio: true });
  const hand = on.notes.find((n) => n.key === 'word-hand');
  assert.deepEqual(hand?.conceptIds, ['word-hand', 'word-arm']);
  assert.equal(hand?.fields.Audio, '[sound:ankigen-ru-93c430ed9faa5bef.mp3]');
  assert.ok(on.notes.every((n) => /^\[sound:ankigen-ru-[0-9a-f]{16}\.mp3\]$/.test(n.fields.Audio)));
  const off = await fixtureDeck({ learn: 'ru', know: 'en', modules: ['core-1'] });
  assert.ok(off.notes.every((n) => n.fields.Audio === ''));
  assert.ok(!/Audio/.test(off.noteType.templates.map((t) => t.qfmt + t.afmt).join('')), 'no audio, no Audio section');
});

test('templates: the clip plays on the forward question and the reverse answer only', async () => {
  const { noteType } = await fixtureDeck({ learn: 'de', know: 'en', reverse: true, type: true, audio: true });
  const [fwd, rev] = noteType.templates;
  assert.ok(fieldsIn(fwd.qfmt).includes('Audio'), 'forward question');
  assert.ok(!fieldsIn(fwd.afmt).includes('Audio'), 'the forward answer does not play it again');
  assert.ok(!fieldsIn(rev.qfmt).includes('Audio'), 'never on the reverse question');
  assert.ok(fieldsIn(rev.afmt.split('<hr id=answer>')[1]).includes('Audio'), 'reverse answer');
  assert.ok(!fieldsIn(rev.afmt.split('<hr id=answer>')[0]).includes('Audio'));
});

test('preview: [sound:…] is a play button where the page draws one, and text in Anki’s own rendering', async () => {
  const deck = await fixtureDeck({ learn: 'de', know: 'en', reverse: true, audio: true });
  const note = deck.notes[0];
  const sound = (/** @type {string} */ name) => `<button class="ag-play" data-name="${name}"></button>`;
  const fwd = renderCard(deck.noteType, note.fields, 0, { sound });
  const rev = renderCard(deck.noteType, note.fields, 1, { sound });
  const button = `<button class="ag-play" data-name="${note.fields.Audio.slice(7, -1)}"></button>`;
  assert.ok(fwd?.front.includes(button) && !fwd.back.includes('ag-play'));
  assert.ok(rev?.back.includes(button) && !rev.front.includes('ag-play'));
  assert.match(renderTemplate('{{Audio}}', note.fields), /^\[sound:ankigen-de-[0-9a-f]{16}\.mp3\]$/);
});

test('.apkg: the clips as zip entries 0, 1, … and the media map, in order of first use; byte-identical with a fixed clock', async () => {
  const deck = await fixtureDeck({ learn: 'ru', know: 'en', audio: true });
  const SQL = await loadSqlJs();
  const media = fixtureMedia(deck);
  const bytes = await buildApkg({ SQL, config: deck.config, meta: deck.meta, deck, media, now: NOW });
  const files = unzipSync(bytes);
  const names = mediaNames(deck.notes);
  assert.equal(names.length, new Set(deck.notes.map((n) => n.fields.Audio)).size, 'one entry per clip');
  assert.deepEqual(JSON.parse(strFromU8(files.media)), Object.fromEntries(names.map((name, i) => [String(i), name])));
  names.forEach((name, i) => assert.deepEqual(files[i], media.get(name), name));
  const reversed = new Map([...media].reverse());
  assert.deepEqual(await buildApkg({ SQL, config: deck.config, meta: deck.meta, deck, media: reversed, now: NOW }), bytes, 'the order comes from the notes');
  await assert.rejects(buildApkg({ SQL, config: deck.config, meta: deck.meta, deck, media: new Map(), now: NOW }), /no audio for ankigen-ru-/);
});

test('tools/apkg.mjs reads the clips from data/audio and writes the same package as buildApkg', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-apkg-'));
  try {
    const args = ['tools/apkg.mjs', '#v1&l=ja&k=de&m=core-1,residence&r=1&a=1', '--data', 'tests/fixtures/data', '--out', out, '--now', String(NOW)];
    assert.match(execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' }), /14 notes, 28 cards, 14 clips/);
    const deck = await fixtureDeck({ learn: 'ja', know: 'de', modules: ['core-1', 'residence'], reverse: true, audio: true });
    const expected = await buildApkg({ SQL: await loadSqlJs(), config: deck.config, meta: deck.meta, deck, media: fixtureMedia(deck), now: NOW });
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(out, apkgFileName(deck.config, deck.meta)))), expected);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
