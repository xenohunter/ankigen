#!/usr/bin/env node
// Merge one generated unit into the data files, lint what it touched, and record progress.
//   node tools/gen/merge-unit.mjs tmp/lang__ru__core-1__1.json [--data data] [--partial]
// Re-running with a corrected file is safe: entries for the same IDs are replaced.
// --partial: merge part of a unit (e.g. the first 25 concepts of a slice); skips the completeness
//            check and does not record progress. Merge the last part without --partial.
// Exit code 1 if the unit still has errors (fix the output file and merge again).
//
// Output file shapes (see tools/gen/prompts/*.md):
//   concepts: {"unit","concepts":{id:concept},"addMods":{existingId:[moduleId,...]}}
//   labels:   {"unit","labels":{key:text}}
//   lang:     {"unit","lang":{id:entry},"ex":{id:[{t,p?,r?}]},"patch":{otherId:{field:value|null}}}
//   review:   {"unit","patch":{id:{field:value|null}},"lang":{id:entry},"ex":{id:[...]}}
//   ipa:      {"unit","ipa":{id:"ipa"}}
//   exfix:    {"unit","slots":{id:{"<slot 1-3>":{t,p?,r?}}}} → replaces those example slots
//   landing:  {"unit","landing":{texts,plural,languages,categories,modules,fields,options,pairs}} → data/landing/<code>.json

import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeCanonical, stringifyLabels, labelOrder, lint, exists } from '../lib/data.mjs';
import { context, findUnit, loadProgress, saveProgress, repoRoot, owns, flaggedTargets } from './units.mjs';
import { appMeta, canonicalTexts, checkTexts } from '../landing.mjs';

const ROOT = repoRoot();
const argv = process.argv.slice(2);
const dIdx = argv.indexOf('--data');
const dataDir = path.resolve(ROOT, dIdx >= 0 ? argv[dIdx + 1] : 'data');
const file = argv.find((a, i) => !a.startsWith('--') && (dIdx < 0 || (i !== dIdx + 1)));
if (!file) die('usage: merge-unit.mjs <output.json>');

let raw = fs.readFileSync(path.resolve(file), 'utf8').trim();
raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
let out;
try { out = JSON.parse(raw); } catch (e) { die(`invalid JSON in ${file}: ${e.message}`); }
if (!out.unit) die('output has no "unit" field');

let ctx = context(dataDir);
const unit = findUnit(ctx, out.unit);
if (!unit) die(`unknown unit "${out.unit}" (run plan.mjs list)`);

const touchedIds = new Set();
const touchedFiles = new Set();
const problems = [];

const layerPath = (layer, code, mod) => path.join(dataDir, layer, code, `${mod}.json`);
const load = (f) => (exists(f) ? readJson(f).data : {});

function writeLayer(layer, code, mod, data) {
  const f = layerPath(layer, code, mod);
  writeCanonical(f, data, ctx.concepts.order);
  touchedFiles.add(`${layer}/${code}/${mod}.json`);
}

function upsert(layer, code, entries, allowed) {
  const byMod = {};
  for (const [id, v] of Object.entries(entries || {})) {
    const ce = ctx.concepts.byId.get(id);
    if (!ce) { problems.push(`${layer}: unknown concept ${id}`); continue; }
    if (allowed && !allowed.has(id)) { problems.push(`${layer}: ${id} is not in this unit's slice`); continue; }
    (byMod[ce.module] ??= {})[id] = v;
    touchedIds.add(id);
  }
  for (const [mod, items] of Object.entries(byMod)) {
    const data = load(layerPath(layer, code, mod));
    Object.assign(data, items);
    writeLayer(layer, code, mod, data);
  }
}

