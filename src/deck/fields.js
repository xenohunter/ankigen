// @ts-check
// Field HTML for every note (ARCHITECTURE §6), in the note type's fixed field list (§7.1). All data text is
// escaped; only our own tags are emitted. A row switched off, or data that is missing, gives an empty field.
//
// Choices beyond the spec (agreed during M0):
//   - synonyms of the learned word (alt) are shown in Related as "= …";
//   - TypeTarget includes the de/nl article only while the Gender / article row is on;
//   - Russian as the known language is shown without stress marks;
//   - merged notes take example slots round-robin from their members (slot 1 of each, then slot 2, …).

import { SAME, placementOf, typesAnswer } from '../state.js';
import { escapeAttr, escapeHtml, stripHtml } from '../text/html.js';
import { exampleHtml, stripFurigana, stripTarget, wordRubyHtml } from '../text/furigana.js';
import { SCHEMES, srToLatin } from '../text/translit.js';
import { stripStress } from '../text/normalize.js';

/** @typedef {import('./select.js').Note} Note */
/** @typedef {import('./select.js').Disambig} Disambig */
/** @typedef {import('../state.js').Config} Config */
/** @typedef {import('../data/loader.js').Concepts} Concepts */
/** @typedef {import('../data/loader.js').LanguageData} LanguageData */

/** The note type's fields, in order. Never reorder or rename within schema v1. */
export const FIELD_NAMES = /** @type {const} */ ([
  'Word', 'WordRuby', 'TypeTarget', 'Disambig', 'Translation', 'Romanization', 'OtherScript', 'MeasureWord',
  'Hanja', 'Forms', 'IPA', 'Examples', 'Related', 'Etymology', 'POS', 'Register', 'Emoji', 'ConceptId', 'Reverse',
  'Audio',
]);

/** @typedef {Record<(typeof FIELD_NAMES)[number], string>} Fields */

/** Learned languages whose typed answer includes the article (SPEC §3). */
const TYPED_ARTICLE = new Set(['de', 'nl']);
/** Form keys whose values are categories with value.* labels. */
const ENUM_FORMS = new Set(['aspect', 'class', 'type']);

/** Distinct non-empty strings, in order. @param {(string | null | undefined)[]} values @returns {string[]} */
const unique = (values) => /** @type {string[]} */ ([...new Set(values.filter(Boolean))]);

/**
 * BCP 47 tag for lang attributes (CJK glyph choice, hyphenation): the registry locale, with the script
 * subtag for Serbian.
 * @param {any} reg @param {string} code @param {'cyrl' | 'latn'} srScript
 */
export function langTag(reg, code, srScript) {
  if (code === 'sr') return srScript === 'latn' ? 'sr-Latn-RS' : 'sr-Cyrl-RS';
  return reg?.locale ?? code;
}

/**
 * Everything the field and template builders need for one config.
 * @param {{ config: Config, meta: any, concepts: Concepts, learnData: LanguageData, knowData: LanguageData, audio?: import('../data/clips.js').AudioIndex | null }} input
 */
export function deckContext({ config, meta, concepts, learnData, knowData, audio = null }) {
  const same = config.know === SAME;
  const learnCode = /** @type {string} */ (config.learn);
  const knowCode = same ? learnCode : /** @type {string} */ (config.know);
  const languages = meta.languages.languages;
  const latn = config.srScript === 'latn';
  const stressOn = placementOf(meta, config, 'stress') === 'on';
  const labelsOf = meta.labels.labels;

  /** Learned-language text: stress marks per the toggle, Serbian in the chosen script. @param {string} text */
  const learnText = (text) => {
    if (learnCode === 'ru' && !stressOn) text = stripStress(text);
    if (learnCode === 'sr' && latn) text = srToLatin(text);
    return text;
  };
  /** Known-language text: Russian without stress marks, Serbian in the chosen script. @param {string} text */
  const knowText = (text) => {
    if (knowCode === 'ru') text = stripStress(text);
    if (knowCode === 'sr' && latn) text = srToLatin(text);
    return text;
  };
  /** Card caption in the known language, falling back to English. @param {string} key @returns {string | null} */
  const label = (key) => {
    const text = labelsOf[knowCode]?.[key] ?? labelsOf.en?.[key] ?? null;
    return text && knowCode === 'sr' && latn && labelsOf[knowCode]?.[key] ? srToLatin(text) : text;
  };

  return {
    config,
    meta,
    concepts,
    same,
    learn: { code: learnCode, reg: languages[learnCode], data: learnData, tag: langTag(languages[learnCode], learnCode, config.srScript) },
    know: { code: knowCode, reg: languages[knowCode], data: knowData, tag: langTag(languages[knowCode], knowCode, config.srScript) },
    /** @param {string} id */
    place: (id) => placementOf(meta, config, id),
    audio: config.audio ? audio : null,
    stressOn,
    learnText,
    knowText,
    label,
  };
}

