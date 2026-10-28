# Generating the vocabulary data

The data is written by Claude in **units**: small, self-contained jobs. Each unit is validated by the linter and merged into `data/` on its own. Units run through the **Anthropic API** (Message Batches for bulk work, plain Messages for sequential work). An interactive Claude session can also run them (§5).

Run everything from the repo root (`/home/xenohunter/projects/ankigen`). You need Node 18+ and, for API runs, a `.env` file in the repo root with `ANKIGEN_API_KEY=…` (copy `.env.example`). `batch.mjs` reads it itself. Don't export `ANTHROPIC_API_KEY` in your shell: Claude Code would then bill the API instead of your plan.

## 1. Phases and units

| Phase | Unit IDs | What | Weight | Count (≈) |
|---|---|---|---|---|
| 1. Concept inventory | `concepts:core-1:1` … `concepts:core-3:4`, then `concepts:<module>` | language-neutral concepts, IDs, modules, groups, local concepts | 2 / 1.5–2 | 41 units |
| 2. Card labels | `labels:<code>` | card captions per language | 0.5 | 13 |
| | `landing:<code>` | the landing pages' texts for that language's speakers (all but English) | 1 | 14 |
| 3. Languages | `lang:<code>:<module>:<n>` | words, forms, hints, definitions, 3 example slots for ≤ 100 concepts | 2 (ja/zh 2.5) | 53 per language |
| | `review:<code>` | fix collisions and warnings, spot-check | 1 | 15 |
| 4. IPA | `ipa:<code>:<module>` | pronunciation (all but zh, ja) | 0.5 | ≈ 36 per language |
| 5. Example fixes | `exfix:<code>:<n>` | rewrite example slots whose target is an alt, not a form of `w` (or, in Chinese, lacks the word); one unit per 250 concepts, sending only the flagged ones | 0.03 per concept | 14 per language |
| — Etymology | (dropped for now; the app hides the field) | one-line schematics | — | — |

Dependencies (enforced by `units.mjs`):
- Concept units run strictly in sequence.
- Lang units appear once the inventory is complete.
- Non-English lang units wait for `review:en`, because English examples are the source of the parallel example slots.
- IPA waits for that language's review.
- Example fixes wait for that language's review, and non-English ones for English's fixes (the slots they translate).

Completion of lang, IPA, label and example-fix units is checked against the files themselves. Concept and review units are recorded in `tools/gen/progress.json`.

The concept inventory is complete: **3,498 concepts** in 36 modules (83 of them country- or language-specific). 1 weight point ≈ 10k output tokens; `plan.mjs status` shows about 1,900 points left, ~85% of it in phase 3.

## 2. Running it through the API (primary path)

```
cp .env.example .env                  # then put your key after ANKIGEN_API_KEY= (gitignored)
node tools/gen/plan.mjs status        # where are we
node tools/gen/batch.mjs estimate     # size and cost of what is available now
```

Phase by phase:

| Step | Command | Mode |
|---|---|---|
| Concepts (if any are left) | `node tools/gen/batch.mjs auto --type concepts` | sequential, plain Messages API |
| Labels | `node tools/gen/batch.mjs auto --type labels` | one small batch |
| Landing texts | `node tools/gen/batch.mjs auto --type landing` | one small batch |
| English | `node tools/gen/batch.mjs auto --type lang --lang en` | batch (≈ 56 units) |
| English review | `node tools/gen/batch.mjs auto --type review --lang en` | sequential |
| All other languages | `node tools/gen/batch.mjs auto --type lang --max 300 --incomplete` | batches; repeat until `estimate` shows none left |
| Reviews | `node tools/gen/batch.mjs auto --type review` | sequential, all languages |
| IPA | `node tools/gen/batch.mjs auto --type ipa --max 300` | batches |
| Example fixes | `node tools/gen/batch.mjs auto --type exfix` | batches; English first, so run it again until `estimate --type exfix` shows none left |

How `auto` works:
1. Submits a batch.
2. Polls every minute. Batches usually finish within an hour; the limit is 24 h.
3. Downloads the results and merges each unit with `merge-unit.mjs`, which lints it.
4. Resubmits failures up to twice:
   - lint or parse errors go back with the error list (a repair turn);
   - truncated outputs are split in two halves.

   With `--incomplete` (on `auto` or `retry`), only units still missing entries go back. A lang unit whose entries all merged, but with lint errors, is left to its language's review unit. Those errors are mostly words shared by two concepts that need a hint, and one review fixes a whole language for well under a dollar. A whole-unit retry costs about $0.10 per unit, and the first pass of 11 languages left 444 such units.

