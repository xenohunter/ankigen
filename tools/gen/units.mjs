// Work units for chunked data generation. Shared by plan.mjs and merge-unit.mjs.
// A unit is a self-contained piece of generation work, committed atomically.
// Units are computed from the current data state; completion of data units is checked
// against the files themselves, so the plan self-heals if files are edited by hand.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paths, loadRegistry, loadConcepts, readJson, exists, listDirs, listJson, targetProblems, dataLanguages } from '../lib/data.mjs';
import { appMeta, readTranslations, translatedLanguages } from '../landing.mjs';

export const CORE_PART = 250;   // concepts per core inventory unit
export const LANG_SLICE = 100;  // concepts per language unit
export const EXFIX_SLICE = 250; // concepts per example-fix unit (only the flagged ones are sent)
export const LANG_ORDER = ['en', 'ru', 'sr', 'ja', 'zh', 'de', 'es', 'pt', 'pl', 'ko', 'nl', 'fr', 'hy', 'tr', 'el', 'it', 'sv', 'uk', 'ga', 'gd', 'hu', 'ar', 'vi'];

// Relative cost of a unit (1 point ≈ 10k output tokens). Calibrate progress.sessionBudget, not these.
export const WEIGHTS = { concepts: 2, conceptsSmall: 1.5, local: 1, labels: 0.5, landing: 1, lang: 2, langCJK: 2.5, review: 1, ipa: 0.5, exfix: 0.03 /* per flagged concept */ };
/** Languages whose text takes more output tokens per concept (writing systems, vowel marks). */
const HEAVY = ['ja', 'zh', 'ar'];

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function context(dataDir, metaDir) {
  const p = paths(dataDir, metaDir);
  const reg = loadRegistry(p.meta);
  const concepts = loadConcepts(p, reg, []);
  const layers = {};
  for (const layer of ['lang', 'ex', 'ipa']) {
    layers[layer] = {};
    for (const code of listDirs(path.join(p.data, layer))) {
      const m = new Map();
      for (const f of listJson(path.join(p.data, layer, code))) {
        try {
          for (const [id, v] of Object.entries(readJson(path.join(p.data, layer, code, f)).data)) m.set(id, v);
        } catch { /* lint reports it */ }
      }
      layers[layer][code] = m;
    }
  }
  return { p, reg, concepts, layers };
}

export function progressFile(rootDir) {
  return path.join(rootDir, 'tools', 'gen', 'progress.json');
}

export function loadProgress(rootDir) {
  const f = progressFile(rootDir);
  const base = { sessionBudget: 8, session: null, done: {} };
  if (!exists(f)) return base;
  return { ...base, ...readJson(f).data };
}

export function saveProgress(rootDir, prog) {
  fs.writeFileSync(progressFile(rootDir), JSON.stringify(prog, null, 1) + '\n', 'utf8');
}

export function moduleConceptIds(ctx, moduleId) {
  return ctx.concepts.order.filter((id) => ctx.concepts.byId.get(id).module === moduleId);
}

/** Generation order of the active and staged languages. */
export function langOrder(reg) {
  const langs = dataLanguages(reg);
  return [...LANG_ORDER.filter((c) => langs.includes(c)), ...langs.filter((c) => !LANG_ORDER.includes(c))];
}

export function owns(concept, code) {
  return !concept.only || concept.only.includes(code);
}

/** Example slots whose {target} does not show the word, for one language (data.mjs targetProblems; cached). */
export function flaggedTargets(ctx, code) {
  ctx.targets ??= {};
  return (ctx.targets[code] ??= targetProblems(ctx.layers.lang[code], ctx.layers.ex[code], ctx.reg.languages.languages[code]));
}

