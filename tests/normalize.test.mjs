import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, stripStress, stripVowels, toHiragana, kanaToRomaji, searchKey, prepareQuery, matches } from '../src/text/normalize.js';
import { srToLatin } from '../src/text/translit.js';

test('fold: case, accents, stress, special letters', () => {
  const cases = {
    'Вода́': 'вода',
    'ВОДА': 'вода',
    'Größe': 'grosse',
    'Ærø': 'aero',
    'Łódź': 'lodz',
    'đak': 'djak',
    'İstanbul': 'istanbul',
    'ılık': 'ilik',
    'νερό': 'νερο',
    'ΣΟΦΟΣ': 'σοφοσ',
    'σοφός': 'σοφοσ',
    'yínháng': 'yinhang',
    'lǜ': 'lu',
    'Thank you!': 'thank you',
    "  l'eau  ": 'l eau',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(fold(input), expected, input);
});

test('fold: Arabic without its vowel marks, hamza seats and tatweel; ة and ى as they are often typed', () => {
  const cases = {
    'الْمَدْرَسَةُ': 'المدرسه',
    'مدرسة': 'مدرسه',
    'إِلَى': 'الي',
    'أَكَلَ': 'اكل',
    'سُؤَال': 'سوال',
    'كتـــاب': 'كتاب',
    'Tiếng Việt': 'tieng viet',
    'Українська': 'украінська',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(fold(input), expected, input);
  assert.equal(stripVowels('مُعَلِّمَة'), 'معلمة');
  assert.equal(stripVowels('كِتَابٌ / كُتُبٌ'), 'كتاب / كتب');
});

test('fold: kana', () => {
  assert.equal(fold('ガッコウ'), 'がっこう');
  assert.equal(fold('ｶﾞｯｺｳ'), 'がっこう');
  assert.equal(fold('が'), 'が');
  assert.notEqual(fold('が'), fold('か'));
  assert.equal(toHiragana('コーヒー'), 'こーひー');
});

test('stripStress removes only U+0301', () => {
  assert.equal(stripStress('вода́'), 'вода');
  assert.equal(stripStress('ёлка'), 'ёлка');
  assert.equal(stripStress('мой'), 'мой');
  assert.equal(stripStress('ма́ленький, небольшо́й'), 'маленький, небольшой');
});

test('kana → romaji (wapuro style)', () => {
  const cases = {
    とうきょう: 'toukyou',
    おおきい: 'ookii',
    がっこう: 'gakkou',
    コーヒー: 'koohii',
    しゃしん: 'shashin',
    ちょっと: 'chotto',
    じゅうみんひょう: 'juuminhyou',
    まっちゃ: 'maccha',
    きんえん: 'kinen',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(kanaToRomaji(input), expected, input);
});

test('matching: scripts, romanization, spacing', () => {
  const ruka = searchKey(['рука', srToLatin('рука'), 'hand; arm']);
  for (const q of ['РУКА', 'ruka', 'Ruka', 'arm', 'hand; a']) assert.ok(matches(ruka, prepareQuery(q)), q);
  assert.ok(!matches(ruka, prepareQuery('nogá')));

  const bank = searchKey(['银行', 'yínháng', 'bank']);
  for (const q of ['yinhang', 'yin hang', 'yínháng', '银行']) assert.ok(matches(bank, prepareQuery(q)), q);

  const tokyo = searchKey(['東京', 'とうきょう', 'tōkyō', kanaToRomaji('とうきょう')]);
  for (const q of ['tokyo', 'Tōkyō', 'toukyou', 'トウキョウ', '東京']) assert.ok(matches(tokyo, prepareQuery(q)), q);

  assert.ok(matches(ruka, prepareQuery('')), 'an empty query matches everything');
  assert.ok(!matches(searchKey(['hand', 'arm']), prepareQuery('handarm')), 'parts do not run together');
});
