# AnkiGen data format

The vocabulary is **concept-centric**. A *concept* is one sense (`word-bank-finance`, not "bank"), defined once in a language-neutral inventory. Every language — English included — describes the concepts in its own files. A deck for "learning A, speaking B" pairs A's entry and B's entry for the same concept ID, so there are no pairwise translation tables. 15 languages need 15 file sets, not 210 pair files.

The validator is `tools/lint-data.mjs`, and `tools/lib/data.mjs` holds the rules. When this document and the code disagree, the code wins. Fix whichever one is wrong.

## 1. Layout

```
data/
  meta/
    languages.json   language registry (active, deferred, features, form keys)
    modules.json     module tree (meta-categories → modules), canonical order
    fields.json      card field table + deck options (UI step 4–5)
    labels.json      card captions per known language
    version.json     data version (shown in footer, sent with reports)
    retired.json     IDs that must never be reused
    audio.json       pronunciation voices and text rules per language (§13)
  concepts/<module>.json          concept inventory, split by PRIMARY module
  lang/<code>/<module>.json       words, forms, hints, definitions, glosses
  ex/<code>/<module>.json         example sentences (3 slots)
  ipa/<code>/<module>.json        IPA (optional layer)
  etym/<code>/<module>.json       etymology hints (optional layer, deferred)
  audio/<code>/manifest.json      pronunciation clips: which word says what, in which file (§13)
  audio/<code>/<hash>.mp3         the clips (written only by tools/audio.mjs)
```

Every layer file for `<module>` contains only concepts whose **primary module** (the first entry of `mods`) is `<module>`. A concept cross-listed in other modules lives in exactly one file per layer.

Optional layers (`ipa`, `etym`) and any missing file or entry must be handled gracefully by the app. Missing content means "not shown", never an error.

## 2. Canonical file format

Data files are a single JSON object with **one entry per line** and compact values:

```
{
"word-water": {"pos":"noun","mods":["core-1","food"],"emoji":"💧","note":"the liquid H2O"},
"word-eat": {"pos":"verb","mods":["core-1","food"],"note":"to consume food"}
}
```

- Concept files keep their own order, which is meaningful. Core files are ordered by frequency, topical files by theme. This becomes the card order.
- Layer files are ordered like the concept inventory.
- `node tools/lint-data.mjs --fix` rewrites everything into canonical form. Non-canonical files are lint errors. This keeps diffs at one line per changed entry.
- UTF-8, NFC (Russian stress marks are combining U+0301 and stay decomposed by nature).

## 3. IDs

- Format: `^(word|phrase)-[a-z0-9]+(-[a-z0-9]+)*$`, at most 60 chars, derived from the English lemma: `word-ice-cream`, `phrase-where-is-toilet`.
- Suffixes are used only to disambiguate:
  - part of speech: `word-light-adj`
  - sense: `word-bank-river`
  - obligatory split: `word-you-formal`, `word-brother-older`
  - country: `word-residence-record-jp`
- **IDs are permanent.** Each one seeds the Anki note GUID, so renaming an ID makes users lose their review history. To remove a concept, delete it from every layer and add the ID to `meta/retired.json`. A retired ID can never be used again.
- `word-` vs `phrase-` is the only kind marker in an ID. Whether English has a word for a concept is *not* encoded in the ID; that is what `only` is for.

## 4. Concepts (`concepts/<module>.json`)

| key | req | meaning |
|---|---|---|
| `pos` | ✓ | noun, verb, adj, adv, pron, num, prep, conj, interj, particle, det, phrase (`phrase-` IDs ⇔ `phrase`) |
| `mods` | ✓ | module IDs; first = primary (= file). At most one core band (`core-1/2/3`). |
| `note` | ✓ | English sense note for authors, ≤ 200 chars (aim ≤ 100). Never shown on cards. |
| `grp` |  | group ID (`weekdays`, `numbers-0-10`). **All members of a group share the same core band.** |
| `emoji` |  | one emoji for concrete, picturable concepts |
| `ant` / `rel` |  | antonym / related concept IDs (rendered in the learned language; antonyms should be reciprocal) |
| `reg` |  | informal, formal, vulgar, offensive — when the concept itself carries that register |
| `only` |  | languages that own this concept (country-specific institutions, untranslatable words). Other languages give a gloss. |

