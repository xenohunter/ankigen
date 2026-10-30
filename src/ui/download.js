// @ts-check
// Step 6: the summary and the Download button. sql.js and the packager (deck/apkg.js with fflate) load on
// first use, and are prefetched while the browser is idle once this step appears.

import { buildDeck } from '../deck/deck.js';
import { apkgFileName, deckName } from '../deck/names.js';
import { deckSize } from './copy.js';
import { h, msg, whenIdle } from './dom.js';
import { number, t } from './i18n.js';
import { help } from './popover.js';

/** @type {Promise<any> | null} */
let sql = null;

/** The initialized sql.js module: vendor/sql-wasm.js is a classic script that defines initSqlJs. */
function loadSql() {
  sql ??= new Promise((resolve, reject) => {
    const script = h('script', { src: 'vendor/sql-wasm.js' });
    script.addEventListener('load', () => resolve(/** @type {any} */ (window).initSqlJs({ locateFile: (/** @type {string} */ f) => `vendor/${f}` })));
    script.addEventListener('error', () => reject(new Error('could not load vendor/sql-wasm.js')));
    document.head.append(script);
  });
  sql.catch(() => (sql = null)); // a later click retries
  return sql;
}

const loadPackager = () => import('../deck/apkg.js');

/** Hand the bytes to the browser as a file download. @param {Uint8Array} bytes @param {string} name */
function save(bytes, name) {
  const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type: 'application/octet-stream' }));
  const link = h('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * @param {HTMLElement} root
 * @param {import('./app.js').App} app
 * @param {{ onSaved?: () => void }} [opts] onSaved: a deck was handed to the browser
 */
export function mountDownload(root, app, { onSaved } = {}) {
  const deck = h('dd');
  const size = h('dd');
  const file = h('dd', { class: 'dl-file' });
  const audio = [h('dt', null, msg('download.audio')), h('dd')];
  const button = h('button', { type: 'button', class: 'button primary' }, msg('download.button'));
  const status = h('p', { class: 'dl-status', role: 'status' });
  /** The status line, worked out again in the interface language on every update. @type {() => string} */
  let say = () => '';
  const updateHelp = h(
    'div',
    null,
    h('p', null, h('strong', null, msg('update.title'))),
    h('p', null, msg('update.intro')),
    h('ul', null, ...['update.edits', 'update.deck', 'update.noteType', 'update.reverse'].map((key) => h('li', null, msg(key)))),
  );
  root.append(
    h('dl', { class: 'dl-summary' }, h('dt', null, msg('download.deck')), deck, h('dt', null, msg('download.size')), size, ...audio, h('dt', null, msg('download.file')), file),
    h('div', { class: 'dl-actions' }, button, h('span', { class: 'dl-help' }, msg('download.later'), help(msg('download.laterTopic'), updateHelp))),
    status,
  );

  let busy = false;
  let prefetched = false;

  /** @param {() => string} text */
  function setStatus(text) {
    say = text;
    status.textContent = text();
  }

  button.addEventListener('click', async () => {
    const input = app.deckInput();
    if (!input || busy) return;
    if (!globalThis.crypto?.subtle) {
      // Note IDs are SHA-256 hashes, and browsers offer crypto.subtle only on HTTPS and localhost.
      setStatus(() => t('download.secure'));
      return;
    }
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus(() => t('download.building'));
    try {
      const [SQL, { buildApkg }] = await Promise.all([loadSql(), loadPackager()]);
      const built = buildDeck(input);
      const media = input.audio ? await (await import('./audio.js')).deckMedia(app, built.notes, setStatus) : undefined;
      if (media === null) return; // the clips could not be loaded; the status says so
      const bytes = await buildApkg({ SQL, config: input.config, meta: input.meta, deck: built, media });
      const name = apkgFileName(input.config, input.meta);
      save(bytes, name);
      setStatus(() => t('download.saved', { file: name }));
      onSaved?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatus(() => t('download.failed', { error: reason }));
    } finally {
      busy = false;
      button.removeAttribute('aria-busy');
      button.disabled = !app.view().notes.length;
    }
  });

  return {
    /** @param {import('./app.js').View} view */
    update(view) {
      const { config, ready, notes, cards } = view;
      const said = say(); // the same text again would be announced again
      if (status.textContent !== said) status.textContent = said;
      if (!config.learn || !config.know) return;
      deck.textContent = deckName(config, app.meta);
      size.textContent = ready ? deckSize(notes.length, cards) : t('download.loading');
      file.textContent = apkgFileName(config, app.meta);
      const clips = view.audio;
      for (const el of audio) el.hidden = !clips;
      if (clips) audio[1].textContent = 'bytes' in clips ? t('download.audioSize', { size: number(Math.ceil(clips.bytes / 104857.6) / 10) }) : t('download.loading');
      if (!busy) button.disabled = !notes.length || !app.deckInput(); // the words, and the clips if any, are loaded
      if (!prefetched && config.modules.length) {
        prefetched = true;
        whenIdle(() => {
          loadSql().catch(() => {});
          loadPackager().catch(() => {});
        });
      }
    },
  };
}
