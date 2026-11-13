import data from './catalog.de.json'
import { GIFT_PHOTO_PREFIX } from './photoRules'

// The provider behind POST /api/gift-ideas: our own catalogue of REAL products of German/EU online shops
// (catalog.de.json, picked and checked by hand — docs/handoffs/2026-10-25-gift-catalog.md). Pure and
// deterministic, no network: nothing about the person leaves the Worker, no shop learns anything.
// The answer follows the STABLE CONTRACT in apps/web/src/lib/api/giftIdeas.ts:
// - pictures: the product's real photo from its shop page through our Worker, "/api/gift-ideas/img/<art>/<id>"
//   (photo.ts; Felix 25.10, closed pilot), else our own drawing "/api/gift-ideas/art/<art id>" (drawn, never fetched);
// - every offer is sponsored: false (no partner links, no paid placements; a test checks the URLs);
// - as_of = the oldest check date of the shown items (prices are approximate, "Stand …").
// Ordering is the demo's (apps/web/src/features/gifts/demo/answer.ts): personalised = the interests in turns
// (best of the first, best of the second, …); not personalised = by rank. Paging: `exclude_ids` drops what
// the app already showed; the cursor ("v1.<n>") is the position in the ordered list where a page ended.
// Topics ("Stöbern nach Thema", 26.10): `topic` asks for one shelf — all of it in one page by our order, its
// items with their facts (`game`, `blurb`, `how_to_play`); the first page of a deck also says how many ideas each
// shelf holds (`topics`, added by the route). The request still carries no interests and nothing of a person.

/** = GIFT_INTERESTS of the app (apps/web/src/lib/api/giftIdeas.ts); a test keeps both lists equal. */
export const GIFT_INTERESTS = [
  'audio', 'coffee', 'books', 'outdoor', 'gaming', 'games', 'fashion', 'beauty', 'plants',
  'photo', 'sport', 'travel', 'kitchen', 'music', 'tech', 'home', 'film', 'creative',
] as const
export type GiftInterest = (typeof GIFT_INTERESTS)[number]

/** The app's own drawings (apps/web/src/features/gifts/art DEMO_ART); a test keeps both lists equal. */
export const GIFT_ART_IDS = [
  'album', 'bathset', 'blanket', 'boardgame', 'books', 'bottle', 'camera', 'candle', 'cards', 'controller',
  'grinder', 'headphones', 'herbs', 'knife', 'lamp', 'lantern', 'lights', 'map', 'openbook', 'paints',
  'pillow', 'plant', 'popcorn', 'pourover', 'powerbank', 'puzzle', 'scarf', 'speaker', 'spices', 'teapot',
  'thermos', 'tongs', 'tote', 'tubes', 'ukulele', 'vinyl', 'yarn', 'yoga',
] as const

export const GIFT_ART_PREFIX = '/api/gift-ideas/art/'

/**
 * The languages of the catalogue's texts (30.10: the app's UI languages). German is always there; every other
 * language is optional per field and falls back: Russian / Ukrainian → English → German, English → German.
 */
export const CATALOG_LANGS = ['de', 'en', 'ru', 'uk'] as const
export type CatalogLang = (typeof CATALOG_LANGS)[number]
const LANG_SET: ReadonlySet<string> = new Set(CATALOG_LANGS)
export const isCatalogLang = (value: unknown): value is CatalogLang => typeof value === 'string' && LANG_SET.has(value)
/** One text in several languages: German always, the others where they exist. */
export type Localized = { de: string } & Partial<Record<Exclude<CatalogLang, 'de'>, string>>
const FALLBACK: Readonly<Record<CatalogLang, readonly CatalogLang[]>> = {
  de: ['de'],
  en: ['en', 'de'],
  ru: ['ru', 'en', 'de'],
  uk: ['uk', 'en', 'de'],
}

/** The text in the asked language, else the next one of its fallback chain — and the language it is in. */
export function pickText(text: Localized, lang: CatalogLang): { text: string; lang: CatalogLang } {
  for (const candidate of FALLBACK[lang]) {
    const value = text[candidate]
    if (typeof value === 'string' && value !== '') return { text: value, lang: candidate }
  }
  return { text: text.de, lang: 'de' }
}
export const CATALOG_PAGE_SIZE = 6

