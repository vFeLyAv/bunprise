import { describe, expect, it } from 'vitest'
import { GIFT_STYLES as WORKER_STYLES } from '../../../../../workers/edge/src/giftIdeas/catalog'
import { GIFT_STYLES } from '../../lib/api/giftIdeas'
import type { WishSignal } from './interests'
import { brandsOf, inferStyles, KNOWN_BRANDS, stylesOfWish } from './styles'

// Taste directions of a wishlist (Felix 27.10: "анализировать бренд … спортивный — предлагать Gymshark"): read on the
// device from brands (title or the link's host — never contacted) and telling product words. Fixture lists only.

const wish = (title: string, url: string | null = null, priority: 1 | 2 | 3 = 2, priceCents: number | null = null): WishSignal => ({ title, url, priority, priceCents })
const ids = (signals: WishSignal[]) => inferStyles(signals).map((style) => style.id)

describe('taste directions', () => {
  it('share one vocabulary with the Worker; the brand map is hand-picked and big enough', () => {
    expect([...GIFT_STYLES]).toEqual([...WORKER_STYLES])
    expect(KNOWN_BRANDS).toBeGreaterThanOrEqual(150)
    expect(KNOWN_BRANDS).toBeLessThanOrEqual(400)
  })

  it('a sporty list → athleisure first (brands in titles and hosts, product words)', () => {
    const sporty = [
      wish('Gymshark Vital Seamless Leggings', 'https://de.gymshark.com/products/vital-leggings', 3),
      wish('Laufschuhe Pegasus 41', 'https://www.nike.com/de/t/pegasus-41', 2),
      wish('Proteinshaker mit Fach'),
      wish('Kabellose Kopfhörer', null, 1),
    ]
    expect(ids(sporty)[0]).toBe('athleisure')
    expect(brandsOf('Gymshark Vital Seamless Leggings', 'https://de.gymshark.com/products/vital-leggings')).toContain('gymshark')
    expect(brandsOf('Laufschuhe Pegasus 41', 'https://www.nike.com/de/t/pegasus-41')).toEqual(['nike'])
  })

  it('outdoor, Scandinavian design, specialty coffee, natural cosmetics, analog — each from its brands', () => {
    expect(ids([wish('Fjällräven Kånken Rucksack'), wish('Regenjacke', 'https://www.vaude.com/de-DE/regenjacke')])).toEqual(['outdoor'])
    expect(ids([wish('Vase von HAY'), wish('Muuto Tischleuchte')])[0]).toBe('scandi')
    expect(ids([wish('Hario V60 Handfilter'), wish('Comandante C40 Handmühle')])[0]).toBe('specialty-coffee')
    expect(ids([wish('Weleda Skin Food'), wish('Dr. Hauschka Rosencreme')])[0]).toBe('natural')
    expect(ids([wish('Instax Mini Film', null, 3)])).toEqual(['analog'])
    // two or three words written together
    expect(brandsOf('Jacke von The North Face', null)).toContain('thenorthface')
    expect(brandsOf('Under Armour Shirt', null)).toContain('underarmour')
  })

  it('everyday words are no brands: Tablett, "Nothing" in a title, a surname, Staubsauger', () => {
    expect(stylesOfWish('Serviertablett aus Holz', null).size).toBe(0)
    expect(stylesOfWish('Tablett', null).has('tech')).toBe(false)
    expect(stylesOfWish('Nothing but thieves – Vinyl', null).has('tech')).toBe(false)
    expect(stylesOfWish('Grillzange wie bei Familie Weber', null).size).toBe(0)
    expect(stylesOfWish('Staubsauger', null).size).toBe(0)
    // the same brand by its own host counts
    expect(stylesOfWish('Ear (a)', 'https://de.nothing.tech/products/ear-a').has('tech')).toBe(true)
    expect(stylesOfWish('Grill', 'https://www.weber.com/DE/de/grill').has('kitchen-pro')).toBe(true)
  })

  it('needs more than a passing mention: one product word at "Kann" is not a taste', () => {
    expect(ids([wish('Duftkerze', null, 1)])).toEqual([])
    expect(ids([wish('Duftkerze', null, 3), wish('Kuscheldecke', null, 2)])).toEqual(['cozy'])
    expect(ids([])).toEqual([])
  })

  it('at most three directions, strongest first; every direction once per wish', () => {
    const many = [
      wish('Gymshark Hoodie', null, 3), wish('Nike Air Max', null, 3), wish('Fjällräven Mütze'), wish('Hario Kessel'),
      wish('HAY Becher'), wish('Weleda Creme'), wish('Nintendo Switch Spiel', null, 3),
    ]
    const result = inferStyles(many)
    expect(result).toHaveLength(3)
    expect(result.map((style) => style.id)[0]).toBe('athleisure')
    // "Nike Air Max": athleisure + streetwear once each, never twice for one wish
    expect([...stylesOfWish('Nike Nike Air Max', null).entries()]).toEqual([['athleisure', 2], ['streetwear', 2]])
  })

  it('says nothing about who someone is: no gender, no age — only directions of taste', () => {
    for (const id of GIFT_STYLES) expect(id).not.toMatch(/women|men|female|male|frau|mann|kid|kind|teen|senior|girl|boy/)
  })
})
