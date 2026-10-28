// Builds the generator input for a unit (used by plan.mjs `show` and batch.mjs),
// and the system prompt for API runs. Keep inputs token-lean: they are sent hundreds of times.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lint } from '../lib/data.mjs';
import { moduleConceptIds, owns, flaggedTargets } from './units.mjs';
import { appMeta, englishTexts, readTranslations } from '../landing.mjs';

export function langInfo(reg, code) {
  const l = reg.languages.languages[code];
  return { code, name: l.name, native: l.native, locale: l.locale, variantNote: l.variantNote, country: l.country, script: l.script, gender: l.gender, stress: l.stress, reading: l.reading, romanization: l.romanization, measureWord: l.measureWord, hanja: l.hanja, exampleReading: l.exampleReading, forms: l.forms };
}

export function outputPath(unitId) {
  return `tmp/${unitId.replace(/:/g, '__')}.json`;
}

/**
 * @param ctx   context() from units.mjs
 * @param u     unit from allUnits()
 * @param opts  { subset?: string[] } restrict a lang/ipa/exfix unit to these concept IDs (used for split retries)
 */
export function buildInput(ctx, u, opts = {}) {
  const { reg, concepts, layers } = ctx;
  const base = { unit: u.id, prompt: `tools/gen/prompts/${u.type}.md`, output: outputPath(u.id) };
  if (u.type === 'concepts') {
    const m = reg.moduleById.get(u.module);
    const existing = {};
    for (const mod of reg.modules) {
      const ids = moduleConceptIds(ctx, mod.id);
      if (ids.length) existing[mod.id] = ids.join(' ');
    }
    const crossListed = concepts.order.filter((id) => concepts.byId.get(id).c.mods.includes(u.module) && concepts.byId.get(id).module !== u.module);
    return {
      ...base,
      module: { id: m.id, name: m.name, desc: m.desc, targetSize: m.size, core: m.core || null },
      part: u.part ? { index: u.part, of: u.parts, size: Math.min(250, m.size - (u.part - 1) * 250) } : null,
      alreadyInThisModule: moduleConceptIds(ctx, u.module).length,
      alreadyCrossListedHere: crossListed.length,
      modules: reg.modules.map((x) => `${x.id} (${x.name})`),
      countries: reg.languages.active.map((c) => `${c}:${reg.languages.languages[c].country}`).join(' '),
      existingConceptIds: existing,
    };
  }
  if (u.type === 'labels') {
    return { ...base, lang: langInfo(reg, u.lang), keys: reg.labels.keys, en: reg.labels.labels.en, ru: reg.labels.labels.ru, current: reg.labels.labels[u.lang] || {} };
  }
  if (u.type === 'landing') {
    const meta = appMeta(ctx.p.meta);
    const { name, native, locale, script } = langInfo(reg, u.lang);
    const { source, ...current } = readTranslations(ctx.p.data)[u.lang] ?? {};
    return {
      ...base,
      lang: { code: u.lang, name, native, locale, script },
      pluralCategories: new Intl.PluralRules(locale).resolvedOptions().pluralCategories,
      en: englishTexts(meta, u.lang),
      current: source ? current : null,
    };
  }
  if (u.type === 'lang') {
    const ids = opts.subset ? u.slice.filter((id) => opts.subset.includes(id)) : u.slice;
    const slice = ids.map((id) => {
      const { c } = concepts.byId.get(id);
      const item = { id, pos: c.pos, note: c.note };
      if (c.only) item.only = c.only;
      if (c.reg) item.reg = c.reg;
      if (c.grp) item.grp = c.grp;
      item.owned = owns(c, u.lang);
      if (u.lang !== 'en') {
        const en = layers.lang.en?.get(id);
        if (en) item.en = Object.fromEntries(Object.entries(en).filter(([k]) => ['w', 'alt', 'hint', 'def', 'gl'].includes(k)));
        const ex = layers.ex.en?.get(id);
        if (ex && item.owned) item.enExamples = ex.map((x) => x.t);
      }
      const cur = layers.lang[u.lang]?.get(id);
      if (cur) item.current = cur;
      return item;
    });
    return { ...base, lang: langInfo(reg, u.lang), slice };
  }
  if (u.type === 'review') {
    const { issues } = lint({ dataDir: ctx.p.data, metaDir: ctx.p.meta });
    // Example targets that are not the word are the exfix units' work.
    const mine = issues.filter((i) => !i.target && ((i.file || '').includes(`/${u.lang}/`) || (i.file || '').startsWith(`lang/${u.lang}`)));
    const errors = mine.filter((i) => i.level === 'error');
    const warnings = mine.filter((i) => i.level === 'warning').slice(0, 300);
    const L = layers.lang[u.lang];
    const E = layers.ex[u.lang];
    const ids = new Set([...errors, ...warnings].map((i) => i.id).filter(Boolean));
    for (const i of errors) for (const m of i.msg.matchAll(/(?:word|phrase)-[a-z0-9-]+/g)) ids.add(m[0]);
    // deterministic spot-check sample of 30 entries
    const all = [...(L?.keys() || [])].filter((id) => L.get(id).w);
    const sample = all
      .map((id) => [createHash('sha1').update(`${u.lang}|${id}`).digest('hex'), id])
      .sort()
      .slice(0, 30)
      .map(([, id]) => id);
    const entries = {};
    for (const id of [...ids, ...sample]) {
      if (!L?.get(id)) continue;
      const c = concepts.byId.get(id)?.c;
      entries[id] = { note: c?.note, pos: c?.pos, entry: L.get(id), ex: E?.get(id)?.map((x) => x.t) };
    }
    return { ...base, lang: langInfo(reg, u.lang), errors, warnings, entries, spotCheck: sample };
  }
  if (u.type === 'exfix') {
    const flagged = flaggedTargets(ctx, u.lang);
    const ids = opts.subset ? u.ids.filter((id) => opts.subset.includes(id)) : u.ids;
    const items = ids.map((id) => {
      const { c } = concepts.byId.get(id);
      const { def, st, ...entry } = layers.lang[u.lang].get(id);
      const item = { id, pos: c.pos, note: c.note, entry, ex: layers.ex[u.lang].get(id) };
      if (u.lang !== 'en') item.enExamples = layers.ex.en?.get(id)?.map((x) => x.t);
      item.fix = Object.fromEntries(flagged.get(id).map((p) => [p.slot, p.msg]));
      return item;
    });
    return { ...base, lang: langInfo(reg, u.lang), concepts: items };
  }
  if (u.type === 'ipa') {
    const words = {};
    const ids = opts.subset ? u.ids.filter((id) => opts.subset.includes(id)) : u.ids;
    for (const id of ids) {
      const e = layers.lang[u.lang]?.get(id);
      if (e?.w && !layers.ipa[u.lang]?.has(id)) words[id] = e.read ? `${e.w} (${e.read})` : e.w;
    }
    return { ...base, lang: langInfo(reg, u.lang), words };
  }
  return base;
}