Anything still failing after that is listed for an interactive fix. You can stop `auto` at any time. Then:
- `node tools/gen/batch.mjs status` shows open batches;
- `auto --batch <id>` resumes waiting on a submitted batch (then collects and retries as usual);
- `collect <id>` and `retry <id>` resume by hand.

Manifests live in `tmp/batches/`; outputs in `tmp/` (gitignored).

Other commands and options:
- `--dry-run` (on submit/sync): writes the request JSONL without calling the API, so you can inspect the prompts.
- `--model`: default `claude-sonnet-5-5`, or env `ANKIGEN_MODEL`.
- `--max-tokens 64000`.
- `--price-in/--price-out`: for the estimate only; default $1/$5 per M = batch Sonnet pricing; check the current price.
- `sync <unit>`: runs one unit immediately, with up to 2 repair rounds.

**Cost:** `batch.mjs estimate` puts English at about $5 (upper bound, before caching); all of phases 2–4 should land around **$80–100** at batch pricing. Measured: about 1.8× the estimate, ≈ $7–8.5 per language for its lang units (11 languages, 583 units: $80.65). Only about 0.8 characters of text come back per billed output token; the rest is presumably the model's reasoning, which the runner doesn't keep. So a large unit can reach `--max-tokens` with ~30,000 characters of text; the retry splits it. The system prompt (data format + unit instructions + golden sample) is marked for prompt caching.

Landing texts translate `englishTexts()` in `tools/landing.mjs` (with the module, field and option texts of `data/meta`) into `data/landing/<code>.json`, with a hash of the English they came from. When those English texts change, `lint-data` warns, the pages of that language fall back to English, and the plan lists the unit again: rerun `auto --type landing`. The app shows their module, field and option texts and language names in its interface language too (ARCHITECTURE §13).

The app's own texts in other languages (`data/ui/<code>.json`, with the landing pages' footer) are not a unit: they are written by hand or by Claude Code, checked by `lint-data`, and stamped with `node tools/ui-texts.mjs stamp <code>`.

## 3. Checkpoints for you

- After `review:en`, read 50 random English entries and examples. English examples are the source for every other language, so fix systematic problems in `tools/gen/prompts/lang.md` **before** running the other languages.
- After Russian, Serbian and Japanese are done, spot-check them (you know these best). If a language is systematically off, improve `tools/gen/prompts/languages.md`. Then delete that language's files and rerun it.
- Mark entries you've checked by hand with `"st":"r"`.

## 4. Quality controls built in

- `merge-unit.mjs` lints every unit before it counts.
- `review:<code>` clears what's left per language: collisions → hints, definitions containing the headword, furigana, missing forms, plus a deterministic 30-entry spot check.
- The target of an example must be a form of `w`, not an `alt` (DATA_FORMAT §6). Lint flags the slots that break this, and `exfix:<code>:<n>` units rewrite them. Until the existing data is fixed this is a lint warning; once `plan.mjs status` shows every `exfix` unit done, it becomes an error (the `warn` in `lintExamples`, `tools/lib/data.mjs`), so new data can't bring it back.
- User reports land in the feedback sheet. Fix those entries in the data files, then run `node tools/lint-data.mjs --fix` and bump `data/meta/version.json`.

## 5. Interactive fallback (Claude session in the repo)

For units the API runner gave up on, or for careful manual work. Prefer Sonnet unless the unit is judgment-heavy. Prompt:

```
Continue AnkiGen data generation in this repo. Follow docs/GENERATION.md §5.
1. Run: node tools/gen/plan.mjs start
2. Loop until the planner says STOP (or until the units I name are done):
   a. node tools/gen/plan.mjs next
   b. node tools/gen/plan.mjs show <unit> — read it, the prompt file it names, and for lang/review/ipa units
      the matching section of tools/gen/prompts/languages.md (read docs/DATA_FORMAT.md and the golden
      sample in tests/fixtures/data once).
   c. Write the output JSON to the path given (tmp/...). For big units write it in parts of ~25 concepts and
      merge each part with --partial; merge the final part without it.
   d. node tools/gen/merge-unit.mjs <file> — fix every error and merge again until it prints OK.
3. Finish with node tools/gen/plan.mjs status and report. Never edit docs/ or tools/, never rename or delete concept IDs, never commit.
```

`plan.mjs start [budget]` and `plan.mjs budget <n>` limit an interactive session to a number of weight points. This is useful on a subscription plan, where you calibrate points per usage window.

## 6. Ready to deploy

- `node tools/lint-data.mjs --report` shows 100% entries, definitions and examples for all 15 languages, with 0 errors.
- IPA may still be in progress if you choose to ship without it.
- Etymology is not generated (dropped for now).
- Non-parallel examples are fine.
