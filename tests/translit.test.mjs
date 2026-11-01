import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruToLatin, ukToLatin, srToLatin, srToCyrillic, hyToLatin, elToLatin, SCHEMES } from '../src/text/translit.js';

/** @param {(s: string) => string} fn @param {Record<string, string>} cases */
function check(fn, cases) {
  for (const [input, expected] of Object.entries(cases)) assert.equal(fn(input), expected.normalize('NFC'), input);
}

test('Russian: readable scheme with optional stress', () => {
  check((s) => ruToLatin(s), {
    'вода́': 'vodá',
    'спаси́бо': 'spasíbo',
    'есть': 'yest',
    'съесть': 'syest',
    'пьёшь': 'pyosh',
    'ребёнок': 'rebyónok',
    'жёлтый': 'zhólty',
    'объём': 'obyóm',
    'щи': 'shchi',
    'Москва́': 'Moskvá',
    'Юрий': 'Yuriy',
    'ВНЖ': 'VNZH',
    'Щу́ка': 'Shchúka',
    'большо́й': 'bolshóy',
    'ма́ленький': 'málenkiy',
    'су́тки': 'sútki',
    'вид на жи́тельство': 'vid na zhítelstvo',
    'понеде́льник': 'ponedélnik',
    'семья́': 'semyá',
  });
  check((s) => ruToLatin(s, { stress: false }), {
    'вода́': 'voda',
    'ребёнок': 'rebyonok',
    'ма́ленький, небольшо́й': 'malenkiy, nebolshoy',
  });
});

test('Ukrainian: the national system of 2010 (examples from its table), with optional stress', () => {
  check((s) => ukToLatin(s, { stress: false }), {
    'Алушта': 'Alushta',
    'Борщагівка': 'Borshchahivka',
    'Вінниця': 'Vinnytsia',
    'Гадяч': 'Hadiach',
    'Згорани': 'Zghorany',
    'Розгон': 'Rozghon',
    'Ґалаґан': 'Galagan',
    'Єнакієве': 'Yenakiieve',
    'Гаєвич': 'Haievych',
    'Закарпаття': 'Zakarpattia',
    'Їжакевич': 'Yizhakevych',
    'Кадиївка': 'Kadyivka',
    'Йосипівка': 'Yosypivka',
    'Стрий': 'Stryi',
    'Харків': 'Kharkiv',
    'Біла Церква': 'Bila Tserkva',
    'Гоща': 'Hoshcha',
    'Юрій': 'Yurii',
    'Корюківка': 'Koriukivka',
    'Яготин': 'Yahotyn',
    'Ічня': 'Ichnia',
    'Знам’янка': 'Znamianka',
    'ЦНАП': 'TSNAP',
  });
  check(ukToLatin, { 'вода́': 'vodá', 'сім’я́': 'simiá', 'Украї́на': 'Ukraína' });
});

test('Serbian Cyrillic → Latin is exact', () => {
  check(srToLatin, {
    'вода': 'voda',
    'јести': 'jesti',
    'љубав': 'ljubav',
    'Љубав': 'Ljubav',
    'ЉУБАВ': 'LJUBAV',
    'Џ': 'Dž',
    'њега': 'njega',
    'џем': 'džem',
    'ђак': 'đak',
    'ћерка': 'ćerka',
    'Чаша и шака': 'Čaša i šaka',
    'хвала вам': 'hvala vam',
    'понедељак': 'ponedeljak',
    'Шта си {јео} за доручак?': 'Šta si {jeo} za doručak?',
  });
});

test('Serbian Latin → Cyrillic (search)', () => {
  check(srToCyrillic, {
    'ljubav': 'љубав',
    'Ljubav': 'Љубав',
    'LJUBAV': 'ЉУБАВ',
    'džem': 'џем',
    'đak': 'ђак',
    'čaša': 'чаша',
    'ponedeljak': 'понедељак',
  });
  for (const word of ['рука', 'хвала вам', 'дозвола за боравак', 'Џем', 'Њујорк']) assert.equal(srToCyrillic(srToLatin(word)), word);
});

