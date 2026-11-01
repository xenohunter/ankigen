#!/usr/bin/env node
// Run generation units through the Anthropic API. See docs/GENERATION.md §2.
// Requires: Node 18+ and an API key in ANKIGEN_API_KEY, read from the repo's .env file (see .env.example).
// Deliberately NOT ANTHROPIC_API_KEY: if that variable is in your shell, Claude Code bills the API instead of your plan.
//
//   node tools/gen/batch.mjs estimate [filters]           size and cost estimate of the available units
//   node tools/gen/batch.mjs submit   [filters] [--max N] [--dry-run]
//   node tools/gen/batch.mjs status   [batchId]           status of one batch, or of all batches in tmp/batches
//   node tools/gen/batch.mjs collect  <batchId>           download results, merge them, record failures
//   node tools/gen/batch.mjs retry    <batchId> [--dry-run] [--incomplete]   resubmit failures (lint feedback / split if truncated)
//   node tools/gen/batch.mjs sync     <unit> [--repairs 2]    one unit via the plain Messages API, with repair rounds
//   node tools/gen/batch.mjs auto     [filters] [--max N]  submit → wait → collect → retry (≤ 2 rounds);
//                                                          concepts/local/review units run one by one via sync;
//                                                          a lang unit whose other entries exist sends only the missing
//   node tools/gen/batch.mjs auto --batch <batchId>        resume waiting on a submitted batch (no new submit)
// filters:  --type concepts|local|labels|landing|lang|review|ipa|exfix   --lang <code>   --module <id>   --units <id,id,…>
// options:  --model claude-sonnet-5-5  --max-tokens 64000  --price-in 1 --price-out 5 (USD per M tokens, batch)
//           --data <dir> (default data)
//           --incomplete (retry, auto): resubmit only units still missing entries; their review units fix lint errors
//
// Files: tmp/batches/<batchId>.json (manifest), tmp/<unit>.json (outputs, then merged by merge-unit.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { context, loadProgress, availableUnits, findUnit, unitDone, repoRoot, pendingSubset } from './units.mjs';
import { buildInput, compact, systemBlocks, outputPath } from './inputs.mjs';
import { parseOutput } from './output.mjs';

const ROOT = repoRoot();
loadDotEnv(path.join(ROOT, '.env'));

// Minimal .env reader (KEY=VALUE lines, # comments, optional quotes). Never overrides variables already set.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
const API = process.env.ANKIGEN_API_BASE || 'https://api.anthropic.com/v1'; // override only for tests
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(name);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--dry-run', '--incomplete'].includes(argv[i - 1])));
const [cmd, arg] = positional;

const MODEL = opt('--model', process.env.ANKIGEN_MODEL || 'claude-sonnet-5-5');
const MAX_TOKENS = Number(opt('--max-tokens', 64000));
const PRICE_IN = Number(opt('--price-in', 1));
const PRICE_OUT = Number(opt('--price-out', 5));
const DATA = path.resolve(ROOT, opt('--data', 'data'));
const BATCH_DIR = path.join(ROOT, 'tmp', 'batches');
const MAX_ATTEMPTS = 3;
/** Unit types that run one by one through sync: each may unlock the next. */
const SEQUENTIAL = ['concepts', 'local', 'review'];

fs.mkdirSync(BATCH_DIR, { recursive: true });

const commands = { estimate, submit, status, collect, retry, sync, auto };
if (!commands[cmd]) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 21).join('\n'));
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();

// ---------------------------------------------------------------- selection

function filters() {
  return { type: opt('--type'), lang: opt('--lang'), module: opt('--module') };
}

function inflightUnits() {
  const set = new Set();
  for (const m of manifests()) {
    if (m.collectedAt) continue;
    for (const r of m.requests) set.add(r.unit);
  }
  return set;
}

function selectUnits() {
  const ctx = context(DATA);
  const prog = loadProgress(ROOT);
  const f = filters();
  const busy = inflightUnits();
  let { available } = availableUnits(ctx, prog, { type: f.type, lang: f.lang });
  if (f.module) available = available.filter((u) => u.module === f.module);
  if (opt('--units')) available = available.filter((u) => opt('--units').split(',').includes(u.id));
  available = available.filter((u) => !busy.has(u.id));
  const max = Number(opt('--max', 300));
  return { ctx, units: available.slice(0, max) };
}

