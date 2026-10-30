// @ts-check
// The note type for a config (ARCHITECTURE §7.1): fixed fields, two templates, card.css verbatim.
//   Forward: learned word → translation. Rows placed on Front go to the question, rows on Back after
//            <hr id=answer>. Japanese uses WordRuby on the question only when Reading = Front, and on
//            the answer whenever Reading ≠ Off.
//   Reverse: translation → learned word. The question is wrapped in {{#Reverse}}…{{/Reverse}}, so Anki
//            makes the card only when the Reverse field is filled. Every row about the learned word goes
//            to the answer; only the translation and concept rows placed on Front (POS, register, emoji)
//            stay on the question. Type the answer adds {{type:TypeTarget}} to both sides.
//   Audio:   only on the forward question and the reverse answer (ARCHITECTURE §7.1).
// Captions come from labels.json in the known language. data-field / data-dir / data-side let the site
// tell which field a selection came from (feedback reports).

import { typesAnswer } from '../state.js';
import { escapeHtml } from '../text/html.js';
import { FIELD_NAMES } from './fields.js';
import { pairLabel } from './names.js';

/** @typedef {import('./fields.js').DeckContext} DeckContext */

/**
 * Field-table rows shown as sections, in display order: [row id, field, CSS class, caption key].
 * @type {[string, string, string, string | null][]}
 */
const ROWS = [
  ['romanization', 'Romanization', 'rom', 'section.romanization'],
  ['otherScript', 'OtherScript', 'other', 'section.otherScript'],
  ['measureWord', 'MeasureWord', 'mw', 'section.measureWord'],
  ['hanja', 'Hanja', 'hanja', 'section.hanja'],
  ['forms', 'Forms', 'forms', 'section.forms'],
  ['ipa', 'IPA', 'ipa', 'section.ipa'],
  ['examples', 'Examples', 'examples', 'section.examples'],
  ['related', 'Related', 'related', 'section.related'],
  ['etymology', 'Etymology', 'etym', 'section.etymology'],
  ['pos', 'POS', 'tag pos', null],
  ['register', 'Register', 'tag reg', null],
  ['emoji', 'Emoji', 'emoji', null],
  ['conceptId', 'ConceptId', 'cid', 'section.conceptId'],
];

/** @param {DeckContext} ctx @param {string} row */
const sideOf = (ctx, row) => ctx.meta.fields.fields.find((/** @type {any} */ f) => f.id === row)?.side;

/**
 * A conditional section, shown only when the field is not empty.
 * @param {DeckContext} ctx @param {string} row @param {string} field @param {string} cls @param {string | null} captionKey
 */
function section(ctx, row, field, cls, captionKey) {
  const key = row === 'measureWord' && ctx.learn.code === 'ja' ? 'section.counter' : captionKey;
  const caption = key ? `<div class="cap">${escapeHtml(ctx.label(key) ?? '')}</div>` : '';
  const lang = sideOf(ctx, row) === 'learning' ? ` lang="${ctx.learn.tag}"` : ` lang="${ctx.know.tag}"`;
  return `{{#${field}}}<div class="sec ${cls}">${caption}<div class="val"${lang} data-field="${field}">{{${field}}}</div></div>{{/${field}}}`;
}

/** @param {DeckContext} ctx @param {(row: string, placement: string) => boolean} pick */
function sections(ctx, pick) {
  return ROWS.filter(([row]) => pick(row, ctx.place(row))).map(([row, field, cls, cap]) => section(ctx, row, field, cls, cap)).join('');
}

/** @param {DeckContext} ctx @param {boolean} ruby */
function word(ctx, ruby) {
  const field = ruby ? 'WordRuby' : 'Word';
  return (
    `<div class="word" lang="${ctx.learn.tag}" data-field="${field}">{{${field}}}</div>` +
    `{{#Disambig}}<div class="disambig" lang="${ctx.know.tag}" data-field="Disambig">{{Disambig}}</div>{{/Disambig}}`
  );
}

/** @param {DeckContext} ctx @param {string} cls */
function translation(ctx, cls) {
  return `<div class="${cls}" lang="${ctx.know.tag}" data-field="Translation">{{Translation}}</div>`;
}

/** @param {string} dir @param {string} side @param {string} body */
const card = (dir, side, body) => `<div class="ag ag-${dir}" data-dir="${dir}" data-side="${side}">${body}</div>`;

/**
 * @param {DeckContext} ctx
 * @param {string} css  css/card.css, embedded verbatim
 */
export function noteType(ctx, css) {
  const ja = ctx.learn.code === 'ja';
  const reading = ja ? ctx.place('reading') : 'off';
  const type = typesAnswer(ctx.config);
  const isEmoji = (/** @type {string} */ row) => row === 'emoji';
  const learningRow = (/** @type {string} */ row) => sideOf(ctx, row) === 'learning';

  const audio = ctx.audio ? '{{#Audio}}<div class="audio" data-field="Audio">{{Audio}}</div>{{/Audio}}' : '';

  // Forward: emoji (if on the front) above the word, other Front rows below it.
  const fwdQuestion = (/** @type {boolean} */ ruby, sound = '') =>
    sections(ctx, (row, p) => isEmoji(row) && p === 'front') + word(ctx, ruby) + sound + sections(ctx, (row, p) => !isEmoji(row) && p === 'front');
  const forwardFront = card('forward', 'front', fwdQuestion(reading === 'front', audio));
  const forwardBack = card(
    'forward',
    'back',
    fwdQuestion(reading !== 'off') + '<hr id=answer>' + translation(ctx, 'translation') + sections(ctx, (_, p) => p === 'back'),
  );

  // Reverse: only the translation and concept rows placed on Front ask the question.
  const revQuestion =
    sections(ctx, (row, p) => isEmoji(row) && p === 'front') +
    translation(ctx, 'translation prompt') +
    sections(ctx, (row, p) => !isEmoji(row) && !learningRow(row) && p === 'front');
  const typeBox = type ? '<div class="typeans">{{type:TypeTarget}}</div>' : '';
  const reverseFront = `{{#Reverse}}${card('reverse', 'front', revQuestion + typeBox)}{{/Reverse}}`;
  const reverseBack = card(
    'reverse',
    'back',
    revQuestion +
      '<hr id=answer>' +
      typeBox +
      word(ctx, reading !== 'off') +
      audio +
      sections(ctx, (row, p) => (learningRow(row) ? p !== 'off' : p === 'back')),
  );

  return {
    name: `AnkiGen ${pairLabel(ctx.meta, ctx.config)}`,
    fields: [...FIELD_NAMES],
    sortField: 0,
    templates: [
      { name: 'Forward', qfmt: forwardFront, afmt: forwardBack },
      { name: 'Reverse', qfmt: reverseFront, afmt: reverseBack },
    ],
    css,
  };
}

/** @typedef {ReturnType<typeof noteType>} NoteType */
