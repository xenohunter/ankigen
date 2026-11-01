// @ts-check
// Read a unit's JSON object from the model's reply (tools/gen/batch.mjs).

/** The keys of a unit's output (tools/gen/merge-unit.mjs): an object without any of them is not one. */
const OUTPUT_KEYS = ['unit', 'lang', 'ex', 'patch', 'concepts', 'addMods', 'labels', 'landing', 'ipa', 'slots'];

/**
 * The reply is one JSON object, perhaps in a code fence. Sometimes the model writes the object, then
 * "Wait — correcting …" and the corrected object: then the last object that parses is the answer. But it may
 * also correct only one entry ("The corrected entry is: "word-put": {…}"), which is not a unit's output: the last
 * object with a unit's keys is the answer then, and the entry's fix is left to lint and the review.
 * @param {string} raw
 * @returns {any}
 */
export function parseOutput(raw) {
  const s = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(s);
  } catch {
    const objects = topLevelObjects(s).flatMap((text) => {
      try {
        return [JSON.parse(text)];
      } catch {
        return []; // an object in the prose, or cut off
      }
    });
    const outputs = objects.filter((o) => o && typeof o === 'object' && OUTPUT_KEYS.some((k) => k in o));
    const answer = (outputs.length ? outputs : objects).at(-1);
    if (answer === undefined) throw new Error('no JSON object found');
    return answer;
  }
}

/**
 * The {…} spans at the top level of a text. Braces inside JSON strings don't count; quotes in the prose
 * between objects don't open strings.
 * @param {string} s
 */
function topLevelObjects(s) {
  /** @type {string[]} */
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = depth > 0;
    } else if (ch === '{') {
      if (depth++ === 0) start = i;
    } else if (ch === '}' && depth > 0) {
      if (--depth === 0) spans.push(s.slice(start, i + 1));
    }
  }
  return spans;
}
