/**
 * The data of the "Ideen → Kategorien" prototype (26.10, GALLERY-ONLY): the category row and ten games of the
 * "Brettspiele" draft. Each card is an entry of docs/research/2026-10-26-board-games.catalog-draft.json (same id,
 * players, minutes and price range — test/ideas-categories.test.ts keeps them equal); the gallery does not read the
 * docs folder itself (a missing file there must never break the gallery). No product photos: a drawn motif each.
 */

import type { CategoryId, MotifId } from './art';

export interface Category {
  id: CategoryId;
  label: string;
  /** ideas in it (Brettspiele: the draft + the 7 board/card games already in the catalogue; others: the catalogue's interest counts, handoff 25.10) */
  count: number;
  unit: string;
  isNew?: boolean;
}

export interface GameCard {
  /** = the draft entry's id */
  id: string;
  name: string;
  kind: string;
  publisher: string;
  players: readonly [number, number];
  minutes: readonly [number, number];
  age: number;
  /** cents: the cheapest and the dearest offer of the draft entry */
  price: readonly [number, number];
  award: string | null;
  blurb: string;
  motif: MotifId;
  tone: 1 | 2 | 3 | 4;
  /** offers as in the draft (shop + cents), for the detail sheet */
  offers: ReadonlyArray<{ shop: string; cents: number }>;
}

/** How many board games the category holds once the draft is in (the draft + Sky Team, Die Crew, Flip 7, Catan Big Box, Cities, Wildwuchs, Happy Holiday). */
export const DRAFT_COUNT = 24;
export const CATALOG_GAMES = 7;
/** Cents: the cheapest and the dearest offer of the whole draft (Wizard … Everdell), for the header line. */
export const DRAFT_PRICE_SPAN: readonly [number, number] = [589, 6999];

export const CATEGORIES: readonly Category[] = [
  { id: 'brettspiele', label: 'Brettspiele', count: DRAFT_COUNT + CATALOG_GAMES, unit: 'Spiele', isNew: true },
  { id: 'buecher', label: 'Bücher', count: 20, unit: 'Ideen' },
  { id: 'kaffee', label: 'Kaffee & Tee', count: 15, unit: 'Ideen' },
  { id: 'kueche', label: 'Küche', count: 17, unit: 'Ideen' },
  { id: 'erlebnisse', label: 'Erlebnisse', count: 5, unit: 'Ideen' },
  { id: 'draussen', label: 'Draußen', count: 15, unit: 'Ideen' },
  { id: 'musik', label: 'Musik', count: 12, unit: 'Ideen' },
  { id: 'kreativ', label: 'Kreativ', count: 8, unit: 'Ideen' },
];

