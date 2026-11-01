# Language guides

Per-language conventions for `lang`, `review` and `ipa` units. The registry (`data/meta/languages.json`) defines the allowed keys; this file says how to fill them. "Formal you" means the polite second-person form the concept `word-you-formal` maps to.

People nouns (all gendered languages): `w` is the masculine (or common) form; give the feminine counterpart in `forms.f` (ru учи́тельница, de Lehrerin, es profesora, fr actrice) when one exists.

Definition style (all languages): one short sentence. English: lower-case start, no final period (learner-dictionary style). All other languages: capitalized, ending with a period (or the language's full stop).

---

## en — English (US)
- US spelling and vocabulary: apartment, truck, gas, cell phone, driver's license, fall (season), elevator.
- Verbs without "to"; phrasal verbs are fine (`pick up`). Nouns in singular, lower case except proper names and weekdays/months.
- `forms`: only irregular — noun `pl` (children), verb `past` + `pp` (ate, eaten), adj `comp` + `sup` (better, best).
- English examples are the source for every other language: keep them literal-friendly (see lang.md).

## ru — Russian
- **Stress**: U+0301 after the stressed vowel in every word of 2+ syllables in `w`, `alt`, `forms` (молоко́, вы́пить). Never on ё (it is always stressed; always write ё, never е for ё). Not in `hint`, `def`, `gl`. In examples, stress only inside the `{target}`.
- Nouns: `g` m|f|n|mf|pl (pl = plurale tantum: су́тки, но́жницы). `forms.gen` = genitive singular (genitive plural for pluralia tantum); `forms.pl` = nominative plural if it exists.
- Verbs: lemma is the imperfective unless the concept is inherently perfective. `aspect` ipf|pf|bi, `pair` = the aspect partner (most common one). `1sg`, `2sg` (present for ipf, simple future for pf), `3pl` when irregular, `past` as "m, f" when stress shifts or stem changes (пил, пила́; нёс, несла́).
- Adjectives: masculine nominative singular; `comp` when irregular (лу́чше), `short` when the short form is common ("рад, ра́да").
- Formal you: вы.

## sr — Serbian (Serbia, ekavian)
- **Cyrillic only** everywhere (entries, hints, definitions, examples). The app derives Latin automatically. Ekavian: млеко, дете, река, лепо.
- Serbian of Serbia, not Croatian/Bosnian: воз (not влак), хлеб, кафа, недеља = Sunday and week (collision → hints), сто (table), пиринач.
- Nouns: `g` m|f|n|pl; `forms.gen` genitive singular; `forms.pl` nominative plural (браћа, деца).
- Verbs: infinitive (-ти, -ћи). `aspect`, `pair`, `1sg`, `3pl` when irregular, `lpt` = active past participle "m, f" (јео, јела).
- Adjectives: the long (definite) masculine form used attributively (велики, нови, мали); `f` feminine, `comp` when irregular (бољи, већи).
- No accent marks. Formal you: ви.

## ja — Japanese
- `w`: the usual written form — kanji where Japanese normally uses kanji, kana where normally kana (する, ある, これ, ちょっと). Katakana for loanwords.
- `read`: kana reading, required when `w` contains kanji (hiragana; katakana stays katakana).
- `rom`: modified Hepburn with macrons for long ō/ū (and ā/ē/ī in loanwords): とうきょう tōkyō, おおきい ōkii, くうき kūki; えい stays ei, いい stays ii; っ doubles the consonant; ん before a vowel/y → n' (kin'en). Spaces between words of multi-word entries.
- Verbs: dictionary form; `forms.class` godan|ichidan|suru|kuru, `masu` (食べます), `te` (食べて), `nai` (食べない). する-compounds: `w` 勉強する, class suru.
- Adjectives: i-adjectives `type: "i"` + `neg` (高くない); na-adjectives `type: "na"`, `w` without な.
- `mw` (counter) for countable nouns that have a specific common counter: 本, 枚, 匹, 台, 冊, 人, 軒, 着. Omit when only つ/個 would apply.
- Phrases: the natural polite form where politeness matters (すみません, お願いします).
- Definitions and glosses use full-width punctuation too: `ギブドド：ロシアの交通警察` (lint rejects ASCII , : ; ! ? ( ) next to Japanese text).
- Examples: natural Japanese, consistent style per sentence (です/ます is the default). Full-width punctuation 。、！？. **Furigana syntax** (the same as Anki's): every kanji run is followed by its reading in square brackets, `日本[にほん]`. When a kanji run follows kana or other characters, put one space before it: `お 茶[ちゃ]を 飲[の]みます` (the space is invisible in the rendered card). The target goes in braces around the furigana: `{食[た]べます}`. Definitions (`def`) use plain text without furigana.

## zh — Chinese (Mandarin, Simplified, mainland)
- `w` in simplified characters, mainland usage (出租车, 自行车, 手机, 地铁).
- `read`: pinyin with tone marks, syllables of one word joined (yínháng, xiǎoshuō); neutral tone unmarked (péngyou); dictionary (citation) tones for 一 and 不, no sandhi.
- `mw`: the usual measure word for nouns (本, 张, 只, 条, 辆, 件, 把, 位); use 个 only when no more specific one is standard. Omit for uncountables.
- No forms. Definitions in simple Chinese.
- Hanzi text (`t`, `def`, `gl`) uses full-width punctuation ，。：；！？（）, also next to Latin words: `导入 Anki（File → Import）`. Only the pinyin `r` uses ASCII punctuation; lint rejects ASCII marks next to hanzi.
- Examples: hanzi with the target in braces; `r` = pinyin of the whole sentence with tone marks, words separated by spaces, ASCII punctuation, no braces: `{"t":"我每天喝{水}。","r":"Wǒ měitiān hē shuǐ."}`.

## de — German (Germany)
- Nouns capitalized, without article in `w`; `g` m|f|n|pl. `forms.pl` whenever a plural exists (Brüder, Hände); `forms.gen` only when not simply -(e)s (des Namens, des Herrn).
- Verbs: infinitive; `3sg` (isst, fährt), `pret` (aß), `pp` with auxiliary (hat gegessen, ist gefahren). Separable: `w` aufstehen, 3sg "steht auf", pret "stand auf", pp "ist aufgestanden". Reflexive: "sich freuen".
- Adjectives: `comp` and `sup` when irregular or umlauted (größer, am größten).
- Formal you: Sie.

## es — Spanish (Spain)
- Peninsular vocabulary: coche, ordenador, móvil, zumo, piso, gafas, conducir. vosotros forms are normal Spain usage.
- Nouns: `g` m|f|mf|m.pl|f.pl. `art: "el"` for feminine nouns with stressed initial a-/ha- (el agua, el hambre). `forms.pl` only when irregular.
- Verbs: `1sg` present (hago), `pret` preterite 3sg (hizo), `pp` (hecho). Reflexive: "levantarse".
- Adjectives: `f` when different (bueno → buena). Formal you: usted.

## pt — Portuguese (Portugal)
- European Portuguese vocabulary and spelling (post-1990 agreement as used in Portugal): comboio, autocarro, pequeno-almoço, frigorífico, telemóvel, casa de banho, ecrã, facto, receção.
- Nouns: `g` m|f|mf|m.pl|f.pl. `forms.pl` only when irregular (pão → pães, avião → aviões).
- Verbs: `1sg` present (faço), `pret` pretérito perfeito 1sg (fiz), `pp` (feito). Reflexive with hyphen: "levantar-se".
- Adjectives: `f` when different. Informal you: tu; formal: você / o senhor (concept mapping per note).

## pl — Polish
- Nouns: `g` m|f|n|pl; `forms.gen` genitive singular, `forms.pl` nominative plural.
- Verbs: `aspect`, `pair`, `1sg`, `2sg` (present for ipf, future for pf), `past` 3sg masculine.
- Adjectives: masculine nominative; `comp` when irregular (lepszy). Formal you: Pan/Pani.

## ko — Korean (South Korea)
- `w` in Hangul. `rom`: official Revised Romanization including its sound-change rules, lower case (한국어 hangugeo, 신라 silla).
- `hanja`: only for Sino-Korean words (은행 → 銀行). Omit for native words and loanwords.
- Verbs and adjectives (descriptive verbs): `w` dictionary form (-다); `haeyo` polite present (가요, 예뻐요); `past` polite past (갔어요).
- Examples: polite 해요체 by default; target in braces around the conjugated form. No romanization in examples.

## nl — Dutch (Netherlands)
- Nouns: `g` c (de-word) | n (het-word) | pl. `forms.pl` whenever it exists; `forms.dim` when the diminutive is common (kopje).
- Verbs: `past` as "sg, pl" (at, aten), `pp` with auxiliary (heeft gegeten, is gegaan).
- Adjectives: `comp` when irregular (beter). Formal you: u.

## fr — French (France)
- Nouns: `g` m|f|mf|m.pl|f.pl. Nouns starting with a vowel or h need `art`: "l'" (h muet: l'homme) or "le"/"la" (h aspiré: le héros). `forms.pl` only when irregular (yeux, chevaux); `forms.f` for the feminine counterpart of people/animals (acteur → actrice).
- Verbs: `1sg` (je fais → "fais"), `1pl` when irregular, `pp` (fait), `aux` avoir|être. Pronominal: "se laver" (aux être).
- Adjectives: `f` when different (beau → belle), `pl` when irregular. Formal you: vous.

## hy — Armenian (Eastern, reformed orthography)
- Armenian script only; Eastern Armenian as used in Armenia, reformed spelling (ուժ, not ույժ).
- Nouns: `forms.pl` nominative plural (-եր / -ներ). No gender.
- Verbs: infinitive (-ել / -ալ); `aor` aorist 3sg (գրեց, կարդաց); `imp` imperative 2sg when irregular.
- Formal you: դուք. Romanization is generated by the app (BGN/PCGN); do not add `rom`.

## tr — Turkish (Turkey)
- Mind ı/i, İ/I. Nouns: `forms.acc` definite accusative (kitabı, ağacı, suyu) — shows consonant changes and harmony; `pl` only if irregular; `poss3` when irregular (su → suyu).
- Verbs: infinitive (-mek/-mak); `aor` aorist 3sg (gelir, yapar, alır) required; `prog` (geliyor) and `past` (geldi) optional.
- Formal you: siz.

## el — Greek (Modern, monotonic)
- Monotonic orthography only; the tonos is mandatory on every word of 2+ syllables.
- Nouns: `g` m|f|n|mf|m.pl|f.pl|n.pl (article is derived: ο/η/το). `forms.gen` genitive singular, `forms.pl` nominative plural.
- Verbs: lemma = 1sg present (γράφω); `aor` simple past 1sg (έγραψα); `fut` "θα + perfective 1sg" (θα γράψω).
- Adjectives: masculine nominative; `f` and `n` required (καλός, καλή, καλό).
- Formal you: εσείς. Romanization is generated by the app (ELOT 743); do not add `rom`.

## it — Italian (Italy)
- Standard Italian of Italy, the usual word rather than a regional one: macchina, cellulare, frigorifero, patente, bagno, colazione, autobus.
- Nouns: `g` m|f|mf|m.pl|f.pl (mf for nouns of either gender: il/la cantante, l'artista; m.pl/f.pl for pluralia tantum: gli occhiali, le forbici). The article is derived from `g` (il, la, il/la, i, le). Set `art` whenever the noun's first sound takes another one:
  - "l'" before a vowel or h, for m, f and mf alike (l'acqua, l'amico, l'ora, l'hotel, l'artista);
  - "lo" for masculine nouns before s + consonant, z, gn, ps, pn, x, y or i + vowel (lo studente, lo zaino, lo gnomo, lo psicologo, lo yogurt, lo iato); "lo/la" for such mf nouns;
  - "gli" for masculine plurals before a vowel or those sounds (gli occhiali, gli spinaci);
  - and wherever usage is irregular (il whisky, gli dei).
- `forms.pl` only when irregular (uomo → uomini, uovo → uova, mano → mani); `forms.f` for the feminine counterpart of a person or animal (attore → attrice, professore → professoressa, gatto → gatta).
- Verbs: infinitive (fare, andare, alzarsi). `1sg` present (faccio, vado, mi alzo), `pp` (fatto, andato), `aux` avere|essere (reflexive verbs take essere).
- Adjectives: masculine singular; `f` when different (bello → bella; not for -e adjectives such as grande); `pl` when not simply -i (lungo → lunghi, bianco → bianchi, greco → greci).
- Formal you: Lei; informal tu; plural voi.
- Examples: the article stays outside the braces, as in French: "Vorrei un bicchiere d'{acqua}.", "L'{acqua} è fredda."

## sv — Swedish (Sweden)
- Standard Swedish of Sweden (rikssvenska), not Finland Swedish: mobil, kylskåp, körkort, tunnelbana, lägenhet, toalett, dator.
- Nouns: `g` c (en-word) | n (ett-word) | pl (plural only: kläder, glasögon). The card shows "en bil", "ett hus". `forms.def` = definite singular, always (bilen, huset, flickan, äpplet, museet); `forms.pl` = indefinite plural whenever it exists (bilar, hus, flickor, äpplen, museer).
- Verbs: infinitive without att (skriva, gå); particle and reflexive verbs as written (tycka om, stänga av, känna sig). `pres` (skriver, går), `pret` (skrev, gick), `supine` (skrivit, gått). Deponents: finnas → finns, fanns, funnits.
- Adjectives: the basic (common-gender) form (stor, gammal, liten); `n` neuter and `pl` plural/definite when not simply + t / + a (gammal → gammalt, gamla; liten → litet, små; ny → nytt, nya); `comp` and `sup` when irregular (bra → bättre, bäst; stor → större, störst).
- You: du, with everyone today. The formal-you concept is ni, the dated polite singular (say so in `def`), so it shares its word with the plural ni: give both hints.

## uk — Ukrainian
- Standard Ukrainian of Ukraine, current (2019) orthography. Genuinely Ukrainian words, never Russian ones or surzhyk: дякую, будь ласка, вибачте, квиток, потяг, лікарня, вихідні, неділя (Sunday) vs тиждень (week).
- **Stress**: U+0301 after the stressed vowel in every word of 2+ syllables in `w`, `alt`, `forms` (вода́, мо́ва, украї́нський). Not in `hint`, `def`, `gl`. In examples, stress only inside the `{target}`. One-syllable words take none.
- The apostrophe is the typographic ’ (м’я́со, сім’я́, п’ять), never ʼ or '. Never the Russian letters ы э ё ъ.
- Nouns: `g` m|f|n|mf|pl (pl = plurale tantum: две́рі, гро́ші, окуля́ри). `forms.gen` = genitive singular (genitive plural for pluralia tantum); `forms.pl` = nominative plural if it exists; `forms.f` = feminine counterpart of a person noun (учи́тель → учи́телька, студе́нт → студе́нтка).
- Verbs: lemma is the imperfective unless the concept is inherently perfective. `aspect` ipf|pf|bi, `pair` = the aspect partner (most common one); `1sg`, `2sg` (present for ipf, simple future for pf); `3pl` when irregular; `past` as "m, f" when stress shifts or the stem changes (ніс, несла́; міг, могла́).
- Adjectives: masculine nominative singular (до́брий); `comp` when irregular (кра́щий, бі́льший, ме́нший).
- Formal you: ви.

## ga — Irish
- Standard Irish: the spelling and grammar of An Caighdeán Oifigiúil, with the síneadh fada (á é í ó ú) and never a grave accent. Vocabulary as used in Ireland today (fón póca, ríomhaire, carr, siopa). IPA: Connacht Irish (see the ipa unit).
- `w` in its radical form, without initial mutation or article (bean, cathair, uisce). Capitals for names and nationalities (Éire, Gaeilge, Éireannach).
- Nouns: `g` m|f|pl (pl = plural-only). `forms.gen` = genitive singular without the article, required (fear → fir, bean → mná, cathair → cathrach, uisce → uisce); `forms.pl` = nominative plural whenever it exists (fir, mná, cathracha).
- Verbs: the dictionary headword, the 2sg imperative (ól, téigh, bí, déan, faigh, tar). `vn` = verbal noun (ól, dul, bheith, déanamh, fáil, teacht) and `past` = the past tense as written without its pronoun (d'ól, chuaigh, bhí, rinne, fuair, tháinig), both required; `fut` = future, only when irregular (rachaidh, beidh, déanfaidh, gheobhaidh, tiocfaidh).
- Adjectives: base form (mór, maith); `comp` = the form after níos, when irregular (mó, fearr, measa, lú).
- Irish has no words for yes and no; answers repeat the verb. word-yes is "sea", word-no "ní hea" (the copula answers); say so in `def`.
- You: tú (one person), sibh (several). There is no polite form, so the formal-you concept is "tú" as well: give both tú entries hints.
- Examples: the target is the word as the sentence has it, mutation included ("Tá {bean} anseo.", "Chonaic mé an {bhean}.", "i {mbaile} mór").

## gd — Scottish Gaelic
- Standard Scottish Gaelic in the Gaelic Orthographic Conventions: grave accents only (à è ì ò ù: òran, mòr, fàilte), never an acute. Vocabulary as used in Scotland today (fòn-làimhe, coimpiutair, càr, bùth). IPA: a general Hebridean pronunciation (see the ipa unit).
- `w` in its radical form, without lenition or article (bean, taigh, cù). Capitals for names (Alba, Gàidhlig, Albannach).
- Nouns: `g` m|f|pl. `forms.gen` = genitive singular without the article, required (cù → coin, bean → mnà, taigh → taighe); `forms.pl` = plural whenever it exists (coin, mnathan, taighean).
- Verbs: the dictionary headword, the 2sg imperative (òl, rach, bi, dèan, faigh, thig). `vn` = verbal noun (òl, dol, bith, dèanamh, faighinn, tighinn) and `past` = the independent past (dh'òl, chaidh, bha, rinn, fhuair, thàinig), both required; `fut` = the independent future, only when irregular (thèid, bidh, nì, gheibh, thig).
- Adjectives: base form (mòr, math); `comp` = the form after nas, when irregular (motha, fheàrr, miosa, lugha).
- Gaelic has no words for yes and no; answers repeat the verb. word-yes is "seadh", word-no "chan eadh" (the copula answers); say so in `def`.
- You: thu (one person, informal); sibh (polite, and several people): the formal-you and plural-you concepts both get "sibh", with hints.
- Examples: the target is the word as the sentence has it, lenition included ("Tha {cù} agam.", "Chunnaic mi a {bhean}.").

## hu — Hungarian
- Standard Hungarian of Hungary. Long vowels with the acute (á é í ó ú) and the double acute (ő ű), never õ û ô.
- Nouns: no gender. `forms.pl` (házak, kertek, madarak) and `forms.acc` = accusative singular (házat, kertet, madarat), both required; `forms.poss3` = his/her, when irregular (víz → vize, ló → lova).
- Verbs: the dictionary form, 3sg present indefinite (ír, eszik, megy, alszik, tud); verbs with a prefix as one word (megír, elmegy, bemutat). `inf` = infinitive (írni, enni, menni, aludni) and `past` = 3sg past indefinite (írt, evett, ment, aludt), both required.
- Adjectives: the basic form (nagy, szép); `comp` when irregular (jó → jobb, sok → több, szép → szebb, kicsi → kisebb).
- You: te (informal), ön (polite), ti (plural).

## ar — Arabic (Modern Standard)
- Modern Standard Arabic (fuṣḥā) as written in the news, books and textbooks across the Arab world, never a dialect. Where countries differ, the word most widely understood.
- **Vowel marks (harakat)**: `w`, `alt` and `forms` are fully vowelized: every consonant carries its fatha, kasra, damma or sukun, a doubled one shadda and its vowel (مُعَلِّم, مَدْرَسَة, سَيَّارَة); the vowel before a letter of length (كِتَاب, كَبِير, سُوق). Nouns and adjectives in the citation form, without case ending or tanwin (كِتَاب, not كِتَابٌ); verbs as dictionaries give them (كَتَبَ, يَكْتُبُ). Hamza on its proper seat (سُؤَال, مَسْؤُول, قِرَاءَة).
- `w` without the article (كِتَاب, not الْكِتَاب), except words that always have it (الْيَوْم today, الْآن now).
- `hint`, `def`, `gl` and the example sentences are ordinary unvowelized Arabic. Only an example's `{target}` is fully vowelized, with the case ending the sentence gives it. The braces take the whole written word, with an article or a preposition attached to it: "شربت {الْمَاءَ} البارد.", "ذهبت {بِالسَّيَّارَةِ} إلى العمل."
- Punctuation: the Arabic comma ، semicolon ؛ and question mark ؟ (never the ASCII ones); full stop and exclamation mark as usual.
- Nouns: `g` m|f|pl (pl = plural-only). `forms.pl` = the plural whenever it exists, broken or sound (كِتَاب → كُتُب, مَدْرَسَة → مَدَارِس, مُعَلِّم → مُعَلِّمُون, سَيَّارَة → سَيَّارَات); `forms.f` = the feminine counterpart of a person noun (مُعَلِّم → مُعَلِّمَة, طَالِب → طَالِبَة).
- Verbs: the dictionary form, 3sg masculine past (كَتَبَ, ذَهَبَ, اِسْتَخْدَمَ). `pres` = 3sg masculine present (يَكْتُبُ, يَذْهَبُ, يَسْتَخْدِمُ) and `vn` = the verbal noun, maṣdar (كِتَابَة, ذَهَاب, اِسْتِخْدَام), both required.
- Adjectives: masculine singular (كَبِير); `f` when not simply + ة (أَحْمَر → حَمْرَاء); `pl` = the broken plural when common (كَبِير → كِبَار, صَغِير → صِغَار).
- When a word has a masculine and a feminine form for the person addressed, give both, masculine first, separated by " / " (أَنْتَ / أَنْتِ, كَيْفَ حَالُكَ / كَيْفَ حَالُكِ).
- You: أَنْتَ / أَنْتِ (one person); أَنْتُمْ (several). Arabic has no informal–formal pair, so the formal-you concept is the polite address حَضْرَتُكَ / حَضْرَتُكِ.
- `rom`: the romanization of `w` in its citation form, ALA-LC style, as pronounced: ā ī ū for long vowels; ḥ ṣ ḍ ṭ ẓ; ʿ (U+02BF) for ʿayn and ʾ (U+02BE) for hamza, but not at the start of a word; th kh dh sh gh; a doubled consonant for shadda; ta marbuta as -a (madrasa); final -iyy as -ī (ʿarabī); the article as pronounced (ash-shams, al-qamar); lower case; " / " as in `w`. كِتَاب kitāb, مَدْرَسَة madrasa, سُؤَال suʾāl, مُعَلِّم muʿallim, كَتَبَ kataba.

## vi — Vietnamese (Northern standard)
- Standard Vietnamese as spoken in Hà Nội (Northern): bát (bowl), lợn (pig), ngô (corn), ốm (ill), ô (umbrella), vâng (yes), bố (father), quả (fruit classifier); not the Southern chén, heo, bắp, bệnh, dù, dạ, ba, trái.
- Spelling: standard quốc ngữ with every tone mark, in precomposed characters; tone marks placed as most texts do (hòa, khỏe, thủy). Lower case except names. Syllables separated by spaces as written (bệnh viện, xe máy).
- No gender and no forms.
- `mw` = the classifier a noun takes when counted or pointed at (con mèo, cái bàn, chiếc xe, quyển sách, tờ giấy, quả táo, bức ảnh, ngôi nhà, đôi giày); omit for uncountable and abstract nouns and those that take none.
- Pronouns: Vietnamese addresses people with kinship terms. word-I is tôi; the informal-you concept bạn; the formal-you concept "ông / bà" (sir / madam, both in `w`, as the polite form for a man or a woman); the plural-you concept các bạn. Name the usual alternatives in `def`; `alt` is only for true synonyms.
