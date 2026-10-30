#!/usr/bin/env node
// Pronunciation audio with Google Cloud Text-to-Speech (docs/GENERATION.md §7): one clip per word entry of a
// language, saying its main form as the card shows it with default settings (the rules in tools/lib/audio.mjs).
//
//   node tools/audio.mjs run      [--lang <code>] [--max-chars N]   resolve voices, then make the missing or changed clips
//   node tools/audio.mjs estimate [--lang <code>]                    clips and characters still to generate
//   node tools/audio.mjs pilot    [--lang <code>]                    about 20 words per language, and tmp/audio-pilot.html
//   node tools/audio.mjs prune                                       delete clip files no manifest uses
//   node tools/audio.mjs status                                      voice and tier per language, clips present and missing
// options: --data <dir> (default data)  --meta <dir> (default data/meta)
//
// run resolves the voice of every language that has a "tts" locale in languages.json but no audio.json entry, checks
// the unsupported ones again, then makes each clip that is missing or whose text, locale, voice or format changed,
// and updates the manifests. Without --lang it covers every language with data. It stops before sending more than
// --max-chars characters (default 900,000); a later run goes on from there. Requests keep to Google's quotas,
// 429/5xx are retried with backoff, and failures are logged to tmp/audio-failures.jsonl while the run goes on.
//
// The API key is GOOGLE_TTS_API_KEY in .env in the repo root; this tool reads that variable and nothing else.
// GOOGLE_TTS_API_BASE points the tool at another endpoint (tests).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDirs, loadConcepts, loadRegistry, paths } from './lib/data.mjs';
import {
  FORMAT, MAX_CHARS, REQUESTS_PER_MINUTE, TIERS, billedChars, clipFile, currentClips, defaultRules, hasSpeech,
  languageAudio, pickVoice, planClips, readAudioMeta, readManifest, resolveReason, speechInputs, writeAtomic,
  writeAudioMeta, writeManifest,
} from './lib/audio.mjs';
import { stripStress } from '../src/text/normalize.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = process.env.GOOGLE_TTS_API_BASE || 'https://texttospeech.googleapis.com/v1';
const TMP = path.join(ROOT, 'tmp');
const FAILURES = path.join(TMP, 'audio-failures.jsonl');
const WORKERS = 6;
/** Tries for a Chirp 3 HD clip that keeps coming back without speech (see hasSpeech). */
const SPEECH_TRIES = 10;

const argv = process.argv.slice(2);
/** @param {string} name @param {string} [fallback] */
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const [cmd] = argv;
const DATA = path.resolve(ROOT, opt('--data', 'data') ?? 'data');
const META = path.resolve(ROOT, opt('--meta', 'data/meta') ?? 'data/meta');
const ONLY = opt('--lang');
const MAX = Number(opt('--max-chars', String(MAX_CHARS)));

/** Characters sent to Google by this run (counted before each request), and whether it stopped at the limit. */
const budget = { used: 0, max: MAX, stopped: false };
/** Write the manifest of the language in progress (on Ctrl+C too). @type {(() => void) | null} */
let flush = null;
/** Requests pause here after a 429. */
let pauseUntil = 0;
/** @type {any[] | null} */
let voiceList = null;

// ---------------------------------------------------------------- context

function context() {
  const p = paths(DATA, META);
  const reg = loadRegistry(p.meta);
  const concepts = loadConcepts(p, reg, []);
  const audio = readAudioMeta(META);
  const order = [...reg.languages.active, ...reg.languages.deferred];
  const withData = listDirs(path.join(DATA, 'lang')).filter((code) => reg.languages.languages[code]);
  if (ONLY && !reg.languages.languages[ONLY]) die(`unknown language "${ONLY}"`);
  const codes = ONLY ? [ONLY] : order.filter((code) => withData.includes(code));
  return { reg, order: concepts.order, audio, langOrder: order, codes, primary: (/** @type {string} */ id) => concepts.byId.get(id)?.module ?? '' };
}

/** @typedef {ReturnType<typeof context>} Ctx */

/** @param {Ctx} ctx @param {string} code */
const audioOf = (ctx, code) => languageAudio({ dataDir: DATA, reg: ctx.reg, order: ctx.order, audio: ctx.audio }, code);

