// @ts-check
// Search folding. Index strings and queries go through the same fold: lower case; accents, stress marks,
// Arabic vowel marks and pinyin tones removed; katakana → hiragana; punctuation → spaces. The index adds the
// variants that let one query match several spellings (Serbian in both scripts, romaji from kana); see searchKey().

const VOICED_KANA = /[\u3099\u309A]/; // dakuten/handakuten survive folding (が ≠ か)
/** @type {Record<string, string>} */
const LETTERS = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'dj', ı: 'i', ς: 'σ', ى: 'ي', ة: 'ه', ـ: '' };

/** Remove Russian and Ukrainian stress marks (U+0301) and keep everything else. @param {string} text */
export function stripStress(text) {
  return text.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');
}

/** Remove Arabic short-vowel marks (harakat, the superscript alef). @param {string} text */
export const stripVowels = (text) => text.replace(/[\u064B-\u0652\u0670]/g, '');

/** Katakana → hiragana, character by character. @param {string} text */
export function toHiragana(text) {
  return text.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** @param {string} text */
export function fold(text) {
  return toHiragana(
    text
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\p{M}/gu, (m) => (VOICED_KANA.test(m) ? m : ''))
      .replace(/[ßæœøłđıςىةـ]/g, (c) => LETTERS[c]),
  )
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

// ---------------------------------------------------------------- kana → romaji
// Wapuro-style spelling of a kana reading, so learners can type "toukyou" or "ookii" (the stored
// Hepburn romanization covers "tokyo" and "okii" once macrons are folded).

/** @type {Record<string, string>} */
const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゎ: 'wa',
};
/** @type {Record<string, string>} */
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };

/** @param {string} kana hiragana or katakana */
export function kanaToRomaji(kana) {
  const chars = [...toHiragana(kana)];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const small = SMALL_Y[chars[i + 1]];
    let syllable = KANA[ch];
    if (syllable && small && syllable.endsWith('i') && syllable.length > 1) {
      // きゃ kya, しゃ sha, ちゃ cha, じゃ ja
      const stem = syllable.slice(0, -1);
      syllable = (/(sh|ch|j)$/.test(stem) ? stem : stem + 'y') + small;
      i++;
    }
    if (syllable) out += syllable;
    else if (ch === 'っ') out += KANA[chars[i + 1]]?.[0] ?? '';
    else if (ch === 'ー') out += out.match(/[aeiou]$/)?.[0] ?? '';
    else out += SMALL_Y[ch] ?? ch;
  }
  return out;
}

// ---------------------------------------------------------------- matching

/**
 * @typedef {{ text: string, compact: string }} Query
 * `compact` drops spaces, so "yin hang" finds yínháng and "icecream" finds "ice cream".
 * @typedef {Query & { parts: string[] }} SearchKey  `parts`: the folded strings one by one, for ranking
 */

/** @param {string[]} parts index strings of one note, already including script/romaji variants @returns {SearchKey} */
export function searchKey(parts) {
  const folded = parts.map(fold).filter(Boolean);
  const text = folded.join(' | ');
  return { text, compact: text.replace(/ /g, ''), parts: folded };
}

/** @param {string} query @returns {Query} */
export function prepareQuery(query) {
  const text = fold(query);
  return { text, compact: text.replace(/ /g, '') };
}

/** @param {SearchKey} key @param {Query} query */
export function matches(key, query) {
  return !query.text || key.text.includes(query.text) || key.compact.includes(query.compact);
}
