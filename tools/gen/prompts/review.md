# Unit type: review — clean up one language after all its lang units are merged

Input: `node tools/gen/plan.mjs show review:<code>` lists every lint error and warning in this language's files. Read the language's section in `tools/gen/prompts/languages.md`.

Fix, in this order:
1. **All errors.** Typical ones: collisions without hints (two concepts with the same `w` — give each a distinct 1–3-word hint in this language; if the two concepts truly have the same meaning in this language, choose a more specific `w` for one of them instead; in Arabic, words that differ only in their vowel marks collide too, because Arabic speakers see them without the marks), missing required forms, wrong script, missing stress marks, furigana syntax.
2. **Warnings worth fixing**: definitions that contain the headword (rewrite), kanji without furigana in examples (add readings), entries with fewer than 3 examples (add the missing slots; mark `"p": 0` unless you are translating the English slot), letters outside the expected script that are not deliberate.
3. **Spot-check quality** of 30 random entries from different modules: wrong sense, unnatural examples, wrong gender, wrong forms. Fix what you find. An example's target is always a form of `w`, never an `alt`.

Output `tmp/review__<code>.json`:

```json
{
  "unit": "review:ru",
  "patch": { "word-hand": {"hint": "кисть"}, "word-x": {"def": "…", "alt": null} },
  "lang": {},
  "ex": { "word-y": [{"t":"…"},{"t":"…"},{"t":"…","p":0}] }
}
```

`patch` merges fields into existing entries (`null` deletes a field); `lang` replaces whole entries; `ex` replaces the whole example list of a concept. Merge with `node tools/gen/merge-unit.mjs tmp/review__<code>.json` and repeat until it reports no errors. The unit is marked done only when the merge succeeds.
