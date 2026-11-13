import { describe, expect, it } from 'vitest'
import { GIFT_INTERESTS } from '../../lib/api/giftIdeas'
import { foldText, inferInterests, interestOfShop, interestsInText, type WishSignal } from './interests'
import interestsSource from './interests.ts?raw'

// The local interest guess of "Geschenk finden" (brief 4.4): DE + EN keywords, German compounds, the
// longest keyword wins inside a word, "Wie sehr?" weighs, a known shop adds a little. Pure, no network.

const wish = (title: string, priority: 1 | 2 | 3 = 2, url: string | null = null, priceCents: number | null = null): WishSignal => ({ title, url, priceCents, priority })

describe('foldText', () => {
  it('folds umlauts and ß, lower-cases and turns everything else into single spaces', () => {
    expect(foldText('Große Kopfhörer – „Über-Ohr“')).toBe('grosse kopfhoerer ueber ohr')
    expect(foldText('Crème brûlée')).toBe('creme brulee')
  })
})

describe('interestsInText', () => {
  it.each([
    ['Kaffeemühle mit Handkurbel', ['coffee']],
    ['Große Zimmerpflanze', ['plants']],
    ['Kabellose Kopfhörer', ['audio']],
    ['Kinogutschein', ['film']],
    ['Brettspiel für zwei', ['games']],
    ['Duftkerze', ['home']],
    ['Leinen-Geschirrtücher', ['kitchen']],
    ['Grillzange aus Edelstahl', ['kitchen']],
    ['Wireless headphones', ['audio']],
    ['Board game for two', ['games']],
    ['French Press', ['coffee']],
    ['Yogamatte aus Kork', ['sport']],
    ['Reisekissen', ['travel']],
  ])('%s → %j', (title, expected) => {
    expect(interestsInText(title)).toEqual(expected)
  })

  it('the longest keyword of a word claims its letters', () => {
    // a string of lights is no necklace ("Kette"), a tea light no tea, a merino scarf no craft
    expect(interestsInText('Lichterkette für den Garten')).toEqual(['home', 'outdoor'])
    expect(interestsInText('Teelicht-Set')).toEqual(['home'])
    expect(interestsInText('Strickschal aus Merinowolle')).toEqual(['fashion'])
    expect(interestsInText('Taschenbücher-Paket')).toEqual(['books'])
    expect(interestsInText('Taschenmesser')).toEqual(['outdoor'])
    expect(interestsInText('Serviertablett')).toEqual(['kitchen'])
  })

  it('short or ambiguous words only count as whole words or at a word start', () => {
    expect(interestsInText('Preise vergleichen')).toEqual([])
    expect(interestsInText('Transportbox')).toEqual([])
    expect(interestsInText('Romantisches Abendessen')).toEqual([])
    expect(interestsInText('Ein Beispiel')).toEqual([])
    expect(interestsInText('Ring aus Silber')).toEqual(['fashion'])
    expect(interestsInText('Tee aus Japan')).toEqual(['coffee'])
  })

  it('says nothing about a text without a known word', () => {
    expect(interestsInText('Gutschein')).toEqual([])
    expect(interestsInText('')).toEqual([])
  })
})

describe('interestOfShop', () => {
  it('knows a few shops by their host (never contacted) and nothing else', () => {
    expect(interestOfShop('https://www.thalia.de/shop/buch/123')).toBe('books')
    expect(interestOfShop('https://www.decathlon.de/p/1')).toBe('sport')
    expect(interestOfShop('https://shop.example/p/1')).toBeNull()
    expect(interestOfShop('kein link')).toBeNull()
    expect(interestOfShop(null)).toBeNull()
  })
})

describe('inferInterests', () => {
  // "Annas Einweihung" of the demo world (src/mocks/fixtures.ts)
  const anna = [
    wish('Kaffeemühle mit Handkurbel', 3, 'https://example.com/kaffeemuehle', 4500),
    wish('Große Zimmerpflanze', 3, null, 3500),
    wish('Kinogutschein', 2, null, 2500),
    wish('Leinen-Geschirrtücher', 2, 'https://example.com/geschirrtuecher', 1800),
    wish('Brettspiel für zwei', 1, null, 3000),
    wish('Duftkerze', 1, null, 1500),
  ]

  it('gives the strongest five, weighted by "Wie sehr?", and remembers where each came from', () => {
    const found = inferInterests(anna)
    expect(found.map((interest) => interest.id)).toEqual(['coffee', 'plants', 'film', 'kitchen', 'games'])
    expect(found[0]).toEqual({ id: 'coffee', score: 1.5, because: ['Kaffeemühle mit Handkurbel'] })
    expect(found[4]?.score).toBe(0.7)
  })

  it('counts a category once per wish, and more wishes of it make it stronger', () => {
    const ben = [wish('Grillzange aus Edelstahl', 3), wish('Gewürzset zum Grillen', 2), wish('Grillschürze', 2), wish('Lichterkette für den Garten', 1)]
    const found = inferInterests(ben)
    expect(found[0]).toMatchObject({ id: 'kitchen', score: 3.5 })
    expect(found[0]?.because).toEqual(['Grillzange aus Edelstahl', 'Gewürzset zum Grillen'])
    expect(found.map((interest) => interest.id)).toEqual(['kitchen', 'home', 'outdoor'])
  })

  it('a known shop adds a little — even when the title says nothing', () => {
    expect(inferInterests([wish('Etwas Schönes', 2, 'https://www.thalia.de/x')])).toEqual([{ id: 'books', score: 0.5, because: ['Etwas Schönes'] }])
  })

  it('an empty list or one with nothing known: no interests at all', () => {
    expect(inferInterests([])).toEqual([])
    expect(inferInterests([wish('Gutschein'), wish('Überraschung')])).toEqual([])
  })

  it('respects the maximum', () => {
    expect(inferInterests(anna, 2).map((interest) => interest.id)).toEqual(['coffee', 'plants'])
    expect(inferInterests(anna, 0)).toEqual([])
  })

  it('every keyword maps to a category of the shared vocabulary', () => {
    for (const interest of inferInterests(anna, 99)) expect(GIFT_INTERESTS).toContain(interest.id)
  })

  it('is pure: no network, no storage, no reservation field anywhere', () => {
    const code = interestsSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|reserv/i)
  })
})
