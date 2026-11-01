// @ts-check
// The card list (SPEC §4, ARCHITECTURE §8): every note of the deck, with a search box. Rows have one fixed
// height and only those in view exist, so the whole English deck scrolls smoothly. A row shows the word
// and its translation; clicking it makes the note the preview sample, and its flag button reports a
// problem with it. Keyboard: the list is one tab stop (plus the focused row's flag); arrow keys, Page
// Up/Down, Home and End move between rows. Wide screens show it under the preview, phones in a sheet.

import { noteSummary } from '../deck/fields.js';
import { createSearch } from '../deck/search.js';
import { listEmptyText, listStatus } from './copy.js';
import { debounce, h, icon, msg } from './dom.js';
import { languageEpoch, plural, t } from './i18n.js';

/** @typedef {import('./app.js').View} View */
/** @typedef {import('../deck/select.js').Note} Note */
/** @typedef {import('./feedback.js').ReportFn} ReportFn */

/** Rows rendered beyond each edge of the visible area. */
const OVERSCAN = 8;

/**
 * @param {HTMLElement} root
 * @param {import('./app.js').App} app
 * @param {{ isActive: () => boolean, report: ReportFn, onPick?: (note: Note) => void }} opts
 *   isActive: whether the list is on screen; onPick: after a row became the sample
 */
