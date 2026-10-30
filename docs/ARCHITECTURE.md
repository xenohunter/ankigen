# AnkiGen: architecture

Audience: the engineer (Claude Code) implementing the web app. Product decisions are in `SPEC.md` and the data contract is in `DATA_FORMAT.md`. This file explains how the pieces fit together.

## 1. Constraints

- **Static site on GitHub Pages** at `https://xenohunter.github.io/ankigen/`. It is served under `/ankigen/`, so use only relative URLs. No server code except the feedback Apps Script.
- **No build step for the app.** Native ES modules, vanilla JS with JSDoc types (`// @ts-check` on every module), plain CSS. Dependencies are **vendored** with pinned versions in `vendor/` (no CDN at runtime):
  - `sql.js` (WASM SQLite)
  - `fflate` (zip)
- **Deterministic** deck content: same data version and same config give the same notes, fields, GUIDs and order. Only export timestamps vary, including the note and card ids derived from them (see §7.2, §7.4).
- **Fast**: initial page JS ≤ 60 KB gzipped (excluding sql.js, which is lazy-loaded; so are the word list, the language menu, the Share block, the Reset all dialog, the feedback dialog and the audio option with its clip loader, which load after the first render, on first use, or once the learned language has audio). First paint < 1 s on a mid-range phone. With audio the first load is at 59.9 KB: little room left.
- Works offline once loaded (nice-to-have: a tiny service worker caching app + fetched data).

## 2. Repository layout

```
index.html              single page; semantic HTML, SEO meta, modulepreload links, footer, noscript description; its
                        texts are marked data-t / data-plural for the interface language
languages.html          the supported languages (SPEC §4): the list in English for crawlers, translated by
                        src/languages-page.js; "Request a language"
404.html                redirect to the app (keeps a configuration hash and ?lang=)
robots.txt, og-image.png (source: tools/og-image.html), favicon.svg, apple-touch-icon.png (sitemap.xml is built)
img/flags/<cc>.svg      the interface languages' flags (4:3), by country code of languages.json
LICENSE                 MIT, for the code; data/LICENSE.md: CC BY-SA 4.0, for the vocabulary
css/app.css             page styles (light/dark via prefers-color-scheme)
css/card.css            card styles; SAME file is embedded into the Anki note type
src/
  main.js               bootstrap, wiring
  languages-page.js     languages.html: translates its list, the language menu, the feedback dialog for requests
  config.js             constants: site, repo, Patreon, Buy Me a Coffee and data license URLs, feedback endpoint, app version
  state.js              config model, defaults, validation, URL-hash codec, localStorage
  data/loader.js        fetch meta, concepts, layer files or bundles; caching; graceful misses
  data/clips.js         pronunciation audio: a language's clip index, a deck's clips and size, and their bytes
                        (byte ranges of the packs); loaded only when a deck has audio
  deck/select.js        which concepts become which notes, in which order (merges, disambiguators)
  deck/fields.js        per-note field HTML (word, translation, forms, examples, …)
  deck/templates.js     Anki templates + CSS for a config
  deck/render.js        mini Anki template renderer for preview/sidebar
  deck/search.js        the word list's search: what a note is found by, and ranking
  deck/names.js         note type, deck and file names of a language pair
  deck/ids.js           stable hashes → GUIDs, note/card/deck/model IDs, Anki checksum
  deck/apkg.js          SQLite collection (schema 11) + zip → .apkg bytes (sql.js passed in)
  text/translit.js      ru → Latin, sr Cyrillic ↔ Latin, hy → Latin (BGN/PCGN), el → Latin (ELOT 743)
  text/normalize.js     search folding (case, diacritics, stress, scripts)
  text/furigana.js      Anki-style furigana → <ruby>; target braces → <b>
  ui/app.js             the page's model: config store, loaded data, derived deck view, its address (no DOM)
  ui/steps.js ui/languages.js ui/modules.js ui/fields.js ui/options.js
  ui/preview.js ui/sidebar.js ui/feedback.js ui/popover.js ui/download.js
  ui/feedback-dialog.js the feedback dialog and its English texts (loaded on first use, with feedback/client.js)
  ui/audio.js           the pronunciation audio toggle and its English texts, a download's clips, the preview's play
                        button (loaded once the learned language has audio)
  ui/strings.js         the page's English texts: the master of the translations in data/ui
  ui/i18n.js            the interface language: texts, plurals, numbers, the language to start with (no DOM)
  ui/page.js            what the two pages share: the starting language, their texts, the language menu
  ui/locale.js          the interface language menu (loaded after the first render)
  ui/support.js         the header's support links, sticky after the first download (loaded then)
  ui/reset.js           "Reset all": the "Are you sure?" dialog, then a reload with the defaults (loaded on first use)
  ui/share.js ui/share-icons.js   the Share block and the sites' logos (loaded when it appears)
  ui/dom.js ui/copy.js  element helper, live texts, icons; texts put together from ui/strings.js
  feedback/client.js    rate limits, garbage heuristics, payload, POST to Apps Script
vendor/                 sql-wasm.js, sql-wasm.wasm, fflate.js (ES module) + fflate.d.ts (pinned; versions,
                        checksums and LICENSE files in vendor/README.md)
data/                   vocabulary (see DATA_FORMAT.md); landing/ and ui/: translations of the landing pages' and the
                        page's texts (§10, §13); audio/: the pronunciation clips (DATA_FORMAT.md §13)
tools/                  data lint + generation tooling, apkg.mjs (an .apkg from a config hash, in Node),
                        bundle.mjs (the site with its data bundles and audio packs), landing.mjs (landing pages and
                        sitemap), ui-texts.mjs (checks and stamps data/ui), audio.mjs (the pronunciation clips, with
                        Google Cloud Text-to-Speech; GENERATION.md §7)
tests/                  node --test suites + fixtures (tests/fixtures/data exists)
feedback/Code.gs        Apps Script backend (exists)
.github/workflows/      ci.yml (lint + tests), pages.yml (bundle + deploy)
```