function patch(code, patches) {
  const byMod = {};
  for (const [id, fields] of Object.entries(patches || {})) {
    const ce = ctx.concepts.byId.get(id);
    if (!ce) { problems.push(`patch: unknown concept ${id}`); continue; }
    (byMod[ce.module] ??= {})[id] = fields;
    touchedIds.add(id);
  }
  for (const [mod, items] of Object.entries(byMod)) {
    const data = load(layerPath('lang', code, mod));
    for (const [id, fields] of Object.entries(items)) {
      if (!data[id]) { problems.push(`patch: ${code} has no entry for ${id} yet`); continue; }
      for (const [k, v] of Object.entries(fields)) {
        if (v === null) delete data[id][k];
        else data[id][k] = v;
      }
    }
    writeLayer('lang', code, mod, data);
  }
}

function setSlots(code, slots, allowed) {
  const byMod = {};
  for (const [id, bySlot] of Object.entries(slots || {})) {
    const ce = ctx.concepts.byId.get(id);
    if (!ce) { problems.push(`slots: unknown concept ${id}`); continue; }
    if (!allowed.has(id)) { problems.push(`slots: ${id} is not in this unit's slice`); continue; }
    (byMod[ce.module] ??= {})[id] = bySlot;
  }
  for (const [mod, items] of Object.entries(byMod)) {
    const data = load(layerPath('ex', code, mod));
    for (const [id, bySlot] of Object.entries(items)) {
      const list = data[id];
      if (!Array.isArray(list)) { problems.push(`slots: ${code} has no examples for ${id}`); continue; }
      for (const [slot, ex] of Object.entries(bySlot || {})) {
        if (!/^[1-3]$/.test(slot) || Number(slot) > list.length) { problems.push(`slots: ${id} has no slot ${slot}`); continue; }
        list[Number(slot) - 1] = ex;
        touchedIds.add(id);
      }
    }
    writeLayer('ex', code, mod, data);
  }
}

