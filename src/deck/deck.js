// @ts-check
// The would-be deck for a config: notes with their fields, and the note type. Shared by the preview,
// the sidebar, the .apkg export and the tests. Pure: the data is passed in.

import { selectNotes } from './select.js';
import { deckContext, noteFields } from './fields.js';
import { noteType } from './templates.js';

/** @typedef {import('./select.js').Note & { fields: import('./fields.js').Fields }} DeckNote */

/**
 * @param {{ config: import('../state.js').Config, meta: any, concepts: import('../data/loader.js').Concepts,
 *   learnData: import('../data/loader.js').LanguageData, knowData: import('../data/loader.js').LanguageData, css: string,
 *   audio?: import('../data/clips.js').AudioIndex | null }} input
 */
export function buildDeck({ config, meta, concepts, learnData, knowData, css, audio }) {
  const ctx = deckContext({ config, meta, concepts, learnData, knowData, audio });
  /** @type {DeckNote[]} */
  const notes = selectNotes(config, meta, concepts, learnData, knowData).map((note) => ({ ...note, fields: noteFields(note, ctx) }));
  return { notes, noteType: noteType(ctx, css) };
}

/** Anki tags for a note: ankigen::<category>::<module> for each selected module it belongs to. @param {any} meta @param {string[]} modules */
export function noteTags(meta, modules) {
  const category = new Map(meta.modules.categories.flatMap((/** @type {any} */ cat) => cat.modules.map((/** @type {any} */ m) => [m.id, cat.id])));
  return modules.map((m) => `ankigen::${category.get(m)}::${m}`);
}