// Token-lean JSON: top-level keys on their own lines, arrays/objects of items one item per line.
export function compact(obj) {
  const lines = ['{'];
  const keys = Object.keys(obj);
  keys.forEach((k, i) => {
    const v = obj[k];
    const comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      lines.push(`${JSON.stringify(k)}: [`);
      v.forEach((item, j) => lines.push(JSON.stringify(item) + (j < v.length - 1 ? ',' : '')));
      lines.push(']' + comma);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 6) {
      lines.push(`${JSON.stringify(k)}: {`);
      const ks = Object.keys(v);
      ks.forEach((kk, j) => lines.push(`${JSON.stringify(kk)}: ${JSON.stringify(v[kk])}` + (j < ks.length - 1 ? ',' : '')));
      lines.push('}' + comma);
    } else lines.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
  });
  lines.push('}');
  return lines.join('\n');
}

// ---------- System prompt for API runs ----------

const API_PREAMBLE = `You are a careful lexicographer generating data for AnkiGen, a multilingual flashcard generator.
You run inside an automated pipeline: you cannot run commands or read files. Everything you need is below and in the user message.
Instructions below may mention running scripts (plan.mjs, merge-unit.mjs); the pipeline does that for you.
Respond with ONE JSON object exactly as described under "Output" in the unit instructions — no prose, no code fences.`;

function read(rootDir, rel) {
  return fs.readFileSync(path.join(rootDir, rel), 'utf8');
}

export function languageSection(rootDir, code) {
  const text = read(rootDir, 'tools/gen/prompts/languages.md');
  const parts = text.split(/^## /m);
  const intro = parts[0];
  const sec = parts.find((p) => p.startsWith(`${code} — `));
  return sec ? `${intro}\n## ${sec}` : intro;
}

function fixtureFiles(rootDir, kinds) {
  const base = path.join(rootDir, 'tests', 'fixtures', 'data');
  const out = [];
  for (const kind of kinds) {
    const dir = path.join(base, kind);
    if (!fs.existsSync(dir)) continue;
    const walk = (d, rel) => {
      for (const f of fs.readdirSync(d).sort()) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p, `${rel}/${f}`);
        else out.push(`--- ${rel}/${f}\n${fs.readFileSync(p, 'utf8')}`);
      }
    };
    walk(dir, kind);
  }
  return out.join('\n');
}

/**
 * Returns system blocks for the Messages API: a shared, cacheable prefix per unit type,
 * followed by the language-specific guide (not cached separately; it is small).
 */
export function systemBlocks(rootDir, u) {
  // Landing texts are prose for a web page: no data format, and no language guide (it asks for stress marks).
  if (u.type === 'landing') return [{ type: 'text', text: [API_PREAMBLE, '# Unit instructions\n' + read(rootDir, 'tools/gen/prompts/landing.md')].join('\n\n'), cache_control: { type: 'ephemeral' } }];
  const shared = [
    API_PREAMBLE,
    '# Data format\n' + read(rootDir, 'docs/DATA_FORMAT.md'),
    '# Unit instructions\n' + read(rootDir, `tools/gen/prompts/${u.type}.md`),
  ];
  if (u.type === 'concepts') shared.push('# Golden sample (concept files)\n' + fixtureFiles(rootDir, ['concepts']));
  if (u.type === 'lang' || u.type === 'review') shared.push('# Golden sample (concepts, entries, examples)\n' + fixtureFiles(rootDir, ['concepts', 'lang', 'ex']));
  if (u.type === 'exfix') shared.push('# Golden sample (examples)\n' + fixtureFiles(rootDir, ['ex']));
  const blocks = [{ type: 'text', text: shared.join('\n\n'), cache_control: { type: 'ephemeral' } }];
  if (u.lang && u.type !== 'labels') blocks.push({ type: 'text', text: '# Language guide\n' + languageSection(rootDir, u.lang) });
  return blocks;
}
