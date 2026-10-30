# AnkiGen: product specification

A free single-page web app on GitHub Pages that builds Anki decks (`.apkg`) entirely in the browser from curated vocabulary data. Output is **deterministic**: the same configuration and data version always give the same notes with the same IDs. Re-importing an updated deck updates existing cards and keeps review history.

Repo: https://github.com/xenohunter/ankigen (branch `master`). Site: https://xenohunter.github.io/ankigen/. Support links: https://www.patreon.com/cw/blisstweeting, https://buymeacoffee.com/blisstweeting

## 1. Languages

- **Active (15):**

  | Language | Variant |
  |---|---|
  | English | US |
  | Russian | |
  | Serbian | ekavian; stored in Cyrillic, Latin derived |
  | Japanese | |
  | Chinese | Mandarin, Simplified, mainland |
  | German | Germany |
  | Spanish | Spain |
  | Portuguese | Portugal |
  | Polish | |
  | Korean | South Korea |
  | Dutch | Netherlands |
  | French | France |
  | Armenian | Eastern, reformed orthography |
  | Turkish | Turkey |
  | Greek | modern, monotonic |

- **Deferred** (codes reserved, added later): Italian, Irish, Scottish Gaelic, Swedish, and more to come.
- **Regional variants** (pt-BR, es-MX, en-GB, …) are added later as separate dropdown entries backed by override files (`extends`).
- **Modes:**
  - Bilingual: *I'm learning* X, *I speak* Y.
  - **Same language**: X → short definitions in X.

## 2. Modules (tree, collapsible meta-categories)

- **Foundations** (open by default): Core I (500), Core II (500), Core III (800), Numbers & math, Time & calendar
- **Communication:** Survival phrases, Countries/nationalities/languages, Language learning
- **Daily life:** Family & relationships, Feelings & character, Food & drinks, Cooking & kitchen, Shopping & clothing, Housing & renting, Household & repair, Weather & nature, Pets & animals
- **Getting around:** City & directions, Transport & travel, Driving & road rules, Signs & notices
- **Living abroad:** Residence & legalization, Money & banking, Work & employment, Post/phone/internet, Education
- **Health & safety:** Health & medicine, Emergencies
- **Interests:** Hobbies, Sports, Music, Video games, Tabletop games, Tech & computers, Science
- **18+:** Profanity (visible, marked 18+). There is no slang module.

How modules behave:
- Concepts can belong to several modules. They are deduplicated in the deck.
- Core bands are mutually exclusive, and word groups (numbers 0–10, weekdays, months…) never split across bands.
- Country-specific modules (residence, driving, …) contain generic concepts plus country-specific terms for each language's country. Those terms appear only when learning that language, with a descriptive gloss on the other side.
- Sizes and descriptions: `data/meta/modules.json`.

## 3. Cards

### Directions
- **Forward:** learned word → translation (or definition).
- **Reverse** (optional): translation → learned word.
  - On reverse cards **every field about the learned word moves to the answer side**. Only the translation with its hint, plus concept-level fields the user placed on the front (part of speech, register, emoji), stay on the question side.
- **Type the answer** (optional, only when reverse cards are on): the user types the learned word on reverse cards. The answer is compared with a clean field: main form, no hint, no stress marks, articles included for German and Dutch, CJK in native script. Forward cards never use typing.

### Field table (step 4)
Each row is Off / Front / Back (some rows have fewer choices). Defaults are in `data/meta/fields.json`. Rows are shown only when relevant to the chosen language:

| Field | Default | Languages / notes |
|---|---|---|
| Word | Front (fixed) | |
| Translation | Back (fixed) | "Definition" in same-language mode; includes hint and synonyms |
| Gender / article | With the word | de nl fr es pt el ru sr pl |
| Stress marks | On | ru |
| Reading (furigana) | Back | ja |
| Romanization | Back | ja zh ko hy el; ru default Off |
| Other script | Off | sr |
| Measure word / counter | Back | zh ja |
| Hanja | Back | ko |
| Key forms | Back | |
| IPA | Back | all but zh ja |
| Examples | Back | slider 0–3, default 2 |
| Example translations | Back | bilingual mode only |
| Antonyms & related | Off | under "More…" |
| Part of speech | Off | under "More…" |
| Register | Off | under "More…" |
| Emoji | Off | under "More…" |
| Concept ID | Off | under "More…"; with a "?" popup explaining it is for error reports |

- **More…:** the last five rows are in a section that is closed until the user opens it, or until one of them is on (from a link). Closed, it names the rows that are on.

