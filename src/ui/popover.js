// @ts-check
// "?" buttons that open a short explanation, and the placing of popovers. The native Popover API closes a
// popover on Esc or an outside click and returns focus; this module only places it under its button, inside
// the viewport.

import { t } from './i18n.js';
import { h, live, textOf } from './dom.js';

/** @typedef {import('./dom.js').Live} Live */

let nextId = 0;
/** @type {{ pop: HTMLElement, anchor: HTMLElement, align: Align } | null} */
let open = null;

/** @typedef {'center' | 'end'} Align  centered under the button, or ending where it ends (its left edge right to left) */

/** @param {HTMLElement} pop @param {HTMLElement} anchor @param {Align} [align] */
function place(pop, anchor, align = 'center') {
  const gap = 6;
  const margin = 8;
  const r = anchor.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  const width = Math.min(align === 'end' ? pop.offsetWidth : 340, viewport - 2 * margin);
  if (align === 'center') pop.style.width = `${width}px`;
  const end = document.documentElement.dir === 'rtl' ? r.left : r.right - width;
  const left = align === 'end' ? end : r.left + r.width / 2 - width / 2;
  pop.style.left = `${Math.min(Math.max(margin, left), viewport - width - margin)}px`;
  const height = pop.offsetHeight;
  const below = r.bottom + gap;
  const fitsBelow = below + height <= window.innerHeight - margin;
  pop.style.top = `${fitsBelow || r.top - gap - height < margin ? below : r.top - gap - height}px`;
}

/**
 * Keep a popover placed at its button while it is open.
 * @param {HTMLElement} pop @param {HTMLElement} anchor @param {Align} [align]
 */
export function anchorTo(pop, anchor, align = 'center') {
  pop.addEventListener('toggle', (event) => {
    const opened = /** @type {ToggleEvent} */ (event).newState === 'open';
    if (opened) {
      open = { pop, anchor, align };
      place(pop, anchor, align);
    } else if (open?.pop === pop) {
      open = null;
    }
  });
}

window.addEventListener('scroll', () => open && place(open.pop, open.anchor, open.align), { passive: true, capture: true });
window.addEventListener('resize', () => open && place(open.pop, open.anchor, open.align));

/**
 * A "?" button and its popover, to insert next to the control it explains.
 * @param {string | Live} topic for the accessible name: "About <topic>"
 * @param {string | Live | (string | Live)[] | Node} content
 * @returns {DocumentFragment}
 */
export function help(topic, content) {
  const id = `help-${++nextId}`;
  const paragraphs = content instanceof Node ? [content] : [content].flat().map((p) => h('p', null, p));
  const pop = h('div', { id, popover: 'auto', class: 'help-pop' }, ...paragraphs);
  const label = live(() => t('help.about', { topic: textOf(topic) }));
  const button = h('button', { type: 'button', class: 'help', popovertarget: id, 'aria-label': label, title: label }, '?');
  anchorTo(pop, button);
  const fragment = document.createDocumentFragment();
  fragment.append(button, pop);
  return fragment;
}
