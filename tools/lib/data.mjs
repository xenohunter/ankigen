// Shared data access + validation for AnkiGen vocabulary data.
// Zero dependencies. Node >= 18. Used by tools/lint-data.mjs, tools/gen/*.mjs and tests.
// The browser app has its own loader; keep the format rules in docs/DATA_FORMAT.md in sync with this file.

import fs from 'node:fs';
import path from 'node:path';

export const LAYERS = ['lang', 'ex', 'ipa', 'etym'];
export const POS = ['noun', 'verb', 'adj', 'adv', 'pron', 'num', 'prep', 'conj', 'interj', 'particle', 'det', 'phrase'];
export const REGISTERS = ['informal', 'formal', 'vulgar', 'offensive'];
export const ID_RE = /^(word|phrase)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ID_MAX = 60;
export const CONCEPT_KEYS = ['pos', 'mods', 'grp', 'emoji', 'ant', 'rel', 'note', 'reg', 'only'];
export const ENTRY_KEYS = ['w', 'alt', 'g', 'art', 'forms', 'hint', 'read', 'rom', 'mw', 'hanja', 'def', 'gl', 'st'];
export const EXAMPLE_KEYS = ['t', 'p', 'r'];
export const ACUTE = '́';

// ---------- IO ----------

export function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return { text, data: JSON.parse(text) };
  } catch (e) {
    const err = new Error(`${file}: invalid JSON: ${e.message}`);
    err.file = file;
    throw err;
  }
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function listJson(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

export function listDirs(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

// Canonical format for data files: one top-level object, one entry per line, compact values,
// keys in canonical concept order. Small, diff-friendly, stable.
export function canonicalStringify(obj, order) {
  const keys = Object.keys(obj);
  if (order) {
    const rank = new Map(order.map((id, i) => [id, i]));
    keys.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || (a < b ? -1 : a > b ? 1 : 0));
  }
  if (keys.length === 0) return '{}\n';
  const lines = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`);
  return '{\n' + lines.join(',\n') + '\n}\n';
}

export function writeCanonical(file, obj, order) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canonicalStringify(obj, order), 'utf8');
}

// Canonical format for meta/labels.json: one line per key group, in "keys" and in every language map.
// A group starts where the key prefix changes, and also at the verb forms and the ja/ko forms,
// so the long form.* run stays readable. Language maps follow `langOrder` (registry order).
const LABEL_LINE_STARTS = new Set(['form.aspect', 'form.class']);

export function labelGroups(keys) {
  const groups = [];
  let prev = null;
  for (const k of keys) {
    const prefix = k.slice(0, k.lastIndexOf('.'));
    if (!groups.length || prefix !== prev || LABEL_LINE_STARTS.has(k)) groups.push([]);
    groups[groups.length - 1].push(k);
    prev = prefix;
  }
  return groups;
}

export function stringifyLabels(data, langOrder = []) {
  const groups = labelGroups(data.keys);
  const known = new Set(data.keys);
  const rank = (code) => (langOrder.includes(code) ? langOrder.indexOf(code) : langOrder.length);
  const codes = Object.keys(data.labels).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const keyLines = groups.map((g) => '    ' + g.map((k) => JSON.stringify(k)).join(', '));
  const langBlocks = codes.map((code) => {
    const map = data.labels[code];
    const lines = [...groups, Object.keys(map).filter((k) => !known.has(k))]
      .map((g) => g.filter((k) => k in map).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(map[k])}`).join(', '))
      .filter(Boolean);
    return lines.length ? `    ${JSON.stringify(code)}: {\n${lines.map((l) => '      ' + l).join(',\n')}\n    }` : `    ${JSON.stringify(code)}: {}`;
  });
  const top = Object.entries(data).map(([k, v]) => {
    if (k === 'keys') return `  "keys": [\n${keyLines.join(',\n')}\n  ]`;
    if (k === 'labels') return `  "labels": {\n${langBlocks.join(',\n')}\n  }`;
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return '{\n' + top.join(',\n') + '\n}\n';
}

// ---------- Paths ----------

export function paths(dataDir, metaDir) {
  const meta = metaDir || path.join(dataDir, 'meta');
  return {
    data: dataDir,
    meta,
    concepts: path.join(dataDir, 'concepts'),
    layer: (layer, code, module) => path.join(dataDir, layer, code, `${module}.json`),
    conceptFile: (module) => path.join(dataDir, 'concepts', `${module}.json`),
  };
}

// ---------- Registry ----------

export function loadRegistry(metaDir) {
  const languages = readJson(path.join(metaDir, 'languages.json')).data;
  const modulesTree = readJson(path.join(metaDir, 'modules.json')).data;
  const fields = readJson(path.join(metaDir, 'fields.json')).data;
  const { data: labels, text: labelsText } = readJson(path.join(metaDir, 'labels.json'));
  const retiredFile = path.join(metaDir, 'retired.json');
  const retired = exists(retiredFile) ? readJson(retiredFile).data.retired || {} : {};
  const modules = [];
  for (const cat of modulesTree.categories) {
    for (const m of cat.modules) modules.push({ ...m, category: cat.id });
  }
  const moduleById = new Map(modules.map((m, i) => [m.id, { ...m, order: i }]));
  return { languages, modulesTree, modules, moduleById, fields, labels, labelsText, retired };
}

/** Language order for meta/labels.json: the registry's active, then deferred languages. */
export function labelOrder(reg) {
  return [...reg.languages.active, ...reg.languages.deferred];
}

// ---------- Concepts ----------

// Returns { byId: Map(id -> {id, c, module, index, rank}), order: [ids in canonical order], files: {module: {data,text}} }
export function loadConcepts(p, reg, issues) {
  const byId = new Map();
  const order = [];
  const files = {};
  const fileNames = listJson(p.concepts);
  const present = new Set(fileNames.map((f) => f.slice(0, -5)));
  for (const f of fileNames) {
    const mod = f.slice(0, -5);
    if (!reg.moduleById.has(mod)) issues?.push(err(`concepts/${f}`, null, `file does not match any module in modules.json`));
  }
  // canonical order: module order, then file order
  for (const m of reg.modules) {
    if (!present.has(m.id)) continue;
    const file = p.conceptFile(m.id);
    let parsed;
    try { parsed = readJson(file); } catch (e) { issues?.push(err(`concepts/${m.id}.json`, null, e.message)); continue; }
    files[m.id] = parsed;
    let index = 0;
    for (const [id, c] of Object.entries(parsed.data)) {
      if (byId.has(id)) {
        issues?.push(err(`concepts/${m.id}.json`, id, `duplicate concept ID (also in concepts/${byId.get(id).module}.json)`));
        continue;
      }
      byId.set(id, { id, c, module: m.id, index: index++, rank: order.length });
      order.push(id);
    }
  }
  return { byId, order, files };
}

// ---------- Issues ----------

export function err(file, id, msg) { return { level: 'error', file, id, msg }; }
export function warn(file, id, msg) { return { level: 'warning', file, id, msg }; }

// ---------- Script checks ----------

const SCRIPT_RE = {
  Latin: /\p{Script=Latin}/u,
  Cyrillic: /\p{Script=Cyrillic}/u,
  Greek: /\p{Script=Greek}/u,
  Armenian: /\p{Script=Armenian}/u,
  Hangul: /\p{Script=Hangul}/u,
  Han: /\p{Script=Han}/u,
  Japanese: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]/u,
};
const LETTER_RE = /\p{L}/u;