Keep pure logic (`state`, `deck/*`, `text/*`, `feedback/client` minus `fetch`) free of DOM access, so it runs under `node --test`.

## 3. Data loading

- **Production:** `node tools/bundle.mjs` builds the site in `_site/` with the data in `bundles/<data version>/`:
  - `meta.json`: the meta files, as `getMeta()` returns them;
  - `concepts.json`: `{module: {id: concept}}` in module tree order, without the authors' `note`s (a third of the file);
  - `<code>.json`: all layers of one language, `{lang:{}, ex:{}, ipa:{}, etym:{}}`, for each language with data;
  - `ui-<code>.json`: the page's texts in an interface language (§13): `{ui, landing}`, from `data/ui/<code>.json` and the parts of `data/landing/<code>.json` the page shows.

  The loader reads `data/meta/version.json` without the cache (`no-cache`), then the bundles of that version. A language pair then takes five requests (version, meta, concepts and the two languages), which gzip well: English is 855 KB, 250 KB gzipped. The site leaves out the source vocabulary files (it keeps `data/meta/`), and the same data always gives the same bytes. `tools/bundle.mjs` replaces `_site/` as a whole, so it refuses any directory it did not build.
- **Pronunciation audio** (`tools/lib/audio.mjs` `audioPacks`): outside the versioned bundles, so that unchanged audio stays cached across data versions, the site has per language with clips
  - `audio/<code>/<module>.<hash>.mp3`: packs of the clips whose words' concepts have that primary module, each clip once (in the pack of its first use), in canonical order;
  - `audio/<code>/index.<hash>.json`: `{packs: [[path, size]], files: {clip: [pack, offset, length]}, clips: {concept: clip}}`, a clip being its content hash.

  Both names carry their content's hash, and `meta.json` names each index (`meta.audio[code].index`; only languages with clips are listed, so only they show the toggle). Only clips whose text is the word's current one get in. Same clips, same bytes. The browser never fetches a file per clip: `data/clips.js` asks for the byte ranges a deck needs, merging ranges less than 16 KB apart, or for the whole pack when the ranges would cover 60% of it. A topical module borrows many core words (Time & calendar: 8 words of its own, 118 cross-listed), so whole packs would cost several MB for a few hundred KB of clips. A server that ignores ranges sends the whole pack once; Pages answers ranges with 206.
