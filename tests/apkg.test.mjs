// The .apkg export (ARCHITECTURE §7): built from the fixtures, unzipped and reopened with sql.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from '../vendor/fflate.js';
import { buildApkg } from '../src/deck/apkg.js';
import { apkgFileName, deckName } from '../src/deck/names.js';
import { FIELD_NAMES } from '../src/deck/fields.js';
import { cardId, deckId, fieldChecksum, modelId, noteGuid, noteId } from '../src/deck/ids.js';
import { stripHtml } from '../src/text/html.js';
import { fixtureDeck } from './helpers/fixtures.mjs';
import { loadSqlJs } from '../tools/lib/sqljs.mjs';

const NOW = 1_792_300_000_000; // fixed export clock, ms
const SEC = NOW / 1000;
const DAY = 86_400_000;

/** @param {Record<string, any>} partial @param {number} [now] */
async function build(partial, now = NOW) {
  const deck = await fixtureDeck(partial);
  const SQL = await loadSqlJs();
  const bytes = await buildApkg({ SQL, config: deck.config, meta: deck.meta, deck, now });
  return { ...deck, bytes, ...open(SQL, bytes) };
}

/** @param {any} SQL @param {Uint8Array} bytes */
function open(SQL, bytes) {
  const files = unzipSync(bytes);
  const db = new SQL.Database(files['collection.anki2']);
  /** @param {string} sql @returns {Record<string, any>[]} */
  const rows = (sql) => {
    const [res] = db.exec(sql);
    return res ? res.values.map((/** @type {any[]} */ v) => Object.fromEntries(res.columns.map((/** @type {string} */ c, /** @type {number} */ i) => [c, v[i]]))) : [];
  };
  const col = rows('select * from col')[0];
  return { files, rows, col, json: (/** @type {string} */ key) => JSON.parse(col[key]) };
}

