import { GIFT_INTERESTS, type GiftInterest } from '../../lib/api/giftIdeas'

// "Warum diese Ideen?" — interests guessed ON THE DEVICE from what a wishlist already shows (Find Gift,
// brief 4.4: explicit signals, explained, with an opt-out). Pure: no network, no storage, no React.
// - Input: only the title, the link's host and the price of each wish, and how much it is wished for.
//   Nothing about reservations (contract.md §9; follows-design G1/G7) — the type has no such field.
// - A small keyword → category map (DE + EN, umlauts folded: "Kopfhörer" = "kopfhoerer"). German compounds
//   match by their parts ("Zimmerpflanze" → plants); the LONGEST keyword in a word wins, so
//   "Lichterkette" is a home thing and never jewellery ("Kette"), "Teelicht" never tea.
// - Every category counts once per wish, weighted by "Wie sehr?" (Unbedingt 1.5 · Gern 1 · Kann 0.7); a
//   known shop adds a little. The top five are the chips; each remembers which wishes it came from.
// What leaves the device afterwards is only the list of category ids the person kept (lib/api/giftIdeas.ts).

export interface WishSignal {
  title: string
  url: string | null
  priceCents: number | null
  /** 3 Unbedingt · 2 Gern · 1 Kann */
  priority: 1 | 2 | 3
}

export interface InferredInterest {
  id: GiftInterest
  score: number
  /** the wish titles it came from, at most two (shown in "Warum diese Ideen?") */
  because: string[]
}

/** The brief asks for 3–5 interests: more would read like a profile, fewer like a guess. */
export const INTERESTS_SHOWN = 5

interface Keywords {
  /** matched anywhere inside a word (compounds): "kaffee" in "kaffeemuehle" */
  parts?: readonly string[]
  /** matched at the start of a word: "tee" in "teekanne" (but not in "steel") */
  starts?: readonly string[]
  /** matched as a whole word only (short or ambiguous): "ring", "uhr", "tea" */
  words?: readonly string[]
}