- **Audio while developing:** without bundles the toggle shows for the languages with a voice in `data/meta/audio.json`, and each clip is fetched from its own file under `data/audio/` (or `?data=`'s `audio/`).
- **Development / fallback:** if bundles are missing, load `data/meta/*`, all `data/concepts/*.json`, then per-module layer files for the two languages, in parallel. A missing file means empty; never throw.
- Loader API (async, cached): `getMeta()`, `getConcepts()`, `getLanguage(code)` → `{lang: Map, ex: Map, ipa: Map, etym: Map}`, `getUiTexts(code)` → `{ui, landing}` (the bundle, or the two source files), `getJson(path)` (with `dataBase`, what `data/clips.js` `loadAudioIndex` reads the audio index or manifest with).
- Start prefetching a language when the user hovers or focuses its chip. Show a short inline status in the step while loading ("Loading Japanese words…"), and a message if loading fails.

## 4. State and URL

- **Config:** `{v:1, learn, know|'=', modules:[ids], fields:{id: placement}, examples:0–3, reverse, type, audio, srScript}`.
- Encoded in `location.hash`, compact and human-readable, for example:
  `#v1&l=ja&k=ru&m=core-1,core-2,food&f=reading:f,ipa:o,forms:b&x=2&r=1&t=1&a=1&sr=c`
  - Only non-default field placements are written.
  - `a=1` (pronunciation audio) only while the learned language has audio (`hasAudio`); anything but `1` is off. The choice itself survives a switch to a language without audio and back.
  - Unknown keys are ignored. Invalid values fall back to defaults, keeping the rest.
- The config is also saved to localStorage (try/catch). On load, the precedence is hash > localStorage > defaults.
- The interface language is the `lang` query parameter: `?lang=ru#v1&l=ja&k=ru…` (§13). The address names it once there is a config or the user chose a language; other parameters (the dev `?data=`) stay. `app.address(href)` builds the address, for the URL and for the Share block.
- `state.js` exposes `subscribe()`. `ui/app.js` derives the deck view (notes, counts, sample) on each change; it takes a few milliseconds even for the full English deck.
  - Controls update at once.
  - The preview frames re-render debounced (about 60 ms), and the URL hash and localStorage are written after about 150 ms.

## 5. Deck selection (`deck/select.js`)

Input: config, meta, concepts, learning-language data `A`, known-language data `B` (same as `A` in same-language mode). Output: an ordered list of **notes**:
`{key, conceptIds[], learnEntries[], knowEntries[], disambig?}`.

1. **Candidate concepts:** a concept is a candidate when its `mods` intersect the selected modules.
2. **Bilingual mode:** include the concept iff
   - the concept is owned by the learned language (no `only`, or `only` includes it);
   - `A` has a word entry (`w`);
   - `B` has a word entry or a gloss (`w` or `gl`).
3. **Same-language mode:** include iff `A` has `w` and `def`.
4. **Adult module:** profanity concepts are included only when that module is selected (they may be cross-listed, so check membership, not the primary module).
5. **Order:** canonical concept order (module tree order of the primary module, then position in its file).
6. **Merge sets** (learning side), computed once per learning language over the **whole inventory**, not the selection:
   - Group word entries by `(w, g, art, pos, read, JSON(forms))`. The reading keeps Japanese/Chinese homographs apart (今日 きょう / こんにち).
   - Each group of 2 or more is one merge set, keyed by its first member in canonical order.
   - A selected concept that belongs to a merge set produces one note per set. That note contains the selected members only, and its key and GUID come from the set's first member, even if that member is not selected. Its position is the earliest selected member.
7. **Disambiguators:** entries with the same `w` that are *not* merged (different POS, gender, reading or forms) get `disambig`, computed over the whole inventory like the merge sets. That is the POS label in the known language if the POS differs, otherwise the gender (article or mark) if that differs (der/die See), otherwise the first form value that differs, otherwise the learned-language hint; shown on the front as a small caption.

## 6. Field rendering (`deck/fields.js`)

Produces the HTML for each Anki field, given the note and config. All text is escaped; only our own tags are emitted.

- **Word:**
  - article or gender marker according to the language rules (`gender.mode`, `articles` table, `art` override, fr elision `l'` without space);
  - stress marks stripped if off;
  - Serbian converted to the chosen script;
  - `WordRuby` = `<ruby>` for Japanese (`w` + `read`; readings are per word, so place the ruby over the whole kanji part and keep okurigana outside when `w` ends in kana that also ends `read`);
  - `TypeTarget` = plain main form with no hint, no stress, de/nl article included while the Gender / article row is on.
- **Translation:**
  - format: `w (hint) · alt1, alt2`;
  - glosses are rendered in italics;
  - merged notes join members with `; ` in canonical order;
  - Russian is shown without stress marks (a learner aid; the Stress row is about the learned word);
  - same-language mode: `def` (merged notes numbered `1. … 2. …`);
  - if the known language is Serbian, convert it to the chosen script.
- **Forms:**
  - `label value` pairs in the order of `languages.json` → `forms[pos].keys`;
  - labels come from `labels.json` in the **known** language, falling back to `en`;
  - enum values (`aspect`, `class`, `type`) are shown through `value.*` labels;
  - Russian stress follows the toggle.
- **Romanization:**
  - ja and ko: stored `rom`;
  - zh: `read`;
  - ru, hy, el: rule-based `text/translit.js` (tables + context rules, unit-tested);
  - sr "other script": the opposite script.
- **Examples:**
  - first N slots; merged notes take them round-robin from their members (slot 1 of each, then slot 2, …);
  - target `{…}` → `<b class="t">…</b>`;
  - Japanese furigana rendered as `<ruby>` when Reading ≠ Off, otherwise stripped to plain kanji;
  - Chinese: a pinyin line under the sentence when Romanization ≠ Off;
  - Russian stress follows the toggle;
  - if Example translations are on and both slot k entries are parallel, the known-language sentence goes underneath (braces removed, furigana stripped).
- **Related:**
  - synonyms of the learned word `= alt`, antonyms `↔ w` and related `→ w`, rendered in the learned language;
  - concepts the learned language doesn't have are skipped.
- **IPA, Measure word, Hanja, POS, Register, Emoji, ConceptId:** straight from the data, with captions from `labels.json`.
- **Etymology:** dropped for now. `fields.json` has no row for it, so the field stays empty, but the note type keeps it (and `fields.js` still fills it from the `etym` layer when a row returns).

## 7. Anki package

### 7.1 Note type (one per language pair)

- **Fields (fixed order, never changes within schema v1; a new field can only be appended):**
  `Word, WordRuby, TypeTarget, Disambig, Translation, Romanization, OtherScript, MeasureWord, Hanja, Forms, IPA, Examples, Related, Etymology, POS, Register, Emoji, ConceptId, Reverse, Audio`.
  - Fields switched off are left empty.
  - `Reverse` is `"1"` when reverse cards are on, otherwise empty.
  - `Audio` (appended 2026-10-28) is `[sound:ankigen-<lang>-<hash>.mp3]` when the deck has audio and the word has a clip (merged notes: their shared word's), otherwise empty. A deck made before it has 19 fields: Anki then needs "Merge note types" once (§7.4).
- **Templates:**
  - `Forward`.
  - `Reverse`, whose front is wrapped entirely in `{{#Reverse}}…{{/Reverse}}`. Anki creates a reverse card only when the field is non-empty, so toggling reverse never changes the note type's schema.
  - Templates are generated from the config: field rows on Front go to the question, rows on Back go after `<hr id=answer>`.
  - On reverse cards every learning-side field goes to the answer.
  - Japanese: the front uses `WordRuby` only when Reading = Front; the back uses `WordRuby` whenever Reading ≠ Off.
  - Type the answer: `{{type:TypeTarget}}` on the reverse front and back, only when enabled.
  - Audio (only when the deck has audio): `{{#Audio}}<div class="audio">{{Audio}}</div>{{/Audio}}` under the word on the forward question and on the reverse answer, never on the reverse question. Anki plays every `[sound:]` of the side it shows (`{{FrontSide}}` would not replay it, but these templates repeat the question instead), so the forward answer leaves it out: the word plays once, on the question. Checked with Anki's own `question_av_tags`/`answer_av_tags`.
- **CSS:** `css/card.css`, embedded verbatim.
  - Night mode via `.nightMode`/`.night_mode`.
  - `lang` attributes on learned/known blocks so CJK picks correct glyphs (zh-Hans vs ja).
  - Ruby styling, small grey captions, mobile-first.
  - The play button's place and size: Anki's own `.replay-button` and the preview's `.ag-play`.
- **Sort field:** Word (plain text).

### 7.2 IDs (`deck/ids.js`) — use `crypto.subtle` SHA-256 (async; available in browsers and Node ≥ 20)

| ID | Formula |
|---|---|
| note GUID | base91(first 8 bytes of SHA-256(`ankigen/v1/note|{learn}|{know}|{key}`)). `know` is `=` in same-language mode. |
| deck id | first 8 bytes of SHA-256(`ankigen/v1/deck|{learn}|{know}`), mapped into [1e12, 2^53) |
| model id | first 8 bytes of SHA-256(`ankigen/v1/model|{learn}|{know}`), mapped into [1e12, 2^53) |
| note id | export time in ms + note position (0-based): `T + i` |
| card id | export time in ms + 2 × note position + ord: `T + 2i + ord` |

- Why two kinds: Anki matches an imported note to an existing one by **GUID**, cards by (note, template), and the note type by its **id**. Those are hashed so they never change. Anki does not match on note or card ids: when an incoming id is already taken, the importer shifts it by 999 until it is free. But it reads them as creation times: the browser's "Created" column is the note id, a card's "Added" date and the `added:N` search use the card id. So they follow Anki's own convention (export-time milliseconds), and ids within one file are consecutive, never colliding.
- Decks are matched by **name**, not id: the deck id only links cards to the deck inside the file, and the importer gives a new deck an id of its own. So the deck name (§7.3) is part of a language pair's identity, like the GUID prefix: never change a language's `native` name in `languages.json`.
- `csum` = first 8 hex digits of SHA-1 of the stripped first field (Word), as an int (Anki's rule).
- Changing a prefix version (`v1`) is a breaking change for every user. Don't do it.

### 7.3 Collection

- Write a **schema 11** `collection.anki2`: `col`, `notes`, `cards`, `revlog`, `graves` and their indexes, with `conf`, `models`, `decks` and `dconf` JSON in `col`, with the keys and values Anki's own legacy export writes. It imports into all current Anki desktop, AnkiDroid and AnkiMobile versions.
  - Anki's own legacy export puts the data in `collection.anki21` and a "please update Anki" note in `collection.anki2`. Every importer since 2.1 reads `collection.anki2` when there is no `.anki21`, so one file serves all of them.
  - `decks` also holds the "Default" deck (id 1) that every schema-11 collection has. Importers skip it, because it holds no cards.
  - `dconf` is Anki's "Default" preset. Our deck uses it, so users keep their own options.
  - The note type's legacy `req` (which cards a note gets) is computed the way Anki computes it. Anki ≥ 2.1.28 recomputes it on import and gets the same result.
- Deck name: `AnkiGen::<Learning native name> (<Known native name>)`; for same-language mode, `AnkiGen::<name> (definitions)`.
- Deck description: `Made with AnkiGen · data <version>`, where "AnkiGen" links to the site with this config's hash, so users can reopen their settings to download an update.
- Tags: `ankigen::<category>::<module>` for every selected module the concept belongs to, sorted (Anki keeps tags sorted). Use the module IDs from `modules.json`.
- Notes: `sfld` and `csum` come from the stripped Word field, as Anki computes them. `mod` and `usn` per §7.4.
- Cards:
  - One per template whose question is not blank: the forward card always, the reverse card when Reverse = 1. This uses `cardOrds` in `deck/render.js`, the same check the preview uses.
  - New cards: `due` = note position (0-based); `ord` 0 = forward, 1 = reverse.
- Zip with `fflate` entries `collection.anki2`, the clips and `media`, fixed entry mtime 1980-01-01 00:00, deterministic order.
  - Without audio `media` is `{}`. With audio the clips the notes name are entries `0`, `1`, … (stored, not deflated: MP3 is compressed already) in order of first use in the notes, and `media` maps them to their names, `{"0": "ankigen-ru-7f5f35a1b51dbce6.mp3", …}`. The order comes from the notes, not from how the clips were fetched, so a fixed clock still gives identical bytes. A clip a note names but the caller didn't pass is an error, never a silent broken button.
  - A clip's name is its content hash: Anki matches media by name, so one name never stands for two recordings, and importing the same clip again adds nothing.
- File name: `ankigen-<learn>-<know>-<data version>.apkg`; same-language decks repeat the language (`ankigen-en-en-…`).
- `buildApkg` takes the initialized sql.js module as a parameter and returns the bytes; the page wraps them in a Blob.

### 7.4 Timestamps and updates

With its default options, Anki's importer updates an existing note (same GUID) or the note type (same id, same field and template names) only when the incoming one is **newer** by its `mod` time, to the second.
- The defaults are: Update notes and Update note types "If newer"; Merge note types off.
- So `mod` and the collection timestamps use the export time (seconds), and note and card ids the export time in milliseconds (§7.2). Everything else is deterministic.

Tests pass a fixed clock. Two exports of the same config are then byte-identical, in Node and in the browser alike. With different clocks, only the timestamp columns and the ids derived from them differ.

What re-importing does was checked against the Anki backend itself: the `anki` Python package 26.09.3 and 23.12.1, and the legacy importer of 2.1.49 (AnkiDroid's old Java importer is a port of it).
- **The same file again:** nothing changes ("notes already present").
- **A newer export:** fields, tags and the templates update. Review history, scheduling, suspended cards and flags stay.
- **More modules:** new notes are added to the same deck, at their positions in the new export. Existing cards keep their positions.
- **Reverse turned on:** reverse cards are added.
- **Reverse turned off:** the existing reverse cards stay but are blank ("The front of this card is blank"). Tools → Empty Cards deletes them.
- **The user's own edits and tags** on these notes, including "marked" and "leech", are replaced by the new version.
- **A renamed or moved deck:** existing cards stay where they are; new cards go to a re-created deck with the original name.
- **A note type the user changed** (e.g. added a field):
  - Without "Merge note types": notes are not updated, and Anki adds an unused copy "AnkiGen … +" of the incoming note type.
  - With it: notes update, but the user's extra field is emptied.
- **Pronunciation audio** (checked on 2026-10-28 with the same three backends):
  - With audio, the clips land in `collection.media` byte for byte; the same file again adds no media ("already present").
  - Turning audio on later: notes and templates update, the clips are added. Turning it off: the `Audio` field is emptied and the clips stay; Tools → Check Media lists them as unused.
  - The forward card plays the clip on the question only, the reverse card on the answer only.
  - A deck from before the `Audio` field (19 fields), then one with it, with default options: "conflicting", nothing updated (and Anki keeps a copy "AnkiGen … +" of the new note type). With "Merge note types" ticked, at once or on a later import: the notes update, with their clips, and the copy goes.
  - When testing by hand or in scripts, build each file after the previous import, or give it a later clock: an importer may stamp updated notes with the import time, and then an older file counts as a duplicate.

The manual checks on real devices are in `docs/ANKI_CHECKLIST.md`. The user-facing summary of all this is the "?" next to Download (`update.*` in `src/ui/strings.js`).

## 8. Preview and sidebar

- **One template pipeline:** the preview renders the *same* generated templates and fields with `deck/render.js`, a tiny Mustache subset:
  - `{{Field}}`, `{{#F}}…{{/F}}`, `{{^F}}…{{/F}}`, `{{FrontSide}}`;
  - `{{type:F}}` renders as a disabled input.

  What the user sees is what Anki shows.
- **Preview:** each face is rendered in an `<iframe srcdoc sandbox="allow-scripts">` with `card.css`, inside `<body class="card">` like Anki's reviewer. Light/dark follows the page (`nightMode` on the body).
  - The frames have an opaque origin: they can't reach the page, its storage or its address, and the page can't read them. Their only script is a small bridge (`bridge` in `ui/preview.js`) that posts `{ankigen: 1, type}` messages to the page: `size` (the body's height, on load, resize and when fonts arrive), `selection` (the selected text and where it is, or null) and `shortcut` (Ctrl/Cmd+Enter). The page answers `clear` after a report quoted the selection. The page accepts messages only from its own frames and keeps only the fields and lengths a report uses.
  - Why not `allow-same-origin` without scripts: browser extensions inject scripts into every frame, and in such a frame Chrome blocks them and logs "Blocked script execution in 'about:srcdoc'…" for each face. With `allow-scripts` alone the extensions run, nothing is logged, and the frames stay isolated from the page. (Both flags together would let the frames lift their own sandbox.)
  - **Audio:** `deck/render.js` draws `[sound:…]` with a `sound` renderer, here `ui/audio.js`'s play button. The page fetches the clip (one byte range of its pack) and puts it into the frame as a `data:` URL; the frame's second script (`PLAYER`) plays it on the click. So the frame needs nothing from the page, and the sound starts within the click, which browsers require for audio. The button is disabled while its clip loads. The preview never plays by itself, and the word list has no audio.
  - A face never scrolls: its frame takes the face's whole height (plus the frame's borders), and the frame's document hides overflow. When the faces don't fit, the panel scrolls them under its heading and buttons.
  - The sample is the richest of the first 40 notes, and it is kept while it stays in the deck. "Another word" picks a random note.
  - "Reset all" (shown once a language is chosen) asks "Are you sure?" in a small dialog, then removes the saved config (`ankigen:config`), drops the hash from the address and reloads: the defaults, with nothing loaded. The interface language (`?lang=`, `ankigen:lang`) and the feedback client's state stay.
  - Wide screens show front and back side by side in a sticky panel; phones open the preview as a sheet from a bar at the bottom.
- **Word list (the sidebar, `ui/sidebar.js`):** a virtualized list with a fixed row height that renders only the rows in view (13 in the DOM for the 3,341-note English deck).
  - Each row shows the word as the card does (article or gender mark, stress, script) and the translation or definition.
  - Clicking a row makes it the preview sample; its flag button reports a problem with that note.
  - Keyboard: the list is one tab stop (plus the focused row's flag); arrows, Page Up/Down, Home and End move.
  - Wide screens show it under the preview in the sticky column, where the preview takes up to 60% of the height.
- **Search (`deck/search.js`):** the index is built on the first search (about 15 ms for the English deck).
  - A note is found by the word and translation as shown, plus synonyms, readings, romanization (stored, by rule, or kana as romaji) and Serbian in both scripts, all folded like the query.
  - Results come in this order: a whole word, then a word start, then anywhere, in deck order within each. In same-language decks the definitions are searched too, ranked after the words.
- **Mobile:** the list is a sheet opened from the note count in the bottom bar. Picking a word opens the preview over it, and closing the preview returns to the list.

## 9. Feedback client

- **Opening the dialog:**
  - Shortcut: `keydown` Ctrl/Cmd+Enter opens it.
  - Corner button: a fixed ⚑ in the bottom-right.
- **Selection capture:**
  - Listen to `selectionchange` and keep the last non-empty selection with its context: `closest('[data-concept]')`, `[data-field]`, and direction/side from the card container.
  - The page can't read the preview frames (§8), so each frame posts its selection and its Ctrl/Cmd+Enter; the newer of the page's and a frame's selection wins, and a frame that loads a new face drops its old selection. Each frame's body carries the note's concept IDs and word.
  - Capture on `pointerdown` of the corner button (and of the word list's flags), because on mobile tapping clears the selection before `click`.
  - Without a selection, the word list's flags report their note; Ctrl/Cmd+Enter reports the focused list row, if any. After a report is sent, its quote is deselected.
- **A chosen category:** `open(context, { category })` starts the dialog with that category, and with its question in place of the card line (`fb.newLanguage` for `new-language`: the languages page's "Request a language"). The dialog needs only `meta` and `view().config` from the page (`ReportSource`), so `languages-page.js` passes those (the last saved config) instead of an app, which would load the vocabulary.
- **Loading:** the dialog (`ui/feedback-dialog.js`) and `feedback/client.js` load when the browser is idle, or on first use, so they are not part of the initial JS.
- **Request:** `POST` to the Apps Script `/exec` URL with `Content-Type: text/plain;charset=utf-8` (a simple request, so no CORS preflight), body = JSON:

```json
{"clientId":"uuid","clientTime":"ISO","tzOffsetMin":-120,"category":"typo","message":"…","email":"",
 "selectedText":"…","conceptId":"word-water","direction":"forward","side":"back","field":"Examples",
 "learning":"ja","known":"ru","configUrl":"https://…#v1&…","appVersion":"…","dataVersion":"2026.10.17",
 "browserLang":"ru-RU","website":""}
```

  `website` is the honeypot. Read the JSON response `{ok:true}` / `{ok:false,error}`. If reading fails because of CORS, fall back to `mode:'no-cors'` and assume success.
  - Apps Script answers the POST with a 302 to a `script.googleusercontent.com` echo URL. Both responses carry `Access-Control-Allow-Origin: *`, so the answer can be read and the fallback is only a safety net. This was checked on the live `/exec` URL (GET) and with a local mock that redirects the same way (POST).
  - A timeout (20 s) is shown as an error, not retried, so a slow report isn't sent twice.
- **Limits:** client rate limits and garbage heuristics as in SPEC §5, with counters in localStorage (`ankigen:feedback`, together with the client ID). They are friction only.
  - Rate limits: the dialog says how long to wait.
  - Garbage is no letters, a single letter, one short sequence repeated, or the same report again (same folded message, concept and quote). It is sent only after the user confirms with "Send anyway".
  - From the 10th garbage report on, garbage is dropped without asking, and the dialog still says thanks. Real reports are still sent.

## 10. SEO

- `<title>`: "AnkiGen — free Anki vocabulary decks in 15 languages".
- Meta description, canonical URL, Open Graph and Twitter card (with `og-image.png`, 1200×630, rendered from `tools/og-image.html`).
- `<meta name="author">` and `twitter:creator` for the author (`AUTHOR_NAME`, `AUTHOR_URL` in `src/config.js`).
- `<meta name="google-site-verification">` on the app page, for Search Console (`docs/AFTER_LAUNCH.md`).
- JSON-LD `@graph`: the `WebApplication` (free offer, `inLanguage` list, `featureList`, screenshot, license, author), the `WebSite` it is part of, and the author as a `Person` with `sameAs` (X, Patreon, Buy Me a Coffee).
- Semantic headings, `noscript` text describing the tool, `robots.txt`, and `sitemap.xml` (built with the landing pages).
- These static files repeat URLs from `src/config.js` and the language count, because crawlers and link previews run no scripts. `tests/site.test.mjs` checks that they agree with `config.js` and `languages.json`.
- Crawlers read `robots.txt` only at the root of a host. For a project site that is `xenohunter.github.io/robots.txt`, outside this repository, so submit `sitemap.xml` in Google Search Console instead. The file under `/ankigen/` is harmless.
- **Speed:** `index.html` has a `modulepreload` link for every module of the first load (the test checks the list), so the browser fetches them all at once instead of in four rounds. The footer appears only after the first render, so it doesn't jump down while the steps appear.
- **Languages page:** `languages.html` has its own title, description, canonical URL and JSON-LD (a `WebPage` with its `BreadcrumbList` and an `ItemList` of the languages as `Language`), and the list itself in its HTML, in English; `tests/site.test.mjs` checks them against `languages.json` and `fields.json`, its modulepreload links against `src/languages-page.js`, and its footer against `index.html`'s.
- The canonical URL is the bare app address; `?lang=` addresses are the same page in another interface language (§13), not separate pages. Search engines get the languages from the landing pages, which are written in their visitors' languages.
- **Landing pages:** `tools/landing.mjs` makes them from the bundles `tools/bundle.mjs` has just built, so they describe the deck the site serves.
  - `decks/<learning>-for-<known>-speakers/` for each bilingual pair: 210 pages once all 15 languages are complete. Same-language decks get no pages, and a pair without words gets none yet. The slugs come from the English names in `languages.json`, so renaming a language moves its pages.
  - Each page has its own title and description and shows the deck with the app's own code:
    - the word count, and the field rows and deck options the app shows for the pair, with their help texts;
    - every module with words, with the count the module tree shows, up to three sample words and its country-specific words. Samples are the module's own single-meaning words first, never from an 18+ module and never vulgar or offensive.
  - "Build your deck" opens the app with a preset hash (the pair with Core I), and each module opens it with only that module; both in the visitors' interface language (`?lang=<known>`).
  - `decks/` lists the pages by the language you speak. The app's footer and noscript text link to it, and every page links to the other decks for the same speakers and for the same learned language.
  - Plain HTML with the app's stylesheet and no scripts: canonical URL, Open Graph tags, author, and JSON-LD: a `BreadcrumbList`, and on a pair's page a `LearningResource` (flashcards, free, about the learned `Language`, in both languages).
  - The pages for one learned language that are written in their visitors' language name each other with `<link rel="alternate" hreflang>` (the known language's code), with the English speakers' page as `x-default`. A page in English only because its translation is missing names none and is named by none.
  - A page is written in the language its visitors speak. `data/landing/<code>.json` (unit `landing:<code>`, `docs/GENERATION.md`) translates `englishTexts()`: the page texts, module, field and option texts, language names, and per pair the heading, title, description and lede. Counts use the translation's CLDR plural forms. A page uses its translation only when that is complete and made from the current English texts (it records their hash); otherwise it is in English, as English speakers' pages are. `lang` and `og:locale` follow. The hub stays in English, but names each page in that page's language.
  - The footer is the app's, in the page's language from `data/ui` (§13): support links, the decks and the source, the licenses, the author. The landing texts don't repeat it.
  - The footer also links to `languages.html?lang=<the page's language>`.
  - `sitemap.xml` lists the app, `languages.html`, `decks/` and every page.

## 11. Testing

- `node --test` suites:
  - **IDs:** stable, known vectors.
  - **URL codec:** round trip and invalid input.
  - **translit:** tables.
  - **furigana:** parser.
  - **select:** fixtures. Merge рука́ hand/arm when learning Russian; hints for English brother; `only` concepts; glosses.
  - **fields:** snapshots per language for the golden sample.
  - **templates:** reverse rule moves learning fields to the back; type answer only on reverse.
  - **apkg:** build in Node with sql.js, reopen the DB, assert tables, IDs, fields, cards and the zip layout; byte-identical with a fixed clock; another clock changes only timestamps.
  - **audio** (`tests/audio.test.mjs`, on the golden sample's real clips in `tests/fixtures/data/audio/`): voice resolution (exact locale, tier order, unsupported, checked again), the text rules, cache keys, the speech check, packs (determinism, index), fetching by byte range with and without range support, the Audio field, templates (never on the reverse question), the preview's play button, media entries in the .apkg and `tools/apkg.mjs` with `a=1`; the `a` key (`state`), the deck view's clips and Armenian without any (`ui`).
- `tools/lint-data.mjs` on `data/` and on `tests/fixtures/data` in CI.
- **site:** the static files agree with `src/config.js` and the registry; `modulepreload` matches the import graph; the first load stays within its budget.
- **tools:** `tools/apkg.mjs` matches `buildApkg`; the site from `tools/bundle.mjs` loads the same data as the source files, its packs give the very clips of `data/audio`, and its landing pages are the ones the source files give; the build fails above its size limit; `lint-data --gate` passes and fails as it should.
- **landing:** a page for every pair with words, at its slug; unique titles and descriptions; every link resolves, and the app links decode to the page's pair in its visitors' language; module counts match the deck; no 18+ or vulgar samples; the hub and the sitemap list exactly the pages; same data, same pages; hreflang only among pages in their own language; the structured data.
- **i18n:** the language a visitor gets; texts, plurals and numbers per language, and the English fallback; every `data/ui` translation complete and current; the bundle gives the same texts as the source files; the page's address.
- **site** also checks that the texts of `index.html` and `languages.html` are the English of `src/ui/strings.js`, that their early language check knows the interface languages, and the languages page's list.
- Optional Playwright smoke test (Chromium): pick ja ← ru, select Core I, toggle reverse, download, check the blob size is > 0.

## 12. CI/CD

- `ci.yml` (push/PR): Node 22, `node tools/lint-data.mjs`, `node tools/lint-data.mjs --data tests/fixtures/data --meta data/meta`, `node --test`.
- `pages.yml` (push to `master`, or run by hand): lint, tests, the data gate, `node tools/bundle.mjs --site _site` (app + vendor + bundles + audio packs + data/meta + SEO files + landing pages and sitemap), then `actions/upload-pages-artifact` and `actions/deploy-pages`. One-time setup: Settings → Pages → Source: GitHub Actions.
- **Site size:** Pages publishes up to 1 GB. `tools/bundle.mjs` measures the built site and fails above 900 MB (`--limit-mb`), so the deploy stops there; it prints the size on every build. The pronunciation audio is most of it: 241 MB for 14 languages, in a 273 MB site (2026-10-29; §3). Pages also has a soft limit of 100 GB of traffic a month: a full deck with audio is 15–20 MB, so audio downloads are what would reach it first.
- **Data gate:** `node tools/lint-data.mjs --gate` fails unless every active language has an entry for every concept, which is 100% in the `entries` column of `--report`. A failing gate fails the build, so nothing deploys. A manual run can skip it with the input "Deploy even if some languages are incomplete". The site ships only when every language is complete.

## 13. Interface language

The page speaks the 15 languages (SPEC §4). `src/ui/i18n.js` holds the language and turns keys into texts; it has no DOM, so it runs under `node --test`.

- **Texts:**
  - English: `src/ui/strings.js` (`STRINGS`, and `PLURALS` for texts with a number), plus the feedback dialog's own texts in `src/ui/feedback-dialog.js` and the audio option's in `src/ui/audio.js`, which register when their module loads (`addEnglish`), so they stay out of the first load.
  - Translations: `data/ui/<code>.json` has `texts`, `plural` (one form per CLDR plural category of the language, `Intl.PluralRules`) and the two fixed field rows (`fields.word`, `fields.translation`); `data/landing/<code>.json` (§10) gives the module, category, field and option texts and the language names.
  - `t(key, values)`, `plural(key, n, values)` and `number(n)` use the translation, else the English text, key by key: a new English text shows in English until its translations arrive.
  - `{placeholders}` are filled in at run time. A sentence is never assembled from pieces in English order; a text with a number is one whole text per plural category ("{n} words here exist only in…").
- **Which language:** `pickLanguage`: the address's `?lang=`, else the last choice (`localStorage` `ankigen:lang`), else the first of `navigator.languages` the page speaks (by primary subtag: `zh-TW` → `zh`, `sr-Latn` → `sr`), else English. `UI_LANGUAGES` lists them, in the order of the chips; the inline script in `index.html` repeats the rule to hide the English texts (`i18n-pending`) until a translation arrives, so a non-English visitor never sees English first. English visitors see the static text at once.
- **Loading:** the translation loads with the meta files (`getUiTexts`, one bundle `ui-<code>.json` of about 7 KB gzipped), before the first render. Switching loads the new one, then relabels the page in place: focus, scroll, open sections and the search box are kept.
- **Two pages:** `ui/page.js` holds what `main.js` and `languages-page.js` share: the starting language and its texts (`startPage`, with the page's own title and description), the `data-t` / `data-plural` texts, links marked `data-keep-lang` (they carry `?lang=`, so the page they open speaks the same language), and the language menu (`mountMenu`).
- **Live texts** (`ui/dom.js`): `h()` takes `msg(key)` or `live(fn)` for a text node or an attribute; `relabel()` redoes them all after a switch (nodes are held weakly, so removed ones drop out). Texts a part computes in `update()` are redone by the re-render that follows; parts that keep built rows (the field table, the word list) rebuild them when `languageEpoch()` changes. `index.html` marks its texts with `data-t="key"` (a `{placeholder}` keeps its element, marked `data-part`) and `data-plural="key"` (counted by the number of languages).
- **Also switched:** `<html lang>` (the language's tag; Serbian in Cyrillic), the title and the description, number formats and plural rules, the frames' type-the-answer label, and the share text. Card captions don't change: they follow the known language (`labels.json`).
- **The menu** (`ui/locale.js`): a button with the current language's flag and code, and a popover of the languages (two columns, read down) with flags and native names, arrow keys, Home/End, Esc and Tab to leave. Flags are images, `img/flags/<country>.svg` for the `country` of `languages.json`: Windows shows no flag emoji. Simplified where an emblem would not read at 20 px (Spain's and Serbia's civil flags, Portugal's sphere and shield).
- **Checks:** `tools/ui-texts.mjs check` (also in `lint-data`): every English text present and non-empty, the same `{placeholders}`, every plural category with exactly one `{n}`, no HTML, full-width punctuation in Chinese and Japanese, prose not left in English and in the language's script, no unknown keys. Each file records the hash of the English it follows (`source`); when the English changes, lint warns until the translation is updated and stamped again (`tools/ui-texts.mjs stamp <code>`, which also writes it in canonical order). The translations are written by hand (or by Claude Code), not by the API pipeline.
- **Adding an interface language:** a complete `data/ui/<code>.json` (stamped), the language in `UI_LANGUAGES` and in the early check of `index.html` and `languages.html`, its landing translation for the module texts, and a flag if its country is new. A newly active language also goes into `languages.html`'s list (the site test says what to write).
