import { describe, expect, it } from 'vitest'
import type { OccasionScreen, PotluckItem } from '../../lib/api/types'
import { hostScreen } from '../occasions/test-utils'
import { potluckEnabled } from './flag'
import {
  potluckOf,
  progressOf,
  sectionsOf,
  showsWishes,
  titleProblem,
  withAddedItem,
  withClaim,
  withItemId,
  withoutItem,
  withRenamedItem,
  withSections,
} from './cache'

const item = (patch: Partial<PotluckItem> = {}): PotluckItem => ({
  id: 'a', title: 'Salat', created_at: '2030-01-01T10:00:00.000Z', can_edit: false, can_delete: false,
  claimed: false, claimed_by_me: false, bringer: null, ...patch,
})

function screenWith(sections: 'wishes' | 'bring' | 'both', items: PotluckItem[] = []): OccasionScreen {
  const base = hostScreen()
  return { ...base, occasion: { ...base.occasion, sections }, potluck: sections === 'wishes' ? null : { max_items: 50, items } }
}

const ME = { profileId: 'me', displayName: 'Mila' }

describe('the release flag', () => {
  it('is on in the demo and with VITE_POTLUCK=1, off otherwise', () => {
    expect(potluckEnabled({ VITE_DEMO: '1' })).toBe(true)
    expect(potluckEnabled({ VITE_POTLUCK: '1' })).toBe(true)
    expect(potluckEnabled({ VITE_DEMO: '0', VITE_POTLUCK: '0' })).toBe(false)
    expect(potluckEnabled({})).toBe(false)
  })
})

describe('what the occasion offers', () => {
  it('a server before the migration sends no sections: wishes only, no list', () => {
    const old = hostScreen()
    expect(sectionsOf(old)).toBe('wishes')
    expect(potluckOf(old)).toBeNull()
    expect(showsWishes(old)).toBe(true)
  })

  it('"bring" hides the wish list only while it is empty — nothing vanishes silently', () => {
    const withWishes = screenWith('bring')
    expect(showsWishes(withWishes)).toBe(true) // hostScreen() has a wish
    const empty = { ...withWishes, wishlist: { ...withWishes.wishlist!, wishes: [], received: [] } }
    expect(showsWishes(empty)).toBe(false)
    expect(showsWishes(screenWith('both'))).toBe(true)
  })

  it('switched on but not loaded yet: an empty list', () => {
    const s = { ...screenWith('both'), potluck: undefined }
    expect(potluckOf(s)).toEqual({ max_items: 50, items: [] })
  })
})

describe('titles and progress', () => {
  it('1..80 characters (code points), one line', () => {
    expect(titleProblem('  ')).toBe('empty')
    expect(titleProblem('a'.repeat(81))).toBe('too_long')
    expect(titleProblem('😀'.repeat(80))).toBeNull()
    expect(titleProblem('Bier\tSaft')).toBe('one_line')
    expect(titleProblem(' Salat ')).toBeNull()
  })

  it('counts the entries somebody brings', () => {
    expect(progressOf([item(), item({ id: 'b', claimed: true }), item({ id: 'c', claimed: true })])).toEqual({ claimed: 2, total: 3 })
  })
})

describe('optimistic steps', () => {
  it('adding: my entry at the end, with me as the bringer when I bring it myself', () => {
    const s = withAddedItem(screenWith('both', [item()]), { id: 'new-1', title: ' Kuchen ', createdAt: 'x', claim: true }, ME)
    expect(s.potluck!.items.map((i) => [i.id, i.title, i.can_edit, i.can_delete, i.claimed_by_me, i.bringer?.profile_id ?? null]))
      .toEqual([['a', 'Salat', false, false, false, null], ['new-1', 'Kuchen', true, true, true, 'me']])
    expect(withItemId(s, 'new-1', 'real').potluck!.items[1]!.id).toBe('real')
  })

  it('renaming, deleting, claiming and withdrawing touch only that entry', () => {
    const s = screenWith('both', [item(), item({ id: 'b', title: 'Bier' })])
    expect(withRenamedItem(s, 'b', 'Saft').potluck!.items.map((i) => i.title)).toEqual(['Salat', 'Saft'])
    expect(withoutItem(s, 'a').potluck!.items.map((i) => i.id)).toEqual(['b'])
    const claimed = withClaim(s, 'a', ME)
    expect(claimed.potluck!.items[0]).toMatchObject({ claimed: true, claimed_by_me: true, bringer: { profile_id: 'me' } })
    expect(withClaim(claimed, 'a', null).potluck!.items[0]).toMatchObject({ claimed: false, claimed_by_me: false, bringer: null })
  })

  it('switching the list off empties it, on starts it empty; the wish list stays as it is', () => {
    const s = screenWith('both', [item()])
    const off = withSections(s, 'wishes')
    expect(off.occasion.sections).toBe('wishes')
    expect(off.potluck).toBeNull()
    expect(off.wishlist).toBe(s.wishlist)
    expect(withSections(off, 'bring').potluck).toEqual({ max_items: 50, items: [] })
    expect(withSections(s, 'bring').potluck!.items).toHaveLength(1) // both → bring keeps the entries
  })
})