- **Deck options:** Reverse cards (off), Type the answer (off; needs reverse), Serbian script (Cyrillic/Latin; shown when Serbian is on either side), Pronunciation audio (off; see below).
- No color coding, no listening or cloze cards (explicitly out of scope).

### Pronunciation audio (prototype)
The most experimental part of the app, and labelled as such.
- **What:** one machine-made clip per learned word: its main form as the card shows it with default settings. That is the article where the Gender / article row shows one (das Wasser, l'eau; a noun of either gender gets both: el estudiante, la estudiante), Russian without stress marks, Serbian in its stored Cyrillic, a Japanese word as its kana reading when another word is spelled the same with another reading, and such a Chinese word with an SSML pinyin phoneme. Merged notes share one clip. No examples, translations or definitions.
- **Voices:** Google Cloud Text-to-Speech only, for the language's exact locale (never a sibling such as pt-BR for pt-PT): a Chirp 3 HD voice (Kore, female, wherever it exists), else Neural2, else WaveNet, else no audio. Today: Chirp 3 HD for 13 languages, WaveNet for Portuguese, none for Armenian.
- **On cards:** the clip plays on the front of forward cards and on the back of reverse cards, never on the reverse question; the forward answer doesn't play it again.
- **Page:** only when the learned language has audio, the Card options block ends with a line, the "Pronunciation audio" toggle and, always in sight, a muted warning: the most experimental, prototype part of the app; clips are machine-generated and unchecked; stress, readings and accent may be wrong; don't rely on them; native speakers who find them poor are asked to tell us with the Feedback button, and a language's audio is taken down if needed. Its "?" says it covers words only, that the voices are Google Cloud Text-to-Speech's, and how to remove the files (Tools → Check Media). For other languages the block ends as before.
- While the toggle is on, a light warning frame under it tells people who imported an AnkiGen deck before audio was added to tick "Merge note types" the first time they import an update (§6).
- The choice is `a=1` in the link. It survives switching languages, but is written only for a learned language with audio. With audio on, the Download summary shows the extra size, a download fetches the clips with a progress line, and the preview shows a small play button.
- Audio coverage is not part of the deploy gate: a word without a clip simply has none.

## 4. Page flow and UI

Minimal, clean, fast. Card captions use the language the user speaks, via `labels.json`.

**Interface language:** the page is in any of the 15 languages, chosen with a menu in the header's top-right corner: the current language's flag and code, opening a list of the languages with their flags and native names. A flag is the language's country in `languages.json`, drawn as an image (Windows shows no flag emoji). Choosing one switches every text at once, without a reload.
- The language is in the address (`?lang=ru`), so a shared link opens in it. Without one, the page takes the visitor's last choice, else the browser's language when the page speaks it, else English.
- Module, field and option texts and the language names come from the landing pages' translations (`data/landing`); the page's own texts are in `data/ui`. A text a translation lacks is shown in English.

1. **Title + short description**, plus a one-line disclaimer: vocabulary is machine-drafted and partly unreviewed, and feedback is welcome. Top right, beside the interface language: "Support this project:" with Patreon and Buy Me a Coffee (as in the footer, but outlined in orange there).
2. **I'm learning:** language chips with native names (Српски, 日本語, Հայերեն) and the names in the interface language as tooltips.
3. **I speak:** first a **Same language** button on a row of its own, with "— word definitions" in muted text (the interface language's clearest phrase: ru «толковый словарь»), set apart from the language chips below by a thin line.
4. **Modules:** a tree with expand/collapse and checkboxes at module and category level, a selected count, and an 18+ badge on Profanity.
5. **Card fields:** the field table and examples slider; the rarely used rows under "More…" (§3).
6. **Reverse cards / Type the answer** toggles, and the Pronunciation audio toggle where the learned language has audio (§3).
7. **Download:** summary plus the button.
8. **Share** (no number, no card background), with Download. First row: "Copy link" (the page's address: the deck and the interface language) and the system share sheet where the browser has one. Second row: X, Facebook, Reddit, Telegram, WhatsApp, VK (Russian interface), LINE (Japanese), Weibo (Chinese), Bluesky and email.

How the steps behave:
- Each step's block appears once the previous step has a choice.
- Steps stay editable; changing an earlier step never resets later choices unless they become invalid.
- "?" popups explain non-obvious controls: modules with country-specific terms, 18+, each field row, reverse cards, type the answer, Serbian script, pronunciation audio, concept ID, the draft disclaimer, and how to re-import updates. Same-language mode is explained by its note, and in full by its tooltip.
- After the first download, the header's support links are sticky: while their place is out of view they slide down from the top edge of the window and stay there.

Always-visible elements:
- **Live counter:** "1,734 notes · 3,468 cards".
- **Live preview:** up to 4 rendered card faces (forward front/back, reverse front/back when reverse is on), using a sample concept. A "random sample" button cycles samples. Clicking a card in the sidebar makes it the sample. Beside it, "Reset all" asks "Are you sure?" and then starts over: default settings, no language chosen, nothing saved (the interface language stays).
- **Cards sidebar:** every note of the would-be deck in a virtualized list, with a search box. Search ignores case, diacritics and stress, matches Serbian in both scripts, and finds Japanese/Chinese/Korean words by romanization. Each card has a "report" action. On mobile the sidebar becomes a drawer.
- **Shareable state:** the full configuration lives in the URL hash, so a link reproduces the exact deck. The last configuration is also remembered locally.
- **Footer:**
  - "Support this project:" with two buttons, Patreon and Buy Me a Coffee;
  - links to the decks by language pair, the supported languages and the GitHub repo;
  - the licenses;
  - "Created by Phil Filippak", the name linking to https://x.com/blisstweeting.

**Supported languages** (`languages.html`, linked from the footer): the languages, each with its flag, native name, name in the interface language, the field rows only some languages have ("Cards can also show: Reading (furigana) · Romanization · …") and "Build a deck", which opens the app with it as the learned language. Below: "Missing a language?" with **Request a language**, which opens the feedback dialog with the category New language chosen and a question in place of the card line ("Which language would you like to see here? Tell us which language you speak, too."). Same header language menu, footer and Feedback button as the app.

## 5. Feedback and error reports

- **Opening the dialog:** Ctrl/Cmd+Enter (with or without selected text), or a small fixed button in a screen corner (the only way on phones). If text is selected inside a card, the dialog quotes it and records which card and field it came from.
- **Dialog fields:**
  - Message (required; prefilled with the quote).
  - Email (optional; "If you want us to get back to you, leave your email").
  - Category (optional): Wrong translation / Typo / Wrong form / Bad example / New language / Suggestion / Other.
  - Hidden honeypot field.
  - One-line privacy note.
- **Attached automatically:**
  - client timestamp and timezone;
  - random client ID (generated once, kept in localStorage; **no fingerprinting**);
  - config URL, app version, data version;
  - concept ID, card direction, side and field of the selection;
  - the selected text;
  - browser language.
- **Backend:** a Google Apps Script web app bound to a Google Sheet (`feedback/Code.gs`, setup in `docs/FEEDBACK.md`). The server adds the received timestamp.
- **Client limits** (overridable, just friction):
  - ≥ 15 s between sends, ≤ 5 per 10 min, ≤ 20 per day;
  - "garbage" detection (too short, no letters, repeated characters, duplicates);
  - from the 10th garbage message on, the client silently stops sending garbage but still says "Thanks"; real reports are still sent.
- **Server limits:**
  - payload ≤ 8 KB, schema check, honeypot;
  - ≤ 30 reports per client ID per rolling 6 h;
  - **≤ 2,000 rows per day globally**;
  - formula-injection guard on every cell.

## 6. Anki output

- `.apkg` built in the browser (sql.js + zip). Media only with pronunciation audio: the clips, named `ankigen-<lang>-<content hash>.mp3`, so a name never stands for two recordings and a re-import never duplicates one.
- **One deck per language pair:** `AnkiGen::<Learning> (<Known>)`. Deck, note type and note IDs come from stable hashes, so importing more modules later adds to the same deck, and re-downloading updates notes.
- **Note order:** canonical order (module tree order, then file order).
- **Module membership** goes into hierarchical tags: `ankigen::<category>::<module>`.
- The **note type** has a fixed field list. Templates depend on the configuration. Fields the user switched off are left empty.
  - On 2026-10-28 the `Audio` field was appended (20 fields). The site was already reachable then, so a deck downloaded before that needs "Merge note types" ticked once when the next download is imported; otherwise Anki skips its notes as conflicting.

## 7. Data

- See `docs/DATA_FORMAT.md`. The data is concept-centric, with per-language layer files, permanent IDs, a linter, and a golden sample in `tests/fixtures/data`.
- Data is generated in resumable units (`docs/GENERATION.md`). The site deploys once all 15 languages are complete. IPA comes last. Pronunciation audio is made from the finished words by its own tool (`docs/GENERATION.md` §7) and never holds up a deploy. Etymology is dropped for now: the note type keeps an empty Etymology field, so it can come back without changing the note type.

## 8. Non-goals (for now)

Audio beyond the word itself (examples, translations, listening cards), images, user accounts, server-side generation, translations of example sentences beyond the slot-parallel scheme, slang, analytics.