/** All units in execution order: [{id, type, weight, deps:[ids], ...}] */
export function allUnits(ctx) {
  const { reg } = ctx;
  const units = [];
  // 1. Concept inventory: core bands strictly in sequence, then topical modules
  const coreUnits = [];
  for (const m of reg.modules.filter((m) => m.core)) {
    const parts = Math.ceil(m.size / CORE_PART);
    for (let i = 1; i <= parts; i++) {
      const id = `concepts:${m.id}:${i}`;
      units.push({ id, type: 'concepts', module: m.id, part: i, parts, weight: WEIGHTS.concepts, deps: coreUnits.length ? [coreUnits[coreUnits.length - 1]] : [] });
      coreUnits.push(id);
    }
  }
  const conceptUnits = [...coreUnits];
  for (const m of reg.modules.filter((m) => !m.core)) {
    const id = `concepts:${m.id}`;
    units.push({ id, type: 'concepts', module: m.id, part: null, weight: m.size > 150 ? WEIGHTS.concepts : WEIGHTS.conceptsSmall, deps: [conceptUnits[conceptUnits.length - 1]] });
    conceptUnits.push(id);
  }
  // 1b. The country-specific and untranslatable concepts of a language added after the inventory was built
  //     (a staged language with a country), one after another, appended to the topical modules: every language's
  //     units of those modules wait for them.
  const localUnits = [];
  for (const code of reg.languages.staged ?? []) {
    if (!reg.languages.languages[code]?.country) continue;
    const id = `local:${code}`;
    units.push({ id, type: 'local', lang: code, weight: WEIGHTS.local, deps: [localUnits.at(-1) ?? conceptUnits.at(-1)] });
    localUnits.push(id);
  }
  const inventory = (/** @type {any} */ m) => (m.core || !localUnits.length ? conceptUnits.at(-1) : localUnits.at(-1));
  // 2. Card labels, and the landing pages' texts for each language's speakers (English is their source, in
  //    tools/landing.mjs). Both independent of everything else.
  for (const code of langOrder(reg)) {
    units.push({ id: `labels:${code}`, type: 'labels', lang: code, weight: WEIGHTS.labels, deps: [] });
  }
  for (const code of langOrder(reg).filter((c) => c !== 'en')) {
    units.push({ id: `landing:${code}`, type: 'landing', lang: code, weight: WEIGHTS.landing, deps: [] });
  }
  // 3. Language layers (need the complete concept inventory; non-English needs reviewed English)
  for (const code of langOrder(reg)) {
    const langUnits = [];
    for (const m of reg.modules) {
      const ids = moduleConceptIds(ctx, m.id);
      const parts = Math.ceil(ids.length / LANG_SLICE);
      for (let i = 1; i <= parts; i++) {
        const id = `lang:${code}:${m.id}:${i}`;
        const deps = [inventory(m)];
        if (code !== 'en') deps.push('review:en');
        units.push({ id, type: 'lang', lang: code, module: m.id, part: i, slice: ids.slice((i - 1) * LANG_SLICE, i * LANG_SLICE), weight: HEAVY.includes(code) ? WEIGHTS.langCJK : WEIGHTS.lang, deps });
        langUnits.push(id);
      }
    }
    units.push({ id: `review:${code}`, type: 'review', lang: code, weight: WEIGHTS.review, deps: langUnits.length ? langUnits : [inventory({})] });
  }
  // 4. IPA (after the language is reviewed)
  for (const code of langOrder(reg)) {
    if (!reg.languages.languages[code].ipa) continue;
    for (const m of reg.modules) {
      const ids = moduleConceptIds(ctx, m.id);
      if (!ids.length) continue;
      units.push({ id: `ipa:${code}:${m.id}`, type: 'ipa', lang: code, module: m.id, ids, weight: WEIGHTS.ipa, deps: [`review:${code}`] });
    }
  }
  // 5. Example fixes: slots whose {target} is not a form of the word (DATA_FORMAT §6), per 250 concepts of a
  //    language; `ids` are the flagged ones. English first: the other languages' slots translate it.
  const enFixes = [];
  for (const code of langOrder(reg)) {
    const flagged = flaggedTargets(ctx, code);
    for (let i = 1; i <= Math.ceil(ctx.concepts.order.length / EXFIX_SLICE); i++) {
      const id = `exfix:${code}:${i}`;
      const chunk = ctx.concepts.order.slice((i - 1) * EXFIX_SLICE, i * EXFIX_SLICE);
      const ids = chunk.filter((c) => flagged.has(c));
      const weight = Math.max(0.1, Math.round(ids.length * WEIGHTS.exfix * 10) / 10);
      units.push({ id, type: 'exfix', lang: code, part: i, chunk, ids, weight, deps: [`review:${code}`, ...(code === 'en' ? [] : enFixes)] });
      if (code === 'en') enFixes.push(id);
    }
  }
  return units;
}

/** Is the unit complete? Data units are checked against files; others use progress.done. */
export function unitDone(ctx, prog, u) {
  switch (u.type) {
    case 'labels': {
      const map = ctx.reg.labels.labels[u.lang];
      return Boolean(map) && ctx.reg.labels.keys.every((k) => k in map);
    }
    case 'lang': {
      if (!u.slice.length) return true;
      const L = ctx.layers.lang[u.lang];
      const E = ctx.layers.ex[u.lang];
      return u.slice.every((id) => {
        const e = L?.get(id);
        if (!e) return false;
        const c = ctx.concepts.byId.get(id).c;
        if (!owns(c, u.lang)) return true;
        return Array.isArray(E?.get(id)) && E.get(id).length > 0;
      });
    }
    case 'landing': {
      ctx.translated ??= translatedLanguages(appMeta(ctx.p.meta), readTranslations(ctx.p.data));
      return ctx.translated.includes(u.lang);
    }
    case 'exfix':
      return !u.ids.length;
    case 'ipa': {
      const L = ctx.layers.lang[u.lang];
      const I = ctx.layers.ipa[u.lang];
      // done only when the language layer exists for every concept and every word entry has IPA
      return u.ids.every((id) => {
        const e = L?.get(id);
        return Boolean(e) && (!e.w || I?.has(id));
      });
    }
    default:
      return Boolean(prog.done[u.id]);
  }
}

/**
 * The concepts of a lang unit that still need their entry (or, if owned, their examples), when the others are there
 * already: concepts added to its module later (local units). Only those are sent. Null when the whole slice is
 * missing, or nothing is.
 */
export function pendingSubset(ctx, u) {
  if (u.type !== 'lang') return null;
  const L = ctx.layers.lang[u.lang];
  const E = ctx.layers.ex[u.lang];
  const pending = u.slice.filter((id) => !L?.has(id) || (owns(ctx.concepts.byId.get(id).c, u.lang) && !E?.get(id)?.length));
  return pending.length && pending.length < u.slice.length ? pending : null;
}

export function availableUnits(ctx, prog, { type, lang } = {}) {
  const units = allUnits(ctx);
  const doneSet = new Set(units.filter((u) => unitDone(ctx, prog, u)).map((u) => u.id));
  return {
    units,
    doneSet,
    available: units.filter((u) => !doneSet.has(u.id) && u.deps.every((d) => doneSet.has(d)) && (!type || u.type === type) && (!lang || u.lang === lang)),
  };
}

export function findUnit(ctx, id) {
  return allUnits(ctx).find((u) => u.id === id);
}
