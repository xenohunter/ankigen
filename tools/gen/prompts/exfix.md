# Unit type: exfix — rewrite example slots whose target is not the word

A card teaches the entry's word `w`, and its examples show it in bold: the `{target}` of every example is a form of `w` itself, never an `alt`. Examples written before this rule sometimes mark an alt (容易 is the word, but slot 2 says 做三明治很{简单}), and some Chinese ones leave out part of the word. The pipeline's check found the slots listed under `fix`.

Read `docs/DATA_FORMAT.md` §Examples and the section for your language in `tools/gen/prompts/languages.md`.

Input: `node tools/gen/plan.mjs show <unit>` gives the language block and `concepts`. Each has `pos`, `note` (the sense), the `entry` (`w`, `alt`, forms, reading), its current examples `ex` (slots 1–3), for non-English units the English examples `enExamples` (English slot k is the source of slot k), and `fix`: the slots to rewrite, with what the check found.

## Rewriting a slot

For every slot under `fix`, write a new sentence for that slot:
- **Mark a form of `w`** with `{…}`: the dictionary form or the inflected form the sentence needs, the whole of it (all words of a phrase; in Chinese all characters of the word, together). Never an alt.
- **Other languages:** translate English slot k naturally, using `w`, and omit `p`. If a natural translation can't use `w` (it would sound odd or change the meaning, e.g. Chinese or-questions need 还是, not 或者), write your own natural sentence with `w` instead and add `"p": 0`. Never force `w` into an unnatural translation.
- **English** (the source of every language's slot k): keep the sentence's meaning and structure, usually by putting `w` where the alt was, so the other languages' translations of the slot still fit. No `p`.
- As for all examples: a natural everyday sentence, A2–B1, 4–12 words, different in use or collocation from the concept's other two slots. Notation as in the language guide: furigana (ja), pinyin of the whole sentence in `r` (zh), stress only inside the target (ru), script.
- If you think the check is wrong because the target already is a form of `w` (an irregular form it can't recognize), still rewrite the slot, with a form of `w` closer to its dictionary form.

Leave every other slot as it is.

## Output

Write `tmp/<unit with : replaced by __>.json`:

```json
{
  "unit": "exfix:zh:1",
  "slots": {
    "word-easy": {"2": {"t":"做三明治很{容易}。","r":"Zuò sānmíngzhì hěn róngyì."}},
    "word-or": {"1": {"t":"周末我们去爬山{或者}游泳。","r":"Zhōumò wǒmen qù páshān huòzhě yóuyǒng.","p":0}}
  }
}
```

`slots` maps a concept ID to its rewritten slots by slot number (1–3). Each value is the complete example (`t`, and `r` or `p` when needed) and replaces that slot. Merge with `node tools/gen/merge-unit.mjs <file>`: it fails while a slot of the unit is still flagged.
