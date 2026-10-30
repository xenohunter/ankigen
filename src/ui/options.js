// @ts-check
// Step 5: deck options from fields.json → deckOptions: reverse cards, type the answer (needs reverse
// cards) and the Serbian script (shown when Serbian is on either side); the audio toggle (ui/audio.js) where the
// learned language has audio.

import { hasAudio, usesSerbian } from '../state.js';
import { h, live, msg } from './dom.js';
import { optionText } from './i18n.js';
import { help } from './popover.js';

/**
 * @param {HTMLElement} root
 * @param {import('./app.js').App} app
 */
export function mountOptions(root, app) {
  const option = (/** @type {string} */ id) => app.meta.fields.deckOptions.find((/** @type {any} */ o) => o.id === id);
  /** The option's label and help, live. @param {any} def */
  const texts = (def) => ({ label: live(() => optionText(def).label), about: live(() => optionText(def).help) });

  /** @param {string} id @param {(on: boolean) => Partial<import('../state.js').Config>} change */
  function toggle(id, change) {
    const { label, about } = texts(option(id));
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.addEventListener('change', () => app.update(() => change(input.checked)));
    const el = h('div', { class: 'opt' }, h('label', { class: 'switch' }, input, h('span', null, label)), help(label, about));
    root.append(el);
    return { input, el };
  }

  const reverse = toggle('reverse', (on) => ({ reverse: on }));
  const type = toggle('typeAnswer', (on) => ({ type: on }));

  const sr = option('srScript');
  const scriptId = 'opt-sr-script';
  const scripts = /** @type {string[]} */ (sr.values).map((value) => {
    const input = h('input', { type: 'radio', name: scriptId, value });
    input.addEventListener('change', () => app.update(() => ({ srScript: /** @type {any} */ (value) })));
    return input;
  });
  const { label, about } = texts(sr);
  const script = h(
    'div',
    { class: 'opt' },
    h('span', { id: scriptId, class: 'opt-label' }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': scriptId }, ...scripts.map((input, i) => h('label', null, input, h('span', null, msg(`options.${sr.values[i]}`))))),
    help(label, about),
  );
  root.append(script);

  /** @type {{ update: (view: import('./app.js').View) => void } | null} */
  let audio = null;

  return {
    /** @param {import('./app.js').View} view */
    update(view) {
      const { config } = view;
      if (audio) audio.update(view);
      else if (hasAudio(app.meta, config.learn)) import('./audio.js').then((m) => (audio ??= m.mountAudioOption(root, app, help)).update(app.view()), () => {});
      reverse.input.checked = config.reverse;
      type.input.checked = config.reverse && config.type;
      type.input.disabled = !config.reverse;
      type.el.classList.toggle('is-disabled', !config.reverse);
      script.hidden = !usesSerbian(config);
      for (const input of scripts) input.checked = input.value === config.srScript;
    },
  };
}