switch (unit.type) {
  case 'concepts': {
    const f = path.join(dataDir, 'concepts', `${unit.module}.json`);
    const data = load(f);
    for (const [id, c] of Object.entries(out.concepts || {})) {
      const other = ctx.concepts.byId.get(id);
      if (other && other.module !== unit.module) { problems.push(`concept ${id} already exists in ${other.module}; use addMods instead`); continue; }
      data[id] = c;
      touchedIds.add(id);
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeCanonical(f, data, Object.keys(data));
    touchedFiles.add(`concepts/${unit.module}.json`);
    ctx = context(dataDir);
    const perFile = {};
    for (const [id, mods] of Object.entries(out.addMods || {})) {
      const ce = ctx.concepts.byId.get(id);
      if (!ce) { problems.push(`addMods: unknown concept ${id}`); continue; }
      const cf = path.join(dataDir, 'concepts', `${ce.module}.json`);
      perFile[cf] ??= load(cf);
      const c = perFile[cf][id];
      for (const m of mods) if (!c.mods.includes(m)) c.mods.push(m);
      touchedIds.add(id);
      touchedFiles.add(`concepts/${ce.module}.json`);
    }
    for (const [cf, d] of Object.entries(perFile)) writeCanonical(cf, d, Object.keys(d));
    break;
  }
  case 'labels': {
    const f = path.join(ctx.p.meta, 'labels.json');
    const data = readJson(f).data;
    const keys = new Set(data.keys);
    for (const k of Object.keys(out.labels || {})) if (!keys.has(k)) problems.push(`labels: unknown key ${k}`);
    data.labels[unit.lang] = { ...(data.labels[unit.lang] || {}), ...(out.labels || {}) };
    fs.writeFileSync(f, stringifyLabels(data, labelOrder(ctx.reg)), 'utf8');
    touchedFiles.add('meta/labels.json');
    break;
  }
  case 'lang': {
    const allowed = new Set(unit.slice);
    upsert('lang', unit.lang, out.lang, allowed);
    upsert('ex', unit.lang, out.ex, allowed);
    patch(unit.lang, out.patch);
    break;
  }
  case 'review': {
    upsert('lang', unit.lang, out.lang, null);
    patch(unit.lang, out.patch);
    upsert('ex', unit.lang, out.ex, null);
    break;
  }
  case 'ipa': {
    upsert('ipa', unit.lang, out.ipa, new Set(unit.ids));
    break;
  }
  case 'exfix': {
    setSlots(unit.lang, out.slots, new Set(unit.chunk));
    break;
  }
  case 'landing': {
    const meta = appMeta(ctx.p.meta);
    problems.push(...checkTexts(out.landing, meta, unit.lang));
    const f = path.join(dataDir, 'landing', `${unit.lang}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(canonicalTexts(out.landing, meta, unit.lang), null, 2) + '\n', 'utf8');
    touchedFiles.add(`landing/${unit.lang}.json`);
    break;
  }
  default:
    die(`unit type ${unit.type} cannot be merged`);
}

// Lint and report only what this unit touched. Concept IDs are shared by all languages, so problems in another
// language's files belong to that language's units: this unit can't fix them (its patches stay in its language).
const { issues } = lint({ dataDir, metaDir: ctx.p.meta });
const otherLanguage = (file) => Boolean(unit.lang) && /^(lang|ex|ipa|etym)\//.test(file ?? '') && file.split('/')[1] !== unit.lang;
const relevant = issues.filter((i) => {
  if (otherLanguage(i.file)) return false;
  if (!touchedFiles.has(i.file)) return touchedIds.has(i.id) || [...touchedIds].some((id) => i.msg.includes(id));
  return i.id === null || touchedIds.has(i.id) || unit.type === 'labels';
});
// An example fix must leave no target that lint flags, warning or not.
const failed = (i) => i.level === 'error' || (unit.type === 'exfix' && i.target);
const errors = relevant.filter(failed);
const warnings = relevant.filter((i) => !failed(i));

// Completeness
const partial = argv.includes('--partial');
ctx = context(dataDir);
const fresh = findUnit(ctx, unit.id);
if (fresh.type === 'lang' && !partial) {
  for (const id of fresh.slice) {
    const e = ctx.layers.lang[unit.lang]?.get(id);
    if (!e) { problems.push(`missing entry for ${id}`); continue; }
    const c = ctx.concepts.byId.get(id).c;
    if (!owns(c, unit.lang)) continue;
    const ex = ctx.layers.ex[unit.lang]?.get(id);
    if (!ex?.length) problems.push(`missing examples for ${id}`);
    else if (ex.length < 3) warnings.push({ level: 'warning', file: `ex/${unit.lang}`, id, msg: `only ${ex.length} example(s); 3 expected` });
  }
}
if (fresh.type === 'exfix' && !partial) {
  const flagged = flaggedTargets(ctx, unit.lang);
  for (const id of fresh.ids) {
    if (!touchedIds.has(id)) for (const p of flagged.get(id)) problems.push(`${id}: slot ${p.slot} not fixed: ${p.msg}`);
  }
}
if (fresh.type === 'labels') {
  const map = ctx.reg.labels.labels[unit.lang] || {};
  const missing = ctx.reg.labels.keys.filter((k) => !(k in map));
  if (missing.length) problems.push(`labels missing: ${missing.join(', ')}`);
}

for (const p of problems) console.log(`ERROR   ${p}`);
for (const i of errors) console.log(`ERROR   ${i.file} ${i.id ?? ''}: ${i.msg}`);
for (const i of warnings) console.log(`warning ${i.file} ${i.id ?? ''}: ${i.msg}`);

if (problems.length || errors.length) {
  console.log(`\n${unit.id}: ${problems.length + errors.length} error(s). Files were written; fix the output and merge again.`);
  process.exit(1);
}

if (partial) {
  console.log(`\nOK partial merge for ${unit.id} (${touchedIds.size} entries). Merge the final part without --partial.`);
  process.exit(0);
}
const prog = loadProgress(ROOT);
if (unit.type === 'concepts' || unit.type === 'review') prog.done[unit.id] = { at: new Date().toISOString() };
if (prog.session && !prog.session.units.includes(unit.id)) {
  prog.session.units.push(unit.id);
  prog.session.spent += unit.weight;
}
saveProgress(ROOT, prog);
console.log(`\nOK ${unit.id} merged (${touchedIds.size} entries, ${warnings.length} warning(s)).${prog.session ? ` Session ${prog.session.spent}/${prog.session.budget}.` : ''}`);

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}
