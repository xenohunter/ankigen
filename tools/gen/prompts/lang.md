# Unit type: lang — write one language's entries and examples for a slice of concepts

Read `docs/DATA_FORMAT.md` §Language entries and §Examples, and the section for your language in `tools/gen/prompts/languages.md`. Look at the golden sample in `tests/fixtures/data/` (en, ru, ja, de, sr) — match its style and density.

Input: `node tools/gen/plan.mjs show <unit>` gives the language block (variant, gender values, allowed form keys) and the slice: up to 100 concepts with `pos`, `note`, `owned`, and for non-English units the English entry (`en`) and English example sentences (`enExamples`). If `current` is present, an entry already exists: improve it only if wrong.

## Entries (`lang`)

Translate the **concept** (its `note`), not the English word.

- **Owned concepts** (`owned: true`): a full entry.
  - `w`: the most common, neutral, standard word or phrase for this sense in the language variant (see languages.md). Dictionary form. Nouns without article (gender goes in `g`).
  - `alt`: up to 3 genuinely interchangeable synonyms in common use. Not hypernyms, not rare words. Omit if none.
  - `g`, `art`, `forms`, `read`, `rom`, `mw`, `hanja`: as defined for your language. Required forms are required; give optional forms when they help a learner (irregular, stress shift, consonant change).
  - `hint`: required only when two concepts in this language get the same `w` (e.g. ru рука = hand and arm; en brother = older and younger). 1–3 words in this language, no parentheses, different for each colliding concept. If the collision is with an entry outside this slice, add a hint to that entry via `patch`.
  - `def`: a same-language definition for the "Same language" mode. Simple words, ≤ 20 words / ≤ 200 chars, must not contain the headword or an obvious derivative. For phrases: when and why it is said.
- **Not owned** (`owned: false`, concept is specific to another language/country): only `{"gl": "…"}` — a short descriptive gloss in this language (≤ 12 words), e.g. `"jūminhyō: Japanese certificate of registered address"`.

## Examples (`ex`) — owned concepts only, exactly 3 slots

**English units** (English examples are the source for all languages):
- Natural everyday sentences, A2–B1 level, 4–12 words, each slot showing a different typical use or collocation.
- Easy to translate literally: no idioms, puns, wordplay, slang, brand names, or culture-specific references. Common first names are fine.
- Mark the target word form with braces exactly once: `"I {ate} too much."`. It is a form of `w`, never an `alt`.

**Other languages** — slot k is a translation of English slot k:
- The target is always a form of `w`: the card teaches `w`, and an `alt` in bold would teach another word.
- Translate naturally. If your natural translation contains a form of `w`, mark that form with `{…}` and omit `p`.
- If a natural translation would **not** contain the word, write your own natural sentence of similar length and difficulty for that slot and add `"p": 0`. Never distort a translation to force the word in.
- Language-specific notation (furigana, pinyin, stress, script) is in languages.md.

## Output

Write `tmp/<unit with : replaced by __>.json`:

```json
{
  "unit": "lang:ru:core-1:1",
  "lang": {
    "word-water": {"w":"вода́","g":"f","forms":{"gen":"воды́","pl":"во́ды"},"def":"Прозрачная жидкость без цвета и запаха, из которой состоят реки, озёра и моря."},
    "word-residence-record-jp": {"gl":"дзюминхё: японская справка о зарегистрированном месте жительства"}
  },
  "ex": {
    "word-water": [{"t":"Можно мне стакан {воды́}, пожалуйста?"},{"t":"{Вода́} в этом озере очень холодная."},{"t":"Растениям нужны {вода́} и солнечный свет."}]
  },
  "patch": {}
}
```

Every concept of the slice must appear in `lang`; every owned concept in `ex`. Then run `node tools/gen/merge-unit.mjs tmp/<file>.json` and fix every error (warnings: fix if cheap). Work through the slice in chunks of ~25 concepts if that helps you stay accurate, appending to the same output file.
