import { describe, expect, it } from 'vitest'

// Static guard for "Geschenk finden" (CLAUDE.md "Secrecy of reservations", contract.md §9, follows-design
// G1/G7): the feature looks at wishlists — mine and other people's — but never at reservations: no
// reservation API, no myReservations query, no reserved* field, no reservation words; and it loads nothing
// from a third party: no foreign URL, no favicon service, no <img> other than the own-origin picture.
// Comments are stripped first (they may explain the rule).

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { eager: true, query: '?raw', import: 'default' })
const api = import.meta.glob<string>('../../lib/api/giftIdeas.ts', { eager: true, query: '?raw', import: 'default' })
const mock = import.meta.glob<string>('../../mocks/giftIdeas.ts', { eager: true, query: '?raw', import: 'default' })

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const ALL = { ...sources, ...api, ...mock }

describe('gift modules', () => {
  it('found the feature files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15)
    expect(Object.keys(api)).toHaveLength(1)
    expect(Object.keys(mock)).toHaveLength(1)
  })

  for (const [name, source] of Object.entries(ALL)) {
    it(`${name}: no reservation API, query, field or word`, () => {
      const body = code(source)
      expect(body).not.toMatch(/api\/reservations|lib\/queries|myReservations/)
      expect(body).not.toMatch(/reserv/i)
    })

    it(`${name}: nothing from a third party`, () => {
      const body = code(source)
      // reserved example domains are the demo's invented shops (they cannot exist); no other host appears
      const hosts = [...body.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((match) => match[1] ?? '')
      for (const host of hosts) expect(host, `${name}: ${host}`).toMatch(/(^|\.)(example|test|invalid|localhost)$|(^|\.)example\.(com|net|org)$/)
      expect(body).not.toMatch(/favicon|new Image\(|<iframe|<script/i)
    })
  }

  it('the only <img> are the own-origin pictures (the idea; the photo slide of a game), loaded without referrer and checked again', () => {
    const withImg = Object.entries(ALL).filter(([, source]) => /<img\b/.test(code(source)))
    expect(withImg.map(([name]) => name).sort()).toEqual(['./GiftPicture.tsx', './topics/GameSheet.tsx'])
    for (const [name, source] of withImg) {
      const picture = code(source)
      expect(picture, name).toMatch(/ownImagePath\(/)
      expect(picture, name).toMatch(/referrerPolicy="no-referrer"/)
    }
  })

  it('wishes leave a source only as title + link + price + "Wie sehr?" (asOwnerWishes drops every other field)', () => {
    const source = code(sources['./sources.ts'] ?? '')
    expect(source).toMatch(/asOwnerWishes\(/)
    expect(source).toMatch(/title: wish\.title,\s*url: wish\.url,\s*priceCents: wish\.price_cents,\s*priority: wish\.priority/)
  })
})
