#!/usr/bin/env node
// The translations of the page's own texts (ARCHITECTURE §13): data/ui/<code>.json for each interface language
// but English, written by hand or by Claude Code (not by the API pipeline):
//   { "source": "<hash of the English texts>",
//     "texts":  { key: text },                      every text of src/ui/strings.js, the feedback dialog and the
//                                                   audio option (src/ui/audio.js)
//     "plural": { key: { category: text } },        each plural category of the language (Intl.PluralRules)
//     "fields": { word: { label, help }, translation: { label, labelSame, help } } }   the two fixed field rows
// The module, field and option texts and the language names come from data/landing (tools/landing.mjs).
//
//   node tools/ui-texts.mjs check           what is wrong with each translation (lint-data reports it too)
//   node tools/ui-texts.mjs stamp <code>…   write a translation in canonical order and record that it follows
//                                           the current English texts (refused while it has problems)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PLURALS, STRINGS } from '../src/ui/strings.js';
import { DIALOG_PLURALS, DIALOG_STRINGS } from '../src/ui/feedback-dialog.js';
import { AUDIO_STRINGS } from '../src/ui/audio.js';
import { UI_LANGUAGES } from '../src/ui/i18n.js';
import { SCRIPT_LETTERS, appMeta } from './landing.mjs';
import { fullWidthLang, hasAsciiPunctuation } from './lib/data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Long texts that must not stay in English, and must be in the language's script. */
const PROSE = ['head.draftHelp1', 'update.intro', 'fb.privacy'];

/**
 * The English that every translation follows.
 * @param {any} meta
 * @returns {{ texts: Record<string, string>, plural: Record<string, Record<string, string>>, fields: Record<string, Record<string, string>> }}
 */
export function englishUi(meta) {
  const fixed = meta.fields.fields.filter((/** @type {any} */ d) => d.fixed);
  return {
    texts: { ...STRINGS, ...DIALOG_STRINGS, ...AUDIO_STRINGS },
    plural: { ...PLURALS, ...DIALOG_PLURALS },
    fields: Object.fromEntries(fixed.map((/** @type {any} */ d) => [d.id, { label: d.label, ...(d.labelSame ? { labelSame: d.labelSame } : {}), help: d.help }])),
  };
}

/** Identifies the English a translation was made from. @param {any} meta */
export function uiSource(meta) {
  return createHash('sha256').update(JSON.stringify(englishUi(meta))).digest('hex').slice(0, 12);
}

/** The {placeholders} of a text, sorted. @param {string} text */
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(' ');

/**
 * What is wrong with a translation: missing, unknown or empty texts, changed {placeholders}, missing plural
 * forms, HTML, ASCII punctuation in Chinese or Japanese, prose left in English or in another script.
 * @param {any} t @param {any} meta @param {string} code @returns {string[]}
 */
export function checkUi(t, meta, code) {
  const english = englishUi(meta);
  const reg = meta.languages.languages[code];
  /** @type {string[]} */
  const problems = [];
  /** @param {string} at @param {unknown} v @param {string} master */
  const text = (at, v, master) => {
    if (typeof v !== 'string' || !v.trim()) return problems.push(`${at}: missing`);
    if (placeholders(v) !== placeholders(master)) problems.push(`${at}: placeholders {${placeholders(v)}} instead of {${placeholders(master)}}`);
    if (/[<>]/.test(v)) problems.push(`${at}: contains < or >; write plain text`);
    if (fullWidthLang(reg) && hasAsciiPunctuation(v)) problems.push(`${at}: ASCII punctuation; use full-width ，：；！？（）`);
  };
  for (const [key, master] of Object.entries(english.texts)) text(`texts.${key}`, t?.texts?.[key], master);
  for (const key of Object.keys(t?.texts ?? {})) if (!(key in english.texts)) problems.push(`texts.${key}: not an English text`);
  const categories = new Intl.PluralRules(reg.locale).resolvedOptions().pluralCategories;
  for (const [key, forms] of Object.entries(english.plural)) {
    for (const category of categories) {
      const v = t?.plural?.[key]?.[category];
      if (typeof v !== 'string' || !/\{n\}/.test(v) || v.split('{n}').length !== 2) problems.push(`plural.${key}.${category}: missing, or not exactly one {n}`);
      else if (placeholders(v) !== placeholders(forms.other)) problems.push(`plural.${key}.${category}: placeholders {${placeholders(v)}} instead of {${placeholders(forms.other)}}`);
      else if (/[<>]/.test(v)) problems.push(`plural.${key}.${category}: contains < or >; write plain text`);
      else if (fullWidthLang(reg) && hasAsciiPunctuation(v)) problems.push(`plural.${key}.${category}: ASCII punctuation; use full-width ，：；！？（）`);
    }
  }
  for (const key of Object.keys(t?.plural ?? {})) if (!(key in english.plural)) problems.push(`plural.${key}: not an English text`);
  for (const [id, row] of Object.entries(english.fields)) for (const [key, master] of Object.entries(row)) text(`fields.${id}.${key}`, t?.fields?.[id]?.[key], master);
  const letters = SCRIPT_LETTERS[reg.script];
  for (const key of PROSE) {
    const v = t?.texts?.[key];
    if (typeof v !== 'string') continue;
    if (v === english.texts[key]) problems.push(`texts.${key}: still in English`);
    else if (letters && !letters.test(v)) problems.push(`texts.${key}: not in ${reg.script} script`);
  }
  if (!UI_LANGUAGES.includes(code) || code === 'en') problems.push(`${code}: not an interface language other than English (UI_LANGUAGES in src/ui/i18n.js)`);
  return problems;
}

