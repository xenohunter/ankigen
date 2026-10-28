#!/usr/bin/env node
// Generation planner. See docs/GENERATION.md.
//   node tools/gen/plan.mjs status           progress overview
//   node tools/gen/plan.mjs list [n]         list the next n available units
//   node tools/gen/plan.mjs show <unit>      print the input for a unit (JSON) — what the generator receives
//   node tools/gen/plan.mjs done <unit>      mark a concepts/review unit done by hand (merge-unit does this automatically)
//   node tools/gen/plan.mjs undo <unit>      clear a done mark
// Interactive sessions (Claude working in the folder, see GENERATION.md §5):
//   node tools/gen/plan.mjs start [budget]   begin a session (budget in weight points)
//   node tools/gen/plan.mjs next             the next unit, or STOP when the session budget is used
//   node tools/gen/plan.mjs budget <n>       set the default session budget
// Options: --data <dir> (default data)

import path from 'node:path';
import { context, loadProgress, saveProgress, availableUnits, allUnits, unitDone, findUnit, repoRoot } from './units.mjs';
import { buildInput, compact, outputPath } from './inputs.mjs';

const ROOT = repoRoot();
const argv = process.argv.slice(2);
const dIdx = argv.indexOf('--data');
const dataDir = path.resolve(ROOT, dIdx >= 0 ? argv[dIdx + 1] : 'data');
const args = dIdx >= 0 ? argv.filter((_, i) => i !== dIdx && i !== dIdx + 1) : argv;
const [cmd, arg] = args;

const ctx = context(dataDir);
const prog = loadProgress(ROOT);

switch (cmd) {
  case 'start': {
    const budget = arg ? Number(arg) : prog.sessionBudget;
    prog.session = { started: new Date().toISOString(), budget, spent: 0, units: [] };
    saveProgress(ROOT, prog);
    console.log(`Session started. Budget: ${budget} points.`);
    printNext();
    break;
  }
  case 'next':
    printNext();
    break;
  case 'list': {
    const { available } = availableUnits(ctx, prog);
    for (const u of available.slice(0, Number(arg) || 20)) console.log(`${u.id}  (weight ${u.weight})`);
    if (!available.length) console.log('Nothing available.');
    break;
  }
  case 'show': {
    const u = findUnit(ctx, arg);
    if (!u) fail(`unknown unit "${arg}"`);
    console.log(compact(buildInput(ctx, u)));
    break;
  }
  case 'status': {
    const units = allUnits(ctx);
    const by = {};
    for (const u of units) {
      const key = ['lang', 'ipa', 'exfix'].includes(u.type) ? `${u.type}:${u.lang}` : u.type;
      by[key] ??= { done: 0, total: 0, weightLeft: 0 };
      by[key].total++;
      if (unitDone(ctx, prog, u)) by[key].done++;
      else by[key].weightLeft += u.weight;
    }
    let left = 0;
    for (const [k, v] of Object.entries(by)) {
      left += v.weightLeft;
      console.log(`${k.padEnd(14)} ${String(v.done).padStart(4)}/${String(v.total).padEnd(4)} remaining weight ${round1(v.weightLeft)}`);
    }
    console.log(`\nRemaining weight: ${round1(left)} points (1 point ≈ 10k output tokens).`);
    console.log(`Concepts: ${ctx.concepts.order.length}. Lang/IPA units are listed once the concept inventory is complete.`);
    if (prog.session) console.log(`Interactive session: spent ${prog.session.spent}/${prog.session.budget} (${prog.session.units.join(', ') || 'no units yet'})`);
    break;
  }
  case 'done':
  case 'undo': {
    const u = findUnit(ctx, arg);
    if (!u) fail(`unknown unit "${arg}"`);
    if (cmd === 'done') prog.done[u.id] = { at: new Date().toISOString(), manual: true };
    else delete prog.done[u.id];
    saveProgress(ROOT, prog);
    console.log(`${cmd}: ${u.id}`);
    break;
  }
  case 'budget':
    prog.sessionBudget = Number(arg);
    saveProgress(ROOT, prog);
    console.log(`Default session budget set to ${prog.sessionBudget}.`);
    break;
  default:
    console.log('Usage: plan.mjs status|list|show|done|undo|start|next|budget  (see header of this file)');
}

function printNext() {
  const s = prog.session;
  if (!s) fail('No session. Run: node tools/gen/plan.mjs start');
  const { available } = availableUnits(ctx, prog);
  if (!available.length) { console.log('STOP: nothing available (everything done, or blocked).'); return; }
  const u = available[0];
  if (s.spent > 0 && s.spent + u.weight > s.budget * 1.1) {
    console.log(`STOP: session budget reached (${s.spent}/${s.budget}). Next would be ${u.id}.`);
    return;
  }
  const out = outputPath(u.id);
  console.log(`NEXT: ${u.id}  (weight ${u.weight}; session ${s.spent}/${s.budget})`);
  console.log(`  input:  node tools/gen/plan.mjs show ${u.id}`);
  console.log(`  prompt: tools/gen/prompts/${u.type}.md`);
  console.log(`  output: ${out}  then  node tools/gen/merge-unit.mjs ${out}`);
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}
