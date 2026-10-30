// @ts-check
// The .apkg file (ARCHITECTURE §7): a schema-11 collection.anki2 written with sql.js, the pronunciation clips the
// notes name (zip entries 0, 1, … in order of first use) and the media map naming them ({} without audio), zipped
// with fflate. The JSON in the col row mirrors what Anki's own legacy export writes.
//
// What Anki's importer matches on, so it must never change for a language pair: note GUIDs, the note
// type ID with its field and template names, and the deck *name* (decks are matched by name, not ID).
// Note and card IDs and every mod time come from the export clock (§7.2, §7.4), because Anki updates an
// existing note or note type only when the incoming one is newer. With a fixed clock the file is
// byte-identical.
//
// sql.js is passed in: the page loads vendor/sql-wasm.js on first download; Node (tests, tools/apkg.mjs)
// loads it through tools/lib/sqljs.mjs.

import { strToU8, zipSync } from '../../vendor/fflate.js';
import { SITE_URL } from '../config.js';
import { encodeHash } from '../state.js';
import { escapeAttr, escapeHtml, stripHtml } from '../text/html.js';
import { noteTags } from './deck.js';
import { cardId, deckId, fieldChecksum, modelId, noteGuid, noteId } from './ids.js';
import { cardOrds, renderTemplate } from './render.js';
import { deckName } from './names.js';

/** @typedef {import('./deck.js').DeckNote} DeckNote */
/** @typedef {import('./templates.js').NoteType} NoteType */
/** @typedef {import('../state.js').Config} Config */
/** @typedef {{ Database: new () => any }} SqlJs  the initialized sql.js module */

/** Anki's schema-11 tables and indexes, as in its own legacy exports. */
const SCHEMA = `
create table col (
  id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
);
create table notes (
  id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null,
  data text not null
);
create table cards (
  id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null
);
create table revlog (
  id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null
);
create table graves (usn integer not null, oid integer not null, type integer not null);
create index ix_notes_usn on notes (usn);
create index ix_cards_usn on cards (usn);
create index ix_revlog_usn on revlog (usn);
create index ix_cards_nid on cards (nid);
create index ix_cards_sched on cards (did, queue, due);
create index ix_revlog_cid on revlog (cid);
create index ix_notes_csum on notes (csum);
`;

const LATEX_PRE =
  '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n' +
  '\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
const LATEX_POST = '\\end{document}';

/** Anki's "Default" deck options. The importer keeps the user's own presets unless asked otherwise. */
const DEFAULT_DCONF = {
  id: 1, mod: 0, name: 'Default', usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
  new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
  rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
  lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
};

/** Zip entry time: 1980-01-01 00:00, the DOS epoch. fflate reads it in local time, so this is the same everywhere. */
const ZIP_TIME = new Date(1980, 0, 1);

/** Shown on the deck's overview screen; the link reopens this exact configuration. @param {Config} config @param {any} meta */
function deckDescription(config, meta) {
  const url = SITE_URL + encodeHash(config, meta);
  return `Made with <a href="${escapeAttr(url)}">AnkiGen</a> · data ${escapeHtml(meta.version.data)}`;
}

/**
 * @param {number} id @param {string} name @param {string} desc @param {number} mod @param {number} usn
 * @param {boolean} collapsed
 */
function deckJson(id, name, desc, mod, usn, collapsed) {
  return {
    id, mod, name, usn, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed, browserCollapsed: collapsed, desc, dyn: 0, conf: 1, extendNew: 0, extendRev: 0,
  };
}

/**
 * Legacy card requirements (`req`), computed the way Anki 2.1 computed them: the fields a template's
 * question needs ("all"), or else the fields any one of which is enough ("any"). Anki ≥ 2.1.28 recomputes
 * these itself; older clients use them to decide which cards a new note gets.
 * @param {NoteType} noteType
 */
function requirements(noteType) {
  const names = noteType.fields;
  /** @param {(name: string) => boolean} filled */
  const fields = (filled) => Object.fromEntries(names.map((n) => [n, filled(n) ? 'ankiflag' : '']));
  return noteType.templates.map((tpl, ord) => {
    /** @param {Record<string, string>} f */
    const question = (f) => renderTemplate(tpl.qfmt, f);
    const empty = question(fields(() => false));
    if (question(fields(() => true)) === empty) return [ord, 'none', []];
    const all = names.flatMap((n, i) => (question(fields((m) => m !== n)).includes('ankiflag') ? [] : [i]));
    if (all.length) return [ord, 'all', all];
    return [ord, 'any', names.flatMap((n, i) => (question(fields((m) => m === n)) === empty ? [] : [i]))];
  });
}