/** @typedef {ReturnType<typeof deckContext>} DeckContext */

/**
 * @param {Note} note @param {DeckContext} ctx
 * @returns {Fields}
 */
export function noteFields(note, ctx) {
  const on = (/** @type {string} */ id) => ctx.place(id) !== 'off';
  const concepts = note.conceptIds.map((id) => ctx.concepts.byId.get(id)?.c);
  const entry = note.learnEntries[0];
  return {
    Word: wordHtml(entry, ctx),
    WordRuby: ctx.learn.code === 'ja' && on('reading') ? wordRubyHtml(entry.w, entry.read) : '',
    TypeTarget: typesAnswer(ctx.config) ? escapeHtml(typeTarget(entry, ctx)) : '',
    Disambig: note.disambig ? escapeHtml(disambigText(note.disambig, ctx)) : '',
    Translation: translationHtml(note, ctx),
    Romanization: on('romanization') ? escapeHtml(romanization(entry, ctx)) : '',
    OtherScript: on('otherScript') && ctx.learn.code === 'sr' ? escapeHtml(ctx.config.srScript === 'latn' ? entry.w : srToLatin(entry.w)) : '',
    MeasureWord: on('measureWord') ? escapeHtml(unique(note.learnEntries.map((e) => e.mw)).join(', ')) : '',
    Hanja: on('hanja') ? escapeHtml(unique(note.learnEntries.map((e) => e.hanja)).join(', ')) : '',
    Forms: on('forms') ? formsHtml(entry, concepts[0]?.pos, ctx) : '',
    IPA: on('ipa') ? escapeHtml(unique(note.conceptIds.map((id) => ctx.learn.data.ipa.get(id))).map((x) => `/${x}/`).join(' · ')) : '',
    Examples: on('examples') && ctx.config.examples > 0 ? examplesHtml(note, ctx) : '',
    Related: on('related') ? relatedHtml(note, ctx) : '',
    Etymology: on('etymology') ? escapeHtml(unique(note.conceptIds.map((id) => ctx.learn.data.etym.get(id))).join(' · ')) : '',
    POS: on('pos') && concepts[0]?.pos ? escapeHtml(ctx.label(`pos.${concepts[0].pos}`) ?? concepts[0].pos) : '',
    Register: on('register') ? escapeHtml(unique(concepts.map((c) => c?.reg)).map((r) => ctx.label(`reg.${r}`) ?? r).join(', ')) : '',
    Emoji: on('emoji') ? escapeHtml(unique(concepts.map((c) => c?.emoji)).join(' ')) : '',
    ConceptId: on('conceptId') ? escapeHtml(note.conceptIds.join(', ')) : '',
    Reverse: ctx.config.reverse ? '1' : '',
    Audio: soundTag(note, ctx),
  };
}

/** Merged members say the same word. @param {Note} note @param {DeckContext} ctx */
function soundTag(note, ctx) {
  const hash = ctx.audio && note.conceptIds.map((id) => ctx.audio?.clips.get(id)).find(Boolean);
  return hash ? `[sound:ankigen-${ctx.learn.code}-${hash}.mp3]` : '';
}

/**
 * Plain text for the card list: the word as the card shows it (article or gender mark, stress, script),
 * the caption that tells it from a same-spelled word, and the translation or definition.
 * @param {Note} note @param {DeckContext} ctx
 */
