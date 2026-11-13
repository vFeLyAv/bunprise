import { describe, expect, it } from 'vitest'
import { haystack, matchesSearch, searchForms } from './search'

// Searching inside a topic: on the device, case- and accent-insensitive both ways a German keyboard allows.

const game = (title: string, name: string, publisher: string) => ({ title, game: { name, publisher, players_min: 2, players_max: 4, minutes_min: 30, minutes_max: 30, age_min: 8, award: null }, book: null })
const book = (title: string, author: string, publisher: string) => ({ title, game: null, book: { author, publisher, pages: 300, year: 2025, genre: 'Roman' } })

describe('search', () => {
  it('folds umlauts both ways and ß', () => {
    expect(searchForms('Flügelschlag')).toEqual(['fluegelschlag', 'flugelschlag'])
    expect(searchForms('Großstadt')).toEqual(['grossstadt', 'grossstadt'])
    expect(searchForms('  ÄÖÜ ')).toEqual(['aeoeue', 'aou'])
  })

  it('finds by name, title, publisher or author; every word must be there, in any order', () => {
    const wings = haystack(game('Brettspiel „Flügelschlag“', 'Flügelschlag', 'Feuerland Spiele'))
    for (const query of ['flügel', 'Fluegel', 'FLUGEL', 'feuerland', 'spiele flügel', '']) expect(matchesSearch(wings, query), query).toBe(true)
    for (const query of ['azul', 'flügel pegasus']) expect(matchesSearch(wings, query), query).toBe(false)
    const novel = haystack(book('Roman „Die Mittagsfrau“', 'Julia Franck', 'S. Fischer'))
    expect(matchesSearch(novel, 'franck')).toBe(true)
    expect(matchesSearch(novel, 'fischer mittag')).toBe(true)
  })
})
