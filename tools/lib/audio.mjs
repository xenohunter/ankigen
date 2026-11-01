// Pronunciation audio (docs/GENERATION.md §7): which Google Cloud Text-to-Speech voice speaks a language, what it
// says for each word entry, which clips are current, and the packs the site serves them in. Used by tools/audio.mjs
// (generation), tools/bundle.mjs (the site) and tools/lint-data.mjs. The page reads the packs' index
// (src/data/loader.js).
//
//   data/meta/audio.json              per language { locale, voice, tier, format, text } or { locale, unsupported }
//   data/audio/<code>/manifest.json   { "<concept ID>": { file, text, voice, bytes } }, one entry per line
//   data/audio/<code>/<hash>.mp3      hash: the first 16 hex digits of the SHA-256 of the clip's bytes, so a name
//                                     never stands for two different recordings (Anki matches media by name)
//
// Text rules (audio.json "text"), set from the registry when the voice is resolved and editable by hand:
//   article     say the article the card shows with default settings (das Wasser, l'eau); a noun of either
//               gender gets both articles (el estudiante, la estudiante)
//   stress      keep the stress marks (Russian; stripped when false)
//   homographs  for a word another entry spells the same way with another reading: "reading" says the reading
//               (Japanese kana), "pinyin" wraps the word in an SSML pinyin phoneme (Chinese)

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalStringify, exists, readJson } from './data.mjs';
import { stripStress } from '../../src/text/normalize.js';

/** Voice tiers, best first. Google's Standard voices are never used. */
export const TIERS = ['chirp3-hd', 'neural2', 'wavenet'];
/** Preferred in every locale that has it, so the languages sound alike (a female Chirp 3 HD voice). */
export const VOICE_NAME = 'Kore';
export const FORMAT = 'mp3';
/** Requests per minute: 90% of Google's per-project quota for the tier (Chirp 3 HD 200, others 1,000). */
export const REQUESTS_PER_MINUTE = { 'chirp3-hd': 180, neural2: 900, wavenet: 900 };
/** Characters one run may send (tools/audio.mjs --max-chars). */
export const MAX_CHARS = 900_000;
export const AUDIO_META = 'audio.json';
const RULES = { article: [true, false], stress: [true, false], homographs: ['reading', 'pinyin'] };

const COMMENT =
  'Pronunciation audio per language (tools/audio.mjs, docs/GENERATION.md §7): the Google Cloud Text-to-Speech locale, ' +
  'voice and tier, the clip format, and the text rules (article: say the article; stress: keep Russian stress marks; ' +
  'homographs: "reading" says the kana reading, "pinyin" uses an SSML pinyin phoneme). {"unsupported": true}: Google ' +
  'has no voice of a usable tier for the locale; every run checks again. Edit a voice by hand if you like: the next ' +
  'run regenerates the clips it changes.';

// ---------------------------------------------------------------- voices

/** The tier of a Google voice name such as de-DE-Chirp3-HD-Kore, or null for tiers we don't use. @param {string} name */
export function voiceTier(name) {
  if (name.includes('-Chirp3-HD-')) return 'chirp3-hd';
  if (name.includes('-Neural2-')) return 'neural2';
  if (name.includes('-Wavenet-')) return 'wavenet';
  return null;
}

/**
 * The voice for a locale from Google's voice list (v1/voices), by exact locale only: never a sibling variant such
 * as pt-BR for pt-PT. The best tier wins; within it the preferred voice, else the first female one, else the first.
 * @param {{ name: string, languageCodes?: string[], ssmlGender?: string }[]} voices
 * @param {string} locale
 * @returns {{ voice: string, tier: string } | null}
 */
export function pickVoice(voices, locale) {
  const exact = voices.filter((v) => v.languageCodes?.includes(locale) && v.name.startsWith(`${locale}-`));
  for (const tier of TIERS) {
    const own = exact.filter((v) => voiceTier(v.name) === tier).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const pick = own.find((v) => v.name.endsWith(`-${VOICE_NAME}`)) ?? own.find((v) => v.ssmlGender === 'FEMALE') ?? own[0];
    if (pick) return { voice: pick.name, tier };
  }
  return null;
}