export const GAMES: readonly GameCard[] = [
  { id: 'cat:hig-carcassonne', name: 'Carcassonne', kind: 'Legespiel', publisher: 'Hans im Glück', players: [2, 5], minutes: [35, 35], age: 7, price: [2199, 2699],
    award: 'Spiel des Jahres 2001', motif: 'carcassonne', tone: 1, offers: [{ shop: 'MediaMarkt', cents: 2199 }, { shop: 'Carcassonne & Co', cents: 2699 }],
    blurb: 'Plättchen für Plättchen wächst eine Landschaft mit Burgen, Straßen und Wiesen – der Klassiker, den jeder sofort versteht.' },
  { id: 'cat:dow-zug-um-zug', name: 'Zug um Zug', kind: 'Brettspiel', publisher: 'Days of Wonder', players: [2, 5], minutes: [30, 60], age: 8, price: [4599, 4599],
    award: 'Spiel des Jahres 2004', motif: 'zugumzug', tone: 3, offers: [{ shop: 'Brettspielversand', cents: 4599 }],
    blurb: 'Karten sammeln, Bahnstrecken bauen, anderen den Weg abschneiden: eine Zugreise quer durch Nordamerika, schnell erklärt.' },
  { id: 'cat:cge-codenames', name: 'Codenames', kind: 'Partyspiel', publisher: 'Czech Games Edition', players: [4, 8], minutes: [15, 15], age: 10, price: [1519, 1995],
    award: 'Spiel des Jahres 2016', motif: 'codenames', tone: 2, offers: [{ shop: 'Müller', cents: 1519 }, { shop: 'HeidelBÄR Games', cents: 1995 }],
    blurb: 'Zwei Teams, ein Wort als Hinweis: Wer zuerst alle eigenen Agenten findet, gewinnt. Perfekt für Abende mit vielen Leuten.' },
  { id: 'cat:nextmove-azul', name: 'Azul', kind: 'Legespiel', publisher: 'Next Move Games', players: [2, 4], minutes: [30, 45], age: 8, price: [3199, 3199],
    award: 'Spiel des Jahres 2018', motif: 'azul', tone: 3, offers: [{ shop: 'Müller', cents: 3199 }],
    blurb: 'Bunte Fliesen ziehen und zu einem Mosaik legen. Schnell gelernt, schön anzusehen und überraschend gemein.' },
  { id: 'cat:feuerland-fluegelschlag', name: 'Flügelschlag', kind: 'Brettspiel', publisher: 'Feuerland Spiele', players: [1, 5], minutes: [40, 70], age: 10, price: [3199, 3399],
    award: 'Kennerspiel des Jahres 2019', motif: 'fluegelschlag', tone: 3, offers: [{ shop: 'Müller', cents: 3199 }, { shop: 'MediaMarkt', cents: 3399 }],
    blurb: 'Vögel anlocken, Eier legen, Lebensräume füllen – ein ruhiges Strategiespiel mit wunderschönen Karten, auch allein spielbar.' },
  { id: 'cat:schmidt-quacksalber', name: 'Die Quacksalber von Quedlinburg', kind: 'Brettspiel', publisher: 'Schmidt Spiele', players: [2, 4], minutes: [45, 45], age: 10, price: [2639, 3999],
    award: 'Kennerspiel des Jahres 2018', motif: 'quacksalber', tone: 4, offers: [{ shop: 'Müller', cents: 2639 }, { shop: 'Schmidt Spiele', cents: 3999 }],
    blurb: 'Zutaten blind aus dem Beutel ziehen und den Kessel füllen – bis er knallt. Zocken mit Lachgarantie.' },
  { id: 'cat:pegasus-dorfromantik', name: 'Dorfromantik – Das Brettspiel', kind: 'Legespiel', publisher: 'Pegasus Spiele', players: [1, 6], minutes: [30, 60], age: 8, price: [2999, 3999],
    award: 'Spiel des Jahres 2023', motif: 'dorfromantik', tone: 1, offers: [{ shop: 'MediaMarkt', cents: 2999 }, { shop: 'Pegasus Spiele', cents: 3999 }],
    blurb: 'Gemeinsam eine Landschaft aus Sechsecken legen und Aufträge erfüllen – gemütlich, kooperativ, mit Kampagne.' },
  { id: 'cat:repos-7-wonders-duel', name: '7 Wonders Duel', kind: 'Spiel für zwei', publisher: 'Repos Production', players: [2, 2], minutes: [30, 30], age: 10, price: [3123, 3123],
    award: null, motif: 'duel', tone: 4, offers: [{ shop: 'Hugendubel', cents: 3123 }],
    blurb: 'Ein Zivilisationsduell nur für zwei: Karten nehmen, Weltwunder bauen, den anderen militärisch oder mit Wissenschaft schlagen.' },
  { id: 'cat:nsv-the-mind', name: 'The Mind', kind: 'Kartenspiel', publisher: 'NSV', players: [2, 4], minutes: [15, 20], age: 8, price: [799, 1239],
    award: 'Nominiert: Spiel des Jahres 2018', motif: 'themind', tone: 4, offers: [{ shop: 'Müller', cents: 799 }, { shop: 'Pegasus Spiele', cents: 1239 }],
    blurb: 'Zahlenkarten in die richtige Reihenfolge legen – ohne ein Wort. Klingt unmöglich, fühlt sich an wie Gedankenlesen.' },
  { id: 'cat:repos-just-one', name: 'Just One', kind: 'Ratespiel', publisher: 'Repos Production', players: [3, 7], minutes: [20, 20], age: 8, price: [1759, 1829],
    award: 'Spiel des Jahres 2019', motif: 'justone', tone: 2, offers: [{ shop: 'Müller', cents: 1759 }, { shop: 'Alternate', cents: 1829 }],
    blurb: 'Alle schreiben einen Hinweis, doppelte fliegen raus – ein Ratespiel, bei dem alle zusammen gewinnen.' },
];