/** Names and DOS times from the zip's central directory. @param {Uint8Array} bytes */
function zipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22; // end-of-central-directory record, no archive comment
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const entries = [];
  for (let i = 0, p = view.getUint32(end + 16, true); i < view.getUint16(end + 10, true); i++) {
    const nameLength = view.getUint16(p + 28, true);
    entries.push({
      name: strFromU8(bytes.subarray(p + 46, p + 46 + nameLength)),
      time: view.getUint16(p + 12, true),
      date: view.getUint16(p + 14, true),
    });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

test('the zip holds collection.anki2 and an empty media map, dated 1980-01-01 00:00', async () => {
  const { bytes, files } = await build({ learn: 'ru', know: 'en' });
  const dos1980 = (0 << 9) | (1 << 5) | 1;
  assert.deepEqual(zipDirectory(bytes), [
    { name: 'collection.anki2', time: 0, date: dos1980 },
    { name: 'media', time: 0, date: dos1980 },
  ]);
  assert.equal(strFromU8(files.media), '{}');
});

test('the collection has the schema-11 tables, indexes and col row', async () => {
  const { rows, col, json } = await build({ learn: 'ru', know: 'en' });
  const objects = rows("select type, name from sqlite_master order by type, name").map((r) => `${r.type}:${r.name}`);
  assert.deepEqual(objects, [
    'index:ix_cards_nid', 'index:ix_cards_sched', 'index:ix_cards_usn', 'index:ix_notes_csum', 'index:ix_notes_usn',
    'index:ix_revlog_cid', 'index:ix_revlog_usn',
    'table:cards', 'table:col', 'table:graves', 'table:notes', 'table:revlog',
  ]);
  assert.deepEqual({ ...col, conf: undefined, models: undefined, decks: undefined, dconf: undefined }, {
    id: 1, crt: SEC, mod: NOW, scm: NOW, ver: 11, dty: 0, usn: 0, ls: 0,
    conf: undefined, models: undefined, decks: undefined, dconf: undefined, tags: '{}',
  });
  const mid = await modelId('ru', 'en');
  assert.equal(json('conf').curModel, mid);
  assert.equal(json('conf').schedVer, 2);
  assert.deepEqual(Object.keys(json('dconf')), ['1']);
  assert.equal(rows('select count() as n from revlog')[0].n + rows('select count() as n from graves')[0].n, 0);
});

test('one note type: fixed fields, Forward/Reverse templates, card.css verbatim, legacy req', async () => {
  const { json, noteType, css } = await build({ learn: 'ru', know: 'en', reverse: true });
  const mid = await modelId('ru', 'en');
  const models = json('models');
  assert.deepEqual(Object.keys(models), [String(mid)]);
  const m = models[mid];
  assert.equal(m.id, mid);
  assert.equal(m.name, 'AnkiGen Русский (English)');
  assert.equal(m.did, await deckId('ru', 'en'));
  assert.deepEqual([m.type, m.mod, m.usn, m.sortf], [0, SEC, -1, 0]);
  assert.deepEqual(m.flds.map((/** @type {any} */ f) => [f.ord, f.name]), FIELD_NAMES.map((name, ord) => [ord, name]));
  assert.deepEqual(m.tmpls.map((/** @type {any} */ t) => [t.ord, t.name, t.qfmt, t.afmt]),
    noteType.templates.map((t, ord) => [ord, t.name, t.qfmt, t.afmt]));
  assert.ok(css.length > 0 && m.css === css);
  // What Anki itself computes for these templates (checked against Anki 26.09): the forward question needs
  // Word or Disambig; the reverse one needs Translation and Reverse.
  assert.deepEqual(m.req, [[0, 'any', [0, 3]], [1, 'all', [4, 18]]]);
});

test('decks: Default plus AnkiGen::<pair> with the stable id and a link back to this configuration', async () => {
  const { json, config, meta } = await build({ learn: 'ru', know: 'en', modules: ['core-1'] });
  const did = await deckId('ru', 'en');
  const decks = json('decks');
  assert.deepEqual(Object.keys(decks), ['1', String(did)]);
  assert.equal(decks[1].name, 'Default');
  const deck = decks[did];
  assert.deepEqual([deck.id, deck.name, deck.mod, deck.usn, deck.conf, deck.dyn], [did, 'AnkiGen::Русский (English)', SEC, -1, 1, 0]);
  assert.equal(deckName(config, meta), deck.name);
  assert.equal(
    deck.desc,
    'Made with <a href="https://xenohunter.github.io/ankigen/#v1&amp;l=ru&amp;k=en&amp;m=core-1&amp;x=2">AnkiGen</a> · data ' + meta.version.data,
  );
});

test('notes: stable GUIDs, clock ids, fields in order, Anki sort field and checksum, sorted tags', async () => {
  const { rows, notes } = await build({ learn: 'ru', know: 'en', reverse: true });
  const mid = await modelId('ru', 'en');
  const stored = rows('select * from notes order by id');
  assert.equal(stored.length, notes.length);
  for (const [i, note] of notes.entries()) {
    const row = stored[i];
    const sfld = stripHtml(note.fields.Word);
    assert.deepEqual(row, {
      id: noteId(NOW, i),
      guid: await noteGuid('ru', 'en', note.key),
      mid,
      mod: SEC,
      usn: -1,
      tags: row.tags,
      flds: FIELD_NAMES.map((f) => note.fields[f]).join('\x1f'),
      sfld,
      csum: await fieldChecksum(sfld),
      flags: 0,
      data: '',
    });
    const tags = row.tags.trim().split(' ');
    assert.deepEqual(tags, [...tags].sort());
    assert.match(row.tags, /^ (ankigen::[a-z-]+::[a-z0-9-]+ )+$/);
  }
  // рука́ = hand + arm: one note, keyed by word-hand.
  const ruka = stored.find((r) => r.guid === 'wV3#_8fELM');
  assert.equal(ruka?.sfld, 'рука́ f.');
  assert.equal(ruka?.flds.split('\x1f')[FIELD_NAMES.indexOf('Translation')], '<span class="m">hand;</span> <span class="m">arm</span>');
  assert.equal(ruka?.tags, ' ankigen::foundations::core-1 ankigen::health-safety::health ');
});

test('cards: a forward card per note, reverse only when on; clock ids; due = note position', async () => {
  for (const reverse of [false, true]) {
    const { rows, notes } = await build({ learn: 'ru', know: 'en', reverse });
    const did = await deckId('ru', 'en');
    const expected = notes.flatMap((_, i) => (reverse ? [0, 1] : [0]).map((ord) => ({
      id: cardId(NOW, i, ord), nid: noteId(NOW, i), did, ord, mod: SEC, usn: -1, type: 0, queue: 0, due: i,
      ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, flags: 0, data: '{}',
    })));
    assert.deepEqual(rows('select * from cards order by id'), expected);
    const reverseField = rows('select flds from notes').map((r) => r.flds.split('\x1f')[FIELD_NAMES.indexOf('Reverse')]);
    assert.ok(reverseField.every((v) => v === (reverse ? '1' : '')));
  }
});

test('same-language decks use "=" in the hashes and "definitions" in the names', async () => {
  const { rows, json, config, meta, notes } = await build({ learn: 'en', know: '=' });
  const did = await deckId('en', '=');
  assert.equal(json('decks')[did].name, 'AnkiGen::English (definitions)');
  assert.equal(json('models')[await modelId('en', '=')].name, 'AnkiGen English (definitions)');
  assert.equal(rows('select guid from notes order by id')[0].guid, await noteGuid('en', '=', notes[0].key));
  assert.equal(apkgFileName(config, meta), `ankigen-en-en-${meta.version.data}.apkg`);
  assert.equal(apkgFileName({ ...config, know: 'ru' }, meta), `ankigen-en-ru-${meta.version.data}.apkg`);
});

test('an empty selection still gives a valid, empty package', async () => {
  const { rows, json } = await build({ learn: 'ja', know: 'ru', modules: [] });
  assert.equal(rows('select count() as n from notes')[0].n, 0);
  assert.equal(Object.keys(json('models')).length, 1);
});

test('with a fixed clock two builds are byte-identical', async () => {
  const a = await build({ learn: 'ja', know: 'de', reverse: true, type: true });
  const b = await build({ learn: 'ja', know: 'de', reverse: true, type: true });
  assert.deepEqual(b.bytes, a.bytes);
  const other = await build({ learn: 'ja', know: 'de', reverse: true });
  assert.notDeepEqual(other.bytes, a.bytes);
});

test('another clock changes only the timestamp columns and the ids derived from it', async () => {
  const a = await build({ learn: 'ja', know: 'ru', reverse: true });
  const b = await build({ learn: 'ja', know: 'ru', reverse: true }, NOW + DAY);
  /** @param {Record<string, any>[]} list @param {string[]} keys */
  const without = (list, keys) => list.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))));
  assert.deepEqual(without(b.rows('select * from notes order by id'), ['id', 'mod']), without(a.rows('select * from notes order by id'), ['id', 'mod']));
  assert.deepEqual(without(b.rows('select * from cards order by id'), ['id', 'nid', 'mod']), without(a.rows('select * from cards order by id'), ['id', 'nid', 'mod']));
  assert.deepEqual(b.rows('select nid from cards order by id').map((r) => r.nid - NOW - DAY), a.rows('select nid from cards order by id').map((r) => r.nid - NOW));
  for (const key of ['models', 'decks']) {
    /** @param {Record<string, any>} objects */
    const strip = (objects) => Object.values(objects).map((o) => ({ ...o, mod: 0 }));
    assert.deepEqual(strip(b.json(key)), strip(a.json(key)));
  }
  assert.deepEqual([b.json('conf'), b.json('dconf'), b.col.tags], [a.json('conf'), a.json('dconf'), a.col.tags]);
  assert.deepEqual([b.col.crt, b.col.mod], [SEC + DAY / 1000, NOW + DAY]);
});
