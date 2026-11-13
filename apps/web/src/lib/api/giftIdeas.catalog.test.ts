import { describe, expect, it } from 'vitest'
import { answerCatalog, CATALOG, GIFT_ART_IDS, GIFT_INTERESTS as WORKER_INTERESTS } from '../../../../../workers/edge/src/giftIdeas/catalog'
import { DEMO_ART } from '../../features/gifts/art'
import { demoArtId, drawnArtId, GIFT_IDEAS_ITEMS_MAX, GIFT_INTERESTS, isDemoShopUrl, ownImagePath, parseGiftIdeasPage, photoFallbackArt } from './giftIdeas'

// The Worker's real product catalogue (workers/edge/src/giftIdeas, 25.10.2026) against this app's contract
// parser: every idea it answers survives parseGiftIdeasPage unchanged, is drawn with our own art, carries
// no „Demo“ label and no „Anzeige“, and both sides share one vocabulary.

describe('the Worker catalogue speaks the app contract', () => {
  it('shares the interest vocabulary and the drawings with the app', () => {
    expect([...WORKER_INTERESTS]).toEqual([...GIFT_INTERESTS])
    expect([...GIFT_ART_IDS].sort()).toEqual(Object.keys(DEMO_ART).sort())
  })

  it('every catalogue idea passes the parser unchanged, drawn by us or a photo through our Worker, not a demo, no ad', () => {
    // pages as big as the parser takes from one answer
    const parsed: string[] = []
    let start: number | undefined
    for (let round = 0; round < 10; round += 1) {
      const answer = answerCatalog({ interests: [], budget: { min_cents: 0, max_cents: 100_000_000 }, exclude_ids: [], lang: 'de', start }, { pageSize: GIFT_IDEAS_ITEMS_MAX })
      const page = parseGiftIdeasPage(JSON.parse(JSON.stringify(answer)))
      expect(page?.items).toHaveLength(answer.items.length)
      expect(page?.next_cursor).toBe(answer.next_cursor)
      expect(page?.as_of).toBe(answer.as_of)
      for (const idea of page?.items ?? []) {
        parsed.push(idea.id)
        // our drawing, or the real photo through our own path with a drawing to fall back to (Felix 25.10)
        expect(drawnArtId(idea.image_url) ?? photoFallbackArt(idea.image_url), idea.id).not.toBeNull()
        expect(ownImagePath(idea.image_url, 'http://localhost:3000'), idea.id).toBe(idea.image_url)
        expect(demoArtId(idea.image_url), idea.id).toBeNull()
        expect(idea.offers.every((offer) => !offer.sponsored && !isDemoShopUrl(offer.url)), idea.id).toBe(true)
        expect(idea.interests.length, idea.id).toBeGreaterThan(0)
      }
      if (answer.next_cursor === null) break
      start = Number(answer.next_cursor.slice(3))
    }
    expect(parsed.sort()).toEqual(CATALOG.map((item) => item.id).sort())
  })

  it('drawnArtId reads both prefixes, demoArtId only the demo one', () => {
    expect(drawnArtId('/api/gift-ideas/art/teapot')).toBe('teapot')
    expect(drawnArtId('/api/gift-ideas/demo-art/teapot')).toBe('teapot')
    expect(demoArtId('/api/gift-ideas/art/teapot')).toBeNull()
    expect(drawnArtId('/api/gift-ideas/art/../x')).toBeNull()
    expect(drawnArtId('/api/gift-ideas/img/abc')).toBeNull()
  })
})
