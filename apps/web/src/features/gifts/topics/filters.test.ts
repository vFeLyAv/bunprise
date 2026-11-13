import { describe, expect, it } from 'vitest'
import type { GiftGameFacts } from '../../../lib/api/giftTopics'
import { activeFilters, fitsFilters, NO_FILTERS, span, type TopicFilters } from './filters'

// The filters of a topic screen work on the device only (design 26.10 §2): players, the longest printed time,
// the cheapest offer. An idea without facts never claims to fit a players / time choice.

const game = (players: [number, number | null], minutes: [number, number]): GiftGameFacts => ({
  name: 'Spiel', publisher: 'Verlag', players_min: players[0], players_max: players[1], minutes_min: minutes[0], minutes_max: minutes[1], age_min: 8, award: null,
})
const idea = (facts: GiftGameFacts | null, cents: number) => ({ game: facts, price_min_cents: cents })
const f = (over: Partial<TopicFilters>): TopicFilters => ({ ...NO_FILTERS, ...over })

describe('fitsFilters', () => {
  it('no filter: everything', () => {
    expect(fitsFilters(idea(null, 99_999), NO_FILTERS)).toBe(true)
    expect(activeFilters(NO_FILTERS)).toBe(0)
  })

  it('players: two / four when the box allows it; "Ab 6" when six and more can play', () => {
    const duel = idea(game([2, 2], [30, 30]), 3000)
    const party = idea(game([3, 8], [15, 15]), 1500)
    expect(fitsFilters(duel, f({ players: 'two' }))).toBe(true)
    expect(fitsFilters(duel, f({ players: 'four' }))).toBe(false)
    expect(fitsFilters(party, f({ players: 'two' }))).toBe(false)
    expect(fitsFilters(party, f({ players: 'four' }))).toBe(true)
    expect(fitsFilters(party, f({ players: 'party' }))).toBe(true)
    expect(fitsFilters(duel, f({ players: 'party' }))).toBe(false)
  })

  it('an open-ended box ("ab 1", Jenga: no maximum) fits every players choice it reaches', () => {
    const jenga = idea(game([1, null], [20, 30]), 1499)
    expect(fitsFilters(jenga, f({ players: 'two' }))).toBe(true)
    expect(fitsFilters(jenga, f({ players: 'four' }))).toBe(true)
    expect(fitsFilters(jenga, f({ players: 'party' }))).toBe(true)
    expect(fitsFilters(idea(game([3, null], [20, 30]), 1499), f({ players: 'two' }))).toBe(false)
  })

  it('duration: the longest printed time counts (a "30–60 Min" game is not short)', () => {
    const middle = idea(game([2, 4], [30, 60]), 3000)
    expect(fitsFilters(middle, f({ time: 'short' }))).toBe(false)
    expect(fitsFilters(middle, f({ time: 'mid' }))).toBe(true)
    expect(fitsFilters(middle, f({ time: 'long' }))).toBe(false)
    expect(fitsFilters(idea(game([1, 4], [45, 90]), 1000), f({ time: 'long' }))).toBe(true)
    expect(fitsFilters(idea(game([2, 5], [15, 30]), 1000), f({ time: 'short' }))).toBe(true)
  })

  it('price: the cheapest offer — up to 20 €, 20–40 €, above 40 €', () => {
    expect(fitsFilters(idea(null, 2000), f({ price: 'low' }))).toBe(true)
    expect(fitsFilters(idea(null, 2001), f({ price: 'low' }))).toBe(false)
    expect(fitsFilters(idea(null, 4000), f({ price: 'mid' }))).toBe(true)
    expect(fitsFilters(idea(null, 4001), f({ price: 'high' }))).toBe(true)
  })

  it('an idea without facts passes the price filter only', () => {
    expect(fitsFilters(idea(null, 1500), f({ price: 'low' }))).toBe(true)
    expect(fitsFilters(idea(null, 1500), f({ players: 'two' }))).toBe(false)
    expect(fitsFilters(idea(null, 1500), f({ time: 'short' }))).toBe(false)
  })

  it('combines: all three must fit', () => {
    const azul = idea(game([2, 4], [30, 45]), 3199)
    expect(fitsFilters(azul, f({ players: 'two', time: 'mid', price: 'mid' }))).toBe(true)
    expect(fitsFilters(azul, f({ players: 'two', time: 'mid', price: 'low' }))).toBe(false)
    expect(activeFilters(f({ players: 'two', price: 'low' }))).toBe(2)
  })

  it('span', () => {
    expect(span(2, 2)).toBe('2')
    expect(span(2, 5)).toBe('2–5')
  })
})
