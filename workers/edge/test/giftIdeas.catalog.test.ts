import { describe, expect, it } from 'vitest'
import { CATALOG, GIFT_ART_IDS, GIFT_INTERESTS } from '../src/giftIdeas/catalog'
import data from '../src/giftIdeas/catalog.de.json'

// The data of the "Ideen" catalogue (catalog.de.json): what a person checks by hand once a month
// (scripts/check-catalog.mjs) — and what a machine can check on every run.

// Partner / tracking parameters of the usual programmes and analytics: a catalogue link carries none of them,
// so no shop or network pays us for a click (sponsored = false stays true; research 2026-10-25 §3.6).
const TRACKING = /^(utm_[a-z]+|tag|ref|ref_|campid|customid|mkcid|mkrid|mkevt|toolid|awc|affid|aff_id|affiliate|partner|pid|clickref|gclid|fbclid|msclkid|wt_mc|wt\.mc_id|emid|sc_[a-z]+|cjevent|irclickid|ranmid|ranEAID|ranSiteID|sv1|sv_campaign_id|sid)$/i

describe('catalogue data', () => {
  it('has between 100 and 300 items, every id and rank once', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(100)
    expect(CATALOG.length).toBeLessThanOrEqual(300)
    expect(new Set(CATALOG.map((item) => item.id)).size).toBe(CATALOG.length)
    expect(new Set(CATALOG.map((item) => item.rank)).size).toBe(CATALOG.length)
  })

  it('offers at least five ideas for every interest', () => {
    for (const interest of GIFT_INTERESTS) {
      expect(CATALOG.filter((item) => item.interests.includes(interest)).length, interest).toBeGreaterThanOrEqual(5)
    }
  })

  it.each(CATALOG.map((item) => [item.id, item] as const))('%s is a well-formed item', (_id, item) => {
    expect(item.id).toMatch(/^cat:[a-z0-9-]{1,60}$/)
    // only known interests (CATALOG drops unknown ones — the raw file must not have any)
    const raw = data.items.find((entry) => entry.id === item.id)
    expect(raw?.interests).toEqual(item.interests)
    expect(item.interests.length).toBeGreaterThan(0)
    expect(GIFT_ART_IDS).toContain(item.art)
    for (const title of [item.title.de, item.title.en]) {
      expect(title.trim()).toBe(title)
      expect([...title].length).toBeGreaterThan(3)
      expect([...title].length).toBeLessThanOrEqual(120)
    }
    expect(item.offers.length).toBeGreaterThan(0)
    for (const offer of item.offers) {
      expect([...offer.shop].length).toBeLessThanOrEqual(40)
      expect(Number.isInteger(offer.price_cents)).toBe(true)
      expect(offer.price_cents).toBeGreaterThan(0)
      expect(offer.price_cents).toBeLessThanOrEqual(25_000)
      expect(offer.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // a German calendar day (Europe/Berlin): just after midnight there it is still "yesterday" in UTC
      expect(Date.parse(`${offer.checked_at}T00:00:00+02:00`)).toBeLessThanOrEqual(Date.now())
      const url = new URL(offer.url)
      expect(url.protocol).toBe('https:')
      expect(url.username + url.password).toBe('')
      expect(url.hash).toBe('')
      expect(url.hostname).not.toMatch(/(^|\.)(example|test|invalid|localhost)$/)
      for (const key of url.searchParams.keys()) expect(key, offer.url).not.toMatch(TRACKING)
      // known affiliate redirectors are never a shop page
      expect(url.hostname).not.toMatch(/(awin1|tradedoubler|rover\.ebay|amzn\.to|adcell|partners\.webmasterplan|clk\.tradedoubler)/)
    }
  })
})
