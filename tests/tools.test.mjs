import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fullWidthPunctuation, hasAsciiPunctuation, labelGroups, stringifyLabels, targetProblem } from '../tools/lib/data.mjs';
import { loadSqlJs } from '../tools/lib/sqljs.mjs';
import { buildApkg } from '../src/deck/apkg.js';
import { apkgFileName } from '../src/deck/names.js';
import { createLoader } from '../src/data/loader.js';
import { loadAudioIndex } from '../src/data/clips.js';
import { appMeta, englishTexts, landingSite, textsSource } from '../tools/landing.mjs';
import { parseOutput } from '../tools/gen/output.mjs';
import { fixtureDeck, fixtureLoader } from './helpers/fixtures.mjs';

const REPO = new URL('..', import.meta.url);
/** Run a tool from the repository root. @param {string[]} args */
const run = (args) => execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
/** A tool's exit code and output, also when it fails. @param {string[]} args */
function runStatus(args) {
  try {
    return { status: 0, stdout: run(args) };
  } catch (error) {
    const e = /** @type {any} */ (error);
    return { status: e.status, stdout: String(e.stdout) + String(e.stderr) };
  }
}

test('labels.json layout: one line per key group, languages in registry order', () => {
  const keys = ['section.forms', 'section.ipa', 'pos.noun', 'form.gen', 'form.pl', 'form.aspect', 'form.pp', 'form.class', 'value.aspect.pf', 'value.class.godan'];
  assert.deepEqual(labelGroups(keys), [
    ['section.forms', 'section.ipa'], ['pos.noun'], ['form.gen', 'form.pl'], ['form.aspect', 'form.pp'], ['form.class'], ['value.aspect.pf'], ['value.class.godan'],
  ]);
  const data = { $comment: 'c', keys: ['pos.noun', 'pos.verb', 'reg.formal'], labels: { ru: { 'pos.noun': 'сущ.' }, en: { 'pos.noun': 'noun', 'pos.verb': 'verb', 'reg.formal': 'formal', extra: 'x' }, xx: {} } };
  const text = stringifyLabels(data, ['en', 'ru']);
  assert.equal(
    text,
    [
      '{',
      '  "$comment": "c",',
      '  "keys": [',
      '    "pos.noun", "pos.verb",',
      '    "reg.formal"',
      '  ],',
      '  "labels": {',
      '    "en": {',
      '      "pos.noun": "noun", "pos.verb": "verb",',
      '      "reg.formal": "formal",',
      '      "extra": "x"',
      '    },',
      '    "ru": {',
      '      "pos.noun": "сущ."',
      '    },',
      '    "xx": {}',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  assert.deepEqual(JSON.parse(text), data, 'content is unchanged');
});

test('tools/apkg.mjs writes the same package as buildApkg for a config hash', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-apkg-'));
  try {
    const now = 1_792_300_000_000;
    const args = ['tools/apkg.mjs', '#v1&l=ru&k=en&m=core-1,time&r=1', '--data', 'tests/fixtures/data', '--out', out, '--now', String(now)];
    const stdout = execFileSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.match(stdout, /AnkiGen::Русский \(English\), 11 notes, 22 cards/);
    const deck = await fixtureDeck({ learn: 'ru', know: 'en', modules: ['core-1', 'time'], reverse: true });
    const file = path.join(out, apkgFileName(deck.config, deck.meta));
    const expected = await buildApkg({ SQL: await loadSqlJs(), config: deck.config, meta: deck.meta, deck, now });
    assert.deepEqual(new Uint8Array(fs.readFileSync(file)), expected);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('tools/bundle.mjs: the site serves the same data from its bundles as the source files do', async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-site-'));
  try {
    const stdout = run(['tools/bundle.mjs', '--site', site, '--data', 'tests/fixtures/data']);
    const version = JSON.parse(fs.readFileSync(new URL('data/meta/version.json', REPO), 'utf8')).data;
    assert.match(stdout, new RegExp(`data ${version.replace(/\./g, '\\.')}`));
    const bundles = fs.readdirSync(path.join(site, 'bundles', version)).sort();
    assert.deepEqual(bundles, ['concepts.json', 'de.json', 'en.json', 'ja.json', 'meta.json', 'ru.json', 'sr.json'], 'one bundle per language with data');
    for (const file of ['index.html', '404.html', 'og-image.png', 'favicon.svg', 'src/main.js', 'src/deck/apkg.js', 'vendor/sql-wasm.wasm', 'data/meta/version.json']) {
      assert.ok(fs.existsSync(path.join(site, file)), `the site has ${file}`);
    }
    for (const file of ['docs', 'tools', 'tests', 'feedback', '.env', 'package.json', 'CLAUDE.md', 'data/concepts', 'data/lang', 'data/audio']) {
      assert.ok(!fs.existsSync(path.join(site, file)), `the site leaves out ${file}`);
    }

    // The browser's loader, reading the site: it takes the bundles, and gets what the source files give.
    /** @type {string[]} */
    const fetched = [];
    const fromSite = createLoader({
      fetchJson: async (p) => {
        fetched.push(p);
        const file = path.join(site, p);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      },
      fetchText: async () => '',
    });
    const fromSource = fixtureLoader();
    const [siteMeta, sourceMeta] = [await fromSite.getMeta(), await fromSource.getMeta()];
    assert.deepEqual({ ...siteMeta, audio: null }, { ...sourceMeta, audio: null });

    // Audio: meta.json names the index of each language with clips; the packs give the very clips of data/audio.
    assert.deepEqual(Object.keys(siteMeta.audio), ['en', 'ru', 'sr', 'ja', 'de'], 'the fixture languages with clips, in registry order');
    for (const [code, a] of Object.entries(siteMeta.audio)) {
      assert.equal(a.voice, sourceMeta.audio[code].voice);
      assert.match(/** @type {string} */ (a.index), new RegExp(`^audio/${code}/index\\.[0-9a-f]{16}\\.json$`));
      const [packed, source] = [await loadAudioIndex(fromSite, siteMeta, code), await loadAudioIndex(fromSource, sourceMeta, code)];
      assert.deepEqual([...packed.clips], [...source.clips], `${code}: every word keeps its clip`);
      for (const [hash, file] of source.files) {
        const p = /** @type {import('../src/data/clips.js').ClipSource} */ (packed.files.get(hash));
        assert.match(p.url, new RegExp(`^audio/${code}/[a-z0-9-]+\\.[0-9a-f]{16}\\.mp3$`), 'content-hashed packs per module');
        assert.deepEqual(fs.readFileSync(path.join(site, p.url)).subarray(p.offset, p.offset + p.length), fs.readFileSync(new URL(file.url, REPO)), `${code} ${hash}`);
      }
    }
    assert.match(stdout, /audio\/: en \d+ clips [\d.]+ MB, ru /);
    assert.match(stdout, /site: [\d.]+ MB \(limit 900 MB\)/);
    const [bundled, source] = [await fromSite.getConcepts(), await fromSource.getConcepts()];
    assert.deepEqual(bundled.order, source.order);
    for (const [id, record] of source.byId) {
      const { note, ...concept } = record.c;
      assert.deepEqual(bundled.byId.get(id), { ...record, c: concept }, `${id}, without its author note`);
    }
    for (const code of ['en', 'ru', 'ja', 'de', 'sr', 'zh']) {
      assert.deepEqual(await fromSite.getLanguage(code), await fromSource.getLanguage(code), code);
    }
    assert.ok(fetched.includes(`bundles/${version}/concepts.json`) && !fetched.some((p) => p.startsWith('data/concepts')), 'read from the bundles');

    // The landing pages and the sitemap, made from the bundles: the ones the source files give.
    assert.match(stdout, /decks\/: 20 landing pages and the hub; sitemap\.xml/);
    for (const [name, text] of Object.entries(await landingSite(fromSource))) assert.equal(fs.readFileSync(path.join(site, name), 'utf8'), text, name);

    // Same data, same bytes (the audio packs too); and the next build replaces the site.
    const audioFiles = () => fs.readdirSync(path.join(site, 'audio'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile()).map((d) => [path.join(d.parentPath, d.name), fs.readFileSync(path.join(d.parentPath, d.name))]).sort();
    const before = [fs.readFileSync(path.join(site, 'bundles', version, 'en.json')), audioFiles()];
    run(['tools/bundle.mjs', '--site', site, '--data', 'tests/fixtures/data']);
    assert.deepEqual([fs.readFileSync(path.join(site, 'bundles', version, 'en.json')), audioFiles()], before);

    // The site must stay under the limit (900 MB: GitHub Pages allows 1 GB), or the build fails.
    const over = runStatus(['tools/bundle.mjs', '--site', site, '--data', 'tests/fixtures/data', '--limit-mb', '1']);
    assert.equal(over.status, 1);
    assert.match(over.stdout, /the site is \d+ MB, over the 1 MB limit/);
  } finally {
    fs.rmSync(site, { recursive: true, force: true });
  }
});

test('tools/bundle.mjs never replaces a directory it did not build', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-other-'));
  try {
    fs.writeFileSync(path.join(other, 'keep.txt'), 'mine');
    const refused = runStatus(['tools/bundle.mjs', '--site', other, '--data', 'tests/fixtures/data']);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /refusing to replace .*not built by tools\/bundle\.mjs/);
    assert.equal(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8'), 'mine');
    const root = runStatus(['tools/bundle.mjs', '--site', '.', '--data', 'tests/fixtures/data']);
    assert.equal(root.status, 1);
    assert.match(root.stdout, /refusing to replace .*contains the repository/);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test('Chinese and Japanese text takes full-width punctuation; lint finds ASCII marks and the fix converts them', () => {
  const cases = [
    ['把{水壶}放上,我来泡点茶。', '把{水壶}放上，我来泡点茶。'],
    ['你喜欢{吃饭}?', '你喜欢{吃饭}？'],
    ['ギブドド: ロシアの交通警察', 'ギブドド：ロシアの交通警察'],
    ['按 Ctrl+Enter(Mac 上按 ⌘+Enter),或者', '按 Ctrl+Enter（Mac 上按 ⌘+Enter），或者'],
    ['显示冠词(der Tisch、la mesa)。', '显示冠词（der Tisch、la mesa）。'],
    ['导入 Anki(File → Import)。', '导入 Anki（File → Import）。'],
  ];
  for (const [ascii, full] of cases) {
    assert.ok(hasAsciiPunctuation(ascii), ascii);
    assert.equal(fullWidthPunctuation(ascii), full);
    assert.ok(!hasAsciiPunctuation(full), full);
  }
  for (const fine of ['10:30', 'der Tisch, la mesa', 'Ctrl+Enter, 1,000', 'Bǎ shuǐhú fàng shàng, wǒ lái pào diǎn chá.']) {
    assert.ok(!hasAsciiPunctuation(fine), fine);
    assert.equal(fullWidthPunctuation(fine), fine);
  }
});

test('an example target shows the word: lint flags a target that is an alt, and a Chinese one without the word', () => {
  const { languages } = JSON.parse(fs.readFileSync(new URL('data/meta/languages.json', REPO), 'utf8'));
  /** @type {[string, string, any, any][]} language, sentence, entry, expected problem */
  const cases = [
    ['zh', '做三明治很{简单}。', { w: '容易', alt: ['简单'] }, { alt: '简单' }],
    ['zh', '这次考试很{容易}。', { w: '容易', alt: ['简单'] }, null],
    ['zh', '我每天早上都用{滴眼液}。', { w: '滴剂' }, { missing: true }],
    ['zh', '我昨天{洗了衣服}。', { w: '洗衣服' }, null], // a separable verb
    ['ru', 'Это моя́ {ма́ма}.', { w: 'мать', alt: ['ма́ма'] }, { alt: 'ма́ма' }],
    ['ru', 'Я позвони́л {ма́ме}.', { w: 'мать', alt: ['ма́ма'] }, { alt: 'ма́ма' }], // a form of the alt
    ['ru', 'Стака́н {воды́}, пожа́луйста.', { w: 'вода́', forms: { gen: 'воды́' } }, null],
    ['ru', 'Дай {мне} ключ.', { w: 'я' }, null], // suppletive forms are not flagged
    ['en', '{There are} many children in the park.', { w: 'there is', alt: ['there are'] }, { alt: 'there are' }],
    ['en', 'They visited the {Czech Republic}.', { w: 'the Czech Republic', alt: ['Czechia'] }, null], // the phrase reaches past the braces
    ['en', 'Many {Irish people} live in Boston.', { w: 'Irish person', alt: ['Irishman'] }, null],
    ['en', 'They {married} in May.', { w: 'marry', alt: ['get married to'] }, null],
    ['es', 'Su {marido} es médico.', { w: 'esposo', alt: ['marido'] }, { alt: 'marido' }],
    ['el', 'Το λεωφορείο {σταματά} εδώ.', { w: 'σταματώ', alt: ['σταματάω'] }, null], // a form of both
    ['tr', 'Sen {da} gel.', { w: 'de', alt: ['da'] }, { alt: 'da' }],
    ['ja', '卵[たまご]を{かき 混[ま]ぜて}ください。', { w: '泡立てる', read: 'あわだてる', alt: ['かき混ぜる'] }, { alt: 'かき混ぜる' }],
    ['ja', '玉[たま]ねぎを{刻[きざ]みました}。', { w: '刻む', read: 'きざむ', forms: { class: 'godan', masu: '刻みます', te: '刻んで', nai: '刻まない' } }, null],
    ['ko', '우리는 일곱 시에 {저녁}을 먹어요.', { w: '저녁 식사', alt: ['저녁'] }, { alt: '저녁' }],
    ['ko', '{저녁} 식사를 했어요.', { w: '저녁 식사', alt: ['저녁'] }, null],
  ];
  for (const [code, t, entry, expected] of cases) assert.deepEqual(targetProblem(t, entry, languages[code]), expected, `${code} ${t}`);
});

test('an exfix unit replaces example slots, and its merge fails while a slot still shows an alt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-exfix-'));
  try {
    fs.cpSync(new URL('tests/fixtures/data', REPO), dir, { recursive: true });
    fs.cpSync(new URL('data/meta', REPO), path.join(dir, 'meta'), { recursive: true });
    const file = path.join(dir, 'ex', 'en', 'core-1.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('{Thank you}, see you tomorrow!', '{Thanks}, see you tomorrow!'));
    const lint = runStatus(['tools/lint-data.mjs', '--data', dir, '--warnings']);
    assert.equal(lint.status, 0, 'a warning');
    assert.match(lint.stdout, /warning ex\/en\/core-1\.json phrase-thank-you: slot 3: target \{Thanks\} shows the alt "thanks", not the word "thank you"/);

    const out = path.join(dir, 'out.json');
    /** @param {any} slots @param {string[]} [flags] */
    const merge = (slots, flags = []) => {
      fs.writeFileSync(out, JSON.stringify({ unit: 'exfix:en:1', slots }));
      return runStatus(['tools/gen/merge-unit.mjs', out, '--data', dir, ...flags]);
    };
    const skipped = merge({});
    assert.equal(skipped.status, 1);
    assert.match(skipped.stdout, /phrase-thank-you: slot 3 not fixed: target \{Thanks\}/);
    const still = merge({ 'phrase-thank-you': { 3: { t: '{Thanks} a lot, see you tomorrow!' } } }, ['--partial']);
    assert.equal(still.status, 1);
    assert.match(still.stdout, /ERROR {3}ex\/en\/core-1\.json phrase-thank-you: slot 3: target \{Thanks\} shows the alt/);
    // --partial: this leaves the repository's progress file alone.
    const fixed = merge({ 'phrase-thank-you': { 3: { t: '{Thank you}, see you tomorrow!' } } }, ['--partial']);
    assert.equal(fixed.status, 0, fixed.stdout);
    const ex = JSON.parse(fs.readFileSync(file, 'utf8'))['phrase-thank-you'];
    assert.deepEqual(ex.map((/** @type {any} */ x) => x.t), ['{Thank you} for your help!', '{Thank you} very much for the gift.', '{Thank you}, see you tomorrow!']);
    const unknown = merge({ 'phrase-thank-you': { 4: { t: '{Thank you}!' } } }, ['--partial']);
    assert.match(unknown.stdout, /slots: phrase-thank-you has no slot 4/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('batch.mjs reads the unit from the reply, also when the model corrects itself after it', () => {
  const unit = { unit: 'ipa:sr:time', ipa: { 'word-o-clock': 'ˈsati' } };
  assert.deepEqual(parseOutput(JSON.stringify(unit)), unit);
  assert.deepEqual(parseOutput('```json\n' + JSON.stringify(unit) + '\n```'), unit, 'in a code fence');
  const first = { unit: 'ipa:sr:time', ipa: { 'word-o-clock': 'ˈsatі' } };
  const reply = `${JSON.stringify(first)}\n\nWait — correcting "word-o-clock" (a Cyrillic і): {fixed}\n\n${JSON.stringify(unit)}\nDone.`;
  assert.deepEqual(parseOutput(reply), unit, 'the last object that parses');
  const braces = { unit: 'lang:ru:time:1', ex: { 'word-hour': [{ t: 'Прошёл {час}.' }] } };
  assert.deepEqual(parseOutput(`Here it is: ${JSON.stringify(braces)}`), braces, 'braces inside strings');
  assert.throws(() => parseOutput('no object here'), /no JSON object found/);
});

test('merge-unit holds a unit to its own language: other languages’ problems are not its errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-merge-'));
  try {
    fs.cpSync(new URL('tests/fixtures/data', REPO), dir, { recursive: true });
    fs.cpSync(new URL('data/meta', REPO), path.join(dir, 'meta'), { recursive: true });
    /** @param {string} layer @param {string} code @param {string} module */
    const file = (layer, code, module) => path.join(dir, layer, code, `${module}.json`);
    /** @param {string} f */
    const readData = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    /** Merge a partial Russian core-1 unit with these entries. @param {Record<string, any>} lang */
    const mergeRu = (lang) => {
      const out = path.join(dir, 'out.json');
      fs.writeFileSync(out, JSON.stringify({ unit: 'lang:ru:core-1:1', lang }));
      return runStatus(['tools/gen/merge-unit.mjs', out, '--data', dir, '--partial']);
    };

    // Japanese gets a collision on word-hand (word-arm becomes 手 too, without hints).
    const ja = readData(file('lang', 'ja', 'core-1'));
    ja['word-arm'] = { ...ja['word-hand'] };
    fs.writeFileSync(file('lang', 'ja', 'core-1'), JSON.stringify(ja));
    const ru = readData(file('lang', 'ru', 'core-1'));
    const clean = mergeRu({ 'word-hand': ru['word-hand'] });
    assert.equal(clean.status, 0, clean.stdout);
    assert.doesNotMatch(clean.stdout, /lang\/ja\//);

    // A collision within Russian, with an entry in another file, still counts: the unit can patch that entry.
    const clash = mergeRu({ 'word-water': { ...ru['word-water'], w: readData(file('lang', 'ru', 'time'))['word-day-24h'].w } });
    assert.equal(clash.status, 1);
    assert.match(clash.stdout, /lang\/ru\/time\.json word-day-24h: "су́тки" is also used by word-water: add a hint/);
    assert.doesNotMatch(clash.stdout, /lang\/ja\//);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('merge-unit writes a landing translation and checks it, and lint-data checks data/landing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-landing-'));
  try {
    fs.cpSync(new URL('tests/fixtures/data', REPO), dir, { recursive: true });
    fs.cpSync(new URL('data/meta', REPO), path.join(dir, 'meta'), { recursive: true });
    const meta = appMeta(path.join(dir, 'meta'));
    /** @param {any} v @returns {any} */
    const mark = (v) => (typeof v === 'string' ? `Ру ${v}` : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mark(x)])));
    const { plural, ...texts } = englishTexts(meta, 'ru');
    const forms = (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ c) => ({ one: `{n} ${a}`, few: `{n} ${b}`, many: `{n} ${c}`, other: `{n} ${b}` });
    const landing = { ...mark(texts), plural: { word: forms('слово', 'слова', 'слов'), module: forms('модуль', 'модуля', 'модулей') } };
    const out = path.join(dir, 'out.json');
    /** --partial: a landing unit merges in one go anyway, and this leaves the repository's progress file alone. @param {any} value */
    const merge = (value) => {
      fs.writeFileSync(out, JSON.stringify({ unit: 'landing:ru', landing: value }));
      return runStatus(['tools/gen/merge-unit.mjs', out, '--data', dir, '--partial']);
    };

    const ok = merge(landing);
    assert.equal(ok.status, 0, ok.stdout);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'landing', 'ru.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved), ['source', 'texts', 'languages', 'categories', 'modules', 'fields', 'options', 'pairs', 'plural']);
    assert.equal(saved.source, textsSource(meta, 'ru'), 'records the English texts it translates');
    assert.equal(runStatus(['tools/lint-data.mjs', '--data', dir]).status, 0);

    const { cta, ...rest } = landing.texts;
    const broken = merge({ ...landing, texts: rest });
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /ERROR {3}texts\.cta: missing/);
    const lint = runStatus(['tools/lint-data.mjs', '--data', dir]);
    assert.equal(lint.status, 1);
    assert.match(lint.stdout, /ERROR {3}landing\/ru\.json: texts\.cta: missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lint-data --gate: the deploy needs an entry for every concept in every active language', () => {
  const failing = runStatus(['tools/lint-data.mjs', '--data', 'tests/fixtures/data', '--meta', 'data/meta', '--gate']);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /Deploy gate: 10 active language\(s\) incomplete: zh 0\/15, es 0\/15/);

  // A registry with only the fixture languages active passes.
  const meta = fs.mkdtempSync(path.join(os.tmpdir(), 'ankigen-meta-'));
  try {
    fs.cpSync(new URL('data/meta', REPO), meta, { recursive: true });
    const languages = JSON.parse(fs.readFileSync(path.join(meta, 'languages.json'), 'utf8'));
    const five = ['en', 'ru', 'sr', 'ja', 'de'];
    languages.deferred = [...languages.active.filter((/** @type {string} */ c) => !five.includes(c)), ...languages.deferred];
    languages.active = five;
    fs.writeFileSync(path.join(meta, 'languages.json'), JSON.stringify(languages));
    // labels.json lists its languages in registry order, which this changes.
    const labels = JSON.parse(fs.readFileSync(path.join(meta, 'labels.json'), 'utf8'));
    fs.writeFileSync(path.join(meta, 'labels.json'), stringifyLabels(labels, [...languages.active, ...languages.deferred]));
    const passing = runStatus(['tools/lint-data.mjs', '--data', 'tests/fixtures/data', '--meta', meta, '--gate']);
    assert.match(passing.stdout, /Deploy gate: every active language has an entry for every concept/);
    assert.equal(passing.status, 0, passing.stdout);
  } finally {
    fs.rmSync(meta, { recursive: true, force: true });
  }
});
