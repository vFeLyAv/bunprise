/**
 * Which cover motif fits an occasion title (26.10, GALLERY-ONLY prototype, demo/covers/) — a small pure function that
 * runs ON THE DEVICE ONLY: no AI service, no server, the title never leaves the phone.
 *
 *   themeOf('Spieleabend bei Mila')                → 'gamenight'
 *   themeOf('Familientreffen', { date: '2026-12-24' }) → 'christmas'
 *   themeOf('Trauerfeier für Opa')                 → null
 *
 * Precision over recall (Felix: a wrong picture is worse than none): a hand-written word list per motif in German,
 * English and Russian — always ALL three, whatever the viewer's language, so a guest with an English app sees the same
 * picture as the German host (that is why there is no `language` parameter). How a title is read:
 *   1. normalise: lower case, ß → ss, accents off (ä → a, ё → е, й → и), everything but letters and digits = a space;
 *   2. a sad or medical word anywhere (Trauerfeier, Beerdigung, Krankenhaus, похороны …) → null, nothing else counts;
 *   3. the motifs in THEME_PRIORITY order, the first that matches wins (the reason of the day before the activity:
 *      "Geburtstagsgrillen" = birthday);
 *   4. weak birthday words ("юбилей") only when nothing else matched;
 *   5. the date only upgrades a generic title: "Party" / "Abendessen" / "Familientreffen" on Dec 24–26 → Christmas,
 *      Dec 31 / Jan 1 → New Year's Eve, Oct 31 → Halloween, Easter Sunday / Monday → Easter. A specific title keeps
 *      its own motif ("Spieleabend" on Dec 24 stays a game night).
 *
 * Patterns (one small language, so the lists stay readable):
 *   'kino'      the whole word          'kino*'    a word that starts so (Kinoabend)
 *   '*grill*'   anywhere inside a word  '*fest'    a word that ends so (Sommerfest)
 *   '~geburtstag'  anywhere inside a word, one typo allowed (a missing, extra or swapped letter — never a WRONG
 *                  letter: "Weinachten" = Christmas, but "Weinnacht" is a wine night); only for stems ≥ 8 letters
 *   'game night'   words in a row (each may end in *)   '/(?:^| )wird \d{1,3}(?: |$)/'  a regular expression
 * `not` lists words that never count for that motif ('-' words: "Österreich" is no Easter, "Essen" after "nach" is
 * the city, "банкетный зал" is no gym).
 */

import { THEME_PRIORITY, type ThemeId } from './themes';

export interface ThemeRule {
  theme: ThemeId;
  words: readonly string[];
  not?: readonly string[];
}

/** Title words that mean "no festive picture, ever" — checked first. */
export const BLOCKED: readonly string[] = [
  'trauer*', '*trauerfeier*', 'beerdigung*', 'beisetzung*', 'bestattung*', 'gedenk*', 'todestag*', 'friedhof*',
  'krankenhaus*', 'klinik*', '*arzt*', 'operation*', 'op termin',
  'funeral*', 'memorial*', 'hospital*', 'cemetery',
  'похорон*', 'помин*', 'кладбищ*', 'больниц*', 'врач*', 'операци*',
];