/**
 * @param {NoteType} noteType @param {number} mid @param {number} did @param {number} mod
 */
function modelJson(noteType, mid, did, mod) {
  return {
    id: mid, name: noteType.name, type: 0, mod, usn: -1, sortf: noteType.sortField, did,
    tmpls: noteType.templates.map((t, ord) => ({
      name: t.name, ord, qfmt: t.qfmt, afmt: t.afmt, bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0,
    })),
    flds: noteType.fields.map((name, ord) => ({
      name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, description: '', plainText: false,
      collapsed: false, excludeFromSearch: false, media: [],
    })),
    css: noteType.css, latexPre: LATEX_PRE, latexPost: LATEX_POST, latexsvg: false,
    req: requirements(noteType), tags: [], vers: [],
  };
}

/**
 * Build the .apkg for a deck (buildDeck's output).
 * @param {object} input
 * @param {SqlJs} input.SQL
 * @param {Config} input.config
 * @param {any} input.meta
 * @param {{ notes: DeckNote[], noteType: NoteType }} input.deck
 * @param {Map<string, Uint8Array>} [input.media] the clips the notes' Audio fields name, by media name
 * @param {number} [input.now] export time in milliseconds; tests pass a fixed clock
 * @returns {Promise<Uint8Array>} the zip file
 */
export async function buildApkg({ SQL, config, meta, deck, media = new Map(), now = Date.now() }) {
  const learn = /** @type {string} */ (config.learn);
  const know = /** @type {string} */ (config.know);
  const sec = Math.floor(now / 1000);
  const [did, mid] = await Promise.all([deckId(learn, know), modelId(learn, know)]);
  const { notes, noteType } = deck;
  const names = noteType.fields;

  const rows = await Promise.all(
    notes.map(async (note, i) => {
      const flds = names.map((name) => /** @type {Record<string, string>} */ (note.fields)[name] ?? '');
      const sfld = stripHtml(flds[noteType.sortField]);
      const tags = noteTags(meta, note.modules).sort(); // Anki keeps tags sorted
      return {
        id: noteId(now, i),
        guid: await noteGuid(learn, know, note.key),
        tags: tags.length ? ` ${tags.join(' ')} ` : '',
        flds: flds.join('\x1f'),
        sfld,
        csum: await fieldChecksum(stripHtml(flds[0])),
        ords: cardOrds(noteType, note.fields),
      };
    }),
  );

  const db = new SQL.Database();
  try {
    db.run(SCHEMA);
    db.run('begin');
    db.run('insert into col values (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
      sec, now, now,
      JSON.stringify({
        activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true,
        curModel: mid, nextPos: notes.length, sortType: 'noteFld', sortBackwards: false, addToCur: true,
        schedVer: 2, sched2021: true, dayLearnFirst: false,
      }),
      JSON.stringify({ [mid]: modelJson(noteType, mid, did, sec) }),
      JSON.stringify({
        1: deckJson(1, 'Default', '', 0, 0, true),
        [did]: deckJson(did, deckName(config, meta), deckDescription(config, meta), sec, -1, false),
      }),
      JSON.stringify({ 1: DEFAULT_DCONF }),
      '{}',
    ]);
    const insertNote = db.prepare('insert into notes values (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, \'\')');
    const insertCard = db.prepare('insert into cards values (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, \'{}\')');
    rows.forEach((row, i) => {
      insertNote.run([row.id, row.guid, mid, sec, row.tags, row.flds, row.sfld, row.csum]);
      // New cards: due = note position, so they are studied in deck order.
      for (const ord of row.ords) insertCard.run([cardId(now, i, ord), row.id, did, ord, sec, i]);
    });
    insertNote.free();
    insertCard.free();
    db.run('commit');
    /** @type {import('../../vendor/fflate.js').Zippable} */
    const zip = { 'collection.anki2': [db.export(), { mtime: ZIP_TIME }] };
    const names = mediaNames(notes);
    names.forEach((name, i) => {
      const bytes = media.get(name);
      if (!bytes) throw new Error(`no audio for ${name}`);
      zip[i] = [bytes, { mtime: ZIP_TIME, level: 0 }]; // MP3 is compressed already
    });
    zip.media = [strToU8(JSON.stringify(Object.fromEntries(names.map((name, i) => [i, name])))), { mtime: ZIP_TIME, level: 0 }];
    return zipSync(zip);
  } finally {
    db.close();
  }
}

/** The media the notes name in their Audio fields, in order of first use. @param {DeckNote[]} notes */
export function mediaNames(notes) {
  return [...new Set(notes.flatMap((note) => [...(note.fields.Audio ?? '').matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1])))];
}