test('Armenian: BGN/PCGN 1981 (examples from the PCGN table)', () => {
  check(hyToLatin, {
    'Արաքս': 'Arak’s',
    'Բյուրական': 'Byurakan',
    'Գյումրի': 'Gyumri',
    'Դիլիջան': 'Dilijan',
    'Երևան': 'Yerevan',
    'Զվարթնոց': 'Zvart’nots’',
    'Էրեբունի': 'Erebuni',
    'Ընկուզեկ': 'Ynkuzek',
    'Թեղենավ': 'T’eghenav',
    'Ժանգոտ': 'Zhangot',
    'Իջեվան': 'Ijevan',
    'Լոռի': 'Lorri',
    'Խաչքարեր': 'Khach’k’arer',
    'Ծիծեռնակաբերդ': 'Tsitserrnakaberd',
    'Կապան': 'Kapan',
    'Հայկաշեն': 'Haykashen',
    'Ձորաշեն': 'Dzorashen',
    'Ղազարի': 'Ghazari',
    'Լիճ': 'Lich',
    'Մասիս': 'Masis',
    'Հայկաձոր': 'Haykadzor',
    'Նաիրի': 'Nairi',
    'Շիրակ': 'Shirak',
    'Որոտան': 'Vorotan',
    'Չըռչըռ': 'Ch’yrrch’yrr',
    'Պարույր Սևակ': 'Paruyr Sevak',
    'Ջերմուկ': 'Jermuk',
    'Սպիտակ': 'Spitak',
    'Վանաձոր': 'Vanadzor',
    'Տավրուս': 'Tavrus',
    'Արարատ': 'Ararat',
    'Ցիցլեռ': 'Ts’its’lerr',
    'ՈՒրմիա': 'Urmia',
    'Փոս': 'P’os',
    'Քանաքեռ-Զեյթուն': 'K’anak’err-Zeyt’un',
    'Օրոր': 'Oror',
    'Ֆանտան': 'Fantan',
  });
  check(hyToLatin, {
    'ով': 'ov',
    'և': 'yev',
    'ջուր': 'jur',
    'Ինչպե՞ս ես։': 'Inch’pes? yes.',
    'հայերեն': 'hayeren',
    'ուժ': 'uzh',
  });
});

test('Greek: ELOT 743 (examples from the PCGN table)', () => {
  check(elToLatin, {
    'Άρτα': 'Árta',
    'Ακταίο': 'Aktaío',
    'Νεράϊδα': 'Neráïda',
    'Μαυροβούνι': 'Mavrovoúni',
    'Ναύπλιο': 'Náfplio',
    'Ταΰγετος': 'Taÿ́getos',
    'Βόλος': 'Vólos',
    'Γαράζο Γουριά Άγναντα Γλυφάδα': 'Garázo Gouriá Ágnanta Glyfáda',
    'Αγχίαλος': 'Anchíalos',
    'Λόγγος': 'Lóngos',
    'Λαγκάδα': 'Lagkáda',
    'Δένδρα': 'Déndra',
    'Ερέτρια': 'Erétria',
    'Ηράκλειο': 'Irákleio',
    'Μαρινέϊκα': 'Marinéïka',
    'Ρεύματα': 'Révmata',
    'Λευκάδα': 'Lefkáda',
    'Ζεμενό': 'Zemenó',
    'Θεσπιές': 'Thespiés',
    'Ίρια': 'Íria',
    'Καλαμάκι': 'Kalamáki',
    'Λίμνη': 'Límni',
    'Μαραθώνας': 'Marathónas',
    'Μπέχρος': 'Béchros',
    'Τέμπη': 'Témpi',
    'Νεστάνη': 'Nestáni',
    'Ντία': 'Ntía',
    'Ξάνθη': 'Xánthi',
    'Όθος': 'Óthos',
    'Δελφοί': 'Delfoí',
    'Δοϊράνι': 'Doïráni',
    'Βούναργο': 'Voúnargo',
    'Παύλος': 'Pávlos',
    'Μερόπι': 'Merópi',
    'Άσσος': 'Ássos',
    'Σάμος': 'Sámos',
    'Τίρυνθα': 'Tíryntha',
    'Πέντε Βρύσες': 'Pénte Vrýses',
    'Υλίκη': 'Ylíki',
    'Φιλοθέη': 'Filothéi',
    'Χαραυγή': 'Charavgí',
    'Ψαρά': 'Psará',
    'Ωρωπός': 'Oropós',
    'Αθήνα': 'Athína',
    'Οινούσσες': 'Oinoússes',
    'Οίτη': 'Oíti',
    'Αύρα': 'Ávra',
    'Γαύριο': 'Gávrio',
    'Καλλιπεύκα': 'Kallipéfka',
    'Κως': 'Kos',
    'Αχαΐα': 'Achaḯa',
  });
  check(elToLatin, { 'νερό': 'neró', 'ΚΤΕΟ': 'KTEO', 'ευχαριστώ': 'efcharistó', 'μπαμπάς': 'bampás' });
});

test('schemes are registered under the names languages.json uses', async () => {
  const { default: languages } = await import('../data/meta/languages.json', { with: { type: 'json' } });
  for (const code of [...languages.active, ...languages.staged]) {
    const lang = languages.languages[code];
    if (lang.romanization?.source === 'rule') assert.ok(SCHEMES[lang.romanization.scheme], lang.romanization.scheme);
    if (lang.otherScript) assert.ok(SCHEMES[lang.otherScript.rule], lang.otherScript.rule);
  }
});
