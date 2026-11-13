import type { GiftTopicIdea } from '../../../lib/api/giftTopics'

// The filters of a topic screen (design 26.10 §2): players, duration, price — applied ON THE DEVICE to the shelf
// that came whole (the Worker never learns what the person chose). Pure; the screen draws the pills and the sheet.

export type PlayersFilter = 'all' | 'two' | 'four' | 'party'
export type TimeFilter = 'all' | 'short' | 'mid' | 'long'
export type PriceFilter = 'all' | 'low' | 'mid' | 'high'

export interface TopicFilters {
  players: PlayersFilter
  time: TimeFilter
  price: PriceFilter
}

export type FilterKind = keyof TopicFilters

export const NO_FILTERS: TopicFilters = { players: 'all', time: 'all', price: 'all' }

export const FILTER_CHOICES = {
  players: ['all', 'two', 'four', 'party'],
  time: ['all', 'short', 'mid', 'long'],
  price: ['all', 'low', 'mid', 'high'],
} as const satisfies { [K in FilterKind]: readonly TopicFilters[K][] }

/** Euro cents where the price choices change: up to 20 €, 20–40 €, above 40 €. */
const LOW_MAX = 2000
const MID_MAX = 4000

/**
 * Does the idea fit? Players: the box allows two / four, or six and more ("Ab 6"). Duration: the longest printed
 * time (a "30–60 Min" game is not short). Price: the cheapest offer. An idea without facts (no board game, or one
 * whose facts are not checked yet) passes the price filter only — it never claims to fit a players / time choice.
 */
export function fitsFilters(idea: Pick<GiftTopicIdea, 'game' | 'price_min_cents'>, f: TopicFilters): boolean {
  const game = idea.game
  if ((f.players !== 'all' || f.time !== 'all') && !game) return false
  if (game) {
    const { players_min: pMin, minutes_max: long } = game
    // an open-ended box ("ab 1", Jenga) has no upper limit
    const pMax = game.players_max ?? Number.POSITIVE_INFINITY
    const okPlayers =
      f.players === 'all' ||
      (f.players === 'two' && pMin <= 2 && pMax >= 2) ||
      (f.players === 'four' && pMin <= 4 && pMax >= 4) ||
      (f.players === 'party' && pMax >= 6)
    const okTime = f.time === 'all' || (f.time === 'short' && long <= 30) || (f.time === 'mid' && long > 30 && long <= 60) || (f.time === 'long' && long > 60)
    if (!okPlayers || !okTime) return false
  }
  const cents = idea.price_min_cents
  return f.price === 'all' || (f.price === 'low' && cents <= LOW_MAX) || (f.price === 'mid' && cents > LOW_MAX && cents <= MID_MAX) || (f.price === 'high' && cents > MID_MAX)
}

export function activeFilters(f: TopicFilters): number {
  return (f.players !== 'all' ? 1 : 0) + (f.time !== 'all' ? 1 : 0) + (f.price !== 'all' ? 1 : 0)
}

/** "2–5" / "2" */
export function span(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`
}