export interface CatalogOffer {
  shop: string
  url: string
  price_cents: number
  /** YYYY-MM-DD: when a person last saw this price on the shop's page */
  checked_at: string
}

/**
 * "Stöbern nach Thema" (Felix 26.10, docs/design/2026-10-26-ideas-categories.md): shelves of the same catalogue.
 * Board games are marked by hand (`topic: "brettspiele"`, with their facts); every other topic is one interest —
 * without the board games, which have their own shelf. = GIFT_TOPICS of the app (a test keeps both lists equal).
 */
export const GIFT_TOPICS = ['brettspiele', 'buecher', 'kaffee', 'kueche', 'draussen', 'musik', 'kreativ'] as const
export type GiftTopic = (typeof GIFT_TOPICS)[number]
const TOPIC_INTEREST: Readonly<Record<Exclude<GiftTopic, 'brettspiele'>, GiftInterest>> = {
  buecher: 'books', kaffee: 'coffee', kueche: 'kitchen', draussen: 'outdoor', musik: 'music', kreativ: 'creative',
}
/**
 * A topic is small (≤ 100 ideas): it comes in one page, the app filters on the device. The app takes as many items from
 * one answer (GIFT_IDEAS_ITEMS_MAX in apps/web/src/lib/api/giftIdeas.ts); tests fail when a shelf outgrows the page.
 */
export const TOPIC_PAGE_SIZE = 100

/**
 * Taste directions (Felix 27.10: "анализировать бренд … спортивный — предлагать Gymshark"): the app reads them ON
 * THE DEVICE from the brands, product words and prices of a wishlist (apps/web/src/features/gifts/styles.ts) and
 * sends only these ids — never a brand, a wish or a name. Catalogue items carry the ones that honestly fit (`styles`).
 * No gender, no age: a style says what someone likes, never who they are. = GIFT_STYLES of the app (a test).
 */
export const GIFT_STYLES = [
  'athleisure', 'outdoor', 'scandi', 'streetwear', 'natural', 'specialty-coffee', 'tea', 'analog', 'cozy', 'kitchen-pro', 'tech', 'gaming',
] as const
export type GiftStyle = (typeof GIFT_STYLES)[number]
const STYLE_SET: ReadonlySet<string> = new Set(GIFT_STYLES)
export const isGiftStyle = (value: unknown): value is GiftStyle => typeof value === 'string' && STYLE_SET.has(value)

/** A prize of the jury "Spiel des Jahres" (sdj) / "Kennerspiel des Jahres" (kdj): written as text, never its logo. */
export interface CatalogAward {
  prize: 'sdj' | 'kdj'
  year: number
  /** on the shortlist, not the winner */
  nominated?: boolean
}

/** What the box says about a board game (publisher / shop pages, docs/research/2026-10-26-board-games.md). */
export interface CatalogGame {
  /** the game's own name ("Carcassonne"), the same in every language */
  name: string
  publisher: string
  players_min: number
  /** absent = open-ended: the box says "ab <players_min>" (Jenga: "1+ Spieler") */
  players_max?: number
  minutes_min: number
  minutes_max: number
  age_min: number
  award?: CatalogAward
}

export interface CatalogItem {
  id: string
  interests: readonly GiftInterest[]
  art: string
  /** 1 = shown first when nothing is personalised; every rank once */
  rank: number
  title: Localized & { en: string }
  offers: readonly CatalogOffer[]
  /** The product photo on the shop's page (https, final URL after redirects), set by scripts/catalog-photos.mjs */
  image_source?: string
  /** a hand-marked shelf (only board games so far) */
  topic?: 'brettspiele'
  /** the taste directions it honestly fits (hand-tagged, 27.10) */
  styles?: readonly GiftStyle[]
  game?: CatalogGame
  /** our own short text (≤ 140 characters in every language) */
  blurb?: Localized
  /** "So wird gespielt": 2–4 sentences in our own words from the official rules (≤ 300 characters in every language) */
  how_to_play?: Localized
  /** a book's facts (publisher / shop pages, docs/research/2026-10-27-books.md) */
  book?: CatalogBook
  /** "Worum geht's": 1–2 short sentences in our own words (≤ 200 characters), never the publisher's text */
  about?: Localized
}

