// @ts-check
// The page's English texts: what the page shows in English, and the master that every translation in
// data/ui/<code>.json follows (tools/ui-texts.mjs checks them). {name} marks a value filled in at run time.
// Module, field and option texts come from data/meta, translated in data/landing; the feedback dialog's
// texts are in ui/feedback-dialog.js and the audio option's in ui/audio.js, which load them when they load.
//
// tools/landing.mjs uses head.draftHelp1 and update.intro too: changing them changes the landing pages'
// English texts, so their translations are redone (docs/GENERATION.md).

export const STRINGS = {
  'head.draft': 'The vocabulary is machine-drafted and only partly reviewed. Feedback is very welcome.',
  'head.draftTopic': 'the draft vocabulary',
  'head.draftHelp1':
    'Words, translations and example sentences were drafted with an AI model and are being checked by people, language by language.',
  'head.draftHelp2':
    'If something looks wrong, select it on a preview card and press Ctrl+Enter (⌘+Enter on a Mac), or use the Feedback button in the corner. Every report helps fix the deck for everyone.',
  'head.language': 'Interface language',
  'head.languageNow': 'Interface language: {language}',
  'help.about': 'About {topic}',
  support: 'Support this project:',
  fatal: 'AnkiGen could not load its word lists. Check your connection and reload the page.',

  'step.learn': 'I’m learning',
  'step.know': 'I speak',
  'step.modules': 'Modules',
  'step.fields': 'Card fields',
  'step.fieldsNote': 'Choose what each card shows, and on which side. The preview follows along.',
  'step.options': 'Card options',
  'step.download': 'Download',
  'step.share': 'Share',

  'lang.same': 'Same language',
  'lang.sameNote': 'word definitions',
  'lang.sameHelp':
    'Cards show a short definition in the language you are learning instead of a translation. Good once you can read simple sentences in it.',
  'lang.loading': 'Loading {language} words…',
  'lang.failed': 'Could not load the {language} words. Check your connection and reload the page.',
  'group.germanic': 'Germanic',
  'group.asian': 'East and Southeast Asian',
  'group.romance': 'Romance',
  'group.slavic': 'Slavic',
  'group.celtic': 'Celtic',
  'group.other': 'Other',

  'modules.hint': 'Pick the topics you want; you can add more later.',
  'modules.show': 'Show {category} modules',
  'modules.tally': '{n} of {total}',
  'modules.adultTopic': '18+ modules',
  'modules.adultHelp':
    'Swear words, insults and vulgar slang, matched by strength across languages. They are included only when this module is selected, even the ones that also belong to another module.',
  'modules.localTopic': '{module}: local words',

  'placement.off': 'Off',
  'placement.front': 'Front',
  'placement.back': 'Back',
  'placement.on': 'On',
  'placement.word': 'With the word',
  'fields.alwaysFront': 'Always on the front',
  'fields.alwaysBack': 'Always on the back',
  'fields.examples': 'Number of examples',
  'fields.more': 'More…',

  'options.cyrl': 'Cyrillic',
  'options.latn': 'Latin',

  'download.deck': 'Deck',
  'download.size': 'Size',
  'download.file': 'File',
  'download.button': 'Download deck',
  'download.later': 'Updating a deck later',
  'download.laterTopic': 'updating a deck',
  'download.loading': 'Loading…',
  'download.secure': 'Downloading needs a secure connection: open the page over https:// (or localhost).',
  'download.building': 'Building your deck…',
  'download.saved': 'Saved {file}. Open it with Anki (File → Import), or tap it on your phone to open it in AnkiDroid.',
  'download.failed': 'Could not build the deck ({error}). Please try again.',
  'download.audio': 'Audio',
  'download.audioSize': '+{size} MB',
  'update.title': 'Updating your deck',
  'update.intro':
    'Changed fields, added modules, or want newer data? Download again and import the new file into Anki (File → Import) with the default options. Anki updates your existing notes and their layout, adds new words to the same deck, and keeps your review progress.',
  'update.edits': 'Your own edits and tags on AnkiGen notes are replaced by the new version. Flags, suspended cards and progress are kept.',
  'update.deck':
    'New cards go to the deck with exactly this name. If you renamed or moved it, they appear in a new deck with the original name, and you can move them.',
  'update.noteType': 'If you changed the fields of the AnkiGen note type, tick “Merge note types” when importing, or Anki can’t update these notes.',
  'update.reverse': 'Turned reverse cards off? Anki keeps the old ones as blank cards. Remove them with Tools → Empty Cards.',

  'share.copy': 'Copy link',
  'share.copied': 'Link copied',
  'share.copyFailed': 'Could not copy the link. Copy it from the address bar.',
  'share.more': 'Share…',
  'share.on': 'Share on {site}',
  'share.email': 'Email',

  'preview.heading': 'Preview',
  'preview.another': 'Another word',
  'preview.forward': 'Forward card',
  'preview.reverse': 'Reverse card',
  'preview.front': 'Front',
  'preview.back': 'Back',
  'preview.face': '{card}, {side}',
  'preview.typeAnswer': 'Type the answer',
  'preview.pickLanguages': 'Pick the language you are learning and one you speak to see sample cards here.',
  'preview.loading': 'Loading words…',
  'preview.pickModules': 'Choose modules to see sample cards here.',
  'preview.empty': 'No words for these languages in the chosen modules yet.',
  'preview.close': 'Close',

  'reset.button': 'Reset all',
  'reset.title': 'Are you sure?',
  'reset.text': 'Your languages, modules and card settings go back to the defaults.',
  'reset.cancel': 'Cancel',

  'list.heading': 'Words',
  'list.search': 'Search words',
  'list.label': 'Words in the deck',
  'list.report': 'Report a problem with {word}',
  'list.reportTitle': 'Report a problem',
  'list.noMatch': 'No words match “{query}”.',
  'list.open': 'Word list: {size}',

  'feedback.button': 'Feedback',
  'feedback.title': 'Feedback ({shortcut})',

  'langs.title': 'Supported languages — AnkiGen',
  'langs.heading': 'Supported languages',
  'langs.extras': 'Cards can also show: {fields}',
  'langs.build': 'Build a deck',
  'langs.askTitle': 'Missing a language?',
  'langs.askText': 'Tell us which language you would like to learn, or to use this site in. Requests help decide which languages come next.',
  'langs.ask': 'Request a language',

  'foot.decks': 'Decks by language pair',
  'foot.languages': 'Supported languages',
  'foot.source': 'Source on GitHub',
  'foot.license': 'Code under the {mit} license; vocabulary under {cc}.',
  'foot.author': 'Created by {name}',
};