export const RULES: readonly ThemeRule[] = [
  {
    theme: 'birthday',
    words: [
      '~geburtstag', 'wiegenfest', 'bday', 'b day', '~birthday',
      'др', 'днюх*', 'днюшк*', 'день рождени*', 'дн* рождени*', 'день варень*', 'именин*',
      '/(?:^| )wird \\d{1,3}(?: |$)/', '/(?:^| )turns \\d{1,3}(?: |$)/', '/(?:^| )исполня\\S* \\d{1,3}(?: |$)/',
    ],
  },
  {
    theme: 'wedding',
    words: [
      '~hochzeit', 'trauung', 'standesamt*', 'polterabend*', 'verlobung*',
      'wedding*', 'engagement party', 'bridal shower',
      'свадьб*', 'свадеб*', 'помолвк*', 'венчани*', 'бракосочетани*',
    ],
  },
  {
    theme: 'baby',
    words: [
      'baby*', 'gender reveal', 'babypinkeln', 'pullerparty', 'taufe', 'taufe*', 'tauffeier', 'christening', 'baptism',
      'беби шауэр', 'бэби шауэр', 'бейби шауэр', 'бебишауэр', 'крестин*', 'роддом*',
    ],
    not: ['babysit*', 'babysitter*'],
  },
  {
    theme: 'housewarming',
    words: ['~einweihung', 'einzugsparty', 'umzug*', 'housewarming', 'house warming', 'moving day', 'новосель*', 'переезд*'],
  },
  {
    theme: 'christmas',
    words: [
      '~weihnacht', 'heiligabend', 'heilig abend', 'wichteln', 'wichtel*', 'advent*', 'nikolaus*', 'gluhwein*', 'gluehwein*', 'platzchen*',
      'christmas*', 'xmas', 'x mas', 'secret santa',
      'рождеств*', 'сочельник*',
    ],
    not: ['adventure*'],
  },
  {
    theme: 'newyear',
    words: [
      '~silvester', 'sylvester*', 'neujahr*', 'jahreswechsel*',
      'nye', 'new year*', 'new years eve',
      'нов* год*', 'новогодн*', 'нг',
    ],
  },
  {
    theme: 'halloween',
    words: ['~halloween', 'helloween', 'grusel*', 'trick or treat', 'хэллоуин*', 'хеллоуин*', 'хелоуин*', 'хэлоуин*'],
  },
  {
    theme: 'easter',
    words: ['oster*', 'eiersuche', 'easter*', 'пасх*'],
    // after ä → a: "Österreich" reads "osterreich"; two towns
    not: ['osterreich*', 'osterode*', 'osterholz*'],
  },
  {
    theme: 'gamenight',
    words: [
      '~spieleabend', 'spielabend*', 'spielenachmittag*', 'spieletreff*', 'spielenacht', 'spielerunde*', '*brettspiel*', '*gesellschaftsspiel*', '*kartenspiel*',
      'poker*', 'skat', 'skatabend*', 'skatrunde*', 'doppelkopf*', 'doko', 'catan', 'siedler*', 'monopoly', 'werwolf*', 'romme*',
      'schach', 'schachabend*', 'schachturnier*', 'zocken', 'zockabend*', 'lan party', 'lanparty*', 'videospiel*', 'gaming*', 'pen paper', 'pen and paper',
      'game night*', 'games night*', 'gamenight*', 'board game*', 'boardgame*',
      'настолк*', 'настольн* игр*', 'вечер игр', 'игров* вечер*', 'мафи*', 'покер*', 'игротек*',
    ],
  },
  {
    theme: 'movie',
    words: ['kino*', 'film*', 'serienabend*', 'serienmarathon*', 'movie*', 'cinema*', 'netflix*', 'кино*', 'фильм*'],
  },
  {
    theme: 'concert',
    words: [
      'konzert*', 'konzi', 'festival*', 'gig', 'gigs', 'livemusik*', 'live musik', 'open air', 'openair*', 'karaoke*', 'oper', 'opera', 'musical*',
      'jam session', 'jamsession*', 'bandprobe*',
      'concert*', 'live music',
      'концерт*', 'фестивал*', 'караоке', 'опера', 'оперу', 'мюзикл*',
    ],
  },
  {
    theme: 'sport',
    words: [
      'gym', 'fitness*', 'training', 'trainingsabend*', 'workout*', 'sport*', '*fussball*', 'kicken', 'kicker*', 'basketball*', '*volleyball*',
      'handball*', 'tennis*', 'tischtennis*', 'padel*', 'badminton*', 'squash', 'yoga*', 'pilates', 'laufen', 'lauftreff*', 'joggen', 'jogging',
      'marathon', 'halbmarathon', 'boulder*', 'bouldern', 'klettern', 'kletterhalle*', 'schwimmen', 'crossfit*', 'spinning', 'turnhalle*',
      'run', 'football', 'soccer', 'running',
      'зал', 'спортзал*', 'качалк*', 'тренировк*', 'фитнес*', 'йога', 'йогу', 'йогой', 'футбол*', 'пробежк*', 'спорт*', 'бассейн*', 'теннис*',
      'волейбол*', 'баскетбол*', 'настольн* теннис*',
    ],
    not: ['банкетн* зал', 'актов* зал', 'выставочн* зал', 'читальн* зал', 'зал ожидани*', 'зал торжеств'],
  },
  {
    theme: 'bbq',
    words: ['*grill*', 'bbq', 'barbecue', 'barbeque', 'шашлык*', 'барбекю', 'мангал*', 'гриль*'],
  },
  {
    theme: 'picnic',
    words: ['~picknick', 'picnic*', 'пикник*'],
  },
  {
    theme: 'dinner',
    words: [
      'essen', 'abendessen', 'mittagessen', 'familienessen', 'teamessen', 'essen gehen', 'dinner*', 'lunch*', 'brunch*', 'fruhstuck*', 'fruehstueck*',
      'kochen', 'kochabend*', 'kochkurs*', 'raclette*', 'fondue*', 'sushi*', 'pizza*', 'tapas*', 'buffet', 'kaffee und kuchen', 'kaffeeklatsch*', 'restaurant*',
      'breakfast', 'ужин*', 'обед', 'обеда', 'завтрак*', 'бранч*', 'пицц*',
    ],
    // "Essen" after a preposition is the city ("Ausflug nach Essen")
    not: ['in essen', 'nach essen', 'aus essen', 'von essen', 'bis essen'],
  },
  {
    theme: 'party',
    words: [
      '*party*', '*feier*', 'fete', 'sause', 'fest', '*fest', 'jga', 'junggesell*', 'disco*', 'abiball*', 'abschlussball*',
      'celebration', 'вечеринк*', 'тусовк*', 'туса', 'тусич', 'пати', 'праздник*', 'корпоратив*', 'девичник*', 'мальчишник*', 'выпускн*',
    ],
    // after work (Feierabend) is no party; a manifest neither
    not: ['feierabend*', 'manifest*'],
  },
];

