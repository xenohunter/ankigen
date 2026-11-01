# Unit type: local — the own concepts of a language added after the inventory was built

The concept inventory (`concepts` units) was built for the first languages: each of them got a few concepts of its own, with `only` naming it, that other languages only gloss. A language added later gets its own the same way, in one unit. Read `docs/DATA_FORMAT.md` §Concepts and the `concepts` instructions' rules 4–7 (IDs, country-specific concepts, language-unique words, fields): they apply here.

Input: `node tools/gen/plan.mjs show local:<code>` gives the language and its country (`GB-SCT` is Scotland, which shares the United Kingdom's institutions), the topical modules, `otherLanguagesOwn` (every existing concept with `only`, grouped by its owners: follow their kind, number and style), and every concept ID that exists.

## What to produce

1. **Country-specific concepts**: the 3–6 most important institutional terms of the country that a newcomer meets and that have no cross-country equivalent: the personal or tax ID number, the residence permit or card, the registration of an address, the immigration office, the car inspection, the health card. ID suffix = the country code, lower case (`word-codice-fiscale-it`, `word-personnummer-se`, `word-national-insurance-number-uk` for Scotland); `only` = this language. Put each in the module where the others' are (mostly `residence`, then `driving`, `housing`, `money`, `health`, `telecom`).
2. **Language-unique words**: 0–3 words or phrases of this language with no exact equivalent elsewhere that learners are glad to know (Swedish lagom, fika; Irish craic), as for de Feierabend, pt saudade, ja いただきます. No ID suffix; `only` = this language; in the module where the word belongs (`feelings`, `food`, `phrases`, `work`, `time`). Skip this when nothing is genuinely useful. Nothing political: no slogans, salutes or statements.

Never add a concept that exists already (check `existingConceptIds`): a generic sense belongs to every language, not to this one. Never put a new concept into a core module. If a concept of another language also exists in this one (its country has the same institution under its own name), leave it: its `only` stays as it is.

## Output

Write `tmp/local__<code>.json`:

```json
{
  "unit": "local:it",
  "concepts": {
    "word-codice-fiscale-it": {"pos":"noun","mods":["residence","money"],"note":"Italian tax code, the personal ID number for taxes, health care and contracts","only":["it"]}
  }
}
```

Each concept is appended to the file of its first module. Then run `node tools/gen/merge-unit.mjs tmp/local__<code>.json` and fix every error it reports.
