// Loads data/meta/*.json for tests (the browser gets the same objects from src/data/loader.js).
import fs from 'node:fs';

const META = new URL('../../data/meta/', import.meta.url);

/** @param {string} name */
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, META), 'utf8'));

export function loadMeta() {
  return {
    languages: read('languages.json'),
    modules: read('modules.json'),
    fields: read('fields.json'),
    labels: read('labels.json'),
    version: read('version.json'),
    audio: fs.existsSync(new URL('audio.json', META)) ? read('audio.json').languages : {},
  };
}