export interface CatalogBook {
  author: string
  publisher: string
  pages: number
  /** the year of this edition */
  year: number
  genre: Localized
}

export interface CatalogRequest {
  interests: readonly GiftInterest[]
  budget: { min_cents: number; max_cents: number }
  exclude_ids: readonly string[]
  /** the app's UI language; each text falls back per field (pickText) */
  lang: CatalogLang
  /** the next_cursor of the previous page, already parsed (undefined = first page) */
  start?: number
  /** one shelf instead of a deck: all of it by our order, no interests (unknown id = an empty shelf) */
  topic?: string
  /** taste directions read ON THE DEVICE from the wishes' brands and words (27.10): the best matches come first */
  styles?: readonly GiftStyle[]
}

/** The extension of a topic answer's items (only what the item has). */
export interface CatalogTopicExtras {
  /** players_max null = open-ended ("ab <players_min>") */
  game?: Omit<CatalogGame, 'award' | 'players_max'> & { players_max: number | null; award: CatalogAward | null }
  blurb?: string
  /** the language the blurb is in (the asked one, or its fallback) */
  blurb_lang?: CatalogLang
  how_to_play?: string
  /** the language of how_to_play (the asked one, or its fallback: the app then says which language it is) */
  how_to_play_lang?: CatalogLang
  book?: Omit<CatalogBook, 'genre'> & { genre: string }
  /** "Worum geht's" in the asked language (or its fallback) */
  about?: string
  about_lang?: CatalogLang
}

export interface CatalogAnswer {
  items: Array<{
    id: string
    title: string
    image_url: string
    price_min_cents: number
    price_max_cents: number
    offers: Array<{ shop: string; price_cents: number; url: string; sponsored: false }>
    interests: GiftInterest[]
  } & CatalogTopicExtras>
  next_cursor: string | null
  as_of: string | null
}

const INTEREST_SET: ReadonlySet<string> = new Set(GIFT_INTERESTS)
export const isGiftInterest = (value: unknown): value is GiftInterest => typeof value === 'string' && INTEREST_SET.has(value)
const TOPIC_SET: ReadonlySet<string> = new Set(GIFT_TOPICS)
export const isGiftTopic = (value: unknown): value is GiftTopic => typeof value === 'string' && TOPIC_SET.has(value)

type RawItem = (typeof data.items)[number]

/**
 * A text of the JSON in its languages: only the known language keys with a non-empty string are kept; without its
 * German text the field counts as missing (null). (A test checks the JSON itself: keys, lengths, every language.)
 */
export function readLocalized(value: unknown): Localized | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const de = record.de
  if (typeof de !== 'string' || de === '') return null
  const out: Localized = { de }
  for (const lang of CATALOG_LANGS) {
    const text = record[lang]
    if (lang !== 'de' && typeof text === 'string' && text !== '') out[lang] = text
  }
  return out
}

/** The JSON entry as a typed item (the JSON's literals are plain strings; anything unexpected is left out). */
function readItem(item: RawItem): CatalogItem {
  const raw = item as RawItem & {
    topic?: string
    styles?: string[]
    game?: Record<string, unknown> & { award?: { prize?: string; year?: number; nominated?: boolean } }
    blurb?: unknown
    how_to_play?: unknown
    book?: { author: string; publisher: string; pages: number; year: number; genre: unknown }
    about?: unknown
  }
  const styles = (raw.styles ?? []).filter(isGiftStyle)
  const title = readLocalized(raw.title) ?? { de: raw.id }
  const blurb = readLocalized(raw.blurb)
  const howTo = readLocalized(raw.how_to_play)
  const about = readLocalized(raw.about)
  const genre = raw.book ? readLocalized(raw.book.genre) : null
  const out: CatalogItem = {
    id: raw.id,
    interests: raw.interests.filter(isGiftInterest),
    art: raw.art,
    rank: raw.rank,
    // every title has German and English (a test checks the JSON)
    title: { ...title, en: title.en ?? title.de },
    offers: raw.offers,
    ...(raw.image_source ? { image_source: raw.image_source } : {}),
    ...(raw.topic === 'brettspiele' ? { topic: 'brettspiele' as const } : {}),
    ...(styles.length > 0 ? { styles } : {}),
    ...(blurb ? { blurb } : {}),
    ...(howTo ? { how_to_play: howTo } : {}),
    ...(raw.book && genre ? { book: { author: raw.book.author, publisher: raw.book.publisher, pages: raw.book.pages, year: raw.book.year, genre } } : {}),
    ...(about ? { about } : {}),
  }
  const game = raw.game
  if (game) {
    const award = game.award
    out.game = {
      name: String(game.name),
      publisher: String(game.publisher),
      players_min: Number(game.players_min),
      ...(typeof game.players_max === 'number' ? { players_max: game.players_max } : {}),
      minutes_min: Number(game.minutes_min),
      minutes_max: Number(game.minutes_max),
      age_min: Number(game.age_min),
      ...(award && (award.prize === 'sdj' || award.prize === 'kdj') && typeof award.year === 'number'
        ? { award: { prize: award.prize, year: award.year, ...(award.nominated ? { nominated: true } : {}) } }
        : {}),
    }
  }
  return out
}

