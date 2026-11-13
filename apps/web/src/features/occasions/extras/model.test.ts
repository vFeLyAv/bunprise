import { describe, expect, it } from 'vitest'
import type { LinkPreview } from '../../../lib/api/linkPreview'
import { hostScreen } from '../test-utils'
import {
  NO_EXTRAS,
  bringProblem,
  extrasCount,
  extrasFor,
  extrasLayoutKey,
  parseWishText,
  quickWishOf,
  titleOf,
  wishInputOf,
  wishTextProblem,
  withAnswer,
  withPendingItems,
  type OccasionExtras,
  type QuickWish,
} from './model'

// The pure part of "Gleich mit eintragen" (extras/model.ts): fixtures are invented (reserved example domains).

const LINK = 'https://www.kuechenkontor.example/kaffeemuehle-kegel'

function preview(patch: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: LINK,
    site: 'Küchenkontor',
    title: 'Handkaffeemühle „Kegel“',
    priceCents: 4990,
    partial: false,
    imageUrl: null,
    description: 'Mahlwerk aus Keramik.',
    brand: 'Kegel & Korn',
    color: 'Buche',
    gtin: '2000000000015',
    ...patch,
  }
}

const linked = (patch: Partial<QuickWish> = {}): QuickWish => ({ ...quickWishOf(LINK, 'k1', null), ...patch })

describe('quick wishes', () => {
  it('splits a line into the link and the person’s own words', () => {
    expect(parseWishText('  Puzzle   mit 1000 Teilen ')).toEqual({ url: null, typed: 'Puzzle mit 1000 Teilen' })
    expect(parseWishText(LINK)).toEqual({ url: LINK, typed: '' })
    expect(parseWishText(`Kaffeemühle: ${LINK}`)).toEqual({ url: LINK, typed: 'Kaffeemühle' })
    // a bare shop address becomes https, like every saved link
    expect(parseWishText('kuechenkontor.example/teekanne')).toEqual({ url: 'https://kuechenkontor.example/teekanne', typed: '' })
  })

  it('refuses nothing typed and a title over the database limit — never cuts silently', () => {
    expect(wishTextProblem('   ')).toBe('empty')
    expect(wishTextProblem('x'.repeat(121))).toBe('too_long')
    expect(wishTextProblem('x'.repeat(120))).toBeNull()
    expect(wishTextProblem(LINK)).toBeNull()
  })

  it('a wish without a link is never read; a linked one waits for its answer', () => {
    const plain = quickWishOf('Puzzle', 'k0', Promise.resolve({ preview: null, photo: null }))
    expect(plain.read).toBeNull()
    expect(plain.url).toBeNull()
    const read = Promise.resolve({ preview: preview(), photo: null })
    expect(quickWishOf(LINK, 'k1', read).read).toBe(read)
  })

  it('the title: own words > the shop’s title > the shop’s name (a wish is never lost for a missing title)', () => {
    expect(titleOf(linked())).toBe('kuechenkontor.example')
    expect(titleOf(linked({ answer: { preview: preview(), photo: null } }))).toBe('Handkaffeemühle „Kegel“')
    expect(titleOf(linked({ answer: { preview: preview({ title: null, partial: true }), photo: null } }))).toBe('Küchenkontor')
    expect(titleOf(linked({ typed: 'Für die Küche', answer: { preview: preview(), photo: null } }))).toBe('Für die Küche')
  })

  it('the payload: the cleaned link of the answer, its price and details, priority 2; the plain one is just a title', () => {
    expect(wishInputOf(quickWishOf('Puzzle', 'k0', null))).toEqual({ title: 'Puzzle', price_cents: null, currency: 'EUR', url: null, note: null, priority: 2 })
    const answered = linked({ answer: { preview: preview({ url: 'https://kuechenkontor.example/kegel' }), photo: null } })
    expect(wishInputOf(answered)).toEqual({
      title: 'Handkaffeemühle „Kegel“',
      price_cents: 4990,
      currency: 'EUR',
      url: 'https://kuechenkontor.example/kegel',
      note: null,
      priority: 2,
      description: 'Mahlwerk aus Keramik.',
      brand: 'Kegel & Korn',
      color: 'Buche',
      gtin: '2000000000015',
      shop_name: 'Küchenkontor',
    })
    // no answer (offline, shop down): the link as it was, the host as the title
    expect(wishInputOf(linked())).toMatchObject({ title: 'kuechenkontor.example', url: LINK, price_cents: null })
  })

  it('an answer lands on its own wish only', () => {
    const extras: OccasionExtras = { ...NO_EXTRAS, wishes: [linked(), { ...linked(), key: 'k2' }] }
    const next = withAnswer(extras, 'k2', { preview: preview(), photo: null })
    expect(next.wishes[0]?.answer).toBeNull()
    expect(next.wishes[1]?.answer?.preview?.title).toBe('Handkaffeemühle „Kegel“')
  })
})

describe('bring-along entries', () => {
  it('checks like the database (1..80, one line) and refuses twins and the 51st', () => {
    const items = [{ key: 'a', title: 'Salat' }]
    expect(bringProblem('  ', items)).toBe('empty')
    expect(bringProblem('x'.repeat(81), items)).toBe('too_long')
    expect(bringProblem('salat', items)).toBe('duplicate')
    expect(bringProblem('Kuchen', items)).toBeNull()
    expect(bringProblem('Kuchen', Array.from({ length: 50 }, (_, i) => ({ key: String(i), title: `E${i}` })))).toBe('full')
  })

  it('shows on the optimistic screen at once: mine to edit, free, in the order of the form', () => {
    const screen = { ...hostScreen(), occasion: { ...hostScreen().occasion, sections: 'both' as const }, potluck: { max_items: 50, items: [] } }
    const next = withPendingItems(screen, [{ key: 'a', title: 'Salat' }, { key: 'b', title: ' Getränke ' }], { profileId: 'me', displayName: 'Mila' }, '2030-01-01T10:00:00.000Z')
    expect(next.potluck?.items.map((item) => [item.id, item.title, item.claimed, item.can_edit])).toEqual([
      ['new-a', 'Salat', false, true],
      ['new-b', 'Getränke', false, true],
    ])
  })
})

describe('what goes out', () => {
  const all: OccasionExtras = {
    wishes: [quickWishOf('Puzzle', 'k0', null)],
    picked: [],
    items: [{ key: 'a', title: 'Salat' }],
  }

  it('only the parts the chosen "Was gibt’s?" offers', () => {
    expect(extrasCount(extrasFor(all, 'both'))).toBe(2)
    expect(extrasFor(all, 'wishes').items).toEqual([])
    expect(extrasFor(all, 'bring').wishes).toEqual([])
    expect(extrasFor(all, 'bring').items).toHaveLength(1)
  })

  it('the layout key follows rows, the open field and a link being read', () => {
    const base = extrasLayoutKey(all, 'both', true)
    expect(extrasLayoutKey(all, 'both', false)).not.toBe(base)
    expect(extrasLayoutKey({ ...all, items: [] }, 'both', true)).not.toBe(base)
    const reading = { ...all, wishes: [quickWishOf(LINK, 'k1', new Promise(() => {}))] }
    expect(extrasLayoutKey(reading, 'both', true)).not.toBe(extrasLayoutKey({ ...reading, wishes: [{ ...reading.wishes[0]!, answer: { preview: null, photo: null } }] }, 'both', true))
  })
})
