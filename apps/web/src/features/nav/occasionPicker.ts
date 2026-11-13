import type { FeedOccasion, FeedScreen } from '../../lib/api/types'
import { byStart } from '../feed/model'

// "Wunsch hinzufügen" from the create menu (K5): which wishlist does the new wish go to?
// In the pilot every occasion has ONE wishlist and its owner is the host (pilot-decisions §1), and only
// the list owner may add wishes (S8 is owner-only, RLS `wishes_insert`). So the candidates are the
// upcoming occasions I host — from the feed query the app already has (no extra RPC). A past occasion
// takes no new wishes.

export type WishTarget =
  /** the feed is not there yet (first load) */
  | { kind: 'loading' }
  /** nothing I host is coming up: create an occasion first */
  | { kind: 'none' }
  /** exactly one: straight to its wish form */
  | { kind: 'one'; occasion: FeedOccasion }
  /** several: "Für welchen Anlass?" */
  | { kind: 'many'; occasions: FeedOccasion[] }

/** My upcoming occasions as host, in Start's order (ascending start, the same start by title), each id once. */
export function wishCandidates(feed: Pick<FeedScreen, 'upcoming'>): FeedOccasion[] {
  const seen = new Set<string>()
  return feed.upcoming.filter((occasion) => {
    if (occasion.role !== 'host' || seen.has(occasion.id)) return false
    seen.add(occasion.id)
    return true
  }).sort(byStart)
}

export function wishTarget(feed: Pick<FeedScreen, 'upcoming'> | undefined): WishTarget {
  if (!feed) return { kind: 'loading' }
  const candidates = wishCandidates(feed)
  const [first] = candidates
  if (!first) return { kind: 'none' }
  if (candidates.length === 1) return { kind: 'one', occasion: first }
  return { kind: 'many', occasions: candidates }
}
