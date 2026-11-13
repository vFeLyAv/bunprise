import type { OccasionScreen, OccasionSections, PotluckItem, PotluckScreen } from '../../lib/api/types'

// Pure helpers on the cached occasion screen (['occasion', id], memory only) for the bring-along list:
// what the screen offers, and the optimistic steps of adding, renaming, deleting and (after the server said
// yes) bringing an entry. No React, so every shape is unit-testable.

export const POTLUCK_MAX = 50
export const POTLUCK_TITLE_MAX = 80

/** What the occasion offers; a server before the migration sends nothing = wishes only. */
export function sectionsOf(screen: OccasionScreen): OccasionSections {
  return screen.occasion.sections ?? 'wishes'
}

export function hasPotluck(sections: OccasionSections): boolean {
  return sections === 'bring' || sections === 'both'
}

/**
 * Whether the wish list is shown: always unless the host chose "Mitbringen" only — and even then while it still
 * holds wishes (moved in later, for example): nothing is ever hidden silently (design §1.1).
 */
export function showsWishes(screen: OccasionScreen): boolean {
  if (sectionsOf(screen) !== 'bring') return true
  return Boolean(screen.wishlist && (screen.wishlist.wishes.length > 0 || (screen.wishlist.received?.length ?? 0) > 0))
}

/** The list as the screen has it now; an empty list while it is switched on but not loaded yet. */
export function potluckOf(screen: OccasionScreen): PotluckScreen | null {
  if (!hasPotluck(sectionsOf(screen))) return null
  return screen.potluck ?? { max_items: POTLUCK_MAX, items: [] }
}

/** "4 von 6 verteilt" */
export function progressOf(items: readonly PotluckItem[]): { claimed: number; total: number } {
  return { claimed: items.filter((item) => item.claimed).length, total: items.length }
}

/** A title as the database stores it: trimmed; valid = 1..80 characters (code points), one line. */
export function cleanTitle(value: string): string {
  return value.trim()
}

export function titleProblem(value: string): 'empty' | 'too_long' | 'one_line' | null {
  const title = cleanTitle(value)
  if (title === '') return 'empty'
  if (Array.from(title).length > POTLUCK_TITLE_MAX) return 'too_long'
  if (/[\n\r\t]/.test(title)) return 'one_line'
  return null
}

function withItems(screen: OccasionScreen, change: (items: PotluckItem[]) => PotluckItem[]): OccasionScreen {
  const list = potluckOf(screen)
  if (!list) return screen
  return { ...screen, potluck: { ...list, items: change([...list.items]) } }
}

export interface Me {
  profileId: string
  displayName: string | null
}

/** A new entry of mine, at the end (the server orders by creation). */
export function withAddedItem(screen: OccasionScreen, item: { id: string; title: string; createdAt: string; claim: boolean }, me: Me): OccasionScreen {
  return withItems(screen, (items) => [
    ...items,
    {
      id: item.id,
      title: cleanTitle(item.title),
      created_at: item.createdAt,
      can_edit: true,
      can_delete: true,
      claimed: item.claim,
      claimed_by_me: item.claim,
      bringer: item.claim ? { profile_id: me.profileId, display_name: me.displayName, photo: null } : null,
    },
  ])
}

/** The optimistic entry gets its server id. */
export function withItemId(screen: OccasionScreen, from: string, to: string): OccasionScreen {
  return withItems(screen, (items) => items.map((item) => (item.id === from ? { ...item, id: to } : item)))
}

export function withRenamedItem(screen: OccasionScreen, id: string, title: string): OccasionScreen {
  return withItems(screen, (items) => items.map((item) => (item.id === id ? { ...item, title: cleanTitle(title) } : item)))
}

export function withoutItem(screen: OccasionScreen, id: string): OccasionScreen {
  return withItems(screen, (items) => items.filter((item) => item.id !== id))
}

/** After the server confirmed "Ich bring's mit" (or "Doch nicht"): the entry shows me (or nobody). */
export function withClaim(screen: OccasionScreen, id: string, me: Me | null): OccasionScreen {
  return withItems(screen, (items) =>
    items.map((item) => {
      if (item.id !== id) return item
      if (!me) return { ...item, claimed: false, claimed_by_me: false, bringer: null }
      return { ...item, claimed: true, claimed_by_me: true, bringer: { profile_id: me.profileId, display_name: me.displayName, photo: null } }
    }),
  )
}

/** The host changed what the occasion offers (edit form): switching the list off empties it, on starts it empty. */
export function withSections(screen: OccasionScreen, sections: OccasionSections): OccasionScreen {
  const before = sectionsOf(screen)
  const potluck = hasPotluck(sections) ? (hasPotluck(before) ? (screen.potluck ?? null) : { max_items: POTLUCK_MAX, items: [] }) : null
  return { ...screen, occasion: { ...screen.occasion, sections }, potluck }
}