// ---------------------------------------------------------------- requests

function customId(unitId, part) {
  const base = unitId.replace(/:/g, '__');
  const id = part ? `${base}--p${part[0]}of${part[1]}` : base;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`custom_id not encodable: ${id}`);
  return id;
}

function partFile(unitId, part) {
  const f = outputPath(unitId);
  return part ? f.replace(/\.json$/, `.p${part[0]}of${part[1]}.json`) : f;
}

function buildParams(ctx, u, { subset, repair } = {}) {
  const input = buildInput(ctx, u, { subset });
  const messages = [{ role: 'user', content: `Unit input:\n${compact(input)}\n\nReturn the output JSON object for unit ${u.id}.` }];
  if (repair) {
    messages.push({ role: 'assistant', content: repair.previous.slice(0, 200000) || '{}' });
    messages.push({ role: 'user', content: `The pipeline rejected that output:\n${repair.errors.slice(0, 60).join('\n')}\n\nReturn the complete corrected JSON object for unit ${u.id} (all entries of the unit, not only the fixed ones).` });
  }
  return { model: MODEL, max_tokens: MAX_TOKENS, system: systemBlocks(ROOT, u), messages };
}

function estimateTokens(params) {
  const chars = JSON.stringify(params.system).length + JSON.stringify(params.messages).length;
  return Math.round(chars / 3.2);
}

function expectedOutput(u, subset) {
  const n = subset ? subset.length : u.slice?.length ?? u.ids?.length ?? 0;
  switch (u.type) {
    case 'lang': return n * (['ja', 'zh', 'ar', 'vi'].includes(u.lang) ? 300 : 220);
    case 'local': return 4000;
    case 'ipa': return n * 20;
    case 'exfix': return n * (['ja', 'zh'].includes(u.lang) ? 400 : 300);
    case 'labels': return 2000;
    case 'landing': return 12000;
    case 'concepts': return 250 * 50;
    case 'review': return 8000;
    default: return 5000;
  }
}

// ---------------------------------------------------------------- API