/** Weak birthday words: only when no motif matched ("юбилей свадьбы" stays a wedding). */
export const WEAK_BIRTHDAY: readonly string[] = ['юбиле*', 'jubilaum*'];

/** Generic gathering words: no motif of their own, but on a holiday date they take the holiday's motif. */
export const GENERIC: readonly string[] = [
  'treffen', '*treffen', 'familie*', 'besuch*', 'zusammensein', 'get together', 'gathering', 'family*', 'встреч*', 'семейн*', 'семья', 'семьей',
];

/** The motifs a date may replace (a generic title); a specific motif always keeps itself. */
const DATE_UPGRADES: ReadonlySet<ThemeId> = new Set(['party', 'dinner']);

// ---------------------------------------------------------------------------------------------------------------

/** Lower case, ß → ss, accents off (ä → a, ё → е, й → и), every run of non-letters/digits = one space. */
export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

type Matcher =
  | { kind: 'word' | 'prefix' | 'part' | 'suffix' | 'typo'; text: string; source: string }
  | { kind: 'phrase'; parts: readonly { text: string; prefix: boolean }[]; source: string }
  | { kind: 'regex'; re: RegExp; source: string };

/** One pattern of the little language → a matcher (the pattern text normalised like a title). */
export function compilePattern(source: string): Matcher {
  if (source.startsWith('/') && source.endsWith('/') && source.length > 2) return { kind: 'regex', re: new RegExp(source.slice(1, -1), 'u'), source };
  if (source.startsWith('~')) return { kind: 'typo', text: normalizeTitle(source.slice(1)), source };
  const words = source.split(' ').filter(Boolean);
  if (words.length > 1) {
    return {
      kind: 'phrase',
      parts: words.map((w) => ({ text: normalizeTitle(w.replace(/\*$/, '')), prefix: w.endsWith('*') })),
      source,
    };
  }
  const lead = source.startsWith('*');
  const tail = source.endsWith('*');
  const text = normalizeTitle(source.replace(/^\*|\*$/g, ''));
  if (lead && tail) return { kind: 'part', text, source };
  if (lead) return { kind: 'suffix', text, source };
  if (tail) return { kind: 'prefix', text, source };
  return { kind: 'word', text, source };
}

/** true when `a` turns into `b` with at most ONE missing, extra or swapped (neighbouring) letter — no wrong letter. */
export function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === b.length) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i += 1;
    return i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length - short.length !== 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i += 1;
  return short.slice(i) === long.slice(i + 1);
}

/** `stem` inside `token`, exactly or with one slip (stems of 8+ letters only — shorter ones are too easy to hit). */
export function nearlyContains(token: string, stem: string): boolean {
  if (token.includes(stem)) return true;
  if (stem.length < 8) return false;
  for (let i = 0; i < token.length; i += 1) {
    for (const len of [stem.length - 1, stem.length, stem.length + 1]) {
      const window = token.slice(i, i + len);
      if (window.length === len && oneSlip(window, stem)) return true;
    }
  }
  return false;
}

function tokenHit(m: Extract<Matcher, { text: string }>, token: string): boolean {
  switch (m.kind) {
    case 'word':
      return token === m.text;
    case 'prefix':
      return token.startsWith(m.text);
    case 'suffix':
      return token.length > m.text.length && token.endsWith(m.text);
    case 'part':
      return token.includes(m.text);
    case 'typo':
      return nearlyContains(token, m.text);
  }
}

/** The token indices a matcher covers in the title (empty = no match); a regex covers none but reports a hit. */
function hits(m: Matcher, tokens: readonly string[], flat: string, skip: ReadonlySet<number>): { at: number[]; text: string } | null {
  if (m.kind === 'regex') {
    const found = m.re.exec(flat);
    return found ? { at: [], text: found[0].trim() } : null;
  }
  if (m.kind === 'phrase') {
    const n = m.parts.length;
    for (let i = 0; i + n <= tokens.length; i += 1) {
      let ok = true;
      for (let j = 0; j < n && ok; j += 1) {
        const part = m.parts[j];
        const token = tokens[i + j];
        if (!part || token === undefined || skip.has(i + j)) ok = false;
        else ok = part.prefix ? token.startsWith(part.text) : token === part.text;
      }
      if (ok) return { at: Array.from({ length: n }, (_, j) => i + j), text: tokens.slice(i, i + n).join(' ') };
    }
    return null;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token !== undefined && !skip.has(i) && tokenHit(m, token)) return { at: [i], text: token };
  }
  return null;
}