/** @param {Ctx} ctx @param {string} code */
function label(ctx, code) {
  const lang = ctx.reg.languages.languages[code];
  const s = ctx.audio.languages[code];
  if (!lang.tts) return 'no "tts" locale in languages.json';
  if (!s) return `${lang.tts}: voice not resolved yet`;
  if (s.unsupported) return `${s.locale}: unsupported (no ${TIERS.join(', ')} voice)`;
  return `${s.voice} (${s.tier})`;
}

// ---------------------------------------------------------------- Google Cloud Text-to-Speech

/** GOOGLE_TTS_API_KEY from the environment, else from .env, of which only that line is read. */
function apiKey() {
  if (process.env.GOOGLE_TTS_API_KEY) return process.env.GOOGLE_TTS_API_KEY;
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return '';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?GOOGLE_TTS_API_KEY\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

/** @param {number} attempt */
function backoff(attempt) {
  return Math.min(60_000, 2_000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

/**
 * One API request. 429, 5xx and network errors are retried with backoff; other errors are returned. The key goes in
 * a header, never in the URL, so no message carries it.
 * @param {'GET' | 'POST'} method @param {string} route @param {any} [body]
 * @returns {Promise<{ ok: true, json: any } | { ok: false, status: number, error: string }>}
 */
async function google(method, route, body) {
  const key = apiKey();
  if (!key) die('No API key: put GOOGLE_TTS_API_KEY=… into .env in the repo root (see .env.example)');
  for (let attempt = 0; ; attempt++) {
    if (pauseUntil > Date.now()) await sleep(pauseUntil - Date.now());
    /** @type {Response} */
    let res;
    try {
      res = await fetch(`${API}/${route}`, {
        method,
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json; charset=utf-8' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      const error = /** @type {any} */ (e);
      if (attempt < 6) {
        await sleep(backoff(attempt));
        continue;
      }
      return { ok: false, status: 0, error: `network: ${error.cause?.code ?? error.message}` };
    }
    if (res.ok) return { ok: true, json: await res.json() };
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = backoff(attempt);
      if (res.status === 429) pauseUntil = Math.max(pauseUntil, Date.now() + wait);
      await sleep(wait);
      continue;
    }
    let message = text.slice(0, 300);
    try {
      message = JSON.parse(text).error?.message ?? message;
    } catch {
      // not JSON: keep the text
    }
    return { ok: false, status: res.status, error: message.split(key).join('<key>') };
  }
}

/**
 * @param {string} input plain text, or SSML when it starts with <speak> @param {{ locale: string, voice: string }} setting
 * @returns {Promise<{ ok: true, bytes: Uint8Array } | { ok: false, status: number, error: string }>}
 */
async function synthesize(input, setting) {
  const res = await google('POST', 'text:synthesize', {
    input: input.startsWith('<speak>') ? { ssml: input } : { text: input },
    voice: { languageCode: setting.locale, name: setting.voice },
    audioConfig: { audioEncoding: 'MP3' },
  });
  if (!res.ok) return res;
  const bytes = new Uint8Array(Buffer.from(res.json.audioContent ?? '', 'base64'));
  return bytes.length ? { ok: true, bytes } : { ok: false, status: 200, error: 'no audio in the answer' };
}

/**
 * Synthesize a text whose characters are already spent. A Chirp 3 HD clip without speech in it is tried again, up to
 * SPEECH_TRIES times in all, each try spending its characters. The tries alternate between the text as written and
 * the same words capitalized with a full stop ("tak" → "Tak."), which the voice says more often (tested 2026-10-28).
 * @param {string} text @param {{ locale: string, voice: string, tier: string }} setting @param {() => Promise<void>} limit
 * @returns {Promise<({ ok: true, bytes: Uint8Array } | { ok: false, status: number, error: string }) & { tries: number, sent: string, chars: number }>}
 */
async function say(text, setting, limit) {
  const capital = text.charAt(0).toLocaleUpperCase(setting.locale) + text.slice(1);
  const forms = text.startsWith('<speak>') ? [text] : [text, /[.!?…。！？]$/.test(capital) ? capital : `${capital}.`];
  let chars = 0;
  for (let tries = 1; ; tries++) {
    const sent = forms[(tries - 1) % forms.length];
    chars += billedChars(sent);
    await limit();
    const res = await synthesize(sent, setting);
    if (!res.ok || setting.tier !== 'chirp3-hd' || hasSpeech(res.bytes)) return { ...res, tries, sent, chars };
    const next = forms[tries % forms.length];
    if (tries >= SPEECH_TRIES || !spend(next)) return { ok: false, status: 200, error: `no speech in ${tries} tries`, tries, sent, chars };
  }
}

/** Starts requests no faster than `perMinute`, and not during a pause after a 429. @param {number} perMinute */
function throttle(perMinute) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next, pauseUntil);
    next = at + 60_000 / perMinute;
    if (at > now) await sleep(at - now);
  };
}

/** The characters of a request, unless they would pass the run's limit. @param {string} input */
function spend(input) {
  if (budget.used + billedChars(input) > budget.max) {
    budget.stopped = true;
    return false;
  }
  budget.used += billedChars(input);
  return true;
}

/** Google's voices, all locales (one request per run). */
async function voices() {
  if (!voiceList) {
    const res = await google('GET', 'voices');
    if (!res.ok) die(`could not list Google's voices: ${res.status} ${res.error}`);
    voiceList = res.json.voices ?? [];
  }
  return /** @type {any[]} */ (voiceList);
}

/**
 * Whether a voice follows SSML pinyin phonemes: 还 as hai2 and as huan2 must sound different. If the same request
 * twice gives different bytes as well, the voice varies by itself and the pilot's 还 and 打 tell.
 * @param {string} locale @param {string} voice
 */
async function pinyinWorks(locale, voice) {
  const ssml = (/** @type {string} */ ph) => `<speak><phoneme alphabet="pinyin" ph="${ph}">还</phoneme></speak>`;
  const setting = { locale, voice };
  if (![ssml('hai2'), ssml('hai2'), ssml('huan2')].every(spend)) return false;
  const a = await synthesize(ssml('hai2'), setting);
  const b = await synthesize(ssml('hai2'), setting);
  const c = await synthesize(ssml('huan2'), setting);
  if (!a.ok || !b.ok || !c.ok) {
    const error = [a, b, c].find((r) => !r.ok);
    console.log(`  ${voice} refused SSML pinyin: ${/** @type {any} */ (error).error}`);
    return false;
  }
  const same = (/** @type {Uint8Array} */ x, /** @type {Uint8Array} */ y) => Buffer.compare(x, y) === 0;
  if (same(a.bytes, c.bytes)) return false;
  if (!same(a.bytes, b.bytes)) console.log(`  ${voice} varies between identical requests: listen to 还 and 打 in the pilot`);
  return true;
}

// ---------------------------------------------------------------- voices

/**
 * Resolve the voices audio.json does not settle yet (new languages, unsupported ones, a changed locale) and save it.
 * @param {Ctx} ctx @param {string[]} codes
 */
async function resolveVoices(ctx, codes) {
  let changed = false;
  for (const code of codes) {
    const lang = ctx.reg.languages.languages[code];
    const before = ctx.audio.languages[code];
    const reason = resolveReason(before, lang.tts);
    if (!reason) continue;
    const pick = pickVoice(await voices(), lang.tts);
    if (!pick) {
      if (reason === 'unsupported') console.log(`${code}: still no ${TIERS.join(', ')} voice for ${lang.tts}`);
      else console.log(`${code}: Google has no ${TIERS.join(', ')} voice for ${lang.tts}: no audio`);
      if (reason === 'unsupported') continue;
      ctx.audio.languages[code] = { locale: lang.tts, unsupported: true };
      changed = true;
      continue;
    }
    const text = defaultRules(lang, ctx.reg.fields, code);
    if (text.homographs === 'pinyin' && !(await pinyinWorks(lang.tts, pick.voice))) {
      delete text.homographs;
      console.log(`${code}: ${pick.voice} does not follow SSML pinyin phonemes, so homographs are sent as written`);
    }
    ctx.audio.languages[code] = { locale: lang.tts, voice: pick.voice, tier: pick.tier, format: FORMAT, text };
    console.log(`${code}: ${pick.voice} (${pick.tier})${reason === 'locale' ? `, instead of ${before.locale}` : ''}`);
    changed = true;
  }
  if (changed) writeAudioMeta(META, ctx.audio, ctx.langOrder);
}

// ---------------------------------------------------------------- generation

/**
 * Make one language's missing or changed clips (only those of `only`, if given), within the character budget.
 * @param {Ctx} ctx @param {ReturnType<typeof languageAudio>} la @param {Set<string>} [only]
 */
async function generate(ctx, la, only) {
  const setting = la.setting;
  const { manifest, todo } = planClips(la);
  const save = () => writeManifest(la.dir, manifest, ctx.order);
  flush = save;
  save();
  const tasks = [...todo].filter(([, ids]) => !only || ids.some((id) => only.has(id)));
  const result = { made: 0, failed: 0, retries: 0, chars: 0, left: tasks.length };
  if (!tasks.length) return result;
  const limit = throttle(REQUESTS_PER_MINUTE[/** @type {keyof typeof REQUESTS_PER_MINUTE} */ (setting.tier)] ?? 180);
  let next = 0;
  let unsaved = 0;
  const worker = async () => {
    while (next < tasks.length && !budget.stopped) {
      const [text, ids] = tasks[next];
      if (!spend(text)) break;
      next++;
      const res = await say(text, setting, limit);
      result.chars += res.chars;
      result.retries += res.tries - 1;
      result.left--;
      if (!res.ok) {
        result.failed++;
        fs.mkdirSync(TMP, { recursive: true });
        const line = { time: new Date().toISOString(), lang: la.code, concepts: ids, text, voice: setting.voice, status: res.status, error: res.error };
        fs.appendFileSync(FAILURES, `${JSON.stringify(line)}\n`);
        continue;
      }
      const file = clipFile(res.bytes);
      if (!la.has(file)) writeAtomic(path.join(la.dir, file), res.bytes);
      const sent = res.sent === text ? {} : { sent: res.sent };
      for (const id of ids) manifest[id] = { file, text, voice: setting.voice, bytes: res.bytes.length, ...sent };
      result.made++;
      if (++unsaved >= 50) {
        save();
        unsaved = 0;
      }
      if (result.made % 250 === 0) console.log(`  ${la.code}: ${result.made} of ${tasks.length} clips, ${budget.used.toLocaleString('en-US')} characters sent`);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  save();
  flush = null;
  return result;
}

async function run() {
  const ctx = context();
  await resolveVoices(ctx, ctx.codes);
  const rows = [];
  for (const code of ctx.codes) {
    const la = audioOf(ctx, code);
    if (!la.setting?.voice) {
      console.log(`${code}: ${label(ctx, code)}`);
      continue;
    }
    if (!la.entries.size) continue;
    if (budget.stopped) break;
    console.log(`${code}: ${label(ctx, code)}, ${la.entries.size} words`);
    const r = await generate(ctx, la);
    rows.push({ code, ...r });
  }
  console.log('\nlang  made  retries  failed  characters');
  for (const r of rows) {
    console.log(`${r.code.padEnd(5)} ${String(r.made).padStart(4)}  ${String(r.retries).padStart(7)}  ${String(r.failed).padStart(6)}  ${r.chars.toLocaleString('en-US').padStart(10)}`);
  }
  console.log(`\n${budget.used.toLocaleString('en-US')} characters sent (limit ${budget.max.toLocaleString('en-US')}).`);
  const failed = rows.reduce((n, r) => n + r.failed, 0);
  if (failed) console.log(`${failed} clip(s) failed: see ${path.relative(ROOT, FAILURES)}; the next run tries them again.`);
  if (budget.stopped) console.log('Stopped at the character limit: run again (perhaps with --max-chars) to go on.');
}

async function estimate() {
  const ctx = context();
  let clips = 0;
  let chars = 0;
  console.log('lang  clips  characters  voice');
  for (const code of ctx.codes) {
    const la = audioOf(ctx, code);
    if (la.setting?.unsupported || !ctx.reg.languages.languages[code].tts) {
      console.log(`${code.padEnd(5)} ${'—'.padStart(5)}  ${'—'.padStart(10)}  ${label(ctx, code)}`);
      continue;
    }
    const todo = la.setting?.voice ? planClips(la).todo : new Map([...new Set(la.inputs.values())].map((t) => [t, []]));
    const n = [...todo.keys()].reduce((sum, t) => sum + billedChars(t), 0);
    clips += todo.size;
    chars += n;
    console.log(`${code.padEnd(5)} ${String(todo.size).padStart(5)}  ${n.toLocaleString('en-US').padStart(10)}  ${label(ctx, code)}`);
  }
  console.log(`\ntotal ${clips.toLocaleString('en-US')} clips, ${chars.toLocaleString('en-US')} characters (Chirp 3 HD: $30 per million; check your free tier)`);
}

async function status() {
  const ctx = context();
  console.log(`GOOGLE_TTS_API_KEY: ${apiKey() ? 'set' : 'missing'}\n`);
  console.log('lang  words  clips  missing  files      size  voice');
  for (const code of ctx.codes) {
    const la = audioOf(ctx, code);
    const current = currentClips(la).size;
    const files = fs.existsSync(la.dir) ? fs.readdirSync(la.dir).filter((f) => f.endsWith(`.${FORMAT}`)) : [];
    const size = files.reduce((n, f) => n + fs.statSync(path.join(la.dir, f)).size, 0);
    const missing = la.setting?.voice ? la.entries.size - current : 0;
    console.log(
      `${code.padEnd(5)} ${String(la.entries.size).padStart(5)}  ${String(current).padStart(5)}  ${String(missing).padStart(7)}  ${String(files.length).padStart(5)}  ${mb(size).padStart(8)}  ${label(ctx, code)}`,
    );
  }
}

async function prune() {
  let count = 0;
  let bytes = 0;
  for (const code of listDirs(path.join(DATA, 'audio'))) {
    if (ONLY && code !== ONLY) continue;
    const dir = path.join(DATA, 'audio', code);
    const used = new Set(Object.values(readManifest(dir)).map((m) => m?.file));
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(`.${FORMAT}`) || used.has(f)) continue;
      bytes += fs.statSync(path.join(dir, f)).size;
      fs.unlinkSync(path.join(dir, f));
      count++;
    }
  }
  console.log(`Removed ${count} clip file(s) no manifest uses (${mb(bytes)}).`);
}

// ---------------------------------------------------------------- pilot

/**
 * About 20 words of a language worth listening to first: homographs (Japanese/Chinese readings, Russian stress),
 * special texts (SSML, alternatives, elision), the longest texts, then the first words of the deck.
 * @param {ReturnType<typeof languageAudio>} la
 */
function pilotWords(la, size = 20) {
  const ids = [...la.inputs.keys()];
  const text = (/** @type {string} */ id) => /** @type {string} */ (la.inputs.get(id));
  /** @param {(e: any) => string} by @param {(e: any) => string} value */
  const clashing = (by, value) => {
    /** @type {Map<string, Set<string>>} */
    const groups = new Map();
    for (const [, e] of la.entries) groups.set(by(e), (groups.get(by(e)) ?? new Set()).add(value(e)));
    return ids.filter((id) => /** @type {Set<string>} */ (groups.get(by(la.entries.get(id)))).size > 1);
  };
  const picks = new Set();
  /** @param {string[]} list @param {number} max */
  const add = (list, max) => {
    for (const id of list.slice(0, max)) picks.add(id);
  };
  add(clashing((e) => e.w, (e) => e.read ?? ''), 6);
  if (la.lang.stress) add(clashing((e) => stripStress(e.w), (e) => e.w), 6);
  add(ids.filter((id) => /^<speak>|, /.test(text(id))), 3);
  add(ids.filter((id) => la.entries.get(id).art), 1);
  add([...ids].sort((a, b) => billedChars(text(b)) - billedChars(text(a))), 4);
  for (const id of ids) if (picks.size < size) picks.add(id);
  return ids.filter((id) => picks.has(id));
}

async function pilot() {
  const ctx = context();
  await resolveVoices(ctx, ctx.codes);
  const pilotDir = path.join(TMP, 'audio-pilot');
  const sections = [];
  for (const code of ctx.codes) {
    let la = audioOf(ctx, code);
    const name = ctx.reg.languages.languages[code].name;
    if (!la.setting?.voice) {
      sections.push(`<h2>${esc(name)} (${code})</h2><p>${esc(label(ctx, code))}</p>`);
      continue;
    }
    const picks = pilotWords(la);
    const r = await generate(ctx, la, new Set(picks));
    console.log(`${code}: ${picks.length} words, ${r.made} new clips${r.failed ? `, ${r.failed} failed` : ''}`);
    la = audioOf(ctx, code); // the manifest as saved
    // Russian: the same words with their stress marks, beside the clips, to compare (kept under tmp/ only).
    /** @type {Map<string, string>} */
    const stressed = new Map();
    if (la.lang.stress) {
      const limit = throttle(REQUESTS_PER_MINUTE[/** @type {keyof typeof REQUESTS_PER_MINUTE} */ (la.setting.tier)] ?? 180);
      const dir = path.join(pilotDir, code);
      const cacheFile = path.join(dir, 'texts.json');
      const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
      const withMarks = speechInputs(la.entries, la.lang, { ...la.setting.text, stress: true });
      for (const id of picks) {
        const t = /** @type {string} */ (withMarks.get(id));
        if (t === la.inputs.get(id)) continue;
        const key = `${la.setting.voice}|${t}`;
        if (!cache[key] || !fs.existsSync(path.join(dir, cache[key]))) {
          if (!spend(t)) break;
          const res = await say(t, la.setting, limit);
          if (!res.ok) continue;
          cache[key] = clipFile(res.bytes);
          writeAtomic(path.join(dir, cache[key]), res.bytes);
        }
        stressed.set(id, path.relative(TMP, path.join(dir, cache[key])));
      }
      writeAtomic(cacheFile, JSON.stringify(cache, null, 1));
    }
    const rows = picks.map((id) => {
      const e = la.entries.get(id);
      const m = la.manifest[id];
      const clip = m?.text === la.inputs.get(id) ? `<audio controls preload="none" src="${esc(path.relative(TMP, path.join(la.dir, m.file)))}"></audio>` : '(failed)';
      const extra = la.lang.stress ? `<td>${stressed.has(id) ? `<audio controls preload="none" src="${esc(/** @type {string} */ (stressed.get(id)))}"></audio>` : '(no marks)'}</td>` : '';
      const reading = e.read ? ` <span class="r">${esc(e.read)}</span>` : '';
      return `<tr><td><code>${esc(id)}</code></td><td>${esc(e.w)}${reading}</td><td><code>${esc(/** @type {string} */ (la.inputs.get(id)))}</code></td><td>${clip}</td>${extra}</tr>`;
    });
    const head = `<tr><th>Concept</th><th>Word</th><th>Sent</th><th>Clip</th>${la.lang.stress ? '<th>With stress marks</th>' : ''}</tr>`;
    sections.push(`<h2>${esc(name)} (${code})</h2><p>${esc(label(ctx, code))} · rules ${esc(JSON.stringify(la.setting.text))}</p><table>${head}${rows.join('')}</table>`);
  }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AnkiGen audio pilot</title><style>
body{font:15px/1.4 system-ui,sans-serif;margin:2rem auto;max-width:70rem;padding:0 1rem}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.25rem .5rem;border-bottom:1px solid #ddd;vertical-align:middle}audio{height:2rem}.r{color:#666}
</style></head><body><h1>Pronunciation audio pilot</h1><p>Made ${esc(new Date().toISOString())} by tools/audio.mjs pilot.
Clips are under data/audio (a run reuses them); the Russian clips with stress marks only under tmp/audio-pilot.</p>
${sections.join('\n')}</body></html>
`;
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'audio-pilot.html'), page);
  console.log(`\n${path.relative(ROOT, path.join(TMP, 'audio-pilot.html'))} · ${budget.used.toLocaleString('en-US')} characters sent`);
}

// ---------------------------------------------------------------- helpers

/** @param {string} text */
function esc(text) {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** @param {number} bytes */
function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} message @returns {never} */
function die(message) {
  flush?.();
  console.error(`tools/audio.mjs: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- main (last: the commands use everything above)

const commands = { run, estimate, pilot, prune, status };
if (!Object.hasOwn(commands, cmd ?? '') || !Number.isFinite(MAX) || MAX < 0) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    flush?.();
    console.log(`\nStopped; the manifests are saved. ${budget.used.toLocaleString('en-US')} characters sent.`);
    process.exit(130);
  });
}
await commands[/** @type {keyof typeof commands} */ (cmd)]();