async function api(method, url, body) {
  const key = process.env.ANKIGEN_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) die('No API key: put ANKIGEN_API_KEY=… into .env in the repo root (see .env.example)');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
        method,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt < 5) {
        const wait = Math.min(60, 2 ** attempt * 5);
        console.log(`  network error (${e.cause?.code || e.message}), retrying in ${wait}s…`);
        await sleep(wait * 1000);
        continue;
      }
      die(`network error calling ${url}: ${e.cause?.code || e.message}`);
    }
    if (res.ok) return url.includes('/results') ? res.text() : res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Math.min(60, 2 ** attempt * 5);
      console.log(`  API ${res.status}, retrying in ${wait}s…`);
      await sleep(wait * 1000);
      continue;
    }
    die(`API ${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
}

// A function declaration, not a const: commands run from the top-level await above, before later consts initialize.
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------- manifests

function manifestPath(id) { return path.join(BATCH_DIR, `${id}.json`); }
function saveManifest(m) { fs.writeFileSync(manifestPath(m.id), JSON.stringify(m, null, 1) + '\n'); }
function loadManifest(id) {
  const p = manifestPath(id);
  if (!fs.existsSync(p)) die(`no manifest ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function manifests() {
  return fs.readdirSync(BATCH_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8')));
}

// ---------------------------------------------------------------- commands

async function estimate() {
  const { ctx, units } = selectUnits();
  let tin = 0, tout = 0;
  const byType = {};
  for (const u of units) {
    const subset = pendingSubset(ctx, u);
    const i = estimateTokens(buildParams(ctx, u, { subset }));
    const o = expectedOutput(u, subset);
    tin += i; tout += o;
    const k = `${u.type}${u.lang ? ':' + u.lang : ''}`;
    byType[k] ??= { n: 0, in: 0, out: 0 };
    byType[k].n++; byType[k].in += i; byType[k].out += o;
  }
  for (const [k, v] of Object.entries(byType)) console.log(`${k.padEnd(12)} ${String(v.n).padStart(4)} units  in ≈ ${(v.in / 1e6).toFixed(2)}M  out ≈ ${(v.out / 1e6).toFixed(2)}M`);
  console.log(`\n${units.length} units available. Input ≈ ${(tin / 1e6).toFixed(2)}M tokens (most of the system prompt is cached), output ≈ ${(tout / 1e6).toFixed(2)}M tokens.`);
  console.log(`Upper-bound cost at $${PRICE_IN}/$${PRICE_OUT} per M (in/out): ≈ $${((tin * PRICE_IN + tout * PRICE_OUT) / 1e6).toFixed(2)}`);
}

async function submit(prebuilt) {
  let requests;
  let ctx;
  if (prebuilt) ({ ctx, requests } = prebuilt);
  else {
    const sel = selectUnits();
    ctx = sel.ctx;
    const syncTypes = sel.units.filter((u) => SEQUENTIAL.includes(u.type));
    if (syncTypes.length && !opt('--type')) console.log(`Note: ${syncTypes.length} concepts/local/review unit(s) skipped — run them with "auto --type concepts|local|review" (sequential).`);
    requests = sel.units.filter((u) => !SEQUENTIAL.includes(u.type)).map((u) => ({ unit: u.id, part: null, subset: pendingSubset(ctx, u), attempt: 1 }));
  }
  if (!requests.length) { console.log('Nothing to submit.'); return null; }
  const apiRequests = requests.map((r) => {
    const u = findUnit(ctx, r.unit);
    return { custom_id: customId(r.unit, r.part), params: buildParams(ctx, u, { subset: r.subset, repair: r.repair }) };
  });
  const size = Buffer.byteLength(JSON.stringify({ requests: apiRequests }));
  console.log(`${apiRequests.length} request(s), ${(size / 1e6).toFixed(1)} MB, model ${MODEL}.`);
  if (size > 200e6) die('Batch too large; use --max to split it.');
  if (flag('--dry-run')) {
    const f = path.join(BATCH_DIR, `dry-${Date.now()}.jsonl`);
    fs.writeFileSync(f.replace(/\.jsonl$/, '.requests.jsonl'), apiRequests.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`Dry run: requests written to ${f.replace(/\.jsonl$/, '.requests.jsonl')}`);
    return null;
  }
  const batch = await api('POST', '/messages/batches', { requests: apiRequests });
  const m = {
    id: batch.id, createdAt: new Date().toISOString(), model: MODEL,
    requests: requests.map((r) => ({ customId: customId(r.unit, r.part), unit: r.unit, part: r.part, subset: r.subset, attempt: r.attempt })),
    results: {},
  };
  saveManifest(m);
  console.log(`Submitted ${batch.id}. Check with: node tools/gen/batch.mjs status ${batch.id}`);
  return m;
}

async function status() {
  const ids = arg ? [arg] : manifests().filter((m) => !m.collectedAt).map((m) => m.id);
  if (!ids.length) { console.log('No open batches.'); return; }
  for (const id of ids) {
    const b = await api('GET', `/messages/batches/${id}`);
    const c = b.request_counts;
    console.log(`${id}: ${b.processing_status}  processing ${c.processing}, succeeded ${c.succeeded}, errored ${c.errored}, expired ${c.expired}, canceled ${c.canceled}`);
  }
}

async function collect(idArg) {
  const id = idArg || arg;
  if (!id) die('usage: collect <batchId>');
  const m = loadManifest(id);
  const b = await api('GET', `/messages/batches/${id}`);
  if (b.processing_status !== 'ended') { console.log(`${id} is ${b.processing_status}; try later.`); return m; }
  const text = await api('GET', b.results_url);
  const byCustom = new Map(m.requests.map((r) => [r.customId, r]));
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const line of text.split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const r = byCustom.get(row.custom_id);
    if (!r) continue;
    const res = handleResult(r, row.result, usage);
    m.results[r.customId] = res;
  }
  finalizeMultipart(m);
  m.usage = usage;
  m.collectedAt = new Date().toISOString();
  saveManifest(m);
  report(m);
  return m;
}

function handleResult(r, result, usage) {
  if (result.type !== 'succeeded') return { ok: false, kind: 'api', errors: [`${result.type}: ${JSON.stringify(result.error || {}).slice(0, 300)}`] };
  const msg = result.message;
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  usage.cacheRead += msg.usage?.cache_read_input_tokens || 0;
  usage.cacheWrite += msg.usage?.cache_creation_input_tokens || 0;
  const raw = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (msg.stop_reason === 'max_tokens') return { ok: false, kind: 'truncated', errors: ['output truncated (max_tokens)'], previous: raw };
  return mergeOutput(r, raw);
}

function mergeOutput(r, raw) {
  let obj;
  try { obj = parseOutput(raw); } catch (e) { return { ok: false, kind: 'parse', errors: [`invalid JSON: ${e.message}`], previous: raw }; }
  obj.unit = r.unit;
  const file = path.join(ROOT, partFile(r.unit, r.part));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
  const args = [path.join(ROOT, 'tools/gen/merge-unit.mjs'), file, '--data', DATA];
  if (r.part) args.push('--partial');
  const p = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const out = (p.stdout || '') + (p.stderr || '');
  if (p.status === 0) return { ok: true, file: path.relative(ROOT, file) };
  const errors = out.split('\n').filter((l) => l.startsWith('ERROR')).map((l) => l.replace(/^ERROR\s+/, ''));
  return { ok: false, kind: 'lint', errors: errors.length ? errors : [out.slice(-2000)], previous: raw, file: path.relative(ROOT, file) };
}

// When every part of a split unit merged fine, run a final non-partial merge (completeness check + progress).
function finalizeMultipart(m) {
  const parts = new Map();
  for (const r of m.requests.filter((r) => r.part)) {
    parts.set(r.unit, [...(parts.get(r.unit) || []), r]);
  }
  for (const [unit, rs] of parts) {
    if (!rs.every((r) => m.results[r.customId]?.ok)) continue;
    const file = path.join(ROOT, outputPath(unit).replace(/\.json$/, '.final.json'));
    fs.writeFileSync(file, JSON.stringify({ unit }) + '\n');
    const p = spawnSync(process.execPath, [path.join(ROOT, 'tools/gen/merge-unit.mjs'), file, '--data', DATA], { encoding: 'utf8' });
    if (p.status !== 0) console.log(`  finalize ${unit}: ${(p.stdout || '').split('\n').filter((l) => l.startsWith('ERROR')).join('; ')}`);
  }
}

function report(m) {
  const res = Object.values(m.results);
  const ok = res.filter((r) => r.ok).length;
  const failed = m.requests.filter((r) => !m.results[r.customId]?.ok);
  console.log(`\n${m.id}: ${ok}/${m.requests.length} merged.`);
  for (const r of failed) {
    const x = m.results[r.customId];
    console.log(`  FAILED ${r.customId} [${x?.kind || 'missing'}] ${(x?.errors || ['no result']).slice(0, 3).join(' | ')}`);
  }
  if (m.usage) {
    const u = m.usage;
    const cost = ((u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1) * PRICE_IN + u.output * PRICE_OUT) / 1e6;
    console.log(`  tokens: in ${u.input}, cache write ${u.cacheWrite}, cache read ${u.cacheRead}, out ${u.output}  ≈ $${cost.toFixed(2)}`);
  }
  if (failed.length) console.log(`  Next: node tools/gen/batch.mjs retry ${m.id}`);
}

function retryRequests(m, ctx) {
  // --incomplete: a failed unit whose entries all merged is left to its language's review unit,
  // which fixes lint errors (mostly shared words that need a hint) for a fraction of a whole-unit retry.
  const prog = flag('--incomplete') ? loadProgress(ROOT) : null;
  const out = [];
  for (const r of m.requests) {
    const x = m.results[r.customId];
    if (x?.ok) continue;
    const u = findUnit(ctx, r.unit);
    if (!u) continue;
    if (prog && unitDone(ctx, prog, u)) continue;
    if (r.attempt >= MAX_ATTEMPTS) { console.log(`  giving up on ${r.customId} after ${r.attempt} attempts — fix in an interactive session`); continue; }
    if (x?.kind === 'truncated' && ['lang', 'ipa', 'exfix'].includes(u.type)) {
      const ids = r.subset || u.slice || u.ids;
      const half = Math.ceil(ids.length / 2);
      const [a, b] = [ids.slice(0, half), ids.slice(half)];
      out.push({ unit: r.unit, part: [1, 2], subset: a, attempt: r.attempt + 1 });
      out.push({ unit: r.unit, part: [2, 2], subset: b, attempt: r.attempt + 1 });
    } else if (x?.previous && (x.kind === 'lint' || x.kind === 'parse')) {
      out.push({ unit: r.unit, part: r.part, subset: r.subset, attempt: r.attempt + 1, repair: { previous: x.previous, errors: x.errors } });
    } else {
      out.push({ unit: r.unit, part: r.part, subset: r.subset, attempt: r.attempt + 1 });
    }
  }
  return out;
}

async function retry(idArg) {
  const id = idArg || arg;
  if (!id) die('usage: retry <batchId>');
  const m = loadManifest(id);
  if (!m.collectedAt) die('collect the batch first');
  const ctx = context(DATA);
  const requests = retryRequests(m, ctx);
  m.retriedAt = new Date().toISOString();
  saveManifest(m);
  return submit({ ctx, requests });
}

async function runSync(unitId, repairs) {
  let ctx = context(DATA);
  const u = findUnit(ctx, unitId);
  if (!u) die(`unknown unit ${unitId}`);
  const subset = pendingSubset(ctx, u);
  const r = { unit: u.id, part: null, subset, attempt: 1 };
  let repair = null;
  for (let round = 0; round <= repairs; round++) {
    ctx = context(DATA);
    const params = buildParams(ctx, findUnit(ctx, u.id), { subset, repair });
    if (flag('--dry-run')) { console.log(JSON.stringify(params).slice(0, 2000)); return true; }
    console.log(`${u.id}: request${round ? ` (repair ${round})` : ''}…`);
    const msg = await api('POST', '/messages', params);
    const raw = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (msg.stop_reason === 'max_tokens') { console.log('  truncated output'); repair = { previous: raw, errors: ['output truncated; be more concise'] }; continue; }
    const res = mergeOutput(r, raw);
    const us = msg.usage || {};
    // sync runs on the plain Messages API: twice the batch prices given by --price-in/--price-out
    const cost = (2 * ((us.input_tokens || 0) + (us.cache_creation_input_tokens || 0) * 1.25 + (us.cache_read_input_tokens || 0) * 0.1) * PRICE_IN + 2 * (us.output_tokens || 0) * PRICE_OUT) / 1e6;
    console.log(`  tokens: in ${us.input_tokens}, cache write ${us.cache_creation_input_tokens || 0}, cache read ${us.cache_read_input_tokens || 0}, out ${us.output_tokens}  ≈ $${cost.toFixed(3)}`);
    if (res.ok) { console.log(`  OK ${u.id}`); return true; }
    console.log(`  ${res.kind}: ${res.errors.slice(0, 5).join(' | ')}`);
    repair = { previous: res.previous || raw, errors: res.errors };
  }
  console.log(`  ${u.id} still failing — finish it in an interactive session (docs/GENERATION.md §5).`);
  return false;
}

async function sync() {
  if (!arg) die('usage: sync <unit>');
  await runSync(arg, Number(opt('--repairs', 2)));
}

async function auto() {
  const type = opt('--type');
  if (SEQUENTIAL.includes(type)) {
    // sequential: each unit may unlock the next
    for (;;) {
      const { units } = selectUnits();
      const u = units.find((x) => x.type === type);
      if (!u) { console.log('No more units of this type available.'); return; }
      const ok = await runSync(u.id, Number(opt('--repairs', 2)));
      if (!ok) return;
    }
  }
  let m = opt('--batch') ? loadManifest(opt('--batch')) : await submit();
  for (let round = 0; m && round <= 2; round++) {
    for (;;) {
      await sleep(60000);
      const b = await api('GET', `/messages/batches/${m.id}`);
      const c = b.request_counts;
      console.log(`${new Date().toISOString().slice(11, 19)} ${m.id}: ${b.processing_status} (${c.succeeded + c.errored + c.expired + c.canceled}/${m.requests.length} done)`);
      if (b.processing_status === 'ended') break;
    }
    m = await collect(m.id);
    if (!m.requests.some((r) => !m.results[r.customId]?.ok) || round === 2) break;
    m = await retry(m.id);
  }
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}
