import type { WishPlaceRef } from '../../lib/api/types'

// "Ein Wunsch in mehreren Listen" (20261027200000, docs/spec/shared-wishes-design.md §3.3/§5.7): the quiet line under
// a wish that says where else it lives. The same text for the owner (every other list) and for a guest of an occasion
// (the lists they can read by name; one "hidden" entry = "einer anderen Liste" — never which, never how many).
// Pure data about the wish's lists: nothing here is about reservations.

/** The other lists of a wish, or null when it lives only here (or an older server sent nothing). */
export function otherPlaces(places: readonly WishPlaceRef[] | null | undefined): readonly WishPlaceRef[] | null {
  return places && places.length > 0 ? places : null
}

/** `t` of the wishes namespace (keys wish.places_*). */
export type PlacesT = (key: string, options?: Record<string, unknown>) => string

/** "auch in „Meine Wünsche“" · "auch in einer anderen Liste" · "auch in 2 anderen Listen" */
export function placesText(t: PlacesT, places: readonly WishPlaceRef[] | null | undefined): string | null {
  const others = otherPlaces(places)
  if (!others) return null
  if (others.length > 1) return t('wish.places_many', { count: others.length })
  const [only] = others
  if (!only || only.kind === 'hidden' || !only.title?.trim()) return t('wish.places_hidden')
  return t('wish.places_one', { list: only.title.trim() })
}
