// @ts-check
// Search in the card list (SPEC §4, ARCHITECTURE §8). A note is found by its words in both languages and by
// the other ways a learner may type them: synonyms, readings, romanization (stored, by rule, or kana as
// romaji), Serbian in both scripts and Vietnamese đ as d, whatever the field settings show; in same-language decks
// also by its definition, ranked below the words. Index and query are folded alike (text/normalize.js), so case,
// accents, stress and vowel marks never matter. The index is built on the first search.

import { kanaToRomaji, matches, prepareQuery, searchKey } from '../text/normalize.js';
import { SCHEMES, srToLatin } from '../text/translit.js';
import { noteSummary } from './fields.js';

/** @typedef {import('./select.js').Note} Note */
/** @typedef {import('./fields.js').DeckContext} DeckContext */
/** @typedef {import('../text/normalize.js').SearchKey} SearchKey */
/** @typedef {import('../text/normalize.js').Query} Query */

/** @type {Record<string, (text: string) => string>} */
const RULES = SCHEMES;

/** Other spellings a learner may type: Serbian in Latin, Vietnamese đ as d (the fold makes it dj, as in Serbian). */
const VARIANTS = /** @type {Record<string, (text: string) => string>} */ ({ sr: srToLatin, vi: (text) => text.replace(/[đĐ]/g, 'd') });

/**
 * The strings a note can be found by: its words, and (same-language decks) its definitions.
 * @param {Note} note @param {DeckContext} ctx @returns {{ words: string[], definitions: string[] }}
 */
export function searchParts(note, ctx) {
  const { word, translation } = noteSummary(note, ctx);
  const romanization = ctx.learn.reg?.romanization;
  const rule = romanization?.source === 'rule' ? RULES[romanization.scheme] : null;
  /** @type {(string | undefined)[]} */
  const parts = ctx.same ? [word] : [word, translation];
  for (const e of note.learnEntries) {
    const spellings = [e.w, ...(e.alt ?? [])];
    parts.push(...spellings, e.read, e.rom, e.hanja);
    if (rule) parts.push(...spellings.map((s) => rule(s)));
    if (VARIANTS[ctx.learn.code]) parts.push(...spellings.map(VARIANTS[ctx.learn.code]));
    if (ctx.learn.code === 'ja' && e.read) parts.push(kanaToRomaji(e.read));
  }
  if (!ctx.same) {
    for (const e of note.knowEntries) {
      const spellings = [e.w, e.gl, ...(e.alt ?? [])].filter(Boolean);
      parts.push(...spellings);
      if (VARIANTS[ctx.know.code]) parts.push(...spellings.map(VARIANTS[ctx.know.code]));
    }
  }
  return { words: [...new Set(/** @type {string[]} */ (parts.filter(Boolean)))], definitions: ctx.same ? [translation] : [] };
}

/** 0: a part is the query; 1: a word in a part starts with it; 2: it appears in a part; 3: no match. @param {SearchKey} key @param {Query} q */
function rank(key, q) {
  if (!matches(key, q)) return 3;
  let best = 2;
  for (const part of key.parts) {
    if (part === q.text || part.replace(/ /g, '') === q.compact) return 0;
    if (` ${part}`.includes(` ${q.text}`)) best = 1;
  }
  return best;
}

/**
 * @param {Note[]} notes the deck, in canonical order
 * @param {DeckContext} ctx
 */
export function createSearch(notes, ctx) {
  /** @type {{ words: SearchKey, definitions: SearchKey }[] | null} */
  let keys = null;
  return {
    /**
     * The notes that match, best first: by their words (exact, then a word start, then anywhere), then by their
     * definitions; deck order within each.
     * @param {string} query @returns {Note[]}
     */
    filter(query) {
      const q = prepareQuery(query);
      if (!q.text) return notes;
      keys ??= notes.map((note) => {
        const { words, definitions } = searchParts(note, ctx);
        return { words: searchKey(words), definitions: searchKey(definitions) };
      });
      const index = keys;
      return notes
        .flatMap((note, i) => {
          const byWords = rank(index[i].words, q);
          const score = byWords < 3 ? byWords : 3 + rank(index[i].definitions, q);
          return score < 6 ? [{ note, i, score }] : [];
        })
        .sort((a, b) => a.score - b.score || a.i - b.i)
        .map((hit) => hit.note);
    },
  };
}