/**
 * Texts with a number in them, one per plural category of the language (Intl.PluralRules): English has
 * "one" and "other"; Russian also "few" and "many". {n} is the number, formatted for the language.
 */
export const PLURALS = {
  title: { one: 'AnkiGen — free Anki vocabulary decks in {n} language', other: 'AnkiGen — free Anki vocabulary decks in {n} languages' },
  lede: { one: 'Free Anki vocabulary decks in {n} language, built right in your browser.', other: 'Free Anki vocabulary decks in {n} languages, built right in your browser.' },
  description: {
    one: 'Build free Anki vocabulary decks right in your browser: {n} language, topic modules and the card fields you want. Download an .apkg for Anki or AnkiDroid.',
    other: 'Build free Anki vocabulary decks right in your browser: {n} languages, topic modules and the card fields you want. Download an .apkg for Anki or AnkiDroid.',
  },
  langsLede: {
    one: 'AnkiGen makes Anki decks in {n} language, with definitions in the same language.',
    other: 'AnkiGen makes Anki decks in {n} languages. Learn any of them from any other, or on its own with definitions in the same language.',
  },
  langsDescription: {
    one: 'The {n} language AnkiGen makes free Anki vocabulary decks in, and how to ask for another one.',
    other: 'The {n} languages AnkiGen makes free Anki vocabulary decks in, and how to ask for another one.',
  },
  word: { one: '{n} word', other: '{n} words' },
  note: { one: '{n} note', other: '{n} notes' },
  card: { one: '{n} card', other: '{n} cards' },
  example: { one: '{n} example', other: '{n} examples' },
  modulesChosen: { one: '{n} module of {total} selected', other: '{n} modules of {total} selected' },
  searchWords: { one: 'Search {n} word', other: 'Search {n} words' },
  matches: { one: '{shown} of {n} word', other: '{shown} of {n} words' },
  localTerms: {
    one: '{n} word here exists only in the language you are learning, such as {example}. Other languages have no exact word for it, so your cards explain it in the language you speak.',
    other: '{n} words here exist only in the language you are learning, such as {example}. Other languages have no exact word for them, so your cards explain them in the language you speak.',
  },
};
