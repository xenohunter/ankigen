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
  concepts/<module>.json          concept inventory, split by PRIMARY module
  lang/<code>/<module>.json       words, forms, hints, definitions, glosses
  ex/<code>/<module>.json         example sentences (3 slots)
  ipa/<code>/<module>.json        IPA (optional layer)
  etym/<code>/<module>.json       etymology hints (optional layer, deferred)
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
| `rom` | stored romanization: ja (modified Hepburn with macrons), ko (Revised Romanization). Other scripts are romanized by rule at runtime: ru, sr→Latin, hy, el. |
| `mw` | zh measure word / ja counter |
| `hanja` | ko Sino-Korean characters |
| `def` | same-language definition, ≤ 220 chars, never containing the headword. Required for word entries. |
| `gl` | descriptive gloss for concepts this language doesn't own, ≤ ~12 words |
| `st` | `"r"` = reviewed by a human. Absent = draft. (Not shown on cards; the site carries a general disclaimer.) |

Script rules:
- Serbian is stored **Cyrillic only**.
- Greek is monotonic.
- Russian needs U+0301 on every polysyllabic word in `w`, `alt` and `forms` (ё counts as stressed).
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
- Russian: stress marks only inside the `{target}`.
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

- `languages.json` → `active` lists shipped languages in UI order. `deferred` reserves codes (it, ga, gd, sv, …). To activate one, add its full feature block and generate its units.
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
- **Groups and bands:** core-band exclusivity, groups not split across bands.
- **Word entries:** ownership (`w` vs `gl`), script per language, full-width punctuation in Chinese and Japanese text (examples too), Russian stress, gender and article rules, form keys and required forms, readings and romanization formats, collisions → hints, definitions present and not containing the headword.
- **Examples:** slot rules, target braces, targets showing `w` (not an alt), parallel slots having an English source, furigana syntax, pinyin.
- **Optional layers:** IPA charset, etymology syntax.
- **Labels:** completeness.

## 12. Changing data safely

- **Add** concepts by appending to a concept file (or inserting at the right frequency position in a core file). Then generate their entries.
- **Move** a concept to another primary module by moving its line in every layer. Its ID and GUID stay the same, so this is safe. Re-run `--fix`.
- **Never** rename IDs or reuse retired ones.
- After an edit, run lint and bump `meta/version.json`.
