// Builds decks from the golden sample in tests/fixtures/data, through the same loader the browser uses
// (?data=tests/fixtures/data; meta from data/meta).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createLoader, moduleOrder } from '../../src/data/loader.js';
import { loadAudioIndex } from '../../src/data/clips.js';
import { validate, usesAudio, SAME } from '../../src/state.js';
import { buildDeck } from '../../src/deck/deck.js';
import { mediaNames } from '../../src/deck/apkg.js';

const ROOT = new URL('../../', import.meta.url);

/** fetchJson for Node: repo-relative paths; a missing file is null, like a 404. @param {string} path */
export async function readJsonFile(path) {
  try {
    return JSON.parse(fs.readFileSync(new URL(path, ROOT), 'utf8'));
  } catch (e) {
    if (/** @type {any} */ (e).code === 'ENOENT') return null;
    throw e;
  }
}

/** @param {string} path */
export async function readTextFile(path) {
  try {
    return fs.readFileSync(new URL(path, ROOT), 'utf8');
  } catch {
    return null;
  }
}

export const fixtureLoader = () => createLoader({ fetchJson: readJsonFile, fetchText: readTextFile, dataDir: 'tests/fixtures/data' });

const loader = fixtureLoader();

/** Everything a deck build needs, for a partial config (all modules unless given). @param {Record<string, any>} partial */
export async function fixtureInput(partial) {
  const meta = await loader.getMeta();
  const concepts = await loader.getConcepts();
  const config = validate({ modules: moduleOrder(meta.modules), ...partial }, meta);
  const learnData = await loader.getLanguage(/** @type {string} */ (config.learn));
  const knowData = config.know === SAME ? learnData : await loader.getLanguage(/** @type {string} */ (config.know));
  // the golden sample's clips (tests/fixtures/data/audio), as the browser loads them when audio is on
  const audio = usesAudio(meta, config) ? await loadAudioIndex(loader, meta, /** @type {string} */ (config.learn)) : null;
  return { meta, concepts, config, learnData, knowData, audio, css: (await loader.getCardCss()) ?? '' };
}

/** The clips a deck's notes name, read from their files (each its own file under the fixture's audio/). @param {{ notes: any[], audio: any }} deck */
export function fixtureMedia(deck) {
  return new Map(mediaNames(deck.notes).map((name) => {
    const source = deck.audio.files.get(/-([0-9a-f]+)\.mp3$/.exec(name)?.[1]);
    return [name, new Uint8Array(fs.readFileSync(new URL(source.url, ROOT)))];
  }));
}

/** @param {Record<string, any>} partial */
export async function fixtureDeck(partial) {
  const input = await fixtureInput(partial);
  return { ...input, ...buildDeck(input) };
}

/**
 * Compare with tests/snapshots/<name>.json. UPDATE_SNAPSHOTS=1 rewrites it; a missing snapshot is written
 * on first run, except in CI.
 * @param {string} name @param {unknown} value
 */
export function matchSnapshot(name, value) {
  const file = new URL(`../snapshots/${name}.json`, import.meta.url);
  const text = JSON.stringify(value, null, 1) + '\n';
  if (process.env.UPDATE_SNAPSHOTS || (!fs.existsSync(file) && !process.env.CI)) {
    fs.mkdirSync(new URL('../snapshots/', import.meta.url), { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  assert.equal(text, fs.readFileSync(file, 'utf8'), `snapshot ${name} changed (run with UPDATE_SNAPSHOTS=1 to accept)`);
}
