// @ts-check
// Rule-based romanization for the languages whose romanization is not stored in the data
// (data/meta/languages.json: romanization.source "rule", otherScript.rule):
//   ru-simple     Russian → readable Latin (this project's scheme, below)
//   uk-national   Ukrainian → Latin, the national system of 2010
//   sr-cyrl-latn  Serbian Cyrillic → Latin (exact); srToCyrillic is the inverse, for search only
//   hy-bgn-pcgn   Eastern Armenian, BGN/PCGN 1981 (PCGN table, checked November 2022)
//   el-elot-743   Modern Greek, ELOT 743 = BGN/PCGN 1996 (PCGN table, checked October 2017)
// Each scheme is a letter table plus a few context rules. Characters outside a table pass through.

const ACUTE = '\u0301';
const DIAERESIS = '\u0308';
const WORD = /[\p{L}\p{M}]+/gu;

/** @param {string} ch */
const isUpper = (ch) => ch !== ch.toLowerCase();

/** At least two letters, all capitals (abbreviations such as ВНЖ, ΚΤΕΟ). @param {string[]} chars */
function isAllCaps(chars) {
  const letters = chars.filter((c) => /\p{L}/u.test(c));
  return letters.length > 1 && letters.every(isUpper);
}

/**
 * Case of a romanized letter group: lower stays lower, a capital becomes Title case ("Shch"),
 * or all caps inside an all-caps word ("SHCH").
 * @param {string} latin @param {boolean} upper @param {boolean} caps
 */
function withCase(latin, upper, caps) {
  if (!upper || !latin) return latin;
  return caps ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
}

/** Put an acute accent on the last vowel letter of a romanized group (ya → yá). @param {string} latin */
function accentLastVowel(latin) {
  const i = Math.max(...[...'aeiouy'].map((v) => latin.lastIndexOf(v)));
  return i < 0 ? latin : (latin.slice(0, i + 1) + ACUTE + latin.slice(i + 1)).normalize('NFC');
}

// ---------------------------------------------------------------- Russian (ru-simple)
// Plain English-style letters, no apostrophes: е → ye at the start of a word and after a vowel or ъ/ь;
// ё → yo (o after ж ч ш щ ц); ъ and ь are dropped; final -ый → y. With stress on, the U+0301 marks of
// the data carry over (вода́ → vodá), and ё, always stressed, gets one in words of 2+ syllables.

/** @type {Record<string, string>} */
const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const RU_VOWELS = 'аеёиоуыэюя';

/**
 * @param {string} text Russian, NFC with U+0301 stress marks
 * @param {{ stress?: boolean }} [opts]
 */
export function ruToLatin(text, { stress = true } = {}) {
  return text.normalize('NFC').replace(WORD, (word) => {
    const chars = [...word];
    const caps = isAllCaps(chars);
    const syllables = chars.filter((c) => RU_VOWELS.includes(c.toLowerCase())).length;
    let out = '';
    let prev = ''; // previous letter, lower case
    chars.forEach((ch, i) => {
      if (ch === ACUTE) return; // handled with its vowel
      const lower = ch.toLowerCase();
      let latin = RU[lower];
      if (latin === undefined) {
        out += ch;
        prev = lower;
        return;
      }
      if (lower === 'е' && (!prev || RU_VOWELS.includes(prev) || prev === 'ъ' || prev === 'ь')) latin = 'ye';
      if (lower === 'ё' && 'жчшщц'.includes(prev || '-')) latin = 'o';
      if (lower === 'й' && prev === 'ы' && i === chars.length - 1) latin = '';
      if (stress && (chars[i + 1] === ACUTE || (lower === 'ё' && syllables > 1))) latin = accentLastVowel(latin);
      out += withCase(latin, isUpper(ch), caps);
      prev = lower;
    });
    return out;
  });
}

// ---------------------------------------------------------------- Ukrainian (uk-national)
// The national system of 2010 (Cabinet of Ministers resolution 55): є ї й ю я are ye yi y yu ya at the start of a
// word, ie i i iu ia elsewhere; г is h, ґ is g, and зг is zgh; ь and the apostrophe are dropped. With stress on,
// the U+0301 marks of the data carry over, as in Russian.

