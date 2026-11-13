/**
 * The detection table (26.10, demo/covers/): sample occasion titles with the motif they MUST get — shared by the
 * gallery's table and test/covers.test.ts. Invented titles and first names only (fixtures, no real people).
 * `trap` = a title that must NOT get the motif a careless word list would give it (the note says which).
 */

import type { ThemeId } from './themes';

export interface SampleTitle {
  title: string;
  expect: ThemeId | null;
  /** the occasion's calendar day 'YYYY-MM-DD' (only for the date rules) */
  date?: string;
  /** a trap: what a careless list would get wrong */
  trap?: string;
}

export const SAMPLE_TITLES: readonly SampleTitle[] = [
  // ---- birthday
  { title: 'Geburtstagsparty', expect: 'birthday' },
  { title: 'Annas 30. Geburtstag', expect: 'birthday' },
  { title: 'Kindergeburtstag Mila', expect: 'birthday' },
  { title: 'Geburstag Oma', expect: 'birthday', trap: 'опечатка: пропущена «t»' },
  { title: 'Lisa wird 30', expect: 'birthday' },
  { title: 'Geburtstagsgrillen', expect: 'birthday', trap: 'и «гриль», и «день рождения»: важнее повод' },
  { title: 'Bday Brunch', expect: 'birthday' },
  { title: "Max's Birthday", expect: 'birthday' },
  { title: 'ДР Маши', expect: 'birthday' },
  { title: 'День рождения Кирилла', expect: 'birthday' },
  { title: 'Днюха', expect: 'birthday' },
  { title: 'Юбилей бабушки', expect: 'birthday' },
  // ---- party
  { title: 'Party bei Lisa', expect: 'party' },
  { title: 'Gartenfest bei Mila', expect: 'party' },
  { title: 'Abschiedsparty Jonas', expect: 'party' },
  { title: 'Silvias Feier', expect: 'party', trap: '«Silv…» — не Silvester' },
  { title: 'Вечеринка', expect: 'party' },
  // ---- game night
  { title: 'Spieleabend bei Mila', expect: 'gamenight' },
  { title: 'Brettspiele & Pizza', expect: 'gamenight', trap: 'пицца — это «еда», но игры важнее' },
  { title: 'Pokerabend', expect: 'gamenight' },
  { title: 'Game Night', expect: 'gamenight' },
  { title: 'LAN-Party', expect: 'gamenight', trap: 'это не просто «Party»' },
  { title: 'Настолки у Пети', expect: 'gamenight' },
  { title: 'Вечер игр', expect: 'gamenight' },
  // ---- movie, concert
  { title: 'Kino', expect: 'movie' },
  { title: 'Filmabend', expect: 'movie' },
  { title: 'Movie night', expect: 'movie' },
  { title: 'Konzert im Park', expect: 'concert' },
  { title: 'Festival-Wochenende', expect: 'concert' },
  { title: 'Karaoke', expect: 'concert' },
  { title: 'Концертный зал', expect: 'concert', trap: '«зал» здесь не спортзал' },
  // ---- sport
  { title: 'Gym', expect: 'sport' },
  { title: 'Training mit Tom', expect: 'sport' },
  { title: 'Fußballspiel', expect: 'sport', trap: '«…spiel» — не вечер игр' },
  { title: 'Bouldern', expect: 'sport' },
  { title: 'Yoga am See', expect: 'sport', trap: '«am See» — не пикник' },
  { title: 'Зал', expect: 'sport' },
  { title: 'Тренировка', expect: 'sport' },
  { title: 'Настольный теннис', expect: 'sport', trap: '«настольный» — не настолки' },
  // ---- barbecue, picnic, dinner
  { title: 'Grillen', expect: 'bbq' },
  { title: 'Grillabend bei Jonas', expect: 'bbq' },
  { title: 'BBQ', expect: 'bbq' },
  { title: 'Шашлыки на даче', expect: 'bbq' },
  { title: 'Picknick im Park', expect: 'picnic' },
  { title: 'Picknik am See', expect: 'picnic', trap: 'опечатка: без «c»' },
  { title: 'Пикник', expect: 'picnic' },
  { title: 'Abendessen', expect: 'dinner' },
  { title: 'Raclette-Abend', expect: 'dinner' },
  { title: 'Essen bei Oma', expect: 'dinner' },
  { title: 'Brunch', expect: 'dinner' },
  // ---- wedding, baby, housewarming
  { title: 'Hochzeit Lea & Ben', expect: 'wedding' },
  { title: 'Polterabend', expect: 'wedding' },
  { title: 'Свадьба', expect: 'wedding' },
  { title: 'Юбилей свадьбы', expect: 'wedding', trap: '«юбилей» — не день рождения' },
  { title: 'Babyparty', expect: 'baby', trap: 'это не просто «Party»' },
  { title: 'Baby Shower für Sarah', expect: 'baby' },
  { title: 'Taufe von Emil', expect: 'baby' },
  { title: 'Wohnungseinweihung', expect: 'housewarming' },
  { title: 'Einweihungsparty', expect: 'housewarming' },
  { title: 'Новоселье', expect: 'housewarming' },
  // ---- holidays
  { title: 'Weihnachten bei Oma', expect: 'christmas' },
  { title: 'Weinachtsfeier Büro', expect: 'christmas', trap: 'опечатка: без «h»' },
  { title: 'Wichteln', expect: 'christmas' },
  { title: 'Silvester', expect: 'newyear' },
  { title: 'Silvesterparty', expect: 'newyear' },
  { title: 'Новый год', expect: 'newyear' },
  { title: 'NYE', expect: 'newyear' },
  { title: 'Halloween', expect: 'halloween' },
  { title: 'Halloween-Kinoabend', expect: 'halloween' },
  { title: 'Хэллоуин', expect: 'halloween' },
  { title: 'Osterbrunch', expect: 'easter' },
  { title: 'Ostern bei den Großeltern', expect: 'easter' },
  // ---- the date upgrades a GENERIC title only
  { title: 'Familientreffen', date: '2026-12-24', expect: 'christmas' },
  { title: 'Party', date: '2026-12-31', expect: 'newyear' },
  { title: 'Abendessen', date: '2026-12-25', expect: 'christmas' },
  { title: 'Brunch', date: '2026-04-05', expect: 'easter', trap: 'Пасха 2026 — 5 апреля' },
  { title: 'Spieleabend', date: '2026-12-24', expect: 'gamenight', trap: 'точное название важнее даты' },
  { title: 'Familientreffen', expect: null, trap: 'без даты — ничего' },
  // ---- must stay EMPTY
  { title: 'Trauerfeier für Opa', expect: null, trap: '«…feier» — но это похороны' },
  { title: 'Beerdigung', expect: null },
  { title: 'Похороны', expect: null },
  { title: 'Zahnarzt', expect: null },
  { title: 'Feierabendbier', expect: null, trap: '«Feier…» — это «после работы»' },
  { title: 'Klosterbesuch', expect: null, trap: '«…oster…» — не Пасха' },
  { title: 'Skiurlaub in Österreich', expect: null, trap: 'Österreich → «osterreich»' },
  { title: 'Poster drucken', expect: null },
  { title: 'Möbeltransport', expect: null, trap: '«…sport…» внутри слова' },
  { title: 'Ausflug nach Essen', expect: null, trap: 'Essen — город' },
  { title: 'Halle (Saale)', expect: null, trap: '«Halle» — город, не спортзал' },
  { title: 'Weinnacht', expect: null, trap: 'винная ночь — одна НЕВЕРНАЯ буква от Weihnacht' },
  { title: 'Einweisung neue Kollegen', expect: null, trap: 'одна неверная буква от Einweihung' },
  { title: 'Spielplatz', expect: null, trap: '«Spiel…» — детская площадка' },
  { title: 'Schauspielkurs', expect: null },
  { title: 'Elternabend Gymnasium', expect: null, trap: '«Gym…» — гимназия' },
  { title: 'Kommunikationstraining', expect: null, trap: 'тренинг, не спорт' },
  { title: 'Babysitten bei Mila', expect: null, trap: '«Baby…» — присмотр за ребёнком' },
  { title: 'Schachtel packen', expect: null, trap: '«Schach…» — коробка' },
  { title: 'Adventure-Golf', expect: null, trap: '«Advent…» — не Адвент' },
  { title: 'Manifest lesen', expect: null, trap: '«…fest» — не праздник' },
  { title: 'Банкетный зал', expect: null, trap: '«зал» — не спортзал' },
  { title: 'Treffen mit Jo', expect: null },
  { title: 'Steuererklärung', expect: null },
  { title: 'Встреча', expect: null },
  { title: 'Umzug helfen', expect: 'housewarming' },
  { title: 'Karnevalsumzug', expect: null, trap: '«…umzug» — шествие, не переезд' },
];