export function noteSummary(note, ctx) {
  const plain = (/** @type {string} */ html) => stripHtml(html.replace(/<br>/g, ' '));
  return {
    word: plain(wordHtml(note.learnEntries[0], ctx)),
    disambig: note.disambig ? disambigText(note.disambig, ctx) : '',
    translation: plain(translationHtml(note, ctx)),
  };
}

/**
 * The entry's article (article languages: der, la, l') or gender mark (marker languages: m., ж. р.),
 * or null when the Gender / article row is off or the entry has no gender.
 * @param {any} e @param {DeckContext} ctx
 * @returns {{ art: string } | { mark: string } | null}
 */
function gender(e, ctx) {
  const rules = ctx.learn.reg?.gender;
  if (!rules || !e.g || ctx.place('gender') !== 'word') return null;
  if (rules.mode === 'article') {
    const art = e.art ?? rules.articles?.[e.g];
    return art ? { art } : null;
  }
  const mark = ctx.label(`gender.${e.g}`);
  return mark ? { mark } : null;
}

/** @param {any} e @param {DeckContext} ctx */
function wordHtml(e, ctx) {
  const w = escapeHtml(ctx.learnText(e.w));
  const g = gender(e, ctx);
  if (g && 'art' in g) return `<span class="art">${escapeHtml(ctx.learnText(g.art))}</span>${/['’]$/.test(g.art) ? '' : ' '}${w}`; // l'eau: no space
  if (g) return `${w} <span class="g" lang="${ctx.know.tag}">${escapeHtml(g.mark)}</span>`;
  return w;
}

/** The answer typed on reverse cards: main form, no hint or stress, de/nl article, native script. @param {any} e @param {DeckContext} ctx */
function typeTarget(e, ctx) {
  let w = stripStress(e.w);
  if (ctx.learn.code === 'sr' && ctx.config.srScript === 'latn') w = srToLatin(w);
  const g = TYPED_ARTICLE.has(ctx.learn.code) ? gender(e, ctx) : null;
  return g && 'art' in g ? `${g.art} ${w}` : w;
}

/** @param {Disambig} d @param {DeckContext} ctx */
function disambigText(d, ctx) {
  switch (d.kind) {
    case 'pos':
      return ctx.label(`pos.${d.pos}`) ?? d.pos;
    case 'gender': {
      const gender = ctx.learn.reg?.gender;
      if (gender?.mode === 'article') return ctx.learnText(d.art ?? gender.articles?.[d.g] ?? d.g);
      return ctx.label(`gender.${d.g}`) ?? d.g;
    }
    case 'form':
      return `${ctx.label(`form.${d.key}`) ?? d.key} ${formValue(d.key, d.value, ctx)}`;
    case 'hint':
      return ctx.learnText(d.hint);
  }
}

/** @param {string} key @param {string} value @param {DeckContext} ctx */
function formValue(key, value, ctx) {
  return ENUM_FORMS.has(key) ? (ctx.label(`value.${key}.${value}`) ?? value) : ctx.learnText(value);
}

/** @param {Note} note @param {DeckContext} ctx */
function translationHtml(note, ctx) {
  if (ctx.same) {
    const defs = unique(note.learnEntries.map((e) => e.def)).map((d) => escapeHtml(ctx.learnText(d)));
    return defs.length > 1 ? defs.map((d, i) => `<span class="n">${i + 1}.</span> ${d}`).join('<br>') : (defs[0] ?? '');
  }
  const parts = unique(note.knowEntries.map((e) => knownEntryHtml(e, ctx)));
  if (parts.length < 2) return parts[0] ?? '';
  // merged notes: each member wraps as a unit ("hand; arm")
  return parts.map((p, i) => `<span class="m">${p}${i < parts.length - 1 ? ';' : ''}</span>`).join(' ');
}

/** "brother (older) · big brother", or the gloss in italics. @param {any} e @param {DeckContext} ctx */
function knownEntryHtml(e, ctx) {
  if (!e.w) return `<i class="gl">${escapeHtml(ctx.knowText(e.gl ?? ''))}</i>`;
  let html = escapeHtml(ctx.knowText(e.w));
  if (e.hint) html += ` <span class="hint">(${escapeHtml(ctx.knowText(e.hint))})</span>`;
  if (e.alt?.length) html += ` <span class="alt">· ${e.alt.map((/** @type {string} */ a) => escapeHtml(ctx.knowText(a))).join(', ')}</span>`;
  return html;
}