/** Every token index an exception covers, at every place in the title ("Essen in Essen": only the second one). */
function covered(matchers: readonly Matcher[], tokens: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const m of matchers) {
    for (let i = 0; i < tokens.length; i += 1) {
      const rest = tokens.slice(i);
      const hit = hits(m, rest, rest.join(' '), new Set());
      if (hit && hit.at[0] === 0) for (const j of hit.at) out.add(i + j);
    }
  }
  return out;
}

interface CompiledRule {
  theme: ThemeId;
  words: readonly Matcher[];
  not: readonly Matcher[];
}

const COMPILED: readonly CompiledRule[] = THEME_PRIORITY.map((theme) => {
  const rule = RULES.find((r) => r.theme === theme);
  return { theme, words: (rule?.words ?? []).map(compilePattern), not: (rule?.not ?? []).map(compilePattern) };
});
const BLOCKED_M = BLOCKED.map(compilePattern);
const WEAK_M = WEAK_BIRTHDAY.map(compilePattern);
const GENERIC_M = GENERIC.map(compilePattern);

function firstHit(matchers: readonly Matcher[], tokens: readonly string[], flat: string, skip: ReadonlySet<number> = new Set()): { source: string; text: string } | null {
  for (const m of matchers) {
    const hit = hits(m, tokens, flat, skip);
    if (hit) return { source: m.source, text: hit.text };
  }
  return null;
}

// ---- the date ------------------------------------------------------------------------------------------------------

/** Easter Sunday of a Gregorian year (anonymous Gregorian algorithm): [month 1–12, day]. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** The holiday of a calendar day 'YYYY-MM-DD' (the occasion's own day), or null. */
export function holidayOf(day: string): ThemeId | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  if (mo === 12 && d >= 24 && d <= 26) return 'christmas';
  if ((mo === 12 && d === 31) || (mo === 1 && d === 1)) return 'newyear';
  if (mo === 10 && d === 31) return 'halloween';
  const [em, ed] = easterSunday(y);
  const sunday = Date.UTC(y, em - 1, ed);
  const that = Date.UTC(y, mo - 1, d);
  if (that === sunday || that === sunday + 86_400_000) return 'easter';
  return null;
}

// ---- the answer ----------------------------------------------------------------------------------------------------

export type GuessVia = 'word' | 'weak' | 'date' | 'blocked' | 'none';

export interface ThemeGuess {
  theme: ThemeId | null;
  via: GuessVia;
  /** the pattern that decided (for the gallery's "why") */
  pattern: string | null;
  /** the title's words it matched */
  matched: string | null;
}

export interface ThemeOptions {
  /** the occasion's calendar day 'YYYY-MM-DD' (its own time zone) — only upgrades a generic title */
  date?: string;
}

/** The motif for a title, with the reason (the gallery's playground and table show it). */
export function explainTheme(title: string, options: ThemeOptions = {}): ThemeGuess {
  const flat = normalizeTitle(title);
  const tokens = flat === '' ? [] : flat.split(' ');
  if (tokens.length === 0) return { theme: null, via: 'none', pattern: null, matched: null };
  const blocked = firstHit(BLOCKED_M, tokens, flat);
  if (blocked) return { theme: null, via: 'blocked', pattern: blocked.source, matched: blocked.text };

  let found: ThemeGuess | null = null;
  for (const rule of COMPILED) {
    const skip = covered(rule.not, tokens);
    const hit = firstHit(rule.words, tokens, flat, skip);
    if (hit) {
      found = { theme: rule.theme, via: 'word', pattern: hit.source, matched: hit.text };
      break;
    }
  }
  if (!found) {
    const weak = firstHit(WEAK_M, tokens, flat);
    if (weak) return { theme: 'birthday', via: 'weak', pattern: weak.source, matched: weak.text };
  }

  const holiday = options.date ? holidayOf(options.date) : null;
  if (holiday && (found ? DATE_UPGRADES.has(found.theme as ThemeId) : firstHit(GENERIC_M, tokens, flat) !== null)) {
    return { theme: holiday, via: 'date', pattern: options.date ?? null, matched: found?.matched ?? firstHit(GENERIC_M, tokens, flat)?.text ?? null };
  }
  return found ?? { theme: null, via: 'none', pattern: null, matched: null };
}

/** The motif for an occasion title, or null (no picture — as before). Pure, on the device only. */
export function themeOf(title: string, options: ThemeOptions = {}): ThemeId | null {
  return explainTheme(title, options).theme;
}
