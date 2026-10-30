// @ts-check
// The live preview (ARCHITECTURE §8): the sample note's card faces, rendered from the deck's own templates
// by deck/render.js, each in a frame with card.css. The frames are sandboxed with an opaque origin: they can't
// reach the page, its storage or its address. Their only script is the bridge below: it tells the page the
// face's height, so the frame shows all of it without scrolling, and the text selected on it, for reports (the
// body carries the note's concept IDs and word); Ctrl/Cmd+Enter on a card opens a report as on the page.
// [sound:…] is ui/audio.js's play button, played in the frame.
// Light or dark follows the page, as Anki's night mode follows the app.

import { noteFields } from '../deck/fields.js';
import { renderCard } from '../deck/render.js';
import { escapeAttr, stripHtml } from '../text/html.js';
import { deckSize } from './copy.js';
import { debounce, h, live, msg } from './dom.js';
import { t } from './i18n.js';

/** @typedef {import('./app.js').View} View */
/** @typedef {import('./feedback.js').ReportContext} ReportContext */

const FRAME_STYLE = 'html,body{margin:0;overflow:hidden}body{padding:12px 10px;overflow-wrap:break-word}';
const dark = window.matchMedia('(prefers-color-scheme: dark)');
/** Where the frames post to: this page (an opaque origin, as from file://, can only be reached with '*'). */
const PAGE = location.origin === 'null' ? '*' : location.origin;

/**
 * Runs in every frame (as source text, so it must not use anything from this module). Posts { ankigen: 1, type }
 * messages to the page: 'size' with the body's height, 'selection' with the selected text and where it is (or
 * null), 'shortcut' for Ctrl/Cmd+Enter. Clears its selection when the page posts 'clear'.
 * @param {string} page the page's origin
 */
function bridge(page) {
  /** @param {object} message */
  const post = (message) => parent.postMessage({ ankigen: 1, ...message }, page);
  const body = document.body;
  let height = -1;
  const size = () => {
    const next = Math.ceil(body.getBoundingClientRect().height);
    if (next !== height) post({ type: 'size', height: (height = next) });
  };
  new ResizeObserver(size).observe(body);
  document.fonts.ready.then(size);
  /** @param {Element | null} el @param {string} name */
  const attr = (el, name) => el?.closest(`[${name}]`)?.getAttribute(name) ?? '';
  document.addEventListener('selectionchange', () => {
    const s = document.getSelection();
    const text = s && s.rangeCount && !s.isCollapsed ? s.toString().replace(/\s+/g, ' ').trim() : '';
    if (!s || !text) return post({ type: 'selection', selection: null });
    const node = s.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node.parentElement;
    const selection = { selectedText: text.slice(0, 1000), conceptId: attr(el, 'data-concept'), word: attr(el, 'data-word'), field: attr(el, 'data-field'), direction: attr(el, 'data-dir'), side: attr(el, 'data-side') };
    post({ type: 'selection', selection });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
    event.preventDefault();
    post({ type: 'shortcut' });
  });
  window.addEventListener('message', (event) => {
    if (event.source === parent && event.data?.ankigen === 1 && event.data.type === 'clear') document.getSelection()?.removeAllRanges();
  });
}

const BRIDGE = `<script>(${bridge})(${JSON.stringify(PAGE)})</script>`;

/** @type {typeof import('./audio.js') | null} */
let audio = null;