/** Stored (ja, ko), the pinyin reading (zh), or by rule (ru, hy, el). @param {any} e @param {DeckContext} ctx */
function romanization(e, ctx) {
  const r = ctx.learn.reg?.romanization;
  if (!r) return '';
  if (r.source === 'stored') return e.rom ?? '';
  if (r.source === 'reading') return e.read ?? '';
  const scheme = /** @type {Record<string, (text: string, opts?: { stress?: boolean }) => string>} */ (SCHEMES)[r.scheme];
  return scheme ? scheme(e.w, { stress: ctx.stressOn }) : '';
}

/** "gen. воды́ · pl. во́ды", in the registry's key order, captions in the known language. @param {any} e @param {string} pos @param {DeckContext} ctx */
function formsHtml(e, pos, ctx) {
  const keys = ctx.learn.reg?.forms?.[pos]?.keys ?? [];
  return keys
    .filter((/** @type {string} */ k) => e.forms?.[k])
    .map((/** @type {string} */ k) => `<span class="f"><span class="fk" lang="${ctx.know.tag}">${escapeHtml(ctx.label(`form.${k}`) ?? k)}</span> ${escapeHtml(formValue(k, e.forms[k], ctx))}</span>`)
    .join(' · ');
}

/** @param {Note} note @param {DeckContext} ctx */
function examplesHtml(note, ctx) {
  const { learn, know } = ctx;
  const furigana = learn.code === 'ja' ? (ctx.place('reading') !== 'off' ? 'ruby' : 'strip') : undefined;
  const pinyin = learn.code === 'zh' && ctx.place('romanization') !== 'off';
  const translate = !ctx.same && ctx.place('exampleTranslations') !== 'off';
  /** @type {{ id: string, k: number, ex: any }[]} */
  const slots = [];
  for (let k = 0; k < 3; k++) {
    for (const id of note.conceptIds) {
      const ex = learn.data.ex.get(id)?.[k];
      if (ex?.t) slots.push({ id, k, ex });
    }
  }
  return slots
    .slice(0, ctx.config.examples)
    .map(({ id, k, ex }) => {
      let html = `<div class="ex-t" lang="${learn.tag}">${exampleHtml(ctx.learnText(ex.t), { furigana })}</div>`;
      if (pinyin && ex.r) html += `<div class="ex-r">${escapeHtml(ex.r)}</div>`;
      const other = translate ? know.data.ex.get(id)?.[k] : undefined;
      if (other?.t && ex.p === undefined && other.p === undefined) {
        const plain = ctx.knowText(stripTarget(know.code === 'ja' ? stripFurigana(other.t) : other.t));
        html += `<div class="ex-tr" lang="${know.tag}">${escapeHtml(plain)}</div>`;
      }
      return `<div class="ex" data-concept="${escapeAttr(id)}">${html}</div>`;
    })
    .join('');
}

/** "= synonyms · ↔ antonyms · → related", all in the learned language. @param {Note} note @param {DeckContext} ctx */
function relatedHtml(note, ctx) {
  const own = new Set(note.conceptIds);
  const self = ctx.learnText(note.learnEntries[0].w);
  /** @param {string} id */
  const word = (id) => {
    const w = ctx.learn.data.lang.get(id)?.w;
    return w ? ctx.learnText(w) : '';
  };
  /** @param {'ant' | 'rel'} key */
  const linked = (key) =>
    unique(note.conceptIds.flatMap((id) => ctx.concepts.byId.get(id)?.c[key] ?? []).filter((id) => !own.has(id)).map(word)).filter((w) => w && w !== self);
  const groups = [
    ['syn', '=', unique(note.learnEntries.flatMap((e) => e.alt ?? []).map(ctx.learnText))],
    ['ant', '↔', linked('ant')],
    ['rel', '→', linked('rel')],
  ];
  return groups
    .filter(([, , words]) => words.length)
    .map(([cls, mark, words]) => `<span class="${cls}">${mark} ${/** @type {string[]} */ (words).map(escapeHtml).join(', ')}</span>`)
    .join(' · ');
}
