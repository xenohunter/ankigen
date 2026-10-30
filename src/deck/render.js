// @ts-check
// A small Anki template renderer for the preview and the sidebar (ARCHITECTURE §8), so the site shows
// exactly what Anki will: {{Field}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}}, {{FrontSide}} and
// {{type:Field}} (a disabled input on the question; the expected answer on the answer side); `sound` draws
// [sound:…] tags. Field values are already HTML.

import { escapeAttr } from '../text/html.js';

/** @typedef {import('./templates.js').NoteType} NoteType */

/** Anki's empty-field test: only whitespace and <br>/<div> tags. */
const EMPTY = /^(?:\s|<\/?(?:br|div) ?\/?>)*$/i;
const SECTION = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
const TAG = /\{\{\s*([^}]+?)\s*\}\}/g;

/** @param {string | undefined} value */
export function isEmptyField(value) {
  return value === undefined || EMPTY.test(value);
}

/**
 * @param {string} template
 * @param {Record<string, string>} fields
 * @param {{ frontSide?: string, answer?: boolean, typeLabel?: string, sound?: (name: string) => string }} [opts] answer:
 *   render {{type:…}} as the answer side does; typeLabel: the accessible name of the box for typing the answer
 */
export function renderTemplate(template, fields, { frontSide = '', answer = false, typeLabel = 'Type the answer', sound } = {}) {
  let html = template;
  for (let m = SECTION.exec(html); m; m = SECTION.exec(html)) {
    const [whole, kind, name, body] = m;
    const show = (kind === '#') !== isEmptyField(fields[name]);
    html = html.slice(0, m.index) + (show ? body : '') + html.slice(m.index + whole.length);
  }
  html = html.replace(TAG, (_, tag) => {
    if (tag === 'FrontSide') return frontSide;
    const type = /^type:(.+)$/.exec(tag);
    if (type) {
      return answer
        ? `<code id="typeans">${fields[type[1]] ?? ''}</code>`
        : `<input id="typeans" type="text" disabled aria-label="${escapeAttr(typeLabel)}">`;
    }
    return fields[tag.replace(/^.*:/, '')] ?? '';
  });
  return sound ? html.replace(/\[sound:([^\]]+)\]/g, (_, name) => sound(name)) : html;
}

/** @param {string} html */
function isBlank(html) {
  return html.replace(/<[^>]*>/g, '').trim() === '' && !/<(?:img|input|ruby)/i.test(html);
}

/**
 * Both faces of one card, or null when Anki would not create it (empty question).
 * @param {NoteType} noteType @param {Record<string, string>} fields @param {number} ord 0 = forward, 1 = reverse
 * @param {{ typeLabel?: string, sound?: (name: string) => string }} [opts] typeLabel: the accessible name of the box
 *   for typing the answer
 * @returns {{ front: string, back: string } | null}
 */
export function renderCard(noteType, fields, ord, { typeLabel, sound } = {}) {
  const tpl = noteType.templates[ord];
  if (!tpl) return null;
  const front = renderTemplate(tpl.qfmt, fields, { typeLabel, sound });
  if (isBlank(front)) return null;
  return { front, back: renderTemplate(tpl.afmt, fields, { frontSide: front, answer: true, sound }) };
}

/** The template ordinals Anki creates cards for: those whose question is not blank. @param {NoteType} noteType @param {Record<string, string>} fields */
export function cardOrds(noteType, fields) {
  return noteType.templates.flatMap((tpl, ord) => (isBlank(renderTemplate(tpl.qfmt, fields)) ? [] : [ord]));
}
