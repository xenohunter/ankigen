// The page's DOM-free parts: the step rule, counts, and the app model on the fixtures. (The interface
// language is tested in tests/i18n.test.mjs; here the texts are English.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shownSteps } from '../src/ui/steps.js';
import { deckSize, listStatus, localTermsHelp } from '../src/ui/copy.js';
import { plural } from '../src/ui/i18n.js';
import { createApp } from '../src/ui/app.js';
import { localTerms } from '../src/deck/select.js';
import { buildDeck } from '../src/deck/deck.js';
import { cardOrds } from '../src/deck/render.js';
import { createLoader } from '../src/data/loader.js';
import { defaultConfig, hasAudio, validate } from '../src/state.js';
import { fixtureInput, fixtureLoader } from './helpers/fixtures.mjs';
import { loadMeta } from './helpers/meta.mjs';

const meta = loadMeta();

/** An app on the fixture data, settled. @param {Record<string, any>} partial @param {() => number} [random] */
async function fixtureApp(partial, random) {
  const app = createApp({ loader: fixtureLoader(), meta, initial: validate(partial, meta), random });
  await app.settled();
  return app;
}

test('each step appears once the previous one has a choice', () => {
  const steps = (/** @type {Record<string, any>} */ c) => Object.entries(shownSteps(validate(c, meta))).filter(([, on]) => on).map(([s]) => s);
  assert.deepEqual(steps({}), ['learn']);
  assert.deepEqual(steps({ learn: 'ja' }), ['learn', 'know']);
  assert.deepEqual(steps({ learn: 'ja', know: 'ru' }), ['learn', 'know', 'modules']);
  assert.deepEqual(steps({ learn: 'ja', know: '=', modules: ['food'] }), ['learn', 'know', 'modules', 'fields', 'options', 'download', 'share']);
  // Later choices are kept, but their steps stay hidden while an earlier step is open again.
  assert.deepEqual(steps({ learn: 'ja', modules: ['food'] }), ['learn', 'know']);
});

test('counts read naturally', () => {
  assert.equal(plural('note', 1), '1 note');
  assert.equal(plural('note', 1734), '1,734 notes');
  assert.equal(deckSize(1734, 3468), '1,734 notes · 3,468 cards');
  assert.equal(
    localTermsHelp(1, '住民票'),
    '1 word here exists only in the language you are learning, such as 住民票. Other languages have no exact word for it, so your cards explain it in the language you speak.',
  );
  assert.match(localTermsHelp(12, 'green card'), /^12 words here exist only in the language you are learning, such as green card\. .* for them, so your cards explain them/);
  assert.equal(listStatus(1734, 1734, ''), '', 'the search box shows the total');
  assert.equal(listStatus(12, 1734, ' water '), '12 of 1,734 words');
  assert.equal(listStatus(0, 1734, 'xqz'), 'No words match “xqz”.');
});

test('audio: the deck view has clips only where the learned language has audio; a download waits for them', async () => {
  const loading = createApp({ loader: fixtureLoader(), meta, initial: validate({ learn: 'ru', know: 'en', modules: ['core-1'], audio: true }, meta) });
  assert.equal(loading.deckInput(), null);
  await loading.settled();
  const view = loading.view();
  const manifest = JSON.parse(fs.readFileSync(new URL('fixtures/data/audio/ru/manifest.json', import.meta.url), 'utf8'));
  const files = new Map(view.notes.flatMap((n) => n.conceptIds).map((id) => [manifest[id].file, manifest[id].bytes]));
  assert.deepEqual(view.audio, { clips: files.size, bytes: [...files.values()].reduce((a, b) => a + b, 0) });
  assert.equal(files.size, 10, 'рука́ hand/arm and both брат share a clip');
  assert.ok(loading.deckInput()?.audio, 'then the download has the clips');
  assert.equal((await fixtureApp({ learn: 'ru', know: 'en', modules: ['core-1'] })).view().audio, null, 'audio off');
  // Armenian has no voice: no toggle (ui/options.js shows it where hasAudio), no clips, and the choice is kept.
  const hy = await fixtureApp({ learn: 'hy', know: 'en', modules: ['core-1'], audio: true });
  assert.equal(hasAudio(meta, 'hy'), false);
  assert.equal(hy.view().audio, null);
  assert.equal(hy.store.get().audio, true);
  assert.ok(['ru', 'de', 'ja', 'en', 'sr'].every((code) => hasAudio(meta, code)));
});