export const CATALOG: readonly CatalogItem[] = data.items.map(readItem)

/** Is the item on the shelf? Board games by their mark; the other topics by interest, without the board games. */
export function inTopic(item: Pick<CatalogItem, 'topic' | 'interests'>, topic: GiftTopic): boolean {
  if (topic === 'brettspiele') return item.topic === 'brettspiele'
  return item.topic === undefined && item.interests.includes(TOPIC_INTEREST[topic])
}

/** How many ideas each shelf holds (the app shows a shelf from 8 ideas on). */
export function topicCounts(items: readonly CatalogItem[] = CATALOG): Array<{ id: GiftTopic; count: number }> {
  return GIFT_TOPICS.map((id) => ({ id, count: items.filter((item) => inTopic(item, id)).length }))
}

const CURSOR = /^v1\.(\d{1,5})$/

/** "v1.<n>" → n; anything else → null (the request is then invalid). */
export function parseCursor(raw: string): number | null {
  const match = CURSOR.exec(raw)
  return match ? Number(match[1]) : null
}

/** The item's picture: its photo through our Worker when it has one, else our drawing. */
export function pictureUrl(item: Pick<CatalogItem, 'id' | 'art' | 'image_source'>): string {
  return item.image_source ? `${GIFT_PHOTO_PREFIX}${item.art}/${item.id}` : `${GIFT_ART_PREFIX}${item.art}`
}

function priceRange(item: CatalogItem): { min: number; max: number } {
  const prices = item.offers.map((offer) => offer.price_cents)
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

/** An idea counts when its price range touches the budget (apps/web/src/features/gifts/budget.ts fitsBudget). */
function fitsBudget(item: CatalogItem, budget: CatalogRequest['budget']): boolean {
  const { min, max } = priceRange(item)
  return min <= budget.max_cents && max >= budget.min_cents
}

/** Ideas of the interests, in turns: the best of each interest, then the second best of each … */
function inTurns(pool: readonly CatalogItem[], interests: readonly GiftInterest[]): CatalogItem[] {
  const buckets = interests.map((interest) =>
    pool.filter((item) => item.interests.includes(interest)).sort((a, b) => a.rank - b.rank))
  const taken = new Set<string>()
  const out: CatalogItem[] = []
  while (buckets.some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets) {
      let next = bucket.shift()
      while (next && taken.has(next.id)) next = bucket.shift()
      if (!next) continue
      taken.add(next.id)
      out.push(next)
    }
  }
  return out
}

/** A shelf's own order: what has its facts (the hand-picked, checked board games) first, each part by rank. */
function shelfOrder(pool: readonly CatalogItem[]): CatalogItem[] {
  return [...pool].sort((a, b) => Number(b.game !== undefined) - Number(a.game !== undefined) || a.rank - b.rank)
}

