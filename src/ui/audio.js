// @ts-check
// Pronunciation audio on the page, loaded once the learned language has audio, so the first load stays small: the
// Card options toggle with its warning and "?", the clips of a download, and the preview's play button. Its English
// texts register here (ui/i18n.js addEnglish); data/ui translates them with the others (tools/ui-texts.mjs).

import { fetchClips } from '../data/clips.js';
import { hasAudio } from '../state.js';
import { escapeAttr } from '../text/html.js';
import { h, msg } from './dom.js';
import { addEnglish, t } from './i18n.js';

/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').View} View */

export const AUDIO_STRINGS = {
  'audio.label': 'Pronunciation audio',
  'audio.warning':
    'The most experimental part of AnkiGen, still a prototype: the recordings are machine-generated and nobody has checked them. Stress, readings and accent may be wrong, so don’t rely on them. If you are a native speaker and they sound poor, please tell us with the Feedback button: we take a language’s audio down if needed.',
  'audio.oldDecks':
    'Already imported an AnkiGen deck before audio was added? The first time you import an update, tick “Merge note types” in Anki’s import options; otherwise Anki skips your existing notes, because their note type now has a field for the audio.',
  'audio.help1':
    'Adds a recording of each word you learn: the word only, not its examples, translation or definition. It plays on the front of forward cards and on the back of reverse cards.',
  'audio.help2': 'The recordings are made with Google Cloud Text-to-Speech.',
  'audio.help3':
    'To remove the sound files later, turn the audio off, download the deck and import it again, then delete the unused files with Tools → Check Media in Anki.',
  'audio.play': 'Play the word',
  'audio.loading': 'Loading the pronunciation audio… {percent}%',
  'audio.failed': 'Could not load the pronunciation audio ({error}). Try again, or turn the audio off.',
};

addEnglish(AUDIO_STRINGS);

/**
 * The audio toggle at the end of Card options: after a separator, the switch with its "?" and the warning, always in
 * sight; while it is on, a notice for decks imported before the Audio field existed (they need "Merge note types"
 * once). Shown only while the learned language has audio. `help` is ui/popover.js's, passed in so that this module
 * also loads in Node (tools/ui-texts.mjs reads its texts).
 * @param {HTMLElement} root @param {App} app @param {typeof import('./popover.js').help} help
 */
export function mountAudioOption(root, app, help) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-describedby': 'opt-audio-note opt-audio-old' });
  input.addEventListener('change', () => app.update(() => ({ audio: input.checked })));
  const label = msg('audio.label');
  const notice = h('p', { class: 'opt-notice', id: 'opt-audio-old', role: 'note' }, msg('audio.oldDecks'));
  const el = h(
    'div',
    { class: 'opt-audio' },
    h('div', { class: 'opt' }, h('label', { class: 'switch' }, input, h('span', null, label)), help(label, ['audio.help1', 'audio.help2', 'audio.help3'].map((key) => msg(key)))),
    h('p', { class: 'opt-note', id: 'opt-audio-note' }, msg('audio.warning')),
    notice,
  );
  root.append(el);
  return {
    /** @param {View} view */
    update({ config }) {
      el.hidden = !hasAudio(app.meta, config.learn);
      input.checked = config.audio;
      notice.hidden = !config.audio;
    },
  };
}

/** Clips fetched so far (the preview's and the downloads'), by content hash. @type {Map<string, Uint8Array>} */
const fetched = new Map();

/** The content hash in a media name (ankigen-<lang>-<hash>.mp3, deck/fields.js). @param {string} name */
const hashOf = (name) => /-([0-9a-f]+)\.mp3$/.exec(name)?.[1] ?? '';

/**
 * A download's clips: those the notes name in their Audio fields, by media name, fetched with their progress in the
 * Download status line (and kept). null when they could not be loaded; the status line then says so.
 * @param {App} app @param {{ fields: Record<string, string> }[]} notes @param {(text: () => string) => void} status
 * @returns {Promise<Map<string, Uint8Array> | null>}
 */
export async function deckMedia(app, notes, status) {
  try {
    const media = await clipsOf(app, notes, (got, total) => status(() => t('audio.loading', { percent: Math.floor((100 * got) / total) })));
    status(() => t('download.building'));
    return media;
  } catch (error) {
    status(() => t('audio.failed', { error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

/**
 * The clips the notes name in their Audio fields, by media name; fetched, and kept. Where their bytes are comes from
 * the learned language's index, which the deck was built with.
 * @param {App} app @param {{ fields: Record<string, string> }[]} notes @param {(received: number, total: number) => void} [onProgress]
 * @returns {Promise<Map<string, Uint8Array>>}
 */
async function clipsOf(app, notes, onProgress) {
  const names = [...new Set(notes.flatMap((note) => [...(note.fields.Audio ?? '').matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1])))];
  const files = app.view().ctx?.audio?.files;
  /** @type {Map<string, import('../data/clips.js').ClipSource>} */
  const missing = new Map();
  for (const name of names) {
    const source = fetched.has(hashOf(name)) ? null : files?.get(hashOf(name));
    if (source) missing.set(hashOf(name), source);
  }
  for (const [hash, bytes] of await fetchClips(missing, { onProgress })) fetched.set(hash, bytes);
  /** @type {Map<string, Uint8Array>} */
  const media = new Map();
  for (const name of names) {
    const bytes = fetched.get(hashOf(name));
    if (bytes) media.set(name, bytes);
  }
  return media;
}

/** The preview's clips as data: URLs, by media name ('' when there is none); a promise while loading. @type {Map<string, string | Promise<void>>} */
const urls = new Map();
const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11"/><path d="M10 7.5v9l7-4.5z"/></svg>';

/**
 * The preview's play button for a [sound:name] tag. The sandboxed frame plays the clip itself (PLAYER) from a data:
 * URL, so it needs nothing from the page and the sound starts on the click. While the clip loads the button is
 * disabled; `onLoad` renders again once it is there.
 * @param {App} app @param {string} name @param {() => void} onLoad
 */
export function playButton(app, name, onLoad) {
  const url = urls.get(name);
  if (url === undefined) {
    const done = clipsOf(app, [{ fields: { Audio: `[sound:${name}]` } }]).then((media) => {
      const bytes = media.get(name);
      urls.set(name, bytes ? dataUrl(bytes) : '');
      onLoad();
    });
    urls.set(name, done.catch(() => void urls.delete(name)));
  }
  const src = typeof url === 'string' && url ? `data-src="${url}"` : 'disabled';
  return `<button type="button" class="replay-button ag-play" ${src} aria-label="${escapeAttr(t('audio.play'))}">${ICON}</button>`;
}

/** @param {Uint8Array} bytes */
function dataUrl(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}

/** Runs in each preview frame (as source text, so it must not use anything from this module): a play button plays its clip. */
function player() {
  /** @type {HTMLAudioElement | null} */
  let audio = null;
  document.addEventListener('click', (event) => {
    const button = /** @type {Element} */ (event.target).closest('.ag-play[data-src]');
    if (!button) return;
    audio?.pause();
    audio = new Audio(button.getAttribute('data-src') ?? '');
    audio.play().catch(() => {});
  });
}

export const PLAYER = `<script>(${player})()</script>`;