test('the app loads what the config needs and derives the deck view', async () => {
  const app = await fixtureApp({ learn: 'ru', know: 'en', modules: ['core-1'] });
  const view = app.view();
  assert.equal(view.ready, true);
  assert.equal(view.notes.length, 10); // 12 core-1 concepts, рука́ merges hand + arm, word-day-24h is in time
  assert.equal(view.cards, 10);
  assert.equal(view.counts.get('core-1'), 12);
  assert.equal(view.counts.get('time'), 3);
  assert.ok(view.sample && view.notes.includes(view.sample));
  assert.equal(app.view(), view, 'memoized while nothing changes');

  app.update(() => ({ reverse: true }));
  assert.equal(app.view().cards, 20);
  assert.equal(app.view().sample?.key, view.sample?.key, 'the sample stays when settings change');

  app.update((c) => ({ modules: [...c.modules, 'time'] }));
  assert.equal(app.view().notes.length, 11);
});

test('the app keeps a chosen sample while it is in the deck, else falls back to the default', async () => {
  const app = await fixtureApp({ learn: 'ru', know: 'en', modules: ['core-1'] }, () => 0);
  const first = app.view().sample?.key;
  const notes = app.view().notes;
  app.randomSample();
  const random = app.view().sample?.key;
  assert.ok(random && random !== first);
  assert.equal(app.view().notes, notes, 'a new sample reuses the deck, so the word list keeps its search index');
  app.setSample('word-monday');
  assert.equal(app.view().sample?.key, 'word-monday');
  app.update(() => ({ modules: ['time'] })); // word-monday is in core-1 and time
  assert.equal(app.view().sample?.key, 'word-monday');
  app.update(() => ({ modules: ['food'] })); // word-monday is not in food: back to the default sample
  const fallback = app.view().sample;
  assert.ok(fallback && fallback.key !== 'word-monday' && app.view().notes.includes(fallback));
});

test('the app is not ready until both languages are loaded, and survives a failing loader', async () => {
  const loader = createLoader({ fetchJson: async () => Promise.reject(new Error('offline')), fetchText: async () => null, dataDir: 'x' });
  const app = createApp({ loader, meta, initial: { ...defaultConfig(meta), learn: 'ja', know: 'ru', modules: ['core-1'] } });
  assert.equal(app.view().ready, false);
  assert.equal(app.isLoading('ja'), true);
  await app.settled();
  assert.equal(app.hasFailed('concepts'), true);
  assert.equal(app.view().ready, true);
  assert.equal(app.view().notes.length, 0);
});

test('localTerms counts the words only some languages have, per module', async () => {
  const ja = await fixtureInput({ learn: 'ja', know: 'de' });
  assert.deepEqual([...localTerms(ja.config, ja.meta, ja.concepts, ja.learnData, ja.knowData)], [['residence', { count: 1, example: '住民票' }]]);
  const ru = await fixtureInput({ learn: 'ru', know: 'en' });
  assert.deepEqual([...localTerms(ru.config, ru.meta, ru.concepts, ru.learnData, ru.knowData)], [['time', { count: 1, example: 'су́тки' }]]);
  const en = await fixtureInput({ learn: 'en', know: 'ru' });
  assert.equal(localTerms(en.config, en.meta, en.concepts, en.learnData, en.knowData).size, 0);
});

test('the live card count equals the cards the export creates', async () => {
  for (const partial of [
    { learn: 'ru', know: 'en', reverse: true },
    { learn: 'ja', know: 'de', reverse: true, type: true },
    { learn: 'en', know: '=', reverse: true },
    { learn: 'sr', know: 'en' },
  ]) {
    const app = await fixtureApp({ modules: meta.modules.categories.flatMap((/** @type {any} */ c) => c.modules.map((/** @type {any} */ m) => m.id)), ...partial });
    const input = /** @type {NonNullable<ReturnType<typeof app.deckInput>>} */ (app.deckInput());
    const deck = buildDeck(input);
    const exported = deck.notes.reduce((n, note) => n + cardOrds(deck.noteType, note.fields).length, 0);
    assert.equal(app.view().cards, exported, JSON.stringify(partial));
  }
});
