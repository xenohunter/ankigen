// @ts-check
// The interface language menu in the header: a button with the current language's flag and code, and a menu of
// the languages, each with its flag and native name. A flag is an image, img/flags/<country>.svg for the
// language's country in languages.json (or its "flag", for a language of no one country), since Windows shows no
// flag emoji. Choosing a language switches the page at once (main.js loads the translation and relabels everything).

import { h, live, msg } from './dom.js';
import { language, languageName, t } from './i18n.js';
import { anchorTo } from './popover.js';

/** @typedef {{ code: string, native: string, name: string, country: string, tag: string }} Choice */

/** @param {string} country @param {boolean} [lazy] menu flags load when the menu first opens */
const flag = (country, lazy = false) =>
  h('img', { class: 'flag', src: `img/flags/${country.toLowerCase()}.svg`, alt: '', width: 20, height: 15, loading: lazy ? 'lazy' : null });

/**
 * @param {HTMLElement} root
 * @param {{ choices: Choice[], choose: (code: string) => Promise<void> }} opts choose: switch the page to a language
 *   (rejects when the translation could not load)
 */
export function mountLocale(root, { choices, choose }) {
  const id = 'language-menu';
  const current = () => choices.find((c) => c.code === language()) ?? choices[0];
  const buttonFlag = flag(current().country);
  const code = h('span', { class: 'loc-code' });
  const button = h(
    'button',
    {
      type: 'button',
      class: 'loc-button',
      popovertarget: id,
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-label': live(() => t('head.languageNow', { language: current().native })),
      title: msg('head.language'),
    },
    buttonFlag,
    code,
  );
  const items = choices.map((c) =>
    h(
      'button',
      { type: 'button', class: 'loc-item', role: 'menuitemradio', tabindex: '-1', 'data-code': c.code, title: live(() => languageName(c.code, c.name)) },
      flag(c.country, true),
      h('span', { lang: c.tag }, c.native),
    ),
  );
  const menu = h('div', { id, popover: 'auto', role: 'menu', class: 'loc-menu', 'aria-label': msg('head.language') }, ...items);
  anchorTo(menu, button, 'end');
  root.append(button, menu);

  function refresh() {
    const now = current();
    buttonFlag.src = `img/flags/${now.country.toLowerCase()}.svg`;
    code.textContent = now.code.toUpperCase();
    for (const item of items) item.setAttribute('aria-checked', String(item.dataset.code === now.code));
  }
  refresh();

  menu.addEventListener('toggle', (event) => {
    const opened = /** @type {ToggleEvent} */ (event).newState === 'open';
    button.setAttribute('aria-expanded', String(opened));
    if (opened) (items.find((item) => item.dataset.code === language()) ?? items[0]).focus();
  });
  menu.addEventListener('keydown', (event) => {
    const i = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    const next = /** @type {Record<string, number>} */ ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 })[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[(next + items.length) % items.length].focus();
  });
  // Tabbing away closes the menu, as a menu does.
  menu.addEventListener('focusout', (event) => {
    const to = /** @type {Node | null} */ (event.relatedTarget);
    if (to && !menu.contains(to) && to !== button) menu.hidePopover();
  });
  menu.addEventListener('click', async (event) => {
    const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('.loc-item'));
    if (!item?.dataset.code) return;
    menu.hidePopover();
    button.focus();
    if (item.dataset.code === language()) return;
    button.setAttribute('aria-busy', 'true');
    try {
      await choose(item.dataset.code);
    } catch {
      // offline: the page stays in its language, and choosing again tries again
    } finally {
      button.removeAttribute('aria-busy');
      refresh();
    }
  });
}