/**
 * Why a language's voice must be resolved now, or null when audio.json already settles it: no entry yet, marked
 * unsupported (checked again on every run), or resolved for another locale than languages.json now names.
 * @param {any} setting its audio.json entry @param {string | undefined} locale its "tts" locale
 * @returns {'new' | 'unsupported' | 'locale' | null}
 */
export function resolveReason(setting, locale) {
  if (!locale) return null;
  if (!setting) return 'new';
  if (setting.locale !== locale) return 'locale';
  return setting.unsupported ? 'unsupported' : null;
}

/**
 * The text rules a language starts with (written to audio.json, where they can be changed).
 * @param {any} lang its languages.json entry @param {any} fields fields.json @param {string} code
 */
export function defaultRules(lang, fields, code) {
  const row = fields.fields.find((/** @type {any} */ f) => f.id === 'gender');
  const shown = row && (row.langs === '*' || row.langs.includes(code));
  const article = lang.gender?.mode === 'article' && shown && (row.defaultByLang?.[code] ?? row.default) === 'word';
  const homographs = { kana: 'reading', pinyin: 'pinyin' }[/** @type {string} */ (lang.reading)];
  return { ...(article ? { article: true } : {}), ...(lang.stress ? { stress: false } : {}), ...(homographs ? { homographs } : {}) };
}

/** What is wrong with an audio.json entry (hand edits). @param {any} s @returns {string[]} */
export function settingProblems(s) {
  if (!s || typeof s !== 'object') return ['not an object'];
  const problems = [];
  if (typeof s.locale !== 'string' || !/^[a-z]{2,3}-[A-Z]{2}$/.test(s.locale)) problems.push('locale must look like de-DE or cmn-CN');
  if (s.unsupported) return s.unsupported === true ? problems : [...problems, 'unsupported must be true'];
  if (typeof s.voice !== 'string' || !s.voice.startsWith(`${s.locale}-`)) problems.push(`voice must be a Google voice of ${s.locale}`);
  if (!TIERS.includes(s.tier)) problems.push(`tier must be one of ${TIERS.join(', ')}`);
  if (s.format !== FORMAT) problems.push(`format must be "${FORMAT}"`);
  for (const [key, value] of Object.entries(s.text ?? {})) {
    const allowed = /** @type {Record<string, any[]>} */ (RULES)[key];
    if (!allowed) problems.push(`unknown text rule "${key}"`);
    else if (!allowed.includes(value)) problems.push(`text rule ${key} must be ${allowed.map((v) => JSON.stringify(v)).join(' or ')}`);
  }
  return problems;
}

// ---------------------------------------------------------------- audio.json

/** data/meta/audio.json, or an empty one before the first run. @param {string} metaDir */
export function readAudioMeta(metaDir) {
  const file = path.join(metaDir, AUDIO_META);
  return exists(file) ? readJson(file).data : { $comment: COMMENT, languages: {} };
}

/** audio.json in canonical form: one language per line, in registry order. @param {any} audio @param {string[]} order */
export function stringifyAudioMeta(audio, order) {
  const rank = new Map(order.map((code, i) => [code, i]));
  const codes = Object.keys(audio.languages).sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || (a < b ? -1 : 1));
  const lines = codes.map((code) => `    ${JSON.stringify(code)}: ${JSON.stringify(audio.languages[code])}`);
  const body = lines.length ? `\n${lines.join(',\n')}\n  ` : '';
  return `{\n  "$comment": ${JSON.stringify(audio.$comment ?? COMMENT)},\n  "languages": {${body}}\n}\n`;
}

/** @param {string} metaDir @param {any} audio @param {string[]} order */
export function writeAudioMeta(metaDir, audio, order) {
  writeAtomic(path.join(metaDir, AUDIO_META), stringifyAudioMeta(audio, order));
}

/** @param {string} file @param {string | Uint8Array} content */
export function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, content);
  fs.renameSync(`${file}.tmp`, file);
}

// ---------------------------------------------------------------- what is said

/**
 * A language's word entries (not glosses) from data/lang, in canonical concept order.
 * @param {string} dataDir @param {{ modules: { id: string }[] }} reg @param {string[]} order @param {string} code
 * @returns {Map<string, any>}
 */
