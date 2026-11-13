/**
 * Occasion covers (26.10, GALLERY-ONLY prototype, demo/covers/): the fixed list of cover motifs ("Motive").
 * Felix: an occasion without a photo gets one of OUR pictures when its title says what it is ("Geburtstag",
 * "Spieleabend", "Gym" …); nothing matches → nothing, as before. The host can also pick a motif by hand or switch
 * the automatic one off. The ids are the allow-list a later database column would check (like
 * `wishlists.cover_icon`), so they never change once shipped — only new ones may be added.
 */

/** Every cover motif, in the order of the picker (the most common occasions first). */
export const THEME_IDS = [
  'birthday',
  'party',
  'gamenight',
  'dinner',
  'bbq',
  'movie',
  'sport',
  'picnic',
  'concert',
  'housewarming',
  'wedding',
  'baby',
  'christmas',
  'newyear',
  'halloween',
  'easter',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/**
 * Which motif wins when a title names two ("Geburtstagsgrillen", "Weihnachtsfeier", "Halloween-Kinoabend"): the
 * REASON of the day before the activity, the specific before the generic; "Party" last of all.
 */
export const THEME_PRIORITY: readonly ThemeId[] = [
  'birthday',
  'wedding',
  'baby',
  'housewarming',
  'christmas',
  'newyear',
  'halloween',
  'easter',
  'gamenight',
  'movie',
  'concert',
  'sport',
  'bbq',
  'picnic',
  'dinner',
  'party',
];

export type Lang = 'de' | 'en' | 'ru';

/**
 * The background family of a picture: 1 apricot · 2 blush · 3 blue · 4 butter (the app's four tile tones,
 * styles/tiles.css) · 5 sage · 7 lilac (person tones 3 and 4) · 6 night (the navy theme's surfaces) for the three
 * evening motifs that need a dark sky.
 */
export type CoverTone = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ThemeMeta {
  id: ThemeId;
  tone: CoverTone;
  /** the motif's name in the picker (the app: i18n keys `occasionForm.cover_<id>`) */
  name: Record<Lang, string>;
  /** a mascot is a small guest in the picture */
  guest: 'pompon' | 'tapsi' | null;
  /** a fictional demo title for the gallery's feed cards (no real people) */
  sample: string;
}

export const THEMES: Readonly<Record<ThemeId, ThemeMeta>> = {
  birthday: { id: 'birthday', tone: 1, guest: 'pompon', sample: 'Annas 30. Geburtstag', name: { de: 'Geburtstag', en: 'Birthday', ru: 'День рождения' } },
  party: { id: 'party', tone: 2, guest: null, sample: 'Party bei Lisa', name: { de: 'Party', en: 'Party', ru: 'Вечеринка' } },
  gamenight: { id: 'gamenight', tone: 7, guest: 'tapsi', sample: 'Spieleabend bei Mila', name: { de: 'Spieleabend', en: 'Game night', ru: 'Вечер игр' } },
  dinner: { id: 'dinner', tone: 1, guest: null, sample: 'Raclette-Abend', name: { de: 'Essen', en: 'Dinner', ru: 'Ужин' } },
  bbq: { id: 'bbq', tone: 4, guest: null, sample: 'Grillabend bei Jonas', name: { de: 'Grillen', en: 'Barbecue', ru: 'Шашлыки' } },
  movie: { id: 'movie', tone: 3, guest: null, sample: 'Filmabend', name: { de: 'Filmabend', en: 'Movie night', ru: 'Кино' } },
  sport: { id: 'sport', tone: 5, guest: null, sample: 'Training mit Tom', name: { de: 'Sport', en: 'Sport', ru: 'Спорт' } },
  picnic: { id: 'picnic', tone: 3, guest: 'tapsi', sample: 'Picknick am See', name: { de: 'Picknick', en: 'Picnic', ru: 'Пикник' } },
  concert: { id: 'concert', tone: 6, guest: null, sample: 'Konzert im Park', name: { de: 'Konzert', en: 'Concert', ru: 'Концерт' } },
  housewarming: { id: 'housewarming', tone: 4, guest: null, sample: 'Wohnungseinweihung', name: { de: 'Einweihung', en: 'Housewarming', ru: 'Новоселье' } },
  wedding: { id: 'wedding', tone: 2, guest: null, sample: 'Hochzeit Lea & Ben', name: { de: 'Hochzeit', en: 'Wedding', ru: 'Свадьба' } },
  baby: { id: 'baby', tone: 7, guest: null, sample: 'Babyparty für Sarah', name: { de: 'Baby', en: 'Baby', ru: 'Малыш' } },
  christmas: { id: 'christmas', tone: 3, guest: 'pompon', sample: 'Weihnachten bei Oma', name: { de: 'Weihnachten', en: 'Christmas', ru: 'Рождество' } },
  newyear: { id: 'newyear', tone: 6, guest: null, sample: 'Silvester', name: { de: 'Silvester', en: 'New Year’s Eve', ru: 'Новый год' } },
  halloween: { id: 'halloween', tone: 6, guest: null, sample: 'Halloweenparty', name: { de: 'Halloween', en: 'Halloween', ru: 'Хэллоуин' } },
  easter: { id: 'easter', tone: 5, guest: 'pompon', sample: 'Osterbrunch', name: { de: 'Ostern', en: 'Easter', ru: 'Пасха' } },
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}