// Returns {expected, foreign: [chars]}
export function scriptStats(str, script) {
  const re = SCRIPT_RE[script];
  let expected = 0;
  const foreign = new Set();
  for (const ch of str) {
    if (!LETTER_RE.test(ch)) continue;
    if (re.test(ch)) expected++;
    else foreign.add(ch);
  }
  return { expected, foreign: [...foreign] };
}

// ---------- Full-width punctuation ----------

// Chinese and Japanese prose takes full-width punctuation. An ASCII , : ; ! ? next to a character (looking
// through brackets, braces and quotes), or ( ) next to a character or around text with characters, is a slip.
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー';
const CJK_LEFT = `[${CJK}][\\]}）」』”]*`;
const CJK_RIGHT = `[\\[{（「『“]*[${CJK}]`;
const MARK = '[,:;!?]';
const PARENS_AFTER = `([${CJK}])\\s*\\(([^()]*)\\)`;
const PARENS_BEFORE = `\\(([^()]*)\\)(?=[${CJK}。，、；：！？])`;
const CJK_PARENS = `\\(([^()]*[${CJK}][^()]*)\\)`;
const ASCII_PUNCT_RE = new RegExp(`${CJK_LEFT}${MARK}|${MARK}\\s*${CJK_RIGHT}|${PARENS_AFTER}|${PARENS_BEFORE}|${CJK_PARENS}`, 'u');
const FULL_WIDTH = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？' };

/** Whether a language writes its prose with full-width punctuation (registry entry). */
export function fullWidthLang(lang) { return lang.script === 'Han' || lang.script === 'Japanese'; }

export function hasAsciiPunctuation(str) { return ASCII_PUNCT_RE.test(str); }

/** The same text with full-width punctuation; the space after a converted mark goes. */
export function fullWidthPunctuation(str) {
  return str
    .replace(new RegExp(PARENS_AFTER, 'gu'), '$1（$2）')
    .replace(new RegExp(PARENS_BEFORE, 'gu'), '（$1）')
    .replace(new RegExp(CJK_PARENS, 'gu'), '（$1）')
    .replace(new RegExp(`(${CJK_LEFT})(${MARK})\\s*`, 'gu'), (_, before, mark) => before + FULL_WIDTH[mark])
    .replace(new RegExp(`(${MARK})\\s*(?=${CJK_RIGHT})`, 'gu'), (_, mark) => FULL_WIDTH[mark]);
}

function checkPunctuation(file, id, str, lang, issues, what) {
  if (fullWidthLang(lang) && typeof str === 'string' && hasAsciiPunctuation(str)) {
    issues.push(err(file, id, `${what}: ASCII punctuation in ${lang.name} text; use full-width ，：；！？（）`));
  }
}

export function stripStress(s) { return s.normalize('NFD').replace(/́/g, '').normalize('NFC'); }

export function foldForCompare(s) {
  return stripStress(s).toLowerCase().normalize('NFC');
}