export function wordEntries(dataDir, reg, order, code) {
  /** @type {Map<string, any>} */
  const all = new Map();
  for (const m of reg.modules) {
    const file = path.join(dataDir, 'lang', code, `${m.id}.json`);
    if (exists(file)) for (const [id, e] of Object.entries(readJson(file).data)) if (e?.w) all.set(id, e);
  }
  return new Map(order.filter((id) => all.has(id)).map((id) => [id, all.get(id)]));
}

/**
 * What the voice is sent for each word entry: plain text, or SSML (it starts with <speak>).
 * @param {Map<string, any>} entries @param {any} lang languages.json entry @param {Record<string, any>} [rules]
 * @returns {Map<string, string>} concept → input, in the entries' order
 */
export function speechInputs(entries, lang, rules = {}) {
  /** @type {Map<string, Set<string>>} word → its readings */
  const readings = new Map();
  for (const e of entries.values()) readings.set(e.w, (readings.get(e.w) ?? new Set()).add(e.read ?? ''));
  /** @type {Map<string, string>} */
  const inputs = new Map();
  for (const [id, e] of entries) inputs.set(id, speak(e, lang, rules, /** @type {Set<string>} */ (readings.get(e.w)).size > 1));
  return inputs;
}

/** @param {any} e @param {any} lang @param {Record<string, any>} rules @param {boolean} homograph */
function speak(e, lang, rules, homograph) {
  if (homograph && e.read && rules.homographs === 'reading') return spoken(e.read);
  if (homograph && e.read && rules.homographs === 'pinyin') {
    const ph = numberedPinyin(e.read, e.w);
    if (ph) return `<speak><phoneme alphabet="pinyin" ph="${ph}">${escapeXml(e.w)}</phoneme></speak>`;
  }
  const w = lang.stress && !rules.stress ? stripStress(e.w) : e.w;
  const art = rules.article && e.g ? (e.art ?? lang.gender?.articles?.[e.g]) : null;
  if (!art) return spoken(w);
  return spoken(art.split('/').map((/** @type {string} */ a) => (/['’]$/.test(a) ? a + w : `${a} ${w}`)).join(', '));
}

/** Alternatives become a list (Pan/Pani → Pan, Pani); a suffix or prefix loses its hyphen (-den → den). @param {string} text */
function spoken(text) {
  return text
    .replace(/\s*\/\s*/g, ', ')
    .replace(/(^|[\s,])-(?=\p{L})/gu, '$1')
    .replace(/(?<=\p{L})-(?=$|[\s,])/gu, '')
    .trim();
}

/** @param {string} text */
const escapeXml = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const TONE_MARKS = /** @type {Record<string, number>} */ ({ '\u0304': 1, '\u0301': 2, '\u030C': 3, '\u0300': 4 });
/** A Mandarin syllable: an optional initial and a final (permissive), or the erhua r. */
const SYLLABLE =
  /^(?:(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ueng|iao|ian|ing|uai|uan|üan|ang|eng|ong|ai|ei|ao|ou|an|en|er|ia|ie|iu|in|ua|uo|ui|un|ue|üe|ün|a|o|e|i|u|ü)|r)$/;

/**
 * Pinyin with tone marks the way Google's SSML pinyin phoneme takes it: tone numbers, syllables apart, 5 for the
 * neutral tone (cháoyáng → "chao2 yang2"). One syllable per character of the word; null when the reading does not
 * split that way (the word is then sent as it is).
 * @param {string} read @param {string} w
 */
export function numberedPinyin(read, w) {
  const count = [...w].length;
  if (![...w].every((c) => /\p{Script=Han}/u.test(c))) return null;
  let letters = '';
  /** @type {number[]} */
  const tones = [];
  /** @type {number[]} */
  const breaks = [];
  for (const c of read.normalize('NFD').toLowerCase()) {
    if (TONE_MARKS[c]) tones[letters.length - 1] = TONE_MARKS[c];
    else if (c === '\u0308' && letters.endsWith('u')) letters = `${letters.slice(0, -1)}ü`;
    else if (/[a-z]/.test(c)) letters += c === 'v' ? 'ü' : c;
    else if (/['’\s-]/.test(c)) breaks.push(letters.length);
    else return null;
  }
  /** @type {Map<string, string[] | null>} */
  const memo = new Map();
  /** @param {number} i @param {number} left @returns {string[] | null} */
  const split = (i, left) => {
    if (i === letters.length) return left === 0 ? [] : null;
    if (left === 0) return null;
    const key = `${i}:${left}`;
    if (memo.has(key)) return /** @type {string[] | null} */ (memo.get(key));
    let found = null;
    for (let end = Math.min(letters.length, i + 6); end > i && !found; end--) {
      const syllable = letters.slice(i, end);
      const marks = tones.slice(i, end).filter(Boolean);
      if (!SYLLABLE.test(syllable) || marks.length > 1 || breaks.some((b) => b > i && b < end)) continue;
      const rest = split(end, left - 1);
      if (rest) found = [`${syllable}${marks[0] ?? 5}`, ...rest];
    }
    memo.set(key, found);
    return found;
  };
  return split(0, count)?.join(' ') ?? null;
}

/** Characters as Google bills them (SSML included). @param {string} input */
export const billedChars = (input) => [...input].length;

/**
 * The global gain of each frame of an MP3 clip that holds audio data, read from the frames' side information
 * (MPEG-1/2 Layer III; no decoding). The global gain is the frame's quantizer step, high for loud sound.
 * @param {Uint8Array} bytes
 * @returns {number[]}
 */
export function frameGains(bytes) {
  let i = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) i = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  /** @type {number[]} */
  const gains = [];
  while (i + 4 <= bytes.length) {
    const h = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const version = (h >>> 19) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const rate = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]][version]?.[(h >>> 10) & 3];
    const kbps = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[(h >>> 12) & 15];
    if (h >>> 21 !== 0x7ff || ((h >>> 17) & 3) !== 1 || !rate || !kbps) {
      i++;
      continue;
    }
    const mono = ((h >>> 6) & 3) === 3;
    const mpeg1 = version === 3;
    let bit = (i + 4 + ((h >>> 16) & 1 ? 0 : 2)) * 8; // side information, after the CRC if there is one
    /** @param {number} n */
    const read = (n) => {
      let v = 0;
      for (let k = 0; k < n; k++, bit++) v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
      return v;
    };
    read(mpeg1 ? 9 : 8); // main_data_begin
    read(mpeg1 ? (mono ? 5 : 3) : mono ? 1 : 2); // private bits
    if (mpeg1) read(mono ? 4 : 8); // scfsi
    let gain = 0;
    let data = 0;
    for (let g = 0; g < (mpeg1 ? 2 : 1); g++) {
      for (let ch = 0; ch < (mono ? 1 : 2); ch++) {
        data += read(12); // part2_3_length: the frame's audio data, in bits
        read(9); // big_values
        gain = Math.max(gain, read(8));
        read(mpeg1 ? 4 + 1 + 22 + 3 : 9 + 1 + 22 + 2); // scalefac_compress, window switching, its fields, the flags
      }
    }
    if (data) gains.push(gain); // frames without data pad the end
    i += Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / rate) + ((h >>> 9) & 1);
  }
  return gains;
}

/**
 * Whether a Chirp 3 HD clip has speech in it. That voice sometimes answers a very short word with a fraction of a
 * second of near-silence (about −40 dBFS) instead. Its frames stay below a global gain of 170, with at most one at
 * 166 or more; every spoken clip goes above (calibrated on 335 clips decoded in a browser, 2026-10-28).
 * @param {Uint8Array} bytes
 */
export function hasSpeech(bytes) {
  const gains = frameGains(bytes);
  return Math.max(0, ...gains) >= 170 || gains.filter((g) => g >= 166).length >= 2;
}

// ---------------------------------------------------------------- clips and manifests

/** The cache key of a clip: what is said, in which locale, by which voice, in which format. */
export const clipKey = (/** @type {string} */ text, /** @type {string} */ locale, /** @type {string} */ voice, /** @type {string} */ format) =>
  JSON.stringify([text, locale, voice, format]);

/** A manifest entry's key: a Google voice name starts with its locale (de-DE-…), a file name ends with its format. @param {any} m */
const entryKey = (m) => clipKey(m.text, m.voice.split('-').slice(0, 2).join('-'), m.voice, path.extname(m.file).slice(1));

/** First 16 hex digits of the SHA-256 of some bytes. @param {Uint8Array | string} bytes */
export const hash16 = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** A clip's file name: its content hash and format. @param {Uint8Array} bytes */
export const clipFile = (bytes) => `${hash16(bytes)}.${FORMAT}`;

/** @param {string} dir data/audio/<code> */
export function readManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  return exists(file) ? /** @type {Record<string, any>} */ (readJson(file).data) : {};
}

/** One entry per line, in canonical concept order. @param {string} dir @param {Record<string, any>} manifest @param {string[]} order */
export function writeManifest(dir, manifest, order) {
  writeAtomic(path.join(dir, 'manifest.json'), canonicalStringify(manifest, order));
}

/**
 * What a language still needs. Each word keeps or shares a clip with the same key whose file is present; the other
 * texts must be synthesized, once each, for all the concepts that say them. Until then a word keeps its old entry
 * (currentClips serves it only while its text is still right). Entries of concepts that no longer have a word drop
 * out of the manifest.
 * @param {{ inputs: Map<string, string>, setting: any, manifest: Record<string, any>, has: (file: string) => boolean }} input
 * @returns {{ manifest: Record<string, any>, todo: Map<string, string[]> }} todo: text → concepts
 */
export function planClips({ inputs, setting, manifest, has }) {
  /** @type {Map<string, any>} */
  const known = new Map();
  for (const m of Object.values(manifest)) if (m?.file && m.voice && has(m.file)) known.set(entryKey(m), m);
  /** @type {Record<string, any>} */
  const next = {};
  /** @type {Map<string, string[]>} */
  const todo = new Map();
  for (const [id, text] of inputs) {
    const m = known.get(clipKey(text, setting.locale, setting.voice, setting.format));
    if (m) {
      next[id] = { file: m.file, text, voice: m.voice, bytes: m.bytes, ...(m.sent ? { sent: m.sent } : {}) };
      continue;
    }
    todo.set(text, [...(todo.get(text) ?? []), id]);
    if (manifest[id]?.file && has(manifest[id].file)) next[id] = manifest[id];
  }
  return { manifest: next, todo };
}

/**
 * The clips the site may serve: those whose text is the word's current text, with the file present. (A clip in
 * another voice still says the right word; one of an older text does not.)
 * @param {{ inputs: Map<string, string>, manifest: Record<string, any>, has: (file: string) => boolean }} la
 * @returns {Map<string, { file: string, bytes: number }>} concept → clip, in canonical order
 */
export function currentClips({ inputs, manifest, has }) {
  /** @type {Map<string, { file: string, bytes: number }>} */
  const clips = new Map();
  for (const [id, text] of inputs) {
    const m = manifest[id];
    if (m?.text === text && m.file && has(m.file)) clips.set(id, { file: m.file, bytes: m.bytes });
  }
  return clips;
}

/**
 * Everything about one language's audio: its audio.json entry, word entries, the current text of each, and its
 * manifest. Before a voice is resolved the default rules give the texts.
 * @param {{ dataDir: string, reg: any, order: string[], audio: any }} ctx @param {string} code
 */
export function languageAudio({ dataDir, reg, order, audio }, code) {
  const lang = reg.languages.languages[code];
  const setting = audio.languages[code] ?? null;
  const entries = wordEntries(dataDir, reg, order, code);
  const rules = setting?.text ?? defaultRules(lang, reg.fields, code);
  const dir = path.join(dataDir, 'audio', code);
  return {
    code, lang, setting, entries, dir,
    inputs: speechInputs(entries, lang, rules),
    manifest: readManifest(dir),
    has: (/** @type {string} */ file) => exists(path.join(dir, file)),
  };
}

// ---------------------------------------------------------------- the site's packs

/**
 * A language's packs for the site (ARCHITECTURE §3): its current clips, each once, packed by the primary module of
 * the first concept that says it, in canonical order; and the index the page reads:
 *   { packs: [[path, size]], files: { hash: [pack, offset, length] }, clips: { concept: hash } }
 * Pack and index names carry their content hash, so they stay cached across data versions. Same clips, same bytes.
 * @param {ReturnType<typeof languageAudio>} la @param {(id: string) => string} primaryOf a concept's primary module
 * @returns {{ files: Record<string, Uint8Array | string>, index: string, clips: number, bytes: number } | null}
 */
export function audioPacks(la, primaryOf) {
  const clips = currentClips(la);
  if (!clips.size) return null;
  /** @type {Map<string, string[]>} module → its files, in order of first use */
  const byModule = new Map();
  const seen = new Set();
  for (const [id, { file }] of clips) {
    if (seen.has(file)) continue;
    seen.add(file);
    const m = primaryOf(id);
    byModule.set(m, [...(byModule.get(m) ?? []), file]);
  }
  /** @type {Record<string, Uint8Array | string>} */
  const files = {};
  const index = { packs: /** @type {[string, number][]} */ ([]), files: /** @type {Record<string, number[]>} */ ({}), clips: /** @type {Record<string, string>} */ ({}) };
  let total = 0;
  for (const [module, names] of byModule) {
    const parts = names.map((name) => new Uint8Array(fs.readFileSync(path.join(la.dir, name))));
    const pack = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    names.forEach((name, i) => {
      index.files[path.basename(name, `.${FORMAT}`)] = [index.packs.length, offset, parts[i].length];
      pack.set(parts[i], offset);
      offset += parts[i].length;
    });
    const name = `audio/${la.code}/${module}.${hash16(pack)}.${FORMAT}`;
    files[name] = pack;
    index.packs.push([name, pack.length]);
    total += pack.length;
  }
  for (const [id, { file }] of clips) index.clips[id] = path.basename(file, `.${FORMAT}`);
  const text = JSON.stringify(index);
  const indexName = `audio/${la.code}/index.${hash16(text)}.json`;
  files[indexName] = text;
  return { files, index: indexName, clips: seen.size, bytes: total };
}

// ---------------------------------------------------------------- lint

/**
 * Pronunciation audio problems for lint-data. None of them is about coverage, so none gates a deploy: an active
 * language without a TTS locale and words without a current clip are warnings; a malformed audio.json is an error.
 * @param {{ p: { data: string, meta: string }, reg: any, concepts: { order: string[] } }} ctx
 * @returns {{ level: 'error' | 'warning', file: string, id: string | null, msg: string }[]}
 */
export function audioIssues({ p, reg, concepts }) {
  /** @type {{ level: 'error' | 'warning', file: string, id: string | null, msg: string }[]} */
  const issues = [];
  const L = reg.languages;
  for (const code of L.active) {
    if (!L.languages[code]?.tts) issues.push({ level: 'warning', file: 'meta/languages.json', id: code, msg: 'no "tts" locale, so no pronunciation audio' });
  }
  let audio;
  try {
    audio = readAudioMeta(p.meta);
  } catch (e) {
    return [...issues, { level: 'error', file: `meta/${AUDIO_META}`, id: null, msg: /** @type {Error} */ (e).message }];
  }
  for (const [code, setting] of Object.entries(audio.languages ?? {})) {
    const file = `meta/${AUDIO_META}`;
    if (!L.languages[code]) issues.push({ level: 'error', file, id: code, msg: 'unknown language' });
    for (const msg of settingProblems(setting)) issues.push({ level: 'error', file, id: code, msg });
    const tts = L.languages[code]?.tts;
    if (tts && setting?.locale && tts !== setting.locale) {
      issues.push({ level: 'warning', file, id: code, msg: `locale ${setting.locale}, but languages.json says ${tts}: tools/audio.mjs run resolves the voice again` });
    }
  }
  const ctx = { dataDir: p.data, reg, order: concepts.order, audio };
  for (const code of Object.keys(L.languages)) {
    const dir = path.join(p.data, 'audio', code);
    const voiced = audio.languages?.[code]?.voice;
    if (!voiced && !exists(dir)) continue;
    const la = languageAudio(ctx, code);
    const rel = `audio/${code}`;
    const missing = Object.values(la.manifest).filter((m) => m?.file && !la.has(m.file)).length;
    if (missing) issues.push({ level: 'warning', file: `${rel}/manifest.json`, id: null, msg: `${missing} clip file(s) missing` });
    const used = new Set(Object.values(la.manifest).map((m) => m?.file));
    const unused = exists(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(`.${FORMAT}`) && !used.has(f)).length : 0;
    if (unused) issues.push({ level: 'warning', file: rel, id: null, msg: `${unused} clip file(s) no manifest uses (node tools/audio.mjs prune)` });
    if (!voiced || !la.entries.size) continue;
    const without = la.entries.size - currentClips(la).size;
    if (without) issues.push({ level: 'warning', file: rel, id: null, msg: `${without} of ${la.entries.size} words have no current clip (node tools/audio.mjs run --lang ${code})` });
  }
  return issues;
}
