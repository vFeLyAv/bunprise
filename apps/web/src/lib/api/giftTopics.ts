import {
  cleanLabel,
  GiftIdeasError,
  isGiftLang,
  parseGiftIdeasPage,
  postGiftIdeas,
  type GiftIdea,
  type GiftIdeasOptions,
  type GiftLang,
  type GiftTopic,
} from './giftIdeas'

// One shelf of "Stöbern nach Thema" (Felix 26.10, docs/design/2026-10-26-ideas-categories.md): POST /api/gift-ideas
// with `topic` (the contract at the top of lib/api/giftIdeas.ts). The request carries the shelf's id, the language
// and a budget without limits — no interests, nothing about a person; the filters (players, duration, price) work
// on the device. The answer's items are ordinary ideas (the same strict parser) plus, for board games, the facts
// of the box, our short text and "So wird gespielt" — each field checked and capped here; a broken one is dropped
// (the card then simply shows less), never the idea.
// Imported only by the lazy topic screen (features/gifts/topics).

export interface GiftAward {
  /** "Spiel des Jahres" / "Kennerspiel des Jahres": proper names, written as text (never the jury's logo) */
  prize: 'sdj' | 'kdj'
  year: number
  /** on the shortlist ("Nominiert") */
  nominated: boolean
}

export interface GiftGameFacts {
  name: string
  publisher: string
  players_min: number
  /** null = open-ended: the box says "ab <players_min>" (Jenga: "1+") */
  players_max: number | null
  minutes_min: number
  minutes_max: number
  age_min: number
  award: GiftAward | null
}

/** A book's facts (27.10): from the publisher / shop page, in the asked language. */
export interface GiftBookFacts {
  author: string
  publisher: string
  pages: number
  year: number
  genre: string
}

export interface GiftTopicIdea extends GiftIdea {
  game: GiftGameFacts | null
  book: GiftBookFacts | null
  /** "Worum geht's": our own 1–2 sentences about a book */
  about: string | null
  /** the language of "about" (the asked one, or the Worker's fallback: ru/uk → en → de) */
  about_lang: GiftLang | null
  blurb: string | null
  blurb_lang: GiftLang | null
  how_to_play: string | null
  /** the language of how_to_play (the asked one, or the fallback — the sheet then says which language it is) */
  how_to_play_lang: GiftLang | null
}

export interface GiftTopicPage {
  items: GiftTopicIdea[]
  as_of: string | null
}

const NAME_MAX = 80
const PUBLISHER_MAX = 60
const BLURB_MAX = 200
const HOW_TO_MAX = 400
const ABOUT_MAX = 300
const AUTHOR_MAX = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function whole(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

function parseAward(value: unknown): GiftAward | null {
  if (!isRecord(value) || (value.prize !== 'sdj' && value.prize !== 'kdj')) return null
  const year = whole(value.year, 1979, 2100)
  return year === null ? null : { prize: value.prize, year, nominated: value.nominated === true }
}

/** The facts of a board game, or null when any of them is missing or does not make sense. */
export function parseGameFacts(value: unknown): GiftGameFacts | null {
  if (!isRecord(value)) return null
  const name = cleanLabel(value.name, NAME_MAX)
  const publisher = cleanLabel(value.publisher, PUBLISHER_MAX)
  const playersMin = whole(value.players_min, 1, 99)
  // players_max absent or null = open-ended ("ab N"); present, it must be a whole number ≥ players_min
  const open = value.players_max === undefined || value.players_max === null
  const playersMax = open ? null : whole(value.players_max, 1, 99)
  const minutesMin = whole(value.minutes_min, 1, 999)
  const minutesMax = whole(value.minutes_max, 1, 999)
  const age = whole(value.age_min, 0, 99)
  if (!name || !publisher || playersMin === null || (!open && playersMax === null) || minutesMin === null || minutesMax === null || age === null) return null
  if ((playersMax !== null && playersMin > playersMax) || minutesMin > minutesMax) return null
  return {
    name,
    publisher,
    players_min: playersMin,
    players_max: playersMax,
    minutes_min: minutesMin,
    minutes_max: minutesMax,
    age_min: age,
    award: parseAward(value.award),
  }
}

/** The facts of a book, or null when any of them is missing or does not make sense. */
export function parseBookFacts(value: unknown): GiftBookFacts | null {
  if (!isRecord(value)) return null
  const author = cleanLabel(value.author, AUTHOR_MAX)
  const publisher = cleanLabel(value.publisher, PUBLISHER_MAX)
  const genre = cleanLabel(value.genre, NAME_MAX)
  const pages = whole(value.pages, 1, 9999)
  const year = whole(value.year, 1450, 2100)
  if (!author || !publisher || !genre || pages === null || year === null) return null
  return { author, publisher, pages, year, genre }
}

/** The language a text says it is in; a Worker that does not say (before 30.10) sent German rules. */
function textLang(value: unknown): GiftLang {
  return isGiftLang(value) ? value : 'de'
}

/** A topic answer: the ideas (parseGiftIdeasPage — the same rules as a deck) with their extras. */
export function parseGiftTopicPage(body: unknown): GiftTopicPage | null {
  const page = parseGiftIdeasPage(body)
  if (!page || !isRecord(body) || !Array.isArray(body.items)) return null
  const raw = new Map<string, Record<string, unknown>>()
  for (const item of body.items) {
    if (isRecord(item) && typeof item.id === 'string' && !raw.has(item.id)) raw.set(item.id, item)
  }
  const items = page.items.map((idea): GiftTopicIdea => {
    const extra = raw.get(idea.id) ?? {}
    const howTo = cleanLabel(extra.how_to_play, HOW_TO_MAX)
    const about = cleanLabel(extra.about, ABOUT_MAX)
    const blurb = cleanLabel(extra.blurb, BLURB_MAX)
    return {
      ...idea,
      game: parseGameFacts(extra.game),
      book: parseBookFacts(extra.book),
      about,
      about_lang: about ? textLang(extra.about_lang) : null,
      blurb,
      blurb_lang: blurb ? textLang(extra.blurb_lang) : null,
      how_to_play: howTo,
      how_to_play_lang: howTo ? textLang(extra.how_to_play_lang) : null,
    }
  })
  return { items, as_of: page.as_of }
}

/** No upper limit: a shelf is shown whole, the price filter works on the device. */
const ANY_BUDGET = { min_cents: 0, max_cents: 100_000_000 }

/** The whole shelf in one request. Rejects like fetchGiftIdeas (GiftIdeasError, AbortError, the account boundary). */
export async function fetchGiftTopic(topic: GiftTopic, lang: GiftLang, options: GiftIdeasOptions = {}): Promise<GiftTopicPage> {
  const body = await postGiftIdeas({ mode: 'for_me', interests: [], budget: ANY_BUDGET, exclude_ids: [], lang, topic }, options)
  const page = parseGiftTopicPage(body)
  if (!page) throw new GiftIdeasError('unavailable')
  return page
}