const RU_VOWELS = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/g;
// Russian: every polysyllabic word needs U+0301 or ё. Upper-case abbreviations are exempt.
export function russianStressProblems(str) {
  const out = [];
  // NFC keeps й/ё precomposed; Cyrillic vowel + U+0301 has no precomposed form, so the acute stays separate.
  for (const raw of str.normalize('NFC').split(/[\s\-,;/()«»"!?.:]+/)) {
    const word = raw.trim();
    if (!word) continue;
    if (/^[А-ЯЁ]{2,6}$/.test(word)) continue;
    const vowels = (word.match(RU_VOWELS) || []).length;
    const hasYo = /[ёЁ]/.test(word);
    const acutes = (word.match(/́/g) || []).length;
    if (vowels >= 2 && acutes === 0 && !hasYo) out.push(`${word}: missing stress mark`);
    if (acutes > 1) out.push(`${word}: more than one stress mark`);
  }
  return out;
}

export const PINYIN_WORD_RE = /^[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ'’\s·-]+$/;
export const PINYIN_SENT_RE = /^[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ'’\s·\-0-9,.?!;:"“”‘’()…—]+$/;
export const KANA_RE = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u;
export const HEPBURN_RE = /^[a-zA-Zāīūēō'’\s\-]+$/;
export const ASCII_ROM_RE = /^[a-zA-Z'’\s\-]+$/;
export const HAN_RE = /^\p{Script=Han}+$/u;
export const HAS_HAN = /\p{Script=Han}/u;
export const IPA_FORBIDDEN = /[\/\[\]0-9]/;
const ETYM_CHAIN = /^[a-z]{2,3}(?:-[a-z]{2,5})*:\S+(?:\s(?:→|\+)\s[a-z]{2,3}(?:-[a-z]{2,5})*:\S+)*$/;
const ETYM_CJK = /^\S+\s=\s\S+(?:\s\+\s\S+)+$/;
export function etymOk(s) { return ETYM_CHAIN.test(s) || ETYM_CJK.test(s); }

// Japanese furigana check, emulating the renderer: braces become tag boundaries ('>'),
// base text = run of non-space, non-'>' characters before '[' (Anki's rule).
export function furiganaProblems(t) {
  const out = [];
  const s = t.replace(/[{}]/g, '>');
  const re = / ?([^ >\[\]]+?)\[([^\]]*)\]/g;
  let m;
  let rest = s;
  while ((m = re.exec(s))) {
    const base = m[1];
    const reading = m[2];
    if (!/^[\p{Script=Han}々〆ヶ]+$/u.test(base)) out.push(`furigana base "${base}" must be kanji only — put a space before the kanji`);
    if (!KANA_RE.test(reading)) out.push(`furigana reading "${reading}" must be kana`);
  }
  rest = s.replace(re, '');
  if (/[\[\]]/.test(rest)) out.push('unbalanced furigana brackets');
  if (HAS_HAN.test(rest)) out.push('kanji without furigana');
  return out;
}

export function targetSpans(t) {
  return [...t.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
}

// ---------- Example targets ----------

// An example's {target} shows the entry's word: a form of `w`, never an `alt` (DATA_FORMAT §6). Inflection makes
// "a form of" fuzzy, so words compare by their common beginning, and only clear cases are flagged: a target closer
// to an alt than to the word, and a Chinese target without the word's characters (Chinese does not inflect).
const TARGET_PASS = 0.75; // a target at least this close to the word or one of its forms shows the word
const ALT_MIN = 0.5;      // a target at least this close to an alt (and closer than to the word) shows the alt
const ENUM_FORMS = ['aspect', 'class', 'type', 'aux'];

function foldTarget(s, lang, unspaced) {
  const plain = stripStress(s.replace(/ ?([^ [\]{}]+?)\[[^\]]*\]/g, '$1'))
    .toLocaleLowerCase(lang.locale)
    .replace(/[՛՜՝՞]/g, '') // Armenian emphasis and question marks sit inside the word
    .normalize('NFD'); // Hangul syllables → jamo, so 가다 and 갈 share a beginning
  return unspaced ? plain.replace(/\s+/g, '') : plain;
}

function words(s) {
  return s.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** 1 for the same word; else the share of the shorter word that both begin with, if that is at least half of it. */
function wordSimilarity(a, b) {
  if (a === b) return 1;
  const A = [...a];
  const B = [...b];
  let n = 0;
  while (n < A.length && n < B.length && A[n] === B[n]) n++;
  const shorter = Math.min(A.length, B.length);
  return n >= Math.max(2, Math.ceil(shorter / 2)) ? n / shorter : 0;
}

/** A word next to the braces completes a phrase only as that word, or with a short ending (식사를 for 식사). */
function completes(phraseWord, word) {
  return word.startsWith(phraseWord) && [...word.slice(phraseWord.length).normalize('NFC')].length <= 2;
}

function isSubsequence(part, whole) {
  let i = 0;
  for (const ch of whole) if (ch === part[i]) i++;
  return i === part.length;
}

/**
 * How closely a folded target shows a folded phrase: every word of the phrase, matched to its closest target word.
 * near: the words next to the braces, which may complete a phrase of several words.
 * reserved: target words that are the entry's own words; they show another phrase only as the same word, so
 * "Irish people" does not show the alt "Irishman".
 */
function phraseScore(target, phrase, { unspaced = false, near = [], reserved = new Set() } = {}) {
  if (!phrase) return 0;
  if (unspaced) {
    if (target.includes(phrase)) return 1;
    return isSubsequence([...phrase], target) ? TARGET_PASS : wordSimilarity(phrase, target); // 洗了衣服 shows 洗衣服
  }
  const tw = words(target);
  const all = words(phrase);
  const pw = all.some((w) => [...w].length > 1) ? all.filter((w) => [...w].length > 1) : all; // clitics (s', l') say little
  if (!pw.length) return 0;
  const best = (a) => Math.max(
    0,
    ...tw.map((b) => (reserved.has(b) && a !== b ? 0 : wordSimilarity(a, b))),
    ...(pw.length > 1 ? near : []).map((b) => (completes(a, b) ? 1 : 0)),
  );
  return pw.reduce((sum, a) => sum + best(a), 0) / pw.length;
}

/**
 * Does an example's target show the entry's word? `t` is the sentence with its {target}, `lang` the registry entry.
 * Returns null if it does (or if that is unclear), else { alt } when the target is closer to that alt than to the
 * word, or { missing: true } for a Chinese target without the word's characters.
 */
export function targetProblem(t, entry, lang) {
  const m = typeof t === 'string' && typeof entry?.w === 'string' ? /\{([^{}]*)\}/.exec(t) : null;
  if (!m) return null;
  const unspaced = lang.script === 'Han' || lang.script === 'Japanese';
  const target = foldTarget(m[1], lang, unspaced);
  // A phrase may reach past the braces: "the {Czech Republic}" shows "the Czech Republic".
  const near = unspaced ? [] : [words(foldTarget(t.slice(0, m.index), lang, false)).at(-1), words(foldTarget(t.slice(m.index + m[0].length), lang, false))[0]].filter(Boolean);
  // The word, its kana reading and the words of its forms (each alone: 'hat gegessen', 'шёл, шла').
  const forms = Object.entries(entry.forms || {}).filter(([k, v]) => !ENUM_FORMS.includes(k) && typeof v === 'string').map(([, v]) => v);
  const candidates = [entry.w, ...(lang.reading === 'kana' && entry.read ? [entry.read] : []), ...forms.flatMap((f) => f.split(unspaced ? /[,、]\s*/ : /[,\s]+/))]
    .map((c) => foldTarget(c, lang, unspaced));
  const wordScore = Math.max(...candidates.map((c) => phraseScore(target, c, { unspaced, near })));
  if (wordScore >= TARGET_PASS) return null;
  const reserved = new Set(candidates.flatMap(words));
  let alt = null;
  let altScore = 0;
  for (const a of Array.isArray(entry.alt) ? entry.alt : []) {
    const s = phraseScore(target, foldTarget(a, lang, unspaced), { unspaced, reserved });
    if (s > altScore) [alt, altScore] = [a, s];
  }
  if (alt && altScore >= ALT_MIN && altScore > wordScore) return { alt };
  return lang.script === 'Han' ? { missing: true } : null;
}

export function targetMessage(span, entry, problem) {
  return problem.alt
    ? `target {${span}} shows the alt "${problem.alt}", not the word "${entry.w}"`
    : `target {${span}} does not contain the word "${entry.w}"`;
}

/**
 * Every flagged example slot of one language: Map(id → [{ slot (from 1), span, problem, msg }]).
 * `entries` and `examples` map concept IDs to the entry and the example list.
 */
export function targetProblems(entries, examples, lang) {
  const out = new Map();
  for (const [id, list] of examples || []) {
    const entry = entries?.get(id);
    if (!entry?.w || !Array.isArray(list)) continue;
    list.forEach((ex, i) => {
      const spans = typeof ex?.t === 'string' ? targetSpans(ex.t) : [];
      if (spans.length !== 1) return;
      const problem = targetProblem(ex.t, entry, lang);
      if (!problem) return;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ slot: i + 1, span: spans[0], problem, msg: targetMessage(spans[0], entry, problem) });
    });
  }
  return out;
}

// ---------- Lint ----------

/**
 * Validate the whole dataset. Returns { issues, ctx } where ctx holds loaded data for reports.
 * opts: { dataDir, metaDir, checkCanonical=true }
 */
export function lint(opts) {
  const p = paths(opts.dataDir, opts.metaDir);
  const issues = [];
  const reg = loadRegistry(p.meta);
  lintRegistry(reg, issues, opts);
  const concepts = loadConcepts(p, reg, issues);
  lintConcepts(p, reg, concepts, issues, opts);
  const layers = lintLayers(p, reg, concepts, issues, opts);
  return { issues, ctx: { p, reg, concepts, layers } };
}

function lintRegistry(reg, issues, opts) {
  const L = reg.languages;
  const F = 'meta/languages.json';
  if (opts.checkCanonical !== false && stringifyLabels(reg.labels, labelOrder(reg)) !== reg.labelsText) {
    issues.push(err('meta/labels.json', null, 'not in canonical format (run lint with --fix)'));
  }
  for (const code of [...L.active, ...L.deferred]) {
    if (!L.languages[code]) issues.push(err(F, code, 'listed but not defined'));
  }
  for (const code of L.active) {
    const lang = L.languages[code];
    if (!lang) continue;
    if (lang.status !== 'active') issues.push(err(F, code, 'in active list but status is not "active"'));
    for (const k of ['name', 'native', 'locale', 'country', 'script', 'forms']) {
      if (lang[k] === undefined) issues.push(err(F, code, `missing "${k}"`));
    }
    if (!SCRIPT_RE[lang.script]) issues.push(err(F, code, `unknown script "${lang.script}"`));
  }
  const seen = new Set();
  for (const m of reg.modules) {
    if (seen.has(m.id)) issues.push(err('meta/modules.json', m.id, 'duplicate module id'));
    seen.add(m.id);
  }
  const en = reg.labels.labels.en || {};
  for (const k of reg.labels.keys) if (!(k in en)) issues.push(err('meta/labels.json', 'en', `missing label "${k}"`));
  const keySet = new Set(reg.labels.keys);
  for (const [code, map] of Object.entries(reg.labels.labels)) {
    if (!L.languages[code]) issues.push(err('meta/labels.json', code, 'labels for unknown language'));
    for (const k of Object.keys(map)) if (!keySet.has(k)) issues.push(err('meta/labels.json', code, `unknown label key "${k}"`));
    if (code !== 'en') {
      const missing = reg.labels.keys.filter((k) => !(k in map));
      if (missing.length) issues.push(warn('meta/labels.json', code, `${missing.length} labels missing (falls back to English)`));
    }
  }
  for (const code of L.active) {
    if (!reg.labels.labels[code]) issues.push(warn('meta/labels.json', code, 'no labels yet (unit labels:' + code + ')'));
  }
}

function lintConcepts(p, reg, concepts, issues, opts) {
  const langCodes = new Set([...reg.languages.active, ...reg.languages.deferred]);
  const groups = new Map();
  for (const [mod, parsed] of Object.entries(concepts.files)) {
    const file = `concepts/${mod}.json`;
    if (opts.checkCanonical !== false) {
      const order = Object.keys(parsed.data);
      if (canonicalStringify(parsed.data, order) !== parsed.text) issues.push(err(file, null, 'not in canonical format (run lint with --fix)'));
    }
  }
  for (const id of concepts.order) {
    const { c, module } = concepts.byId.get(id);
    const file = `concepts/${module}.json`;
    if (!ID_RE.test(id)) issues.push(err(file, id, 'ID must match (word|phrase)-[a-z0-9]+(-[a-z0-9]+)*'));
    if (id.length > ID_MAX) issues.push(err(file, id, `ID longer than ${ID_MAX} chars`));
    if (reg.retired[id]) issues.push(err(file, id, 'ID is retired and must not be reused'));
    if (!c || typeof c !== 'object' || Array.isArray(c)) { issues.push(err(file, id, 'concept must be an object')); continue; }
    for (const k of Object.keys(c)) if (!CONCEPT_KEYS.includes(k)) issues.push(err(file, id, `unknown key "${k}"`));
    if (!POS.includes(c.pos)) issues.push(err(file, id, `pos must be one of ${POS.join('|')}`));
    if (id.startsWith('phrase-') !== (c.pos === 'phrase')) issues.push(err(file, id, 'phrase- IDs must have pos "phrase" and vice versa'));
    if (!Array.isArray(c.mods) || c.mods.length === 0) {
      issues.push(err(file, id, 'mods must be a non-empty array'));
    } else {
      if (c.mods[0] !== module) issues.push(err(file, id, `mods[0] must be the file's module "${module}"`));
      if (new Set(c.mods).size !== c.mods.length) issues.push(err(file, id, 'duplicate module in mods'));
      for (const m of c.mods) if (!reg.moduleById.has(m)) issues.push(err(file, id, `unknown module "${m}"`));
      const cores = c.mods.filter((m) => reg.moduleById.get(m)?.core);
      if (cores.length > 1) issues.push(err(file, id, `in more than one core band: ${cores.join(', ')}`));
    }
    if (c.grp !== undefined) {
      if (typeof c.grp !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.grp)) issues.push(err(file, id, 'grp must be kebab-case'));
      else {
        if (!groups.has(c.grp)) groups.set(c.grp, []);
        groups.get(c.grp).push(id);
      }
    }
    if (c.emoji !== undefined && (typeof c.emoji !== 'string' || !c.emoji || /[A-Za-z0-9]/.test(c.emoji) || [...c.emoji].length > 8)) issues.push(err(file, id, 'emoji must be a short emoji string'));
    for (const k of ['ant', 'rel']) {
      if (c[k] === undefined) continue;
      if (!Array.isArray(c[k]) || c[k].length === 0) { issues.push(err(file, id, `${k} must be a non-empty array (or omitted)`)); continue; }
      for (const ref of c[k]) {
        if (ref === id) issues.push(err(file, id, `${k} references itself`));
        else if (!concepts.byId.has(ref)) issues.push(err(file, id, `${k} references unknown concept "${ref}"`));
      }
      if (new Set(c[k]).size !== c[k].length) issues.push(err(file, id, `duplicate in ${k}`));
    }
    if (c.ant) for (const ref of c.ant) {
      const other = concepts.byId.get(ref);
      if (other && !(other.c.ant || []).includes(id)) issues.push(warn(file, id, `antonym "${ref}" does not list this concept back`));
    }
    if (typeof c.note !== 'string' || !c.note.trim()) issues.push(err(file, id, 'note (English sense note for authors) is required'));
    else if (c.note.length > 200) issues.push(warn(file, id, 'note longer than 200 chars'));
    if (c.reg !== undefined && !REGISTERS.includes(c.reg)) issues.push(err(file, id, `reg must be one of ${REGISTERS.join('|')}`));
    if (c.only !== undefined) {
      if (!Array.isArray(c.only) || c.only.length === 0) issues.push(err(file, id, 'only must be a non-empty array of language codes'));
      else for (const code of c.only) if (!langCodes.has(code)) issues.push(err(file, id, `only: unknown language "${code}"`));
    }
  }
  // groups never split across core bands
  for (const [g, ids] of groups) {
    const bands = new Set(ids.map((id) => concepts.byId.get(id).c.mods?.find((m) => reg.moduleById.get(m)?.core) || 'none'));
    if (bands.size > 1) {
      for (const id of ids) issues.push(err(`concepts/${concepts.byId.get(id).module}.json`, id, `group "${g}" is split across bands: ${[...bands].join(', ')}`));
    }
  }
}

function lintLayers(p, reg, concepts, issues, opts) {
  const L = reg.languages;
  // layers[layer][code] = Map(id -> value)
  const layers = { lang: {}, ex: {}, ipa: {}, etym: {} };
  for (const layer of LAYERS) {
    const layerDir = path.join(p.data, layer);
    for (const code of listDirs(layerDir)) {
      const lang = L.languages[code];
      if (!lang) { issues.push(err(`${layer}/${code}`, null, 'unknown language directory')); continue; }
      layers[layer][code] = new Map();
      for (const f of listJson(path.join(layerDir, code))) {
        const mod = f.slice(0, -5);
        const rel = `${layer}/${code}/${f}`;
        if (!reg.moduleById.has(mod)) { issues.push(err(rel, null, 'file does not match any module')); continue; }
        let parsed;
        try { parsed = readJson(path.join(layerDir, code, f)); } catch (e) { issues.push(err(rel, null, e.message)); continue; }
        if (opts.checkCanonical !== false && canonicalStringify(parsed.data, concepts.order) !== parsed.text) {
          issues.push(err(rel, null, 'not in canonical format/order (run lint with --fix)'));
        }
        for (const [id, v] of Object.entries(parsed.data)) {
          const ce = concepts.byId.get(id);
          if (!ce) { issues.push(err(rel, id, 'unknown concept ID')); continue; }
          if (ce.module !== mod) { issues.push(err(rel, id, `entry belongs in ${layer}/${code}/${ce.module}.json (the concept's primary module)`)); continue; }
          layers[layer][code].set(id, { v, file: rel });
        }
      }
    }
  }
  for (const [code, map] of Object.entries(layers.lang)) lintLangEntries(code, map, reg, concepts, issues);
  for (const [code, map] of Object.entries(layers.ex)) lintExamples(code, map, reg, concepts, layers, issues);
  for (const [code, map] of Object.entries(layers.ipa)) {
    const lang = L.languages[code];
    for (const [id, { v, file }] of map) {
      if (!lang.ipa) issues.push(err(file, id, `${code} has no IPA layer`));
      if (typeof v !== 'string' || !v.trim()) issues.push(err(file, id, 'IPA must be a non-empty string'));
      else if (IPA_FORBIDDEN.test(v)) issues.push(err(file, id, 'IPA must not contain slashes, brackets or digits'));
      if (!layers.lang[code]?.get(id)?.v?.w) issues.push(err(file, id, 'IPA for an entry without a word'));
    }
  }
  for (const [code, map] of Object.entries(layers.etym)) {
    for (const [id, { v, file }] of map) {
      if (typeof v !== 'string' || !v.trim()) issues.push(err(file, id, 'etymology must be a non-empty string'));
      else if (v.length > 140) issues.push(err(file, id, 'etymology longer than 140 chars'));
      else if (!etymOk(v)) issues.push(warn(file, id, 'etymology does not follow the schematic syntax (lang:form → lang:form, or 字 = 部 + 件)'));
    }
  }
  return layers;
}

function lintLangEntries(code, map, reg, concepts, issues) {
  const lang = reg.languages.languages[code];
  const byWord = new Map();
  for (const [id, { v: e, file }] of map) {
    const { c } = concepts.byId.get(id);
    if (!e || typeof e !== 'object' || Array.isArray(e)) { issues.push(err(file, id, 'entry must be an object')); continue; }
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) issues.push(err(file, id, `unknown key "${k}"`));
    const owned = !c.only || c.only.includes(code);
    if (!owned) {
      if (e.w !== undefined) issues.push(err(file, id, `concept is only for ${c.only.join(',')}; give a descriptive "gl", not "w"`));
      if (typeof e.gl !== 'string' || !e.gl.trim()) issues.push(err(file, id, 'gl (descriptive gloss) required'));
      checkPunctuation(file, id, e.gl, lang, issues, 'gl');
      for (const k of Object.keys(e)) if (!['gl', 'st'].includes(k)) issues.push(err(file, id, `only "gl" is allowed for a gloss entry (found "${k}")`));
      continue;
    }
    if (e.gl !== undefined) issues.push(err(file, id, '"gl" is only for concepts not owned by this language'));
    if (typeof e.w !== 'string' || !e.w.trim()) { issues.push(err(file, id, 'w (the word) is required')); continue; }
    if (e.w !== e.w.trim() || /\s{2,}/.test(e.w)) issues.push(err(file, id, 'w has stray whitespace'));
    if (e.w !== e.w.normalize('NFC') && !lang.stress) issues.push(err(file, id, 'w must be NFC-normalized'));
    checkScript(file, id, e.w, lang, issues, 'w');
    for (const k of ['w', 'hint', 'def']) checkPunctuation(file, id, e[k], lang, issues, k);
    if (lang.stress) for (const pr of russianStressProblems(e.w)) issues.push(err(file, id, `w: ${pr}`));
    if (e.alt !== undefined) {
      if (!Array.isArray(e.alt) || e.alt.length === 0 || e.alt.some((a) => typeof a !== 'string' || !a.trim())) issues.push(err(file, id, 'alt must be a non-empty array of strings'));
      else {
        if (new Set(e.alt).size !== e.alt.length || e.alt.includes(e.w)) issues.push(err(file, id, 'alt has duplicates or repeats w'));
        for (const a of e.alt) {
          checkScript(file, id, a, lang, issues, 'alt');
          checkPunctuation(file, id, a, lang, issues, 'alt');
          if (lang.stress) for (const pr of russianStressProblems(a)) issues.push(err(file, id, `alt: ${pr}`));
        }
      }
    }
    // gender / article
    if (lang.gender) {
      if (e.g !== undefined && !lang.gender.values.includes(e.g)) issues.push(err(file, id, `g must be one of ${lang.gender.values.join('|')}`));
      if (c.pos === 'noun' && e.g === undefined) issues.push(err(file, id, 'g (gender) required for nouns'));
      if (c.pos !== 'noun' && e.g !== undefined && c.pos !== 'pron' && c.pos !== 'num') issues.push(warn(file, id, 'g given for a non-noun'));
      if (e.art !== undefined && lang.gender.mode !== 'article') issues.push(err(file, id, 'art is only for article languages'));
      if (lang.gender.elision && c.pos === 'noun' && e.art === undefined && /^[aeiouyhàâæéèêëîïôœùûü]/i.test(e.w)) {
        issues.push(err(file, id, 'French noun starting with a vowel or h: set art ("l\'" or, for h aspiré, "le"/"la")'));
      }
    } else {
      if (e.g !== undefined) issues.push(err(file, id, `${code} has no grammatical gender`));
      if (e.art !== undefined) issues.push(err(file, id, `${code} has no articles`));
    }
    // forms
    const fdef = lang.forms?.[c.pos];
    if (e.forms !== undefined) {
      if (!e.forms || typeof e.forms !== 'object' || Array.isArray(e.forms)) issues.push(err(file, id, 'forms must be an object'));
      else if (!fdef) issues.push(err(file, id, `${code} defines no forms for pos "${c.pos}"`));
      else {
        for (const [k, val] of Object.entries(e.forms)) {
          if (!fdef.keys.includes(k)) issues.push(err(file, id, `form key "${k}" not allowed for ${code} ${c.pos} (allowed: ${fdef.keys.join(', ')})`));
          if (typeof val !== 'string' || !val.trim()) issues.push(err(file, id, `form "${k}" must be a non-empty string`));
          else {
            if (k === 'aspect' && !['ipf', 'pf', 'bi'].includes(val)) issues.push(err(file, id, 'aspect must be ipf|pf|bi'));
            else if (k === 'class' && !['godan', 'ichidan', 'suru', 'kuru'].includes(val)) issues.push(err(file, id, 'class must be godan|ichidan|suru|kuru'));
            else if (k === 'type' && !['i', 'na'].includes(val)) issues.push(err(file, id, 'type must be i|na'));
            else if (k === 'aux' && !['avoir', 'être'].includes(val)) issues.push(err(file, id, 'aux must be avoir|être'));
            else if (!['aspect', 'class', 'type', 'aux'].includes(k)) {
              checkScript(file, id, val, lang, issues, `forms.${k}`);
              if (lang.stress) for (const pr of russianStressProblems(val)) issues.push(err(file, id, `forms.${k}: ${pr}`));
            }
          }
        }
      }
    }
    if (fdef && fdef.required.length) {
      const missing = fdef.required.filter((k) => !e.forms || !(k in e.forms));
      if (missing.length) issues.push(err(file, id, `missing required forms: ${missing.join(', ')}`));
    }
    if (e.forms?.class && (e.forms.type)) issues.push(err(file, id, 'class and type are mutually exclusive'));
    // hint
    if (e.hint !== undefined && (typeof e.hint !== 'string' || !e.hint.trim() || e.hint.length > 40 || /[()]/.test(e.hint))) issues.push(err(file, id, 'hint must be a short string without parentheses (≤ 40 chars)'));
    // reading / romanization
    if (lang.reading === 'kana') {
      if (HAS_HAN.test(e.w) && !e.read) issues.push(err(file, id, 'read (kana reading) required when w contains kanji'));
      if (e.read !== undefined && !KANA_RE.test(e.read)) issues.push(err(file, id, 'read must be kana only'));
    } else if (lang.reading === 'pinyin') {
      if (!e.read) issues.push(err(file, id, 'read (pinyin with tone marks) required'));
      else if (!PINYIN_WORD_RE.test(e.read)) issues.push(err(file, id, 'read must be pinyin with tone marks'));
    } else if (e.read !== undefined) issues.push(err(file, id, `${code} has no stored reading`));
    if (lang.romanization?.source === 'stored') {
      if (!e.rom) issues.push(err(file, id, 'rom (romanization) required'));
      else if (!(lang.romanization.scheme === 'hepburn-macron' ? HEPBURN_RE : ASCII_ROM_RE).test(e.rom)) issues.push(err(file, id, `rom has characters outside ${lang.romanization.scheme}`));
    } else if (e.rom !== undefined) issues.push(err(file, id, `${code} romanization is derived at runtime; remove rom`));
    if (e.mw !== undefined) {
      if (!lang.measureWord) issues.push(err(file, id, `${code} has no measure words/counters`));
      else if (!HAN_RE.test(e.mw.replace(/[\s、,／/]/g, '')) && !KANA_RE.test(e.mw)) issues.push(err(file, id, 'mw must be CJK characters'));
      if (c.pos !== 'noun') issues.push(warn(file, id, 'mw on a non-noun'));
    } else if (lang.measureWord === 'measure-word' && c.pos === 'noun') issues.push(warn(file, id, 'noun without measure word (fine for uncountables)'));
    if (e.hanja !== undefined) {
      if (!lang.hanja) issues.push(err(file, id, `${code} has no hanja`));
      else if (!HAN_RE.test(e.hanja)) issues.push(err(file, id, 'hanja must be Han characters only'));
    }
    // definition
    if (typeof e.def !== 'string' || !e.def.trim()) issues.push(err(file, id, 'def (same-language definition) required'));
    else {
      if (e.def.length > 220) issues.push(err(file, id, 'def longer than 220 chars'));
      const fw = foldForCompare(e.w);
      if ([...fw].length >= 3 && foldForCompare(e.def).includes(fw)) issues.push(warn(file, id, 'def contains the headword'));
    }
    if (e.st !== undefined && e.st !== 'r') issues.push(err(file, id, 'st may only be "r" (reviewed); omit for draft'));
    const key = e.w.normalize('NFC');
    if (!byWord.has(key)) byWord.set(key, []);
    byWord.get(key).push({ id, e, file });
  }
  // known-side collisions need distinct hints
  for (const [w, list] of byWord) {
    if (list.length < 2) continue;
    const hints = list.map((x) => x.e.hint);
    const distinct = new Set(hints.filter(Boolean));
    for (const x of list) {
      if (!x.e.hint) issues.push(err(x.file, x.id, `"${w}" is also used by ${list.filter((y) => y !== x).map((y) => y.id).join(', ')}: add a hint`));
    }
    if (hints.every(Boolean) && distinct.size !== hints.length) {
      for (const x of list) issues.push(err(x.file, x.id, `"${w}": hints must differ between colliding entries`));
    }
  }
}

function checkScript(file, id, str, lang, issues, what) {
  const { expected, foreign } = scriptStats(str, lang.script);
  if (expected === 0 && foreign.length) { issues.push(err(file, id, `${what}: no ${lang.script} letters`)); return; }
  if (!foreign.length) return;
  if (lang.script === 'Cyrillic' && lang.otherScript) issues.push(err(file, id, `${what}: Serbian data must be Cyrillic only (found ${foreign.join('')})`));
  else if (lang.script === 'Greek' && /[ἀ-῿]/.test(str)) issues.push(err(file, id, `${what}: polytonic characters; use monotonic`));
  else issues.push(warn(file, id, `${what}: letters outside ${lang.script}: ${foreign.join('')}`));
}

function lintExamples(code, map, reg, concepts, layers, issues) {
  const lang = reg.languages.languages[code];
  const enEx = layers.ex.en;
  for (const [id, { v, file }] of map) {
    const entry = layers.lang[code]?.get(id)?.v;
    if (!entry || !entry.w) issues.push(err(file, id, 'examples for a concept without a word entry in this language'));
    if (!Array.isArray(v) || v.length === 0 || v.length > 3) { issues.push(err(file, id, 'examples must be an array of 1–3 objects')); continue; }
    v.forEach((ex, i) => {
      const where = `slot ${i + 1}`;
      if (!ex || typeof ex !== 'object') { issues.push(err(file, id, `${where}: must be an object`)); return; }
      for (const k of Object.keys(ex)) if (!EXAMPLE_KEYS.includes(k)) issues.push(err(file, id, `${where}: unknown key "${k}"`));
      if (typeof ex.t !== 'string' || !ex.t.trim()) { issues.push(err(file, id, `${where}: t (sentence) required`)); return; }
      if (ex.t.length > 180) issues.push(err(file, id, `${where}: sentence longer than 180 chars`));
      checkPunctuation(file, id, ex.t, lang, issues, where);
      const spans = targetSpans(ex.t);
      if (spans.length !== 1 || !spans[0].trim()) issues.push(err(file, id, `${where}: mark the target word with exactly one {…}`));
      if ((ex.t.match(/[{}]/g) || []).length !== 2) issues.push(err(file, id, `${where}: unbalanced braces`));
      // A warning until the examples written before this check are fixed (exfix units, GENERATION.md); then an error.
      const problem = spans.length === 1 ? targetProblem(ex.t, entry, lang) : null;
      if (problem) issues.push({ ...warn(file, id, `${where}: ${targetMessage(spans[0], entry, problem)}`), target: true });
      if (ex.p !== undefined) {
        if (code === 'en') issues.push(err(file, id, `${where}: English examples are the source; no "p"`));
        else if (ex.p !== 0) issues.push(err(file, id, `${where}: p may only be 0 (non-parallel); omit when parallel`));
      } else if (code !== 'en') {
        const src = enEx?.get(id)?.v;
        if (!Array.isArray(src) || !src[i]) issues.push(err(file, id, `${where}: marked parallel but English has no slot ${i + 1}`));
      }
      if (lang.exampleReading === 'pinyin') {
        if (typeof ex.r !== 'string' || !ex.r.trim()) issues.push(err(file, id, `${where}: r (pinyin of the sentence) required`));
        else if (!PINYIN_SENT_RE.test(ex.r)) issues.push(err(file, id, `${where}: r must be pinyin with tone marks`));
      } else if (ex.r !== undefined) issues.push(err(file, id, `${where}: r is only for Chinese`));
      if (lang.exampleReading === 'furigana') for (const pr of furiganaProblems(ex.t)) issues.push((pr.startsWith('kanji without') ? warn : err)(file, id, `${where}: ${pr}`));
      if (lang.stress && spans[0]) for (const pr of russianStressProblems(spans[0])) issues.push(warn(file, id, `${where}: target ${pr}`));
      const plain = ex.t.replace(/\[[^\]]*\]/g, '');
      const { expected, foreign } = scriptStats(plain, lang.script);
      if (expected === 0) issues.push(err(file, id, `${where}: sentence has no ${lang.script} letters`));
      else if (foreign.length && lang.script === 'Cyrillic' && lang.otherScript) issues.push(err(file, id, `${where}: Serbian examples must be Cyrillic only`));
    });
  }
}

// ---------- Coverage ----------

export function coverage(ctx) {
  const { reg, concepts, layers } = ctx;
  const rows = [];
  for (const code of reg.languages.active) {
    const row = { code, total: 0, entries: 0, defs: 0, ex3: 0, ex1: 0, ipa: 0, etym: 0 };
    for (const id of concepts.order) {
      const { c } = concepts.byId.get(id);
      row.total++;
      const e = layers.lang[code]?.get(id)?.v;
      if (!e) continue;
      row.entries++;
      if (e.def || e.gl) row.defs++;
      const owned = !c.only || c.only.includes(code);
      if (!owned) { row.ex3++; row.ex1++; row.ipa++; row.etym++; continue; }
      const ex = layers.ex[code]?.get(id)?.v;
      if (ex?.length >= 1) row.ex1++;
      if (ex?.length >= 3) row.ex3++;
      if (layers.ipa[code]?.get(id)) row.ipa++;
      if (layers.etym[code]?.get(id)) row.etym++;
    }
    rows.push(row);
  }
  return rows;
}

export function moduleSizes(ctx) {
  const { reg, concepts } = ctx;
  const count = new Map(reg.modules.map((m) => [m.id, 0]));
  for (const id of concepts.order) for (const m of concepts.byId.get(id).c.mods || []) count.set(m, (count.get(m) || 0) + 1);
  return reg.modules.map((m) => ({ id: m.id, target: m.size, actual: count.get(m.id) || 0 }));
}
