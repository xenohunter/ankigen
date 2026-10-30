// @ts-check
// The bytes of pronunciation clips (ARCHITECTURE §3): from the site's packs in few requests (the byte ranges a deck
// needs, merged across small gaps, or the whole pack when most of it is needed), or each from its own file under
// data/audio while developing. A server that ignores ranges sends the whole file, which serves every clip in it.
// Loaded only when a deck has audio (ui/app.js, ui/audio.js), not with the page.

/** @typedef {{ url: string, offset: number, length: number, size: number }} ClipSource  a clip's bytes: a range of a file of `size` bytes */
/** @typedef {{ clips: Map<string, string>, files: Map<string, ClipSource> }} AudioIndex  concept → clip (its content hash) → its bytes */
/** @typedef {{ url: string, start: number, end: number, clips: [string, ClipSource][] }} Request  bytes [start, end) of a file */

/**
 * Load a language's clips: the site's index (meta.json names it), else data/audio's manifest (developing).
 * @param {{ getJson: (path: string) => Promise<any>, dataBase: string }} loader @param {any} meta @param {string} code
 * @returns {Promise<AudioIndex>}
 */
export async function loadAudioIndex(loader, meta, code) {
  const index = meta.audio?.[code]?.index;
  const dir = `${loader.dataBase}audio/${code}/`;
  return audioIndex(index ? { index: await loader.getJson(index) } : { dir, manifest: await loader.getJson(`${dir}manifest.json`) });
}

/**
 * A language's clips from the site's index
 * { packs: [[path, size]], files: { hash: [pack, offset, length] }, clips: { concept: hash } }, or from data/audio's
 * manifest { concept: { file, bytes } } (each clip its own file under `dir`).
 * @param {{ index?: any, dir?: string, manifest?: any }} raw
 * @returns {AudioIndex}
 */
export function audioIndex({ index, dir, manifest }) {
  /** @type {Map<string, string>} */
  const clips = new Map(Object.entries(index?.clips ?? {}));
  /** @type {Map<string, ClipSource>} */
  const files = new Map();
  for (const [hash, [pack, offset, length]] of Object.entries(index?.files ?? {})) {
    files.set(hash, { url: index.packs[pack][0], offset, length, size: index.packs[pack][1] });
  }
  for (const [id, m] of Object.entries(manifest ?? {})) {
    const hash = m.file.replace(/\.mp3$/, '');
    clips.set(id, hash);
    files.set(hash, { url: `${dir}${m.file}`, offset: 0, length: m.bytes, size: m.bytes });
  }
  return { clips, files };
}

/**
 * A deck's clips (one per note, its word's: merged members say the same word) and their size in bytes.
 * @param {{ conceptIds: string[] }[]} notes @param {AudioIndex} audio
 */
export function deckClips(notes, audio) {
  const hashes = new Set(notes.map((n) => n.conceptIds.map((id) => audio.clips.get(id)).find(Boolean)));
  hashes.delete(undefined);
  let bytes = 0;
  for (const hash of hashes) bytes += audio.files.get(/** @type {string} */ (hash))?.length ?? 0;
  return { clips: hashes.size, bytes };
}

/**
 * The requests that fetch these clips: per file, the needed ranges joined across gaps of up to `gap` bytes; the
 * whole file when the ranges would cover `most` of it or need more than `max` requests.
 * @param {Map<string, ClipSource>} clips clip → where its bytes are
 * @param {{ gap?: number, most?: number, max?: number }} [opts]
 * @returns {Request[]}
 */
export function planRequests(clips, { gap = 16_384, most = 0.6, max = 8 } = {}) {
  /** @type {Map<string, [string, ClipSource][]>} */
  const byUrl = new Map();
  for (const entry of clips) byUrl.set(entry[1].url, [...(byUrl.get(entry[1].url) ?? []), entry]);
  /** @type {Request[]} */
  const requests = [];
  for (const [url, list] of byUrl) {
    list.sort((a, b) => a[1].offset - b[1].offset);
    /** @type {Request[]} */
    const spans = [];
    for (const entry of list) {
      const { offset, length } = entry[1];
      const last = spans.at(-1);
      if (last && offset - last.end <= gap) {
        last.end = Math.max(last.end, offset + length);
        last.clips.push(entry);
      } else {
        spans.push({ url, start: offset, end: offset + length, clips: [entry] });
      }
    }
    const size = list[0][1].size;
    const needed = spans.reduce((n, s) => n + s.end - s.start, 0);
    requests.push(...(spans.length > max || needed >= most * size ? [{ url, start: 0, end: size, clips: list }] : spans));
  }
  return requests;
}

/**
 * The bytes of these clips. Files are fetched side by side; the ranges of one file one after another, so a server
 * that answers a range with the whole file is asked only once. onProgress(received, total) follows the download.
 * @param {Map<string, ClipSource>} clips
 * @param {{ fetch?: (url: string, init?: RequestInit) => Promise<Response>, onProgress?: (received: number, total: number) => void }} [opts]
 * @returns {Promise<Map<string, Uint8Array>>} clip → its bytes
 */
export async function fetchClips(clips, { fetch: get = (url, init) => fetch(url, init), onProgress } = {}) {
  /** @type {Map<string, Request[]>} */
  const byUrl = new Map();
  for (const r of planRequests(clips)) byUrl.set(r.url, [...(byUrl.get(r.url) ?? []), r]);
  let total = [...byUrl.values()].flat().reduce((n, r) => n + r.end - r.start, 0);
  let received = 0;
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();
  /** @param {Request} r @param {Uint8Array} bytes @param {number} start where the bytes begin in the file */
  const take = (r, bytes, start) => {
    for (const [hash, c] of r.clips) {
      if (c.offset - start + c.length > bytes.length) throw new Error(`${r.url}: response too short`);
      out.set(hash, bytes.slice(c.offset - start, c.offset - start + c.length));
    }
  };
  await Promise.all(
    [...byUrl.values()].map(async (list) => {
      /** @type {Uint8Array | null} the whole file, once a server sent it */
      let file = null;
      for (const r of list) {
        if (file) {
          take(r, file, 0);
          continue;
        }
        const size = r.clips[0][1].size;
        const whole = r.start === 0 && r.end === size;
        const res = await get(r.url, whole ? undefined : { headers: { Range: `bytes=${r.start}-${r.end - 1}` } });
        if (!res.ok) throw new Error(`${r.url}: HTTP ${res.status}`);
        const partial = res.status === 206;
        if (partial && !(res.headers.get('content-range') ?? '').startsWith(`bytes ${r.start}-`)) throw new Error(`${r.url}: unexpected range`);
        if (!partial && !whole) total += size - list.reduce((n, s) => n + s.end - s.start, 0);
        const bytes = await read(res, (n) => onProgress?.((received += n), total));
        if (partial) take(r, bytes, r.start);
        else take(r, (file = bytes), 0);
      }
    }),
  );
  return out;
}

/** A response's body, counting bytes as they arrive. @param {Response} res @param {(n: number) => void} onChunk */
async function read(res, onChunk) {
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onChunk(bytes.length);
    return bytes;
  }
  /** @type {Uint8Array[]} */
  const chunks = [];
  const reader = res.body.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value);
    onChunk(chunk.value.length);
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