/** A translation in canonical order (English key order, the language's plural categories), with its source. @param {any} t @param {any} meta @param {string} code */
export function canonicalUi(t, meta, code) {
  const english = englishUi(meta);
  const categories = new Intl.PluralRules(meta.languages.languages[code].locale).resolvedOptions().pluralCategories;
  /** @param {Record<string, any>} master @param {any} v @param {(key: string, x: any) => any} [inner] */
  const order = (master, v, inner = (_, x) => x) => Object.fromEntries(Object.keys(master).filter((k) => v?.[k] !== undefined).map((k) => [k, inner(k, v[k])]));
  return {
    source: uiSource(meta),
    texts: order(english.texts, t.texts),
    plural: order(english.plural, t.plural, (_, forms) => Object.fromEntries(categories.filter((c) => forms[c] !== undefined).map((c) => [c, forms[c]]))),
    fields: order(english.fields, t.fields, (id, row) => order(english.fields[id], row)),
  };
}

/** The translations in a data directory, { code: translation } from data/ui/<code>.json; unreadable files are left out (the linter reports them). @param {string} dataDir */
export function readUiTexts(dataDir) {
  const dir = path.join(dataDir, 'ui');
  /** @type {Record<string, any>} */
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      out[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      // reported by uiIssues()
    }
  }
  return out;
}

/**
 * Lint issues of data/ui (tools/lint-data.mjs): errors for unreadable files, unknown languages and checkUi()
 * problems; a warning for a translation of older English texts (its texts may need an update; the page
 * still uses them, and English for any text it lacks).
 * @param {string} dataDir @param {any} meta
 */
export function uiIssues(dataDir, meta) {
  const dir = path.join(dataDir, 'ui');
  /** @type {{ level: 'error' | 'warning', file: string, id: null, msg: string }[]} */
  const issues = [];
  if (!fs.existsSync(dir)) return issues;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const code = file.slice(0, -5);
    /** @param {'error' | 'warning'} level @param {string} msg */
    const add = (level, msg) => issues.push({ level, file: `ui/${file}`, id: null, msg });
    let t;
    try {
      t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      add('error', `invalid JSON: ${/** @type {Error} */ (e).message}`);
      continue;
    }
    if (!meta.languages.languages[code]) {
      add('error', 'not a language of the registry');
      continue;
    }
    for (const problem of checkUi(t, meta, code)) add('error', problem);
    if (t.source !== uiSource(meta)) add('warning', `translated from older English texts: update it, then run node tools/ui-texts.mjs stamp ${code}`);
  }
  return issues;
}

/**
 * What the page loads for an interface language (src/data/loader.js getUiTexts): its data/ui translation, and
 * the parts of its data/landing translation the page shows.
 * @param {any} ui data/ui/<code>.json, or null @param {any} landing data/landing/<code>.json, or null
 */
export function uiBundle(ui, landing) {
  return {
    ui: ui ? { texts: ui.texts, plural: ui.plural, fields: ui.fields } : null,
    landing: landing ? { languages: landing.languages, categories: landing.categories, modules: landing.modules, fields: landing.fields, options: landing.options } : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...codes] = process.argv.slice(2);
  const meta = appMeta(path.join(ROOT, 'data', 'meta'));
  const dataDir = path.join(ROOT, 'data');
  if (command === 'check') {
    const issues = uiIssues(dataDir, meta);
    for (const i of issues) console.log(`${i.level}: ${i.file}: ${i.msg}`);
    console.log(issues.length ? `${issues.length} issue(s)` : 'data/ui: no issues');
    process.exit(issues.some((i) => i.level === 'error') ? 1 : 0);
  } else if (command === 'stamp' && codes.length) {
    let failed = false;
    for (const code of codes) {
      const file = path.join(dataDir, 'ui', `${code}.json`);
      const t = JSON.parse(fs.readFileSync(file, 'utf8'));
      const problems = checkUi(t, meta, code);
      if (problems.length) {
        failed = true;
        console.error(`${code}: not stamped:\n  ${problems.join('\n  ')}`);
        continue;
      }
      fs.writeFileSync(file, `${JSON.stringify(canonicalUi(t, meta, code), null, 2)}\n`);
      console.log(`${code}: stamped ${uiSource(meta)}`);
    }
    process.exit(failed ? 1 : 0);
  } else {
    console.error('usage: node tools/ui-texts.mjs check | stamp <code>…');
    process.exit(2);
  }
}
