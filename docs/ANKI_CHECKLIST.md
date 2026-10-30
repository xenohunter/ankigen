# Anki import checklist (manual)

A hands-on test of the `.apkg` files on Anki desktop and AnkiDroid. It takes about 50 minutes. The page's "?" next to Download explains updating a deck; its text is `update.*` in `src/ui/strings.js`, so check it against what you see.

## Already verified automatically

The import logic was run against Anki's own backend (the `anki` Python package 26.09.3 and 23.12.1, and the old 2.1.49 importer). Current desktop, AnkiDroid and AnkiMobile all use the same backend code. These checks passed:

- **Storage:** every note and card is stored exactly as written: GUIDs, ids, fields, sort field, checksum, tags, card order. The full English deck (3,341 notes) passes Check Database.
- **Re-imports:** each step below gives the numbers stated, and review history survives.
- **Rendering:** for 162 cards across 7 configurations, Anki's rendering equals the site's preview, character for character.
- **Pronunciation audio** (2026-10-28, same three backends): the clips land in `collection.media` byte for byte, and the same file again adds none; turning audio on later updates the notes and adds the clips; turning it off empties the Audio field, and Check Media lists the clips as unused. Anki's own sound tags put the clip on the forward question only and on the reverse answer only. A 19-field deck from before the Audio field is "conflicting" until "Merge note types" is ticked.

So this checklist is about what only the real apps show: their import dialogs, cards on real screens in light and dark mode, typing answers, and opening files on a phone.

## Setup

1. **Write down the versions:** Anki desktop (Help → About) and AnkiDroid (Settings → About).
2. **Desktop:** use a throwaway profile (File → Switch Profile → Add, e.g. "ankigen-test"). A new profile is not logged in to AnkiWeb, so nothing syncs.
3. **AnkiDroid:** don't sync until you've deleted the test decks and their note types.
   - Delete the decks: long-press the deck → Delete.
   - Delete the note types: Manage note types → each "AnkiGen …" type.
   - Or turn off automatic sync for the test.
4. **Build each file right before its step**, in WSL from the repo root.
   - Anki updates a note only from a file whose export time is later than the last one's, to the second. Files built back to back in the same second count as "already present".
   - Files go to `tmp/anki-test/<step>/`. In Windows Explorer that is `\\wsl$\Ubuntu\home\xenohunter\projects\ankigen\tmp\anki-test\`.
   - For the phone, copy a file over (cloud drive, USB, or a message to yourself) and open it with AnkiDroid.

Steps 1–8 use the small test dataset in `tests/fixtures/data`, 15 concepts in en/ru/ja/de/sr. Step 9 uses the real English data. Steps 10–11 go back to the test dataset, with its pronunciation clips (`tests/fixtures/data/audio/`).

## Anki desktop

**Step 1: Import**

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1&x=2' --data tests/fixtures/data --out tmp/anki-test/1
```

Do: File → Import → `tmp/anki-test/1/ankigen-ru-en-<date>.apkg`.

- [ ] **Import options** (take a screenshot). Leave the defaults:
  - Merge note types: off
  - Update notes: If newer
  - Update note types: If newer
  - Include reviews: off
  - Import any deck presets: off
- [ ] **Result:** "10 new notes imported" (in the log: "Notes added from file: 10").
- [ ] **Deck list:** "AnkiGen" with the child deck "Русский (English)", 10 new cards.
- [ ] **Deck overview** (click the deck):
  - It shows "Made with AnkiGen · data 2026.10.17".
  - The "AnkiGen" link points to `https://xenohunter.github.io/ankigen/#v1&l=ru&k=en&m=core-1&x=2`. It is a 404 until the site is live.
  - The deck uses the "Default" options preset (gear → Options).
- [ ] **Browse, Notes mode:**
  - Note type is "AnkiGen Русский (English)".
  - Sort Field shows e.g. "вода́ f.".
  - Created is today (not 1970, not "invalid date").
  - Tags look like `ankigen::foundations::core-1`.
- [ ] **Edit one note:** 20 fields, Word … Reverse, Audio. Rows switched off are empty, and so are Reverse and Audio.

Then study 3 cards and press Good on each.

- [ ] **Front of вода́:** a large "вода́" with a small grey "f.".
- [ ] **Back:**
  - "water", then FORMS "gen. воды́ · pl. во́ды", IPA "/vɐˈda/".
  - EXAMPLES: two Russian sentences with the target word in the accent colour, each with its English translation in grey.
  - RELATED "→ пить".
- [ ] **рука́:** one note, whose back says "hand; arm".
- [ ] **Dark mode** (Tools → Preferences → Appearance → Theme: Dark): the text is readable, the accent is a lighter blue, and nothing stays on a white box.