function topicExtras(item: CatalogItem, lang: CatalogLang): CatalogTopicExtras {
  const out: CatalogTopicExtras = {}
  if (item.game) {
    const { award, players_max: playersMax, ...facts } = item.game
    out.game = { ...facts, players_max: playersMax ?? null, award: award ?? null }
  }
  // each text in the asked language, else its fallback (ru/uk → en → de) — and which language that is
  if (item.blurb) {
    const blurb = pickText(item.blurb, lang)
    out.blurb = blurb.text
    out.blurb_lang = blurb.lang
  }
  if (item.how_to_play) {
    const howTo = pickText(item.how_to_play, lang)
    out.how_to_play = howTo.text
    out.how_to_play_lang = howTo.lang
  }
  if (item.book) out.book = { ...item.book, genre: pickText(item.book.genre, lang).text }
  if (item.about) {
    const about = pickText(item.about, lang)
    out.about = about.text
    out.about_lang = about.lang
  }
  return out
}

/** How many of the asked taste directions an item fits. */
function styleScore(item: CatalogItem, styles: readonly GiftStyle[]): number {
  return item.styles ? item.styles.filter((style) => styles.includes(style)).length : 0
}

/**
 * The deck with taste directions (27.10): what fits the wishes' style comes first — the two best matches, then
 * every other card (the interests in turns between them), so a sporty list gets the athleisure ideas up front
 * without a deck of nothing else. Among the matches: more directions, then the asked interests, then rank.
 */
function withStyles(pool: readonly CatalogItem[], interests: readonly GiftInterest[], styles: readonly GiftStyle[]): CatalogItem[] {
  const interestScore = (item: CatalogItem) => item.interests.filter((interest) => interests.includes(interest)).length
  const matches = pool
    .filter((item) => styleScore(item, styles) > 0)
    .sort((a, b) => styleScore(b, styles) - styleScore(a, styles) || interestScore(b) - interestScore(a) || a.rank - b.rank)
  const taken = new Set(matches.map((item) => item.id))
  const rest = pool.filter((item) => !taken.has(item.id))
  const others = interests.length > 0 ? inTurns(rest, interests) : [...rest].sort((a, b) => a.rank - b.rank)
  const out: CatalogItem[] = matches.slice(0, 2)
  let m = 2
  let o = 0
  while (m < matches.length || o < others.length) {
    const other = others[o]
    if (other) {
      out.push(other)
      o += 1
    }
    const match = matches[m]
    if (match) {
      out.push(match)
      m += 1
    }
  }
  return out
}

export function answerCatalog(request: CatalogRequest, { pageSize = CATALOG_PAGE_SIZE, items = CATALOG } = {}): CatalogAnswer {
  const topic = request.topic
  if (topic !== undefined) pageSize = TOPIC_PAGE_SIZE
  const pool = items.filter((item) => fitsBudget(item, request.budget) && (topic === undefined || (isGiftTopic(topic) && inTopic(item, topic))))
  const styles = request.styles ?? []
  const ordered = topic !== undefined
    ? shelfOrder(pool)
    : styles.length > 0
      ? withStyles(pool, request.interests, styles)
      : request.interests.length > 0 ? inTurns(pool, request.interests) : [...pool].sort((a, b) => a.rank - b.rank)
  const excluded = new Set(request.exclude_ids)
  const page: CatalogItem[] = []
  let position = Math.min(request.start ?? 0, ordered.length)
  for (; position < ordered.length && page.length < pageSize; position += 1) {
    const item = ordered[position]
    if (item && !excluded.has(item.id)) page.push(item)
  }
  const more = ordered.slice(position).some((item) => !excluded.has(item.id))
  const oldest = page.flatMap((item) => item.offers.map((offer) => offer.checked_at)).sort()[0]
  return {
    items: page.map((item) => {
      const { min, max } = priceRange(item)
      return {
        id: item.id,
        title: pickText(item.title, request.lang).text,
        image_url: pictureUrl(item),
        price_min_cents: min,
        price_max_cents: max,
        offers: [...item.offers]
          .sort((a, b) => a.price_cents - b.price_cents)
          .map((offer) => ({ shop: offer.shop, price_cents: offer.price_cents, url: offer.url, sponsored: false as const })),
        interests: [...item.interests],
        ...(topic !== undefined ? topicExtras(item, request.lang) : {}),
      }
    }),
    next_cursor: more ? `v1.${position}` : null,
    as_of: oldest ? `${oldest}T00:00:00.000Z` : null,
  }
}