Core bands are modules `core-1/2/3`. A concept's band is its core module. Topical modules include core concepts by listing the module in their `mods` (e.g. `word-bread`: `["core-1","food"]`). So selecting only "Food & drinks" still yields bread.

## 5. Language entries (`lang/<code>/<module>.json`)

An entry is either a **word entry** (the language owns the concept, i.e. it has no `only` or `only` includes the language) or a **gloss entry** (`{"gl": "…"}` for concepts owned by other languages).

| key | meaning |
|---|---|
| `w` | the word or phrase, dictionary form, no article. Required for word entries. |
| `alt` | up to 3 interchangeable synonyms |
| `g` | gender code from `languages.json` (`gender.values`). Required for nouns in gendered languages. |
| `art` | explicit article when the rule-based one is wrong: fr `l'`/`le`/`la` before vowel/h (required there), es `el` for stressed a- feminine |
| `forms` | key forms; allowed and required keys per language and POS are in `languages.json` → `forms`. Enum values: `aspect` ipf\|pf\|bi, `class` godan\|ichidan\|suru\|kuru, `type` i\|na, `aux` avoir\|être. |
| `hint` | 1–3 words in this language that tell this concept apart from another concept with the same `w`. **Required** (and must differ) whenever two entries share `w`. No parentheses; the app adds them. |
| `read` | ja kana reading (required if `w` has kanji); zh pinyin with tone marks (required) |
| `rom` | stored romanization: ja (modified Hepburn with macrons), ko (Revised Romanization), ar (ALA-LC style, as pronounced: kitāb, ash-shams). Other scripts are romanized by rule at runtime: ru, uk, sr→Latin, hy, el. |
| `mw` | zh measure word / ja counter / vi classifier (a Vietnamese word: con, cái, quyển) |
| `hanja` | ko Sino-Korean characters |
| `def` | same-language definition, ≤ 220 chars, never containing the headword. Required for word entries. |
| `gl` | descriptive gloss for concepts this language doesn't own, ≤ ~12 words |
| `st` | `"r"` = reviewed by a human. Absent = draft. (Not shown on cards; the site carries a general disclaimer.) |

Script rules:
- Serbian is stored **Cyrillic only**.
- Greek is monotonic.
- Russian and Ukrainian need U+0301 on every polysyllabic word in `w`, `alt` and `forms` (in Russian, ё counts as stressed). Ukrainian never uses ы э ё ъ.
- Arabic `w`, `alt` and `forms` are fully vowelized (harakat), in the citation form without case endings; `hint`, `def`, `gl` and example sentences are not, except an example's `{target}`. Arabic text takes ، ؛ ؟, never ASCII , ; ?. A bound suffix is written with the tatweel: ـِي "my". Where Arabic is the known language its vowel marks are not shown, so two words that differ only in them need hints.
- Irish writes only acute accents (á), Scottish Gaelic only grave ones (à, the Gaelic Orthographic Conventions); Hungarian writes ő ű, never õ û.
- No word or form contains * _ # @ $ % ^ & = + < > { } [ ] | \ ~ or `.
- The language guides in `tools/gen/prompts/languages.md` give the full per-language conventions.

## 6. Examples (`ex/<code>/<module>.json`)

```
"word-water": [{"t":"Можно мне стакан {воды́}, пожалуйста?"},{"t":"…"},{"t":"…","p":0}]
```

- Up to 3 slots (target: exactly 3). `t` marks the target form with **exactly one** `{…}`.
- The target is a form of the entry's `w`, inflected as the sentence needs, **never an `alt`**: the card teaches `w`. Lint warns when a target is closer to an alt than to `w` or its forms, and when a Chinese target lacks the characters of `w` (`exfix` units fix those, GENERATION.md).
- **Slot-parallel design**: English slot k is the source sentence. Another language's slot k is a translation of it (`p` omitted) or, when a natural translation would not contain the word, an independent sentence (`"p": 0`). In a deck A→B, the translation shown under A's slot k is B's slot k, but only when both are parallel. Slots never pair across indices.
- Japanese `t` uses Anki-style furigana: `私[わたし]は 水[みず]を 飲[の]みます`. A space goes before a kanji run that follows other text; the renderer removes it. The target wraps the annotated form: `{食[た]べます}`.
- Chinese adds `r`: the pinyin of the whole sentence (tone marks, ASCII punctuation, no braces).
- Russian and Ukrainian: stress marks only inside the `{target}`.
- Arabic: vowel marks only inside the `{target}`, which takes the whole written word, with an article or preposition attached to it: `شربت {الْمَاءَ} البارد.`
- Irish and Scottish Gaelic: the target is the word as the sentence has it, initial mutation included (`an {bhean}`).
- Examples exist only for word entries, not glosses.