const KEYWORDS: Readonly<Record<GiftInterest, Keywords>> = {
  audio: {
    parts: ['kopfhoerer', 'headphone', 'headset', 'earbud', 'earphone', 'ohrhoerer', 'lautsprecher', 'speaker', 'soundbar', 'boombox', 'musikbox', 'noisecancel'],
    words: ['airpods', 'radio', 'kopfhorer'],
  },
  coffee: {
    parts: ['kaffee', 'coffee', 'espresso', 'cappuccino', 'barista', 'siebtraeger', 'frenchpress', 'aeropress', 'teekanne', 'teapot', 'teeset', 'matcha', 'pourover', 'milchschaeumer'],
    starts: ['tee', 'latte', 'chai'],
    words: ['tea', 'teas', 'mug', 'mugs', 'moka'],
  },
  books: {
    parts: ['buecher', 'buch', 'taschenbuch', 'taschenbuecher', 'lesezeichen', 'bookmark', 'krimi', 'thriller', 'manga', 'hoerbuch', 'audiobook', 'ebook', 'bildband', 'lyrik', 'bookshelf', 'buchstuetze'],
    words: ['book', 'books', 'novel', 'novels', 'roman', 'romane', 'comic', 'comics', 'reader', 'kindle', 'tolino', 'poetry'],
  },
  outdoor: {
    parts: ['wander', 'hiking', 'camping', 'zelt', 'rucksack', 'backpack', 'thermos', 'isolierflasche', 'haengematte', 'hammock', 'picknick', 'picnic', 'outdoor', 'lagerfeuer', 'campfire', 'schlafsack', 'taschenlampe', 'stirnlampe', 'headlamp', 'laterne', 'lantern', 'garten', 'hochbeet', 'feuerschale', 'taschenmesser'],
    words: ['tent', 'tents', 'garden', 'draussen'],
  },
  gaming: {
    parts: ['konsole', 'console', 'controller', 'gaming', 'gamer', 'videospiel', 'videogame', 'playstation', 'xbox', 'nintendo', 'gamepad', 'zocken'],
    words: ['ps5', 'ps4', 'steam'],
  },
  games: {
    parts: ['brettspiel', 'boardgame', 'kartenspiel', 'cardgame', 'gesellschaftsspiel', 'partyspiel', 'wuerfelspiel', 'puzzle', 'schach', 'chess', 'spielesammlung', 'escapespiel', 'quizspiel'],
    starts: ['spiel'],
    words: ['game', 'games', 'meeple', 'dice', 'jenga', 'uno', 'monopoly', 'catan', 'quiz'],
  },
  fashion: {
    parts: ['schal', 'scarf', 'muetze', 'beanie', 'socken', 'socks', 'pullover', 'pulli', 'sweater', 'hoodie', 'shirt', 'jacke', 'jacket', 'kleid', 'sneaker', 'schmuck', 'jewel', 'halskette', 'necklace', 'armband', 'bracelet', 'ohrring', 'earring', 'sonnenbrille', 'sunglasses', 'handschuh', 'gloves', 'guertel', 'tasche', 'jutebeutel', 'armbanduhr', 'portemonnaie', 'geldboerse', 'wallet'],
    words: ['ring', 'ringe', 'uhr', 'watch', 'cap', 'hut', 'hat', 'tote', 'belt', 'dress', 'kette'],
  },
  beauty: {
    parts: ['pflege', 'skincare', 'handcreme', 'gesichtscreme', 'creme', 'parfum', 'parfuem', 'perfume', 'badesalz', 'badebombe', 'bathbomb', 'seife', 'soap', 'massage', 'wellness', 'nagellack', 'lippenstift', 'lipstick', 'makeup', 'kosmetik', 'serum', 'gesichtsmaske', 'facemask', 'shampoo', 'bartoel', 'duschgel', 'bodylotion'],
    words: ['spa', 'cream', 'duft'],
  },
  plants: {
    parts: ['pflanz', 'pflegeleicht', 'monstera', 'kaktus', 'kakteen', 'cactus', 'sukkulente', 'succulent', 'blumentopf', 'uebertopf', 'kraeuter', 'giesskanne', 'blumen', 'flower', 'bonsai', 'orchidee', 'orchid', 'terrarium', 'samenbombe', 'saatgut'],
    words: ['plant', 'plants', 'planter', 'herb', 'herbs', 'seeds', 'samen'],
  },
  photo: {
    parts: ['kamera', 'camera', 'foto', 'photo', 'sofortbild', 'instax', 'polaroid', 'objektiv', 'stativ', 'tripod', 'fotoalbum', 'fotobuch'],
    words: ['lens', 'lenses'],
  },
  sport: {
    parts: ['yoga', 'fitness', 'laufschuh', 'running', 'joggen', 'fussball', 'football', 'basketball', 'tennis', 'badminton', 'fahrrad', 'radtrikot', 'trinkflasche', 'sportflasche', 'hantel', 'dumbbell', 'kettlebell', 'klettern', 'climbing', 'boulder', 'schwimm', 'swim', 'snowboard', 'skateboard', 'surf', 'wintersport', 'wassersport', 'trikot', 'faszienrolle', 'springseil', 'fitnessband'],
    // a start only: "Transport" is no sport
    starts: ['sport'],
    words: ['ball', 'golf', 'bike', 'ski', 'gym'],
  },
  travel: {
    parts: ['weltreise', 'rundreise', 'fernreise', 'reisekissen', 'travel', 'koffer', 'suitcase', 'kulturbeutel', 'kulturtasche', 'toiletry', 'nackenkissen', 'neckpillow', 'reisepass', 'passport', 'weltkarte', 'rubbelkarte', 'scratchmap', 'guidebook', 'urlaub', 'vacation', 'staedtereise', 'citytrip', 'gepaeck', 'luggage', 'globus', 'globe'],
    // a start only: "Preise" is no journey
    starts: ['reise'],
    words: ['flug', 'flight', 'trip'],
  },
  kitchen: {
    parts: ['kueche', 'kitchen', 'kochbuch', 'cookbook', 'kochkurs', 'kochen', 'cooking', 'messer', 'knife', 'pfanne', 'kochtopf', 'gewuerz', 'spice', 'grill', 'barbecue', 'schuerze', 'apron', 'backen', 'baking', 'backform', 'geschirr', 'teatowel', 'schneidebrett', 'cuttingboard', 'olivenoel', 'pfeffermuehle', 'besteck', 'eiscreme', 'auflaufform', 'nudelmaschine', 'thermomix', 'wok', 'tablett'],
    words: ['bbq', 'pan', 'pans', 'pasta', 'mixer', 'koch'],
  },
  music: {
    parts: ['musik', 'music', 'vinyl', 'schallplatte', 'plattenspieler', 'turntable', 'gitarre', 'guitar', 'ukulele', 'klavier', 'piano', 'konzert', 'concert', 'festival', 'kalimba', 'mundharmonika', 'harmonica', 'trommel', 'cajon', 'notenheft'],
    words: ['lp', 'drum', 'drums', 'spotify', 'platte'],
  },
  tech: {
    parts: ['ladegeraet', 'charger', 'powerbank', 'ladekabel', 'ladestation', 'smartwatch', 'smarthome', 'ipad', 'smartphone', 'handyhuelle', 'tastatur', 'drohne', 'drone', 'gadget', 'roboter', 'beamer', 'projektor', 'projector', 'webcam', 'festplatte', 'speicherkarte', 'airtag', 'tracker', 'smartlamp', 'usb'],
    // "tablet" as a word only: a German "Tablett" is a tray (kitchen)
    words: ['handy', 'phone', 'case', 'maus', 'mouse', 'cable', 'kabel', 'akku', 'monitor', 'ssd', 'tech', 'tablet'],
  },
  home: {
    parts: ['kerze', 'candle', 'teelicht', 'lichterkette', 'fairylight', 'stringlight', 'lampe', 'kuscheldecke', 'decke', 'blanket', 'kissen', 'cushion', 'vase', 'deko', 'decor', 'poster', 'bilderrahmen', 'bettwaesche', 'bedding', 'teppich', 'einweihung', 'housewarming', 'raumduft', 'diffuser', 'handtuch', 'wanduhr', 'korb', 'basket', 'wohnzimmer'],
    words: ['lamp', 'rug', 'frame', 'towel', 'towels', 'home'],
  },
  film: {
    parts: ['kino', 'cinema', 'movie', 'popcorn', 'streaming', 'netflix', 'bluray', 'filmabend', 'filmplakat'],
    starts: ['film'],
    words: ['dvd', 'serie', 'serien', 'series'],
  },
  creative: {
    parts: ['malen', 'malset', 'painting', 'zeichnen', 'drawing', 'skizzenbuch', 'sketchbook', 'stifte', 'pinsel', 'aquarell', 'watercolo', 'acryl', 'leinwand', 'canvas', 'basteln', 'bastel', 'stricken', 'strickset', 'strickzeug', 'strickwolle', 'knitting', 'yarn', 'naehen', 'sewing', 'toepfer', 'pottery', 'kalligrafie', 'calligraphy', 'lettering', 'modellbau', 'stickset'],
    // "Wolle" alone is yarn; a "Merinowolle" scarf is no craft
    words: ['diy', 'craft', 'crafts', 'brush', 'lego', 'wolle'],
  },
}