**Step 2: Change fields and re-import**

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1&f=forms:f,ipa:o&x=1' --data tests/fixtures/data --out tmp/anki-test/2
```

Import it. This moves Forms to the front, turns IPA off and keeps one example.

- [ ] **Result:** "10 notes were used to update existing ones" ("Notes updated, as file had newer version: 10").
- [ ] **Fronts:** they now show FORMS under the word.
- [ ] **Backs:** no IPA, one example.
- [ ] **The 3 studied cards:** not new again. Their Due is in the future, and Card Info (Browse → card → Ctrl+Shift+I) still lists the review.
- [ ] **Same file again:** import this file a second time. Expect "10 notes already present in your collection." and no change.

**Step 3: Add a module**

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1,time&f=forms:f,ipa:o&x=1' --data tests/fixtures/data --out tmp/anki-test/3
```

- [ ] **Result:** 1 note added and 10 updated.
- [ ] **The new note:** "су́тки pl. only" → "a full day of 24 hours, day and night together".
  - It is in the same deck, with the tag `ankigen::foundations::time`.
  - It comes after the existing new cards.

**Step 4: Reverse cards and typing**

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1,time&f=forms:f,ipa:o&x=1&r=1&t=1' --data tests/fixtures/data --out tmp/anki-test/4
```

- [ ] **Result:** 11 updated, and 11 new reverse cards. Browse in Cards mode shows card type "Reverse". The deck has 22 cards.
- [ ] **Reverse front:** "water", a text box, and nothing about the Russian word (no forms, no examples).
- [ ] **Typing:** type "вода" (no stress mark) and press Enter. It shows as fully correct; a typo such as "вада" is highlighted.
- [ ] **Reverse back:** "вода́" with its forms and examples.

**Step 5: Reverse cards off**

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1,time&f=forms:f,ipa:o&x=1' --data tests/fixtures/data --out tmp/anki-test/5
```

- [ ] **Result:** 11 updated. The 22 cards are still there.
- [ ] **A reverse card in review:** shows "The front of this card is blank."
- [ ] **Tools → Empty Cards…:** it lists 11 cards. Delete them; the forward cards and their review history stay.

**Step 6: Japanese**

```
node tools/apkg.mjs '#v1&l=ja&k=de&m=core-1,residence&r=1' --data tests/fixtures/data --out tmp/anki-test/6
```

- [ ] **Result:** 14 notes and 28 cards in a new deck "AnkiGen › 日本語 (Deutsch)".
- [ ] **Forward front:** "水" only, with no reading (Reading is on the back by default).
- [ ] **Back of 水:**
  - "みず" as furigana over 水, centred and small.
  - "Wasser", then UMSCHRIFT "mizu".
  - Examples with furigana. The captions are in German (Beispiele, Verwandt).
- [ ] **食べる:** FORMEN "Klasse Ichidan (ru-Verb) · höflich 食べます · Te-Form 食べて · Verneinung 食べない", with each item kept on one line.
- [ ] **住民票** (a Japan-only concept): "Jūminhyō: japanische Meldebescheinigung über den Wohnsitz".
- [ ] **Reverse card:** "Wasser" on the front; 水 with furigana on the back.
- [ ] **Kana and kanji** look like a Japanese font, not Chinese glyphs or boxes.

**Step 7: German, typing with the article**

```
node tools/apkg.mjs '#v1&l=de&k=ru&m=core-1&r=1&t=1' --data tests/fixtures/data --out tmp/anki-test/7
```

- [ ] **Reverse front:** "вода", with no stress mark on the side you know, and a text box.
- [ ] **Typing:** "das Wasser" is fully correct; "Wasser" alone flags the missing "das ".
- [ ] **der Bruder:** one note, "брат (старший) · старший брат; брат (младший) · младший брат".

**Step 8: Serbian in Latin script**

```
node tools/apkg.mjs '#v1&l=sr&k=en&m=core-1&f=otherScript:b&sr=l' --data tests/fixtures/data --out tmp/anki-test/8
```

- [ ] **Deck name:** "AnkiGen › Српски (English)". It stays in Cyrillic on purpose: Anki matches decks by name, so the name must not change with the script choice.
- [ ] **Card:** front "voda f."; back with an OTHER SCRIPT section "вода" and forms "gen. vode · pl. vode".

**Step 9: A full-size deck**

```
node tools/apkg.mjs '#v1&l=en&k==&m=core-1,core-2,core-3,numbers,time,phrases,countries,language-learning,family,feelings,food,cooking,shopping,housing,household,nature,animals,city,transport,driving,signs,residence,money,work,telecom,education,health,emergencies,hobbies,sports,music,video-games,tabletop,tech,science,profanity&r=1' --out tmp/anki-test/9
```

