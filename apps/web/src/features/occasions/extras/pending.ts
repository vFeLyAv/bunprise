import type { OccasionScreen } from '../../../lib/api/types'
import { withAddedItem, type Me } from '../../potluck/cache'
import type { BringEntry, OccasionExtras } from './model'

// The two helpers of the form's extras (extras/model.ts) that the create itself needs (actions.ts). A file of its
// own on purpose: actions.ts belongs to screens that load early, and this pulls in nothing new (the link reading,
// the wish API and the rest of the extras stay in the new-occasion chunk and extras/send.ts).

export function extrasCount(extras: OccasionExtras): number {
  return extras.wishes.length + extras.picked.length + extras.items.length
}

/**
 * The optimistic screen of the new occasion with its bring-along entries already in it (temporary ids, mine and
 * free), so the occasion shows them at once; the real screen replaces them once they are saved.
 */
export function withPendingItems(screen: OccasionScreen, items: readonly BringEntry[], me: Me, createdAt: string): OccasionScreen {
  let next = screen
  for (const item of items) next = withAddedItem(next, { id: `new-${item.key}`, title: item.title, createdAt, claim: false }, me)
  return next
}
