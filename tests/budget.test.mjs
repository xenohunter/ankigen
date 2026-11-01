// ARCHITECTURE §1: the page's initial JS stays within 64 KB gzipped. sql.js, fflate and the packager are
// loaded only on download, the feedback dialog with its client on first use (or when the browser is idle),
// the word list once the deck has modules, the language menu after the first render, the Share block when it
// appears, the pinned support links after a download and the Reset all dialog on first use, so they must not
// be reachable through static imports from src/main.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { staticGraph } from './helpers/modules.mjs';

const BUDGET = 64 * 1024;

test('initial JS: within 64 KB gzipped, without the download-only modules (the app and the languages page)', () => {
  const lazy = [
    'src/deck/apkg.js', 'vendor/fflate.js', 'vendor/sql-wasm.js', 'src/ui/feedback-dialog.js', 'src/feedback/client.js',
    'src/ui/sidebar.js', 'src/deck/search.js', 'src/ui/locale.js', 'src/ui/share.js', 'src/ui/share-icons.js', 'src/ui/support.js',
    'src/ui/reset.js',
  ];
  for (const entry of ['src/main.js', 'src/languages-page.js']) {
    const graph = staticGraph(entry);
    const files = [...graph.keys()];
    for (const file of lazy) assert.ok(!files.includes(file), `${entry}: ${file} is loaded up front`);
    const gzipped = [...graph.values()].reduce((sum, source) => sum + zlib.gzipSync(source).length, 0);
    assert.ok(gzipped <= BUDGET, `${entry}: initial JS is ${(gzipped / 1024).toFixed(1)} KB gzipped (budget 64 KB)`);
  }
});