- [ ] **Import:** 3,341 notes and 6,682 cards (about 640 KB). Note how long the import takes.
- [ ] **Browse:** scrolling and searching feel normal.
- [ ] **A few definition cards:** long definitions wrap cleanly.

**Step 10: Pronunciation audio on**

Back to the Russian deck of steps 1–5, with reverse cards and audio. The clips are the golden sample's, in `tests/fixtures/data/audio/ru/`.

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1,time&f=forms:f,ipa:o&x=1&r=1&a=1' --data tests/fixtures/data --out tmp/anki-test/10
```

- [ ] **Result:** 11 notes updated and 11 reverse cards added again (step 5 removed them). Tools → Check Media reports no missing and no unused files.
- [ ] **Forward card:** showing the front plays "вода" by itself, and a small play button sits under the word. Showing the answer does not play it again; R replays it.
- [ ] **Reverse card:** the front ("water") is silent and has no button; showing the answer plays "вода".
- [ ] **Listen to a few:** рука́ (hand and arm share one clip), су́тки, пить. Machine voices: note anything wrong, but these are expected to be imperfect.
- [ ] **Same file again:** "11 notes already present", and Check Media is still clean: no second copy of any clip.
- [ ] **Dark mode:** the play button is visible.

**Step 11: Pronunciation audio off**

```
node tools/apkg.mjs '#v1&l=ru&k=en&m=core-1,time&f=forms:f,ipa:o&x=1&r=1' --data tests/fixtures/data --out tmp/anki-test/11
```

- [ ] **Result:** 11 notes updated; no card plays anything or shows a play button. Edit a note: the Audio field is empty.
- [ ] **Tools → Check Media:** lists 11 unused files, `ankigen-ru-….mp3`. "Delete Unused" removes them. This is what the page's "?" next to the audio toggle tells users to do.

## AnkiDroid

Repeat a shorter round on the phone, in a fresh state (or after deleting the desktop-tested decks there).

- [ ] **Opening a file:** tap the `.apkg` in Files or Downloads and choose AnkiDroid. Also try ⋮ → Import from the deck list.
  - Take a screenshot of whatever options it shows.
- [ ] **Step 1:** import, then study 3 cards.
  - The cards fit the screen width with no sideways scrolling, and long words wrap.
- [ ] **Step 2:** the counts are as on desktop, and the studied cards keep their schedule.
- [ ] **Step 4:** the type-answer box opens the keyboard, and "вода" shows as correct.
- [ ] **Step 5:** the blank reverse card message, then Empty Cards.
  - Tell me the menu path for Empty Cards in your AnkiDroid version, so the "?" text can name it.
- [ ] **Step 6:** furigana and Japanese fonts on the phone.
- [ ] **Night mode** (⋮ → Night mode, or Settings → Appearance): readable, with no white boxes.
- [ ] **Deck description:** the deck's overview screen shows the description, and its link opens the browser.
- [ ] **Step 9:** the full-size deck imports in reasonable time.
- [ ] **Step 10:** the clip plays when the forward front appears and from its button, not again on the forward answer, not on the reverse front, and on the reverse back. Copy the file over again and import it a second time: no new media.
- [ ] **Step 11:** after the audio-off file, Check Media (⋮ → Check media, or Settings → Advanced) lists the unused clips. Tell me the menu path in your version.

## What to send back

- The versions from Setup step 1.
- Per step: OK, or what differed.
- Screenshots:
  - one card front and back, light and dark, on desktop and on the phone;
  - the Japanese back;
  - the import options on both apps.
- The AnkiDroid menu path for Empty Cards.
- For steps 10 and 11: when the clip plays on each app, how the play button looks, and the AnkiDroid menu path for Check Media.

## What the import messages mean

| Message | Cause | What to do |
|---|---|---|
| "N notes already present in your collection." | The same file again, or a file that is not newer | Nothing |
| "N notes were not imported, because their note type has changed, and 'Merge note types' was not enabled." | The AnkiGen note type was edited (fields added, removed or renamed), or the deck was downloaded before 2026-10-28 (19 fields; AnkiGen then added the Audio field) | Re-import with "Merge note types" ticked |
| Unused files `ankigen-<lang>-….mp3` in Check Media | Audio was turned off, or words changed their clips | "Delete Unused" in Check Media |
| A second "AnkiGen::…" deck appears | The original deck was renamed or moved | Move the new cards into your deck |
| "The front of this card is blank." | Reverse cards were turned off | Tools → Empty Cards |