/** @param {string} css @param {string} html @param {{ concept: string, word: string }} note @param {string} [player] */
function frameDoc(css, html, { concept, word }, player = '') {
  const night = dark.matches ? ' nightMode night_mode' : '';
  const data = `data-concept="${escapeAttr(concept)}" data-word="${escapeAttr(word)}"`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}\n${FRAME_STYLE}</style></head><body class="card${night}" ${data}><div id="qa">${html}</div>${BRIDGE}${player}</body></html>`;
}

/** A selection as a frame reported it, with only what a report keeps. @param {any} s @returns {ReportContext | null} */
function selectionOf(s) {
  const text = (/** @type {unknown} */ v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (!s || !text(s.selectedText, 1000)) return null;
  return {
    selectedText: text(s.selectedText, 1000),
    conceptId: text(s.conceptId),
    word: text(s.word),
    field: text(s.field, 40),
    direction: text(s.direction, 20),
    side: text(s.side, 20),
  };
}

/** @param {View} view */
function emptyText({ config, ready, notes }) {
  if (!config.learn || !config.know) return t('preview.pickLanguages');
  if (!ready) return t('preview.loading');
  if (!config.modules.length) return t('preview.pickModules');
  if (!notes.length) return t('preview.empty');
  return '';
}

/**
 * @param {HTMLElement} root
 * @param {import('./app.js').App} app
 * @param {{ id: string, isActive: () => boolean, frames: import('./feedback.js').FrameReports, onReset: () => void }} opts
 *   id: prefix for heading ids; isActive: whether the preview is on screen; frames: where the frames' selections
 *   and shortcuts go; onReset: "Reset all" (ui/reset.js asks first)
 */
export function mountPreview(root, app, { id, isActive, frames, onReset }) {
  const counter = h('p', { class: 'pv-count', 'aria-live': 'polite' });
  const another = h('button', { type: 'button', class: 'button pv-another', onclick: () => app.randomSample() }, msg('preview.another'));
  const resetButton = h('button', { type: 'button', class: 'button pv-reset', title: msg('reset.text'), onclick: onReset }, msg('reset.button'));
  const empty = h('p', { class: 'pv-empty' });
  /** @type {{ ord: number, side: 'front' | 'back', frame: HTMLIFrameElement, doc: string }[]} */
  const faces = [];
  /** @type {HTMLElement[]} */
  const directions = [];
  for (const [ord, card] of /** @type {[number, string][]} */ ([[0, 'preview.forward'], [1, 'preview.reverse']])) {
    const figures = /** @type {const} */ (['front', 'back']).map((side) => {
      const sideKey = side === 'front' ? 'preview.front' : 'preview.back';
      const title = live(() => t('preview.face', { card: t(card), side: t(sideKey) }));
      const frame = h('iframe', { sandbox: 'allow-scripts', title, class: 'pv-frame' });
      faces.push({ ord, side, frame, doc: '' });
      return h('figure', { class: 'pv-face' }, h('figcaption', null, msg(sideKey)), frame);
    });
    const section = h('section', { class: 'pv-dir', 'aria-labelledby': `${id}-dir-${ord}` }, h('h3', { id: `${id}-dir-${ord}` }, msg(card)), h('div', { class: 'pv-pair' }, ...figures));
    directions.push(section);
  }
  const body = h('div', { class: 'pv-faces' }, ...directions);
  root.append(h('div', { class: 'pv-tools' }, counter, h('div', { class: 'pv-actions' }, another, resetButton)), empty, body);

  window.addEventListener('message', (event) => {
    const face = faces.find((f) => f.frame.contentWindow === event.source);
    const data = event.data;
    if (!face?.frame.contentWindow || data?.ankigen !== 1) return;
    if (data.type === 'size') {
      const height = Number(data.height);
      if (!Number.isFinite(height) || height < 0 || height > 50_000) return;
      const style = getComputedStyle(face.frame);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      face.frame.style.height = `${Math.ceil(height + borders)}px`;
    } else if (data.type === 'selection') {
      frames.select(face.frame.contentWindow, selectionOf(data.selection));
    } else if (data.type === 'shortcut') {
      frames.shortcut();
    }
  });

  let stale = true;

  /** @param {View} view */
  function render(view) {
    if (!isActive()) {
      stale = true;
      return;
    }
    stale = false;
    counter.textContent = view.ready && view.config.modules.length ? deckSize(view.notes.length, view.cards) : '';
    const message = emptyText(view);
    empty.textContent = message;
    empty.hidden = !message;
    body.hidden = Boolean(message);
    another.hidden = Boolean(message);
    another.disabled = view.notes.length < 2;
    resetButton.hidden = !view.config.learn; // nothing chosen yet: nothing to reset
    if (message || !view.sample || !view.ctx || !view.noteType) return;
    const fields = noteFields(view.sample, view.ctx);
    const css = view.noteType.css;
    const note = { concept: view.sample.conceptIds.join(','), word: stripHtml(fields.Word) };
    directions[1].hidden = !view.config.reverse;
    if (fields.Audio && !audio) {
      import('./audio.js').then((m) => {
        audio = m;
        render(app.view());
      }, () => {});
    }
    const sound = (/** @type {string} */ name) => audio?.playButton(app, name, () => render(app.view())) ?? '';
    for (const face of faces) {
      const card = renderCard(view.noteType, fields, face.ord, { typeLabel: t('preview.typeAnswer'), sound });
      if (!card) continue;
      const doc = frameDoc(css, card[face.side], note, audio?.PLAYER);
      if (doc !== face.doc) {
        face.doc = doc;
        face.frame.srcdoc = doc;
        // The new face starts without a selection.
        if (face.frame.contentWindow) frames.select(face.frame.contentWindow, null);
      }
    }
  }

  const scheduled = debounce(render, 60);
  dark.addEventListener('change', () => {
    for (const face of faces) face.doc = '';
    render(app.view());
  });

  return {
    /** The first render is immediate, or the panel would show empty frames for a moment; later ones are debounced. @param {View} view */
    update(view) {
      if (stale) render(view);
      else scheduled(view);
    },
    /** Render now if updates were skipped while hidden. */
    show() {
      if (stale) render(app.view());
    },
  };
}