/** Shops whose name says what they sell (matched against the link's host only, never fetched). */
const SHOP_HINTS: ReadonlyArray<readonly [RegExp, GiftInterest]> = [
  [/(^|\.)(thalia|hugendubel|buecher|osiander|weltbild|buch7)\./, 'books'],
  [/(^|\.)(douglas|flaconi|notino)\./, 'beauty'],
  [/(^|\.)(zalando|aboutyou|asos|zara|uniqlo)\./, 'fashion'],
  [/(^|\.)(decathlon|sportscheck)\./, 'sport'],
  [/(^|\.)(globetrotter|bergfreunde|campz)\./, 'outdoor'],
  [/(^|\.)(mediamarkt|saturn|cyberport|notebooksbilliger|alternate)\./, 'tech'],
  [/(^|\.)(thomann|musicstore|justmusic)\./, 'music'],
  [/(^|\.)(fotokoch|calumet)\./, 'photo'],
  [/(^|\.)(ikea|westwing|butlers)\./, 'home'],
  [/(^|\.)(coffeecircle|tchibo)\./, 'coffee'],
  [/(^|\.)(dehner|pflanzen-koelle|bakker)\./, 'plants'],
  [/(^|\.)(spiele-offensive|brettspielversand)\./, 'games'],
  [/(^|\.)(gerstaecker|boesner|idee-shop)\./, 'creative'],
]

const PRIORITY_WEIGHT: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.7, 2: 1, 3: 1.5 }
const SHOP_WEIGHT = 0.5

/** Lower case, umlauts folded (ä → ae, ß → ss), other accents dropped, everything else a space. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Words that only LOOK like a keyword: they claim their letters and count for nothing. */
const BLOCKERS: readonly string[] = ['beispiel', 'entdeck', 'verwandel']

interface Hit {
  /** null = a blocker */
  interest: GiftInterest | null
  start: number
  end: number
}