export function mountCardList(root, app, { isActive, report, onPick }) {
  const search = h('input', {
    type: 'search',
    class: 'cl-search',
    'aria-label': msg('list.search'),
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
  });
  const status = h('p', { class: 'cl-status', role: 'status' });
  const list = h('div', { class: 'cl-list', role: 'list', 'aria-label': msg('list.label') });
  const viewport = h('div', { class: 'cl-viewport' }, list);
  const empty = h('p', { class: 'cl-empty' });
  const body = h('div', { class: 'cl-body' }, h('div', { class: 'cl-tools' }, search, status), viewport);
  root.append(empty, body);

  /** @type {View | null} */
  let view = null;
  /** @type {Note[] | null} the notes the search and the rows were made for */
  let source = null;
  /** @type {ReturnType<typeof createSearch> | null} */
  let finder = null;
  /** @type {Note[]} the notes that match the query, in list order */
  let shown = [];
  /** @type {Map<string, ReturnType<typeof noteSummary>>} */
  let summaries = new Map();
  /** @type {Map<string, HTMLElement>} note key → row in the DOM */
  const rows = new Map();
  /** the interface language the rows were made in */
  let epoch = -1;
  let rowHeight = 0;
  /** the row in the tab order */
  let active = 0;
  let frame = 0;

  /** @param {Note} note */
  function summary(note) {
    let s = summaries.get(note.key);
    if (!s && view?.ctx) summaries.set(note.key, (s = noteSummary(note, view.ctx)));
    return /** @type {ReturnType<typeof noteSummary>} */ (s);
  }

  function measure() {
    const probe = h('div', { class: 'cl-row' }, h('button', { type: 'button', class: 'cl-pick' }, 'x'));
    list.append(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  }

  /** @param {Note} note */
  function makeRow(note) {
    const ctx = /** @type {NonNullable<View['ctx']>} */ (view?.ctx);
    const { word, disambig, translation } = summary(note);
    const pick = h(
      'button',
      { type: 'button', class: 'cl-pick', tabindex: '-1', 'data-concept': note.conceptIds.join(','), 'data-word': word },
      h('span', { class: 'cl-word', lang: ctx.learn.tag, dir: ctx.learn.dir, 'data-field': 'Word' }, word),
      disambig && h('span', { class: 'cl-dis', lang: ctx.know.tag, dir: ctx.know.dir }, disambig),
      h('span', { class: 'cl-tr', lang: ctx.know.tag, dir: ctx.know.dir, 'data-field': 'Translation' }, translation),
    );
    const flag = h('button', { type: 'button', class: 'cl-report', tabindex: '-1', 'aria-label': t('list.report', { word }), title: t('list.reportTitle') }, icon('flag'));
    return h('div', { class: 'cl-row', role: 'listitem', 'data-key': note.key }, pick, flag);
  }

  /** Position, numbering, tab stop and sample mark of a row. @param {HTMLElement} row @param {number} i */
  function place(row, i) {
    const isSample = view?.sample?.key === shown[i].key;
    row.style.top = `${i * rowHeight}px`;
    row.dataset.index = String(i);
    row.setAttribute('aria-posinset', String(i + 1));
    row.setAttribute('aria-setsize', String(shown.length));
    row.classList.toggle('is-sample', isSample);
    const [pick, flag] = /** @type {HTMLElement[]} */ ([...row.children]);
    pick.setAttribute('aria-current', String(isSample));
    pick.tabIndex = flag.tabIndex = i === active ? 0 : -1;
  }

  /** Render the rows in view (and the active one), reusing those already there. */
  function paint() {
    frame = 0;
    if (!view?.ctx || !shown.length) return;
    if (!rowHeight) {
      rowHeight = measure();
      if (!rowHeight) return; // not displayed yet: the resize observer paints later
      list.style.height = `${shown.length * rowHeight}px`;
    }
    const top = viewport.scrollTop;
    const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const last = Math.min(shown.length, Math.ceil((top + viewport.clientHeight) / rowHeight) + OVERSCAN);
    /** @type {Map<string, number>} */
    const wanted = new Map();
    for (let i = first; i < last; i++) wanted.set(shown[i].key, i);
    if (shown[active]) wanted.set(shown[active].key, active);
    for (const [key, row] of rows) {
      if (!wanted.has(key)) {
        row.remove();
        rows.delete(key);
      }
    }
    for (const [key, i] of wanted) {
      let row = rows.get(key);
      if (!row) {
        row = makeRow(shown[i]);
        rows.set(key, row);
        // keep the DOM in list order, for screen readers, without moving rows that may have focus
        const next = [...rows.values()].find((r) => r !== row && Number(r.dataset.index) > i);
        list.insertBefore(row, next ?? null);
      }
      place(row, i);
    }
  }

  /** Match the query again and start the rows over. @param {boolean} keepScroll */
  function refilter(keepScroll) {
    if (!view || !finder) return;
    shown = finder.filter(search.value);
    active = 0;
    for (const row of rows.values()) row.remove();
    rows.clear();
    search.placeholder = plural('searchWords', view.notes.length);
    status.textContent = listStatus(shown.length, view.notes.length, search.value);
    list.style.height = `${shown.length * rowHeight}px`;
    if (!keepScroll) viewport.scrollTop = 0;
    paint();
  }

  /** @param {number} i @param {boolean} toFlag */
  function focusRow(i, toFlag) {
    if (!shown[i] || !rowHeight) return;
    active = i;
    const top = i * rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + rowHeight - viewport.clientHeight;
    paint();
    const target = /** @type {HTMLElement | null | undefined} */ (rows.get(shown[i].key)?.querySelector(toFlag ? '.cl-report' : '.cl-pick'));
    target?.focus({ preventScroll: true });
  }

  search.addEventListener('input', () => refilter(false));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && shown.length) {
      event.preventDefault();
      focusRow(0, false);
    }
  });
  viewport.addEventListener('scroll', () => (frame ||= requestAnimationFrame(paint)), { passive: true });
  // Shown for the first time, resized, or a new text size: measure the rows again.
  new ResizeObserver(() => {
    rowHeight = 0;
    paint();
  }).observe(viewport);

  list.addEventListener('click', (event) => {
    const target = /** @type {Element} */ (event.target);
    const row = /** @type {HTMLElement | null} */ (target.closest('.cl-row'));
    const note = row && shown[Number(row.dataset.index)];
    if (!note) return;
    active = Number(row.dataset.index);
    if (target.closest('.cl-report')) {
      report({ conceptId: note.conceptIds.join(','), word: summary(note).word }, { useSelection: false });
      return;
    }
    app.setSample(note.key);
    onPick?.(note);
  });
  list.addEventListener('focusin', (event) => {
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.cl-row'));
    if (!row || Number(row.dataset.index) === active) return;
    active = Number(row.dataset.index);
    for (const r of rows.values()) place(r, Number(r.dataset.index));
  });
  list.addEventListener('keydown', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const row = /** @type {HTMLElement | null} */ (target.closest('.cl-row'));
    if (!row || !rowHeight) return;
    const i = Number(row.dataset.index);
    const page = Math.max(1, Math.floor(viewport.clientHeight / rowHeight) - 1);
    const next = /** @type {Record<string, number>} */ ({ ArrowDown: i + 1, ArrowUp: i - 1, PageDown: i + page, PageUp: i - page, Home: 0, End: shown.length - 1 })[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusRow(Math.max(0, Math.min(shown.length - 1, next)), target.classList.contains('cl-report'));
  });

  /** @param {View} next */
  function render(next) {
    view = next;
    if (!isActive()) return;
    const message = listEmptyText(next);
    empty.textContent = message;
    empty.hidden = !message;
    body.hidden = Boolean(message);
    if (message || !next.ctx) return;
    const fresh = next.notes !== source;
    if (fresh) {
      source = next.notes;
      finder = createSearch(next.notes, next.ctx);
      summaries = new Map();
    }
    // New notes, or texts in another language: start the rows over.
    if (fresh || epoch !== languageEpoch()) {
      epoch = languageEpoch();
      refilter(true);
    } else {
      for (const row of rows.values()) place(row, Number(row.dataset.index));
    }
  }

  return {
    update: debounce(render, 60),
    /** Render now: the list just came on screen. */
    show() {
      render(app.view());
    },
  };
}
