import type { ListsOverview, ListsStats, OwnerListCard, UpcomingList } from '../../lib/api/lists.types'

// What the "Wunschlisten" tab SHOWS (Felix 22.10: "In Listen gibt es keine Anlässe – nur Wunschlisten"): the
// overview answer minus everything that belongs to an occasion — my occasions' lists in "Meine", the guest
// occasions in "Freunde · Bald" — and minus my lists whose delete waits for its 5 s undo. An occasion's wishlist
// stays where it belongs: on the occasion's own screen. The two counters of the header are counted from exactly
// what the tab shows (the server's stats also count occasion lists), so a number never disagrees with the grid.
// Pure and memory only: the cached overview itself is never changed (other screens read its server numbers).

export interface ListsTabView {
  /** my lists without an occasion, in the server's order, without the ones waiting for their delete */
  myLists: OwnerListCard[]
  /** "Bald": only dated lists without an occasion (the people I follow) */
  upcoming: UpcomingList[]
  stats: ListsStats
}

/** A list of mine that belongs in "Meine" (never an occasion's list). */
export function isTabList(card: Pick<OwnerListCard, 'kind' | 'occasion'>): boolean {
  return card.kind === 'standalone' && card.occasion === null
}

export function listsTabView(overview: ListsOverview, pendingDeletes: ReadonlySet<string> = new Set()): ListsTabView {
  const myLists = overview.my_lists.filter((card) => isTabList(card) && !pendingDeletes.has(card.id))
  const upcoming = overview.upcoming.filter((entry) => entry.kind === 'standalone' && entry.list.occasion_id === null)
  // "Mit dir geteilt": the follower lists of the people I follow — exactly the cards of "Freunde" (each list once)
  const shared = new Set(overview.following.flatMap((person) => person.lists.map((list) => list.id)))
  return {
    myLists,
    upcoming,
    stats: {
      ...overview.stats,
      my_lists: myLists.length,
      my_wishes: myLists.reduce((sum, card) => sum + card.wish_count, 0),
      friends_lists: shared.size,
    },
  }
}