## 7. IPA (`ipa/<code>/<module>.json`)

`"word-water": "vɐˈda"`. A string, no slashes or brackets. Only for languages with `ipa: true` (all but zh, ja).

## 8. Etymology (`etym/<code>/<module>.json`) — deferred content, supported structure

A one-line, language-neutral schematic:
- chains use Wiktionary language codes: `ine-pro:*wódr̥ → sla-pro:*voda → ru:вода`
- compounds use `+`: `de:Hand + de:Schuh`
- CJK uses character composition: `明 = 日 + 月`

No prose and no glosses, so it never needs translating. Lint warns on anything that doesn't parse. Max 140 chars.

## 9. Collisions and merging (semantics the app implements)

- **Known-language side** (translations shown to the user): entries that share `w` must carry distinct hints. These are shown as "brother (older)".
- **Learning-language side** (the word being learned): concepts whose entries in the learned language are identical (same `w`, `g`, `art`, `read`, `forms`, POS) are **merged into one note**, e.g. "рука́ → hand; arm".
  - The merge set is computed over the *whole* inventory of that language, not the current selection.
  - The note GUID derives from the first member in canonical order, so adding modules later never changes a note's identity.
  - If entries share `w` but differ in POS, gender, reading or forms, they stay separate notes. The front then shows a disambiguator: the POS label, or else the gender, or else the first differing form, or else the hint.

## 10. Languages, variants, deferred languages

