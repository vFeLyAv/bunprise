import type { OccasionScreenWishlist } from '../../lib/api/types'
import { GuestWishlist } from './GuestWishlist'
import { OwnerWishlist } from './OwnerWishlist'

// CONTRACT (docs/contract.md §7): the occasion screen renders one <WishlistSection> per wishlist.
// The props below are fixed. Secrecy: the 'owner' branch is a separate component (OwnerWishlist)
// that never touches reservation code or reservation fields; reservation UI exists only in
// GuestWishlist. Both branches use the same order (priority desc, created_at asc).

export interface WishlistSectionProps {
  occasionId: string
  wishlist: OccasionScreenWishlist
  viewer: 'owner' | 'guest'
  /** optional: the screen's content just arrived after its skeleton — the rows rise in one after another */
  entrance?: boolean
}

export function WishlistSection({ occasionId, wishlist, viewer, entrance = false }: WishlistSectionProps) {
  return viewer === 'owner' ? (
    <OwnerWishlist occasionId={occasionId} wishlist={wishlist} entrance={entrance} />
  ) : (
    <GuestWishlist occasionId={occasionId} wishlist={wishlist} entrance={entrance} />
  )
}
