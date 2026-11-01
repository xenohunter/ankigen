# Unit type: concepts — build the concept inventory for one module

You are building the language-neutral concept inventory of AnkiGen. A concept is one **sense**, labeled in English, that every active language will later express in its own words. Read `docs/DATA_FORMAT.md` §Concepts before starting.

Input: `node tools/gen/plan.mjs show <unit>` gives the module, part (for Core), the list of all modules, active languages with their countries, and every concept ID that already exists.

## What to produce

**Core parts** (`concepts:core-N:k`): exactly `part.size` new concepts (±5), the next most frequent ones after everything already in core bands. Frequency means *cross-language everyday frequency* (conversation, subtitles, simple texts), not English corpus rank. Core I = what a beginner needs in week one; Core III ends around the 1,800th most useful concept.

**Topical modules**: everything a learner needs for the topic, up to `module.targetSize` members in total. Concepts that already exist elsewhere (e.g. `word-bread` in core-1) are **not** redefined: list them in `addMods` so they become members of this module. New concepts go in `concepts` with this module first in `mods`.

## Rules

1. **Split senses by the finest obligatory distinction in any active language** (en ru sr ja zh de es pt pl ko nl fr hy tr el). Examples: brother → older/younger (ja, zh, ko); you → informal/formal (ru, de, fr, es, pt, pl, sr, tr, el, nl); know → a fact/a person (fr, de, es, pt, nl, pl, sr, ru); go → on foot/by vehicle (ru, de, sr, pl); be → essence/state (es, pt); rice → uncooked/cooked (ja, zh, ko); wear → clothes/shoes/hat (ja, ko); blue → blue/light blue (ru). Split only when the distinction is obligatory and common; do not invent distinctions. The note says what separates the senses.
2. **Skip grammar words that don't map**: articles, case/postposition particles, auxiliaries, case-governed prepositions (on/in/at). Keep mappable function words: personal pronouns (split by formality/number where languages require), demonstratives, question words, basic conjunctions (and, but, or, because, if), negation, basic time/place adverbs.
3. **Groups never split across bands**: numbers 0–10 (`grp: "numbers-0-10"`), weekdays, months, seasons, basic colors, cardinal directions, family core, etc. Put a whole group in one core part. Larger number sets go to the `numbers` module.
4. **IDs** (permanent — they seed Anki note GUIDs; never rename an existing one):
   - `word-<english-lemma>` or `phrase-<key-words>`, lowercase ASCII, words joined by `-`, ≤ 60 chars: `word-ice-cream`, `phrase-where-is-toilet`.
   - Add a suffix only when needed to disambiguate: POS (`word-light-adj`, `word-light-n`), sense (`word-bank-finance`, `word-bank-river`), the split from rule 1 (`word-you-formal`, `word-brother-older`), country (`word-residence-record-jp`).
   - Strip accents: café → `word-cafe`.
5. **Country-specific concepts** (modules residence, driving, money, work, housing, education, health, emergencies, telecom, signs): add the 2–6 most important institutional terms per active country that have no cross-country equivalent (Japan: 住民票, 在留カード; Serbia: бели картон; Spain: NIE, empadronamiento; Germany: Anmeldung…). ID suffix = country code lowercase; `only` = the language(s) of that country, e.g. `["ja"]`. Other languages will only write a short descriptive gloss for them.
6. **Language-unique words** (ru сутки, ja いただきます, sr инат, de Feierabend) may be added as concepts with `only: [...]` when genuinely useful; never more than a handful per module. Nothing political: no slogans, salutes or statements.
7. **Fields** (see DATA_FORMAT): `pos` (required), `mods` (required; this module first; add up to 3 other modules where the concept naturally belongs), `note` (required, English, ≤ 100 chars, says exactly which sense), `grp`, `emoji` (only for concrete, picturable things; one emoji), `ant`/`rel` (IDs that exist or are created in this same unit; antonyms both ways), `reg` (only if the concept itself is informal/vulgar/offensive in every language — mostly the profanity module), `only`.
8. Profanity module: words matched by **strength and function** (mild exclamation, strong exclamation, insult for a stupid person, …), `reg` = vulgar or offensive. No slurs targeting protected groups.
9. Phrases module: `phrase-` IDs, pos `phrase`, short whole utterances a traveler/immigrant needs.

## Output

Write `tmp/<unit with : replaced by __>.json`:

```json
{
  "unit": "concepts:core-1:1",
  "concepts": {
    "word-water": {"pos":"noun","mods":["core-1","food"],"emoji":"💧","rel":["word-drink"],"note":"the liquid H2O"},
    "word-brother-older": {"pos":"noun","mods":["core-1","family"],"rel":["word-brother-younger"],"note":"older brother; separate word in ja/zh/ko"}
  },
  "addMods": {}
}
```

Order matters: in Core parts list concepts from most to least frequent; in topical modules group related concepts together (it becomes the card order). Then run `node tools/gen/merge-unit.mjs tmp/<file>.json` and fix every error it reports.