- `languages.json` → `active` lists shipped languages in UI order, the order of `groups`. `staged` languages have full feature blocks and generation units, but the page, the landing pages, the bundles and the deploy gate leave them out until they move to `active` (GENERATION.md §9). `deferred` reserves codes without feature blocks.
- `groups` (the chips' groups, SPEC §1): `[{ id, languages }]`, every active and staged language in one. Each language has `speakers` (millions, L1 + L2). Lint checks the order: the group with English first, then by the sum of their speakers, `other` last; within a group by speakers; `active` in that order.
- A language of no one country has `"country": null` and a `flag` (the image `img/flags/<flag>.svg`: Arabic's is `arab-league`). `dir: "rtl"` marks a right-to-left script; `vowels: true` the short-vowel marks the Vowel marks row hides (Arabic).
- `tts`: the language's Google Cloud Text-to-Speech locale (`en-US`, `cmn-CN` for Mandarin), used only for the pronunciation audio (§13). `locale` stays the BCP 47 tag the cards and the page use. Lint warns when an active language has none.
- Regional variants (pt-BR, es-MX, en-GB…) are separate registry entries with `"extends": "<base code>"` and their own files under `lang/<variant>/` containing **only entries that differ**. Missing entries and fields fall back to the base language. They appear as separate choices in the UI.

## 11. Commands

```
node tools/lint-data.mjs                 # errors only, exit 1 on error
node tools/lint-data.mjs --warnings      # also list warnings
node tools/lint-data.mjs --report        # coverage per language + module sizes
node tools/lint-data.mjs --fix           # canonical formatting/order
node tools/lint-data.mjs --filter lang/ru/   # restrict output
node tools/lint-data.mjs --data tests/fixtures/data --meta data/meta   # lint the golden sample
```

What lint checks:
- **Structure:** JSON validity, canonical format, allowed keys, enums.
- **IDs:** ID syntax, uniqueness, retired IDs, references (`mods`, `ant`, `rel`, `only`), entries in the right file.
- **Registry:** feature blocks of active and staged languages, the chips' `groups` and their order by speakers (§10).
- **Groups and bands:** core-band exclusivity, groups not split across bands.
- **Word entries:** ownership (`w` vs `gl`), script per language, full-width punctuation in Chinese and Japanese text (examples too), Russian and Ukrainian stress, Arabic vowel marks and punctuation, each language's spelling slips (Russian letters in Ukrainian, a grave accent in Irish, an acute in Scottish Gaelic, õ û in Hungarian; not in glosses, which quote the foreign term they explain), stray symbols, gender and article rules (French and Italian articles before a vowel, Italian lo/gli), form keys and required forms, readings and romanization formats, collisions → hints, definitions present and not containing the headword.
- **Examples:** slot rules, target braces, targets showing `w` (not an alt; an Arabic article and a Celtic initial mutation are not part of the word), Arabic targets with vowel marks, parallel slots having an English source, furigana syntax, pinyin.
- **Optional layers:** IPA charset, etymology syntax.
- **Labels:** completeness.
- **Audio** (never an error for coverage): an active language without a `tts` locale, words without a current clip, missing or unused clip files (warnings); a malformed `meta/audio.json` (errors).

## 12. Changing data safely

- **Add** concepts by appending to a concept file (or inserting at the right frequency position in a core file). Then generate their entries.
- **Move** a concept to another primary module by moving its line in every layer. Its ID and GUID stay the same, so this is safe. Re-run `--fix`.
- **Never** rename IDs or reuse retired ones.
- After an edit, run lint and bump `meta/version.json`.
- A changed word keeps its old clip until `node tools/audio.mjs run` makes the new one; the site leaves the old one out meanwhile (§13).

## 13. Pronunciation audio (`meta/audio.json`, `audio/<code>/`)

Written by `tools/audio.mjs` (GENERATION.md §7); `audio.json` may also be edited by hand.

`meta/audio.json`, one language per line, in registry order:

```
"de": {"locale":"de-DE","voice":"de-DE-Chirp3-HD-Kore","tier":"chirp3-hd","format":"mp3","text":{"article":true}},
"hy": {"locale":"hy-AM","unsupported":true}
```

- `locale` is the `tts` locale the voice was resolved for; `voice` a Google voice of that locale; `tier` `chirp3-hd`, `neural2` or `wavenet`; `format` `mp3`.
- `unsupported`: Google has no voice of those tiers for the locale. Every run checks again.
- `text`, the rules for what is said (set from the registry when the voice is resolved):
  - `article: true`: the article the card shows with default settings (`das Wasser`, `l'eau`); a noun of either gender gets both (`el estudiante, la estudiante`). Languages whose Gender / article row shows an article.
  - `stress`: Russian and Ukrainian keep their stress marks when `true`; `false` (the default) strips them. Words that differ only in stress then share a clip. The pilot of 2026-10-30 chose `false` for Russian: the voice handled the marks badly.
  - Arabic is said with its vowel marks, as stored: they tell the voice how to read the word.
  - `homographs`: for a word another entry spells the same way with another reading: `"reading"` says the reading (Japanese kana); `"pinyin"` wraps the word in an SSML pinyin phoneme, tone numbers (Chinese).
  - Always: Serbian in its stored Cyrillic; a slash reads as a list (`Pan/Pani` → `Pan, Pani`); the hyphen of a suffix or prefix is not said (`-den` → `den`).

`audio/<code>/manifest.json`, one entry per line in canonical concept order (like a layer file):

```
"word-water": {"file":"b10258a01162bfb2.mp3","text":"das Wasser","voice":"de-DE-Chirp3-HD-Kore","bytes":6432},
"word-yes": {"file":"a3e608a53da16c8c.mp3","text":"tak","voice":"pl-PL-Chirp3-HD-Kore","bytes":3936,"sent":"Tak."},
```

- `file` is named by the first 16 hex digits of the SHA-256 of its bytes, so a name never stands for two recordings (Anki matches media by name). In Anki the clip is `ankigen-<code>-<hash>.mp3`.
- `text` is what was synthesized (SSML for a pinyin phoneme); `sent` only when a retry used another form of it (capitalized with a full stop). Identical texts share one file across concepts; merged notes say the same word, so they get one clip.
- `bytes` is the file's size (the page's Download summary adds them up).
- A clip is current when its `text` is the word's current text; the site serves only current clips, in any voice.
- Gloss entries (concepts a language doesn't own) get no clip. Retired concepts drop out at the next run; `node tools/audio.mjs prune` then deletes the files no manifest uses.
