#!/usr/bin/env node
// Lint the vocabulary data: structure, IDs, references, scripts, forms, collisions, examples; the landing
// pages' translations in data/landing (tools/landing.mjs); and the page's own translations in data/ui
// (tools/ui-texts.mjs).
// Usage:
//   node tools/lint-data.mjs [--data data] [--meta data/meta] [--fix] [--report] [--warnings] [--filter ru/] [--json] [--gate]
// Exit code 1 if any error remains. --gate (the deploy gate, ARCHITECTURE §12) also fails unless every active
// language has an entry for every concept.

import fs from 'node:fs';
import path from 'node:path';
import { lint, coverage, moduleSizes, readJson, writeCanonical, stringifyLabels, labelOrder, listDirs, listJson, LAYERS, paths, loadRegistry, loadConcepts } from './lib/data.mjs';
import { appMeta, landingIssues } from './landing.mjs';
import { uiIssues } from './ui-texts.mjs';
import { audioIssues } from './lib/audio.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const dataDir = path.resolve(opt('--data', 'data'));
const metaDir = path.resolve(opt('--meta', path.join(dataDir, 'meta')));
const filter = opt('--filter', null);

if (flag('--fix')) fix(dataDir, metaDir);

const { issues, ctx } = lint({ dataDir, metaDir });
issues.push(...landingIssues(dataDir, appMeta(metaDir)), ...uiIssues(dataDir, appMeta(metaDir)), ...audioIssues(ctx));
const shown = issues.filter((i) => !filter || (i.file || '').includes(filter) || i.id === filter);
const errors = shown.filter((i) => i.level === 'error');
const warnings = shown.filter((i) => i.level === 'warning');

if (flag('--json')) {
  process.stdout.write(JSON.stringify({ errors, warnings }, null, 1) + '\n');
} else {
  for (const i of errors) console.log(`ERROR   ${i.file}${i.id ? ' ' + i.id : ''}: ${i.msg}`);
  if (flag('--warnings')) for (const i of warnings) console.log(`warning ${i.file}${i.id ? ' ' + i.id : ''}: ${i.msg}`);
  if (flag('--report')) report(ctx);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)${flag('--warnings') ? '' : ' (use --warnings to list)'}`);
}
const gateOk = !flag('--gate') || gate(ctx);
process.exit(errors.length || !gateOk ? 1 : 0);

/** The deploy gate: every active language has an entry (a word or a gloss) for every concept. */
function gate(ctx) {
  const incomplete = coverage(ctx).filter((r) => r.entries < r.total);
  if (incomplete.length) {
    console.log(`Deploy gate: ${incomplete.length} active language(s) incomplete: ${incomplete.map((r) => `${r.code} ${r.entries}/${r.total}`).join(', ')}`);
  } else {
    console.log('Deploy gate: every active language has an entry for every concept.');
  }
  return !incomplete.length;
}

function fix(dataDir, metaDir) {
  const p = paths(dataDir, metaDir);
  const reg = loadRegistry(p.meta);
  fs.writeFileSync(path.join(p.meta, 'labels.json'), stringifyLabels(reg.labels, labelOrder(reg)), 'utf8');
  const concepts = loadConcepts(p, reg, []);
  for (const [mod, parsed] of Object.entries(concepts.files)) {
    writeCanonical(p.conceptFile(mod), parsed.data, Object.keys(parsed.data));
  }
  for (const layer of LAYERS) {
    for (const code of listDirs(path.join(dataDir, layer))) {
      for (const f of listJson(path.join(dataDir, layer, code))) {
        const file = path.join(dataDir, layer, code, f);
        try {
          const { data } = readJson(file);
          writeCanonical(file, data, concepts.order);
        } catch (e) {
          console.log(`cannot fix ${file}: ${e.message}`);
        }
      }
    }
  }
}

function report(ctx) {
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
  console.log('\nCoverage (all concepts, per learning language)');
  console.log('lang  entries   defs      ex≥1      ex=3      ipa       etym');
  for (const r of coverage(ctx)) {
    console.log(
      `${r.code.padEnd(5)} ${pct(r.entries, r.total).padEnd(9)} ${pct(r.defs, r.total).padEnd(9)} ${pct(r.ex1, r.total).padEnd(9)} ${pct(r.ex3, r.total).padEnd(9)} ${pct(r.ipa, r.total).padEnd(9)} ${pct(r.etym, r.total)}`,
    );
  }
  console.log('\nModule sizes (members incl. cross-listed / target)');
  const rows = moduleSizes(ctx);
  console.log(rows.map((m) => `${m.id}: ${m.actual}/${m.target}`).join('  '));
  console.log(`\nConcepts: ${ctx.concepts.order.length}`);
}