// ---------------------------------------------------------------------------------------------- filters

export type PlayersFilter = 'all' | 'two' | 'four' | 'party';
export type TimeFilter = 'all' | 'short' | 'mid' | 'long';
export type PriceFilter = 'all' | 'low' | 'mid' | 'high';
export interface Filters {
  players: PlayersFilter;
  time: TimeFilter;
  price: PriceFilter;
}
export const NO_FILTER: Filters = { players: 'all', time: 'all', price: 'all' };

/** The pills cycle through these (the app would open a small sheet with the same choices). */
export const FILTER_STEPS = {
  players: ['all', 'two', 'four', 'party'],
  time: ['all', 'short', 'mid', 'long'],
  price: ['all', 'low', 'mid', 'high'],
} as const satisfies { [K in keyof Filters]: readonly Filters[K][] };

export const FILTER_LABELS: { [K in keyof Filters]: Record<Filters[K], string> } = {
  players: { all: 'Spieler', two: 'Zu zweit', four: 'Zu viert', party: 'Ab 6' },
  time: { all: 'Dauer', short: 'Bis 30 Min', mid: '30–60 Min', long: 'Über 60 Min' },
  price: { all: 'Preis', low: 'Bis 20 €', mid: '20–40 €', high: 'Über 40 €' },
};

/**
 * Does the game fit? Players: the box allows that many (two / four) or six and more (party). Duration: the longest
 * printed time (a "30–60 Min" game is not short). Price: the cheapest offer.
 */
export function fits(game: Pick<GameCard, 'players' | 'minutes' | 'price'>, f: Filters): boolean {
  const [pMin, pMax] = game.players;
  const okPlayers =
    f.players === 'all' ||
    (f.players === 'two' && pMin <= 2 && pMax >= 2) ||
    (f.players === 'four' && pMin <= 4 && pMax >= 4) ||
    (f.players === 'party' && pMax >= 6);
  const long = game.minutes[1];
  const okTime = f.time === 'all' || (f.time === 'short' && long <= 30) || (f.time === 'mid' && long > 30 && long <= 60) || (f.time === 'long' && long > 60);
  const cents = game.price[0];
  const okPrice = f.price === 'all' || (f.price === 'low' && cents <= 2000) || (f.price === 'mid' && cents > 2000 && cents <= 4000) || (f.price === 'high' && cents > 4000);
  return okPlayers && okTime && okPrice;
}

/** "2–4" / "2" */
export const span = ([a, b]: readonly [number, number]): string => (a === b ? String(a) : `${a}–${b}`);

/** "ca. 25 €" / "ca. 25–30 €" (whole euros, like the app's priceRangeLabel for gift ideas) */
export function priceLabel([min, max]: readonly [number, number]): string {
  const eur = (c: number) => String(Math.round(c / 100));
  return min === max || eur(min) === eur(max) ? `ca. ${eur(min)} €` : `ca. ${eur(min)}–${eur(max)} €`;
}

/** "29,99 €" */
export function offerLabel(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')} €`;
}
