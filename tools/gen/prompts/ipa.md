# Unit type: ipa — pronunciation for one language and module

Input: `node tools/gen/plan.mjs show ipa:<code>:<module>` gives `{id: word}` for every entry still missing IPA.

Write broad phonemic-leaning IPA, the way a good learner's dictionary does:
- No slashes or brackets; primary stress ˈ before the stressed syllable, secondary ˌ where clear; length ː.
- Multi-word entries: transcribe as spoken, words separated by spaces. An entry of two forms written "A / B" (Arabic masculine / feminine, Pan/Pani) gets "A, B": never a slash.
- Use the standard variety of the language registry:
  - en: General American (ɹ, ɚ/ɝ, flapping not shown): water → ˈwɔtɚ.
  - ru: with vowel reduction and palatalization: вода → vɐˈda, молоко → məɫɐˈko.
  - sr: standard ekavian, no pitch-accent marks, stress ˈ on the stressed syllable: вода → ˈʋoda.
  - de: Standard German, vocalized r where usual: Wasser → ˈvasɐ, Arm → aʁm.
  - es: Peninsular (θ for c/z): cerveza → θeɾˈβeθa.
  - pt: European Portuguese with vowel reduction: água → ˈaɣwɐ.
  - pl: Standard Polish: woda → ˈvɔda.
  - ko: Standard Seoul, with sound changes: 한국어 → hanɡuɡʌ (use ʌ, ɯ, ɕ, t͈ for tense consonants).
  - nl: Standard Netherlands Dutch: water → ˈʋaːtər.
  - fr: Standard French, no stress marks: eau → o, maison → mɛzɔ̃.
  - hy: Eastern Armenian: ջուր → d͡ʒuɾ.
  - tr: Istanbul Turkish, always mark stress: kitap → kiˈtap, İstanbul → isˈtanbuɫ.
  - el: Standard Modern Greek: νερό → neˈɾo.
  - it: Standard Italian, double consonants written twice, stress always marked: acqua → ˈakkwa, città → tʃitˈta.
  - sv: Central Standard Swedish, stress and length, no pitch-accent marks: hus → hʉːs, flicka → ˈflɪka.
  - uk: Standard Ukrainian: вода → woˈdɑ, мати → ˈmɑtɪ.
  - ga: Connacht Irish, slender consonants with ʲ and broad ones with ˠ: bean → bʲanˠ, fear → fʲaɾˠ, uisce → ˈɪʃcə.
  - gd: a general Hebridean pronunciation: bean → pɛn, cù → kʰuː, mòr → moːɾ.
  - hu: Standard Hungarian, stress on the first syllable, length ː: ház → haːz, egészség → ˈɛɡeːʃːeːɡ.
  - ar: Modern Standard Arabic in the citation form (as in `w`, without case endings), emphatic consonants with ˤ: كِتَاب → kiˈtaːb, مَدْرَسَة → ˈmadrasa, صَبَاح → sˤaˈbaːħ.
  - vi: Hà Nội Vietnamese, a Chao tone letter after each syllable, no stress marks: Việt Nam → viət̚˧˨ʔ naːm˧˧, xin chào → sin˧˧ t͡ɕaːw˨˩.
- Never output IPA for zh or ja (pinyin/kana cover them).

Output `tmp/ipa__<code>__<module>.json`:

```json
{ "unit": "ipa:ru:core-1", "ipa": { "word-water": "vɐˈda", "word-hand": "rʊˈka" } }
```

Merge with `node tools/gen/merge-unit.mjs <file>`.
