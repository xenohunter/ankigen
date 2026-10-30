# Generating the vocabulary data

The data is written by Claude in **units**: small, self-contained jobs. Each unit is validated by the linter and merged into `data/` on its own. Units run through the **Anthropic API** (Message Batches for bulk work, plain Messages for sequential work). An interactive Claude session can also run them (§5).

Run everything from the repo root (`/home/xenohunter/projects/ankigen`). You need Node 18+ and, for API runs, a `.env` file in the repo root with `ANKIGEN_API_KEY=…` (copy `.env.example`). `batch.mjs` reads it itself. Don't export `ANTHROPIC_API_KEY` in your shell: Claude Code would then bill the API instead of your plan. The pronunciation audio has its own tool and key (§7).

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
- Pronunciation audio (§7) never holds up a deploy: a word without a clip has none.

## 7. Pronunciation audio

`tools/audio.mjs` makes one clip per word entry of a language with **Google Cloud Text-to-Speech** (REST API with an API key; no other service) and keeps the clips in the repo, under `data/audio/` (DATA_FORMAT §13). `tools/bundle.mjs` packs them for the site (ARCHITECTURE §3). Audio is not a unit and not part of the deploy gate.

Setup: put `GOOGLE_TTS_API_KEY=…` into `.env` (see `.env.example`); the tool reads that one variable itself. In the Google Cloud console, restrict the key to the Text-to-Speech API.

```
node tools/audio.mjs status                                # per language: voice and tier, clips present and missing; the key
node tools/audio.mjs estimate [--lang <code>]              # clips and characters still to generate
node tools/audio.mjs run [--lang <code>] [--max-chars N]   # everything, in one go
node tools/audio.mjs pilot [--lang <code>]                 # about 20 words per language, and tmp/audio-pilot.html
node tools/audio.mjs prune                                 # delete clip files no manifest uses
```

What `run` does, in this order:
1. **Resolves the voice** of every language that has a TTS locale (`"tts"` in `languages.json`) but no entry in `data/meta/audio.json`. From Google's voice list, by exact locale only (never pt-BR for pt-PT): a Chirp 3 HD voice (Kore wherever it exists, else the first female one), else Neural2, else WaveNet, else the language is `{"unsupported": true}`. The entry gets the text rules that follow from the registry (DATA_FORMAT §13). For Chinese the tool also tries whether the voice follows SSML pinyin phonemes.
2. **Checks again** the languages marked unsupported (and those whose locale in `languages.json` changed), so a language gains audio as soon as Google adds a voice.
3. **Makes the clips** that are missing or whose key changed. The key is the text sent, the locale, the voice and the format: a corrected word, or another voice picked by hand in `audio.json`, regenerates; everything else is skipped. Each distinct text is synthesized once, and identical texts share one file. Manifests are written as it goes, so it can be stopped (Ctrl+C) and run again.

Without `--lang` it covers every language with data; a language whose data is still incomplete is fine, a later run picks up its new words. It stops before sending more than `--max-chars` characters (default 900,000) and says so. Characters are billed for every request, SSML included; Chirp 3 HD costs $30 per million (check the current price and free tier). The first full run, on 2026-10-28, sent 357,483 characters for 45,591 clips in 14 languages and took about 4 hours; with the pilot and tests the day's total was about 366,000 characters. The clips take 241 MB.

Robustness:
- Requests keep to Google's per-project quotas, at 90% (Chirp 3 HD: 200 a minute, so about 4 hours for 14 languages; Neural2 and WaveNet: 1,000), six at a time. 429 and 5xx are retried with backoff. Other failures are logged to `tmp/audio-failures.jsonl` and the run goes on; the next run tries them again.
- Chirp 3 HD varies from request to request, and sometimes answers a very short word (ja, ty, tak, ναι…) with a fraction of a second of near-silence. The tool checks every Chirp clip for speech without decoding it (`hasSpeech` in `tools/lib/audio.mjs`, from the MP3 frames' global gain; calibrated on 335 decoded clips) and tries up to 10 times, alternating the text as written and the same words capitalized with a full stop ("Tak."), which the voice says more often. The manifest records the form that worked as `sent`. A word that still fails gets no clip and is logged; after the first run that was Russian и and Greek ναι. The check can't hear: decoding all 45,850 clips in a browser afterwards found 3 that had passed it but were too short or quiet (Korean 입, 힘, Turkish ay); deleting such a file makes the next `run` synthesize it again.
- `lint-data` warns when an active language has no TTS locale, about words without a current clip, and about missing or unused clip files; a malformed `audio.json` is an error.

Listening: `pilot` makes about 20 clips per language (homographs, special texts, the longest words, the first words of the deck) into `data/audio` (so a run reuses them), and writes `tmp/audio-pilot.html` to play them. Russian gets a second clip of each word with its stress marks, under `tmp/audio-pilot/`, to compare. On 2026-10-30 the owner kept the clips without marks: the marked ones had several bugs. So `ru` stays at `"stress": false`.

## 8. Adding audio for a language

1. Add its TTS locale to `data/meta/languages.json` as `"tts"`: Google's language code, such as `it-IT` (`cmn-CN` for Mandarin). This is part of adding the language anyway.
2. `node tools/audio.mjs run --lang <code>`

That is all: the bundle packs its clips, and the deck and the page offer audio for it with no code change. If Google has no voice of a usable tier for the locale, `audio.json` says so, and every later `run` checks again.