interface Matcher {
  interest: GiftInterest | null
  keyword: string
  kind: 'part' | 'start' | 'word'
}

/** Every keyword once, longest first (the longest keyword in a word claims its letters). */
const MATCHERS: readonly Matcher[] = [
  ...BLOCKERS.map((keyword): Matcher => ({ interest: null, keyword, kind: 'part' })),
  ...GIFT_INTERESTS.flatMap((interest) => {
    const k = KEYWORDS[interest]
    return [
      ...(k.parts ?? []).map((keyword): Matcher => ({ interest, keyword, kind: 'part' })),
      ...(k.starts ?? []).map((keyword): Matcher => ({ interest, keyword, kind: 'start' })),
      ...(k.words ?? []).map((keyword): Matcher => ({ interest, keyword, kind: 'word' })),
    ]
  }),
].sort((a, b) => b.keyword.length - a.keyword.length)

function hitsInWord(word: string): Hit[] {
  const taken: Hit[] = []
  const overlaps = (start: number, end: number) => taken.some((hit) => start < hit.end && end > hit.start)
  for (const { interest, keyword, kind } of MATCHERS) {
    if (keyword.length > word.length) continue
    if (kind === 'word') {
      if (word === keyword && !overlaps(0, word.length)) taken.push({ interest, start: 0, end: word.length })
      continue
    }
    if (kind === 'start') {
      if (word.startsWith(keyword) && !overlaps(0, keyword.length)) taken.push({ interest, start: 0, end: keyword.length })
      continue
    }
    let from = 0
    for (;;) {
      const at = word.indexOf(keyword, from)
      if (at < 0) break
      if (!overlaps(at, at + keyword.length)) taken.push({ interest, start: at, end: at + keyword.length })
      from = at + 1
    }
  }
  return taken
}

/** The categories a text mentions (each once, in the order they appear). */
export function interestsInText(text: string): GiftInterest[] {
  const words = foldText(text).split(' ').filter(Boolean)
  // "noise cancelling", "French Press", "pour over": two-word names also count as one word
  const pairs = words.slice(1).map((word, i) => `${words[i]}${word}`)
  const found: GiftInterest[] = []
  for (const word of [...words, ...pairs]) {
    for (const hit of hitsInWord(word).sort((a, b) => a.start - b.start)) {
      if (hit.interest && !found.includes(hit.interest)) found.push(hit.interest)
    }
  }
  return found
}

/** A known shop of the link's host, else null (the host is never contacted). */
export function interestOfShop(url: string | null): GiftInterest | null {
  if (!url) return null
  let host: string
  try {
    host = `${new URL(url).hostname.toLowerCase().replace(/^www\./, '')}.`
  } catch {
    return null
  }
  for (const [pattern, interest] of SHOP_HINTS) if (pattern.test(host)) return interest
  return null
}

/**
 * The interests of a wishlist, strongest first (at most `max`, default five). Ties keep the order in which
 * the list mentions them. An empty list — or one that says nothing we know — gives no interests at all
 * (the screen then shows general ideas in the budget and says so).
 */
export function inferInterests(signals: readonly WishSignal[], max = INTERESTS_SHOWN): InferredInterest[] {
  const scores = new Map<GiftInterest, { score: number; because: string[]; first: number }>()
  let order = 0
  for (const wish of signals) {
    const weight = PRIORITY_WEIGHT[wish.priority] ?? 1
    const title = wish.title.trim()
    const fromTitle = interestsInText(title)
    const fromShop = interestOfShop(wish.url)
    const counted = new Set<GiftInterest>()
    for (const interest of fromTitle) {
      if (counted.has(interest)) continue
      counted.add(interest)
      const entry = scores.get(interest) ?? { score: 0, because: [], first: order++ }
      entry.score += weight
      if (title && entry.because.length < 2 && !entry.because.includes(title)) entry.because.push(title)
      scores.set(interest, entry)
    }
    if (fromShop && !counted.has(fromShop)) {
      const entry = scores.get(fromShop) ?? { score: 0, because: [], first: order++ }
      entry.score += SHOP_WEIGHT
      if (title && entry.because.length < 2 && !entry.because.includes(title)) entry.because.push(title)
      scores.set(fromShop, entry)
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].first - b[1].first)
    .slice(0, Math.max(0, max))
    .map(([id, entry]) => ({ id, score: Math.round(entry.score * 100) / 100, because: entry.because }))
}
