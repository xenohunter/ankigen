# Unit type: landing — the landing pages' texts in one language

The site has a static page for every language pair, such as "Japanese for Russian speakers", for people who search the web in the language they speak. This unit translates the texts of the pages for speakers of one language (the target language) from English. The pages show them around the deck's real data: word counts, module names, sample words.

Input (`node tools/gen/plan.mjs show landing:<code>`):
- `lang`: the target language (name, native name, locale, script).
- `en`: the English texts, in the shape of the output. `en.pairs` has one entry per language that can be learned from the target language. `en.languages` names every language of the site.
- `pluralCategories`: the target language's plural categories (CLDR), for `plural`.
- `current`: an earlier translation, or null. Keep what is still right in it.

Output `tmp/landing__<code>.json`:

```json
{ "unit": "landing:ru", "landing": { "texts": { "decks": "Колоды", "...": "..." }, "plural": { "word": { "one": "{n} слово", "few": "{n} слова", "many": "{n} слов", "other": "{n} слова" }, "module": { "...": "..." } }, "languages": {}, "categories": {}, "modules": {}, "fields": {}, "options": {}, "pairs": {} } }
```

Every key of `en` is required, with the same keys inside. `plural` has one entry per category in `pluralCategories` for each noun.

How to write:
- Natural, idiomatic text, the way a good local website would say it: plain and friendly, not salesy, about as long as the English. Address the reader the way such sites usually do in that language (ru «вы», de "du" or "Sie" consistently, ja polite form).
- Keep as they are: AnkiGen, Anki, AnkiDroid, .apkg, IPA. Anki's menu names ("File → Import", "Tools → Empty Cards") stay in English, because Anki may show them in English; you may add the usual local name in brackets.
- **Placeholders** ({module}, {deck}, {caption}, {count}, {example}, {words}, {modules}, {n}) stay exactly as written, once each, untranslated. The pipeline rejects a text whose placeholders differ from the English.
  - {words}, {modules} and {count} become a complete count phrase, already in the right plural form: "3 442 слова", "35 модулей". Put them where that standalone form is correct (after a colon, in a list, as the subject), never after a preposition or verb that would need another case. Rephrase the sentence if you must.
  - {module} becomes a module name, such as "Core I" in your translation; quote it the usual way of your language («…», „…“, 「…」) if it would otherwise have to take a case ending.
  - {example} becomes a word in the language being learned; {caption} a card caption in your language; {deck} the deck's name in Anki.
- `plural`: each form contains {n}, written as your language writes a number with that noun (ja "{n}語", zh "{n} 个词", de "{n} Wörter").
- `languages`: each language's name as a standalone noun, as a list or button would show it (ru "Английский", de "Englisch", ja "英語").
- `pairs.<code>`: the page for learning that language.
  - `name`: the page heading ("Japanese for Russian speakers" → ru "Японский для русскоговорящих", de "Japanisch für Deutschsprachige").
  - `title`: the browser and search title. It ends with " — AnkiGen" and stays under 60 characters.
  - `description`: the search snippet, under 155 characters, with {words} and {modules}.
  - `lede`: one sentence under the heading.
  - `others`: a heading above links to the same language's pages for speakers of other languages.
- `modules`, `categories`, `fields`, `options`: the names and help texts the app shows in English. Translate them for your reader. Keep the examples in their own languages ("der Tisch, la mesa", "молоко́", "一本书", "은행 → 銀行").
- Write your language in its usual script: Serbian in Cyrillic, Chinese in Simplified characters, Japanese in ordinary kanji and kana, Arabic without vowel marks. No stress marks in Russian or Ukrainian prose.
- Arabic takes its own comma, semicolon and question mark (، ؛ ؟), never the ASCII ones. Irish writes only acute accents (á), Scottish Gaelic only grave ones (à).
- Chinese and Japanese take full-width punctuation (，。：；！？（）), also around Latin words and placeholders: `导入 Anki（File → Import）`, `{words}，涵盖 {modules}`. The pipeline rejects ASCII marks next to Chinese or Japanese text.
- Plain text only: no HTML, no Markdown.