/** @type {Record<string, string>} */
const UK = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia',
};
/** @type {Record<string, string>} */
const UK_INITIAL = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };
const UK_WORD = /\p{L}[\p{L}\p{M}]*(?:['’ʼ]\p{L}[\p{L}\p{M}]*)*/gu; // an apostrophe inside a word (сім’я) belongs to it

/**
 * @param {string} text Ukrainian, NFC with U+0301 stress marks
 * @param {{ stress?: boolean }} [opts]
 */
export function ukToLatin(text, { stress = true } = {}) {
  return text.normalize('NFC').replace(UK_WORD, (word) => {
    const chars = [...word];
    const caps = isAllCaps(chars);
    let out = '';
    let prev = ''; // previous letter, lower case; empty at the start of the word
    chars.forEach((ch, i) => {
      if (ch === ACUTE) return; // handled with its vowel
      const lower = ch.toLowerCase();
      let latin = UK[lower];
      if (latin === undefined) {
        if (!"'’ʼ".includes(ch)) out += ch;
        prev = lower;
        return;
      }
      if (!prev && UK_INITIAL[lower]) latin = UK_INITIAL[lower];
      if (lower === 'г' && prev === 'з') latin = 'gh';
      if (stress && chars[i + 1] === ACUTE) latin = accentLastVowel(latin);
      out += withCase(latin, isUpper(ch), caps);
      prev = lower;
    });
    return out;
  });
}

// ---------------------------------------------------------------- Serbian (sr-cyrl-latn)

/** @type {Record<string, string>} */
const SR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l',
  љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h',
  ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
};
/** @type {Record<string, string>} */
const SR_FROM_LATIN = Object.fromEntries(Object.entries(SR).map(([cyr, lat]) => [lat, cyr]));

/** Serbian Cyrillic → Latin. Љ Њ Џ become Lj Nj Dž, or LJ NJ DŽ in capitals. @param {string} text */
export function srToLatin(text) {
  return text.normalize('NFC').replace(WORD, (word) => {
    const chars = [...word];
    const caps = isAllCaps(chars);
    return chars
      .map((ch, i) => {
        const latin = SR[ch.toLowerCase()];
        if (latin === undefined) return ch;
        const nextUpper = i + 1 < chars.length && isUpper(chars[i + 1]);
        return withCase(latin, isUpper(ch), caps || nextUpper);
      })
      .join('');
  });
}

/**
 * Serbian Latin → Cyrillic, for search only: "nj" is ambiguous (injekcija is инјекција), so this is
 * never used to display text.
 * @param {string} text
 */
export function srToCyrillic(text) {
  const s = text.normalize('NFC');
  let out = '';
  for (let i = 0; i < s.length; ) {
    const two = s.slice(i, i + 2);
    const pair = two.length === 2 ? SR_FROM_LATIN[two.toLowerCase()] : undefined;
    const one = SR_FROM_LATIN[s[i].toLowerCase()];
    const cyr = pair ?? one;
    out += cyr === undefined ? s[i] : isUpper(s[i]) ? cyr.toUpperCase() : cyr;
    i += pair ? 2 : 1;
  }
  return out;
}

// ---------------------------------------------------------------- Armenian (hy-bgn-pcgn)
// ե is ye at the start of a word and after a vowel, otherwise e; ո is vo at the start of a word
// (but ով is ov), otherwise o; ու is u; և (or եւ) is yev at the start, alone or after a vowel,
// otherwise ev. The aspiration mark is U+2019. The question and exclamation marks written over a
// vowel move to the end of the word.

/** @type {Record<string, string>} */
const HY = {
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't’', ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh',
  ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz', ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch’',
  պ: 'p', ջ: 'j', ռ: 'rr', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts’', ւ: 'v', փ: 'p’', ք: 'k’', և: 'ev',
  օ: 'o', ֆ: 'f',
};
const HY_VOWELS = new Set(['ա', 'ե', 'է', 'ը', 'ի', 'ո', 'ու', 'օ']);
/** @type {Record<string, string>} */
const HY_PUNCT = { '։': '.', '՝': ',', '՚': '’', '՟': '.' };
const HY_WORD = /[\p{L}\p{M}\u055B\u055C\u055E]+/gu; // letters plus the marks written inside a word

/** @param {string} text Eastern Armenian */
export function hyToLatin(text) {
  return text
    .normalize('NFC')
    .replace(HY_WORD, (raw) => {
      const end = (raw.includes('\u055E') ? '?' : '') + (raw.includes('\u055C') ? '!' : '');
      const chars = [...raw.replace(/[\u055B\u055C\u055E]/g, '')];
      const caps = isAllCaps(chars);
      // units: ու and եւ are single letters
      /** @type {{ lower: string, upper: boolean }[]} */
      const units = [];
      for (let i = 0; i < chars.length; i++) {
        const lower = chars[i].toLowerCase();
        const next = chars[i + 1]?.toLowerCase();
        if ((lower === 'ո' || lower === 'ե') && next === 'ւ') {
          units.push({ lower: lower === 'ո' ? 'ու' : 'և', upper: isUpper(chars[i]) });
          i++;
        } else units.push({ lower, upper: isUpper(chars[i]) });
      }
      const whole = units.map((u) => u.lower).join('');
      let out = '';
      units.forEach((u, i) => {
        const initial = i === 0;
        const afterVowel = i > 0 && HY_VOWELS.has(units[i - 1].lower);
        let latin = u.lower === 'ու' ? 'u' : HY[u.lower];
        if (latin === undefined) {
          out += u.upper ? u.lower.toUpperCase() : u.lower;
          return;
        }
        if (u.lower === 'ե' && (initial || afterVowel)) latin = 'ye';
        if (u.lower === 'և' && (initial || afterVowel)) latin = 'yev';
        if (u.lower === 'ո' && initial) latin = whole === 'ով' ? 'o' : 'vo';
        out += withCase(latin, u.upper, caps);
      });
      return out + end;
    })
    .replace(/[։՝՚՟]/g, (p) => HY_PUNCT[p]);
}

// ---------------------------------------------------------------- Greek (el-elot-743)
// αυ ευ ηυ: v before vowels and β γ δ ζ λ μ ν ρ, f before θ κ ξ π σ τ φ χ ψ and at the end of a word;
// letter by letter (ay…) when the first vowel is stressed or υ has a diaeresis. ου → ou. γ → n before
// γ ξ χ (γγ ng, γξ nx, γχ nch). μπ → b at the start and end of a word, mp inside. Stress (tonos) is kept
// as an acute: on υ of ου (oú), on the first vowel of av/ef… (áv), on the letter otherwise. Diaereses stay.

/** @type {Record<string, string>} */
const EL = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n',
  ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const EL_VOICELESS = new Set([...'θκξπσςτφχψ']);

/** @param {string} text Modern Greek, monotonic */
export function elToLatin(text) {
  return text.normalize('NFC').replace(WORD, (word) => {
    // units: a base letter with its tonos / diaeresis
    /** @type {{ lower: string, upper: boolean, acute: boolean, diaeresis: boolean }[]} */
    const units = [];
    for (const ch of word.normalize('NFD')) {
      const last = units[units.length - 1];
      if (ch === ACUTE || ch === '\u0300' || ch === '\u0342') {
        if (last) last.acute = true;
      } else if (ch === DIAERESIS) {
        if (last) last.diaeresis = true;
      } else if (!/\p{M}/u.test(ch)) units.push({ lower: ch.toLowerCase(), upper: isUpper(ch), acute: false, diaeresis: false });
    }
    const caps = isAllCaps(units.map((u) => (u.upper ? u.lower.toUpperCase() : u.lower)));
    /** @param {string} latin @param {{ acute: boolean, diaeresis: boolean }} marks */
    const mark = (latin, marks) => (latin + (marks.diaeresis ? DIAERESIS : '') + (marks.acute ? ACUTE : '')).normalize('NFC');
    let out = '';
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const next = units[i + 1];
      const after = units[i + 2];
      let latin = EL[u.lower];
      if (latin === undefined) {
        out += u.upper ? u.lower.toUpperCase() : u.lower;
        continue;
      }
      if ('αεη'.includes(u.lower) && next?.lower === 'υ' && !next.diaeresis && !u.acute) {
        const fv = !after || EL_VOICELESS.has(after.lower) ? 'f' : 'v';
        latin = mark(EL[u.lower], { acute: next.acute, diaeresis: false }) + fv;
        i++;
      } else if (u.lower === 'ο' && next?.lower === 'υ' && !next.diaeresis && !u.acute) {
        latin = 'o' + mark('u', next);
        i++;
      } else if (u.lower === 'μ' && next?.lower === 'π' && (i === 0 || i + 2 === units.length)) {
        latin = 'b';
        i++;
      } else {
        if (u.lower === 'γ' && next && 'γξχ'.includes(next.lower)) latin = 'n';
        latin = mark(latin, u);
      }
      out += withCase(latin, u.upper, caps);
    }
    return out;
  });
}

/** Romanization schemes by the names used in data/meta/languages.json. */
export const SCHEMES = {
  'ru-simple': ruToLatin,
  'uk-national': ukToLatin,
  'sr-cyrl-latn': srToLatin,
  'hy-bgn-pcgn': hyToLatin,
  'el-elot-743': elToLatin,
};
