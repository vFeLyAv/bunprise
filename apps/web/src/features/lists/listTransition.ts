import { onAccountEnded } from '../../lib/accountBoundary'

// Shared-element transition list card ↔ the list screen's header (design-system-motion §2.5; the router runs every
// screen change in a view transition, router.tsx defaultViewTransition): the opened card's PHOTO and the header's
// photo carry the same view-transition-name, so the picture glides from the card to the top of the list and back
// (the smooth spring of styles/app.css ::view-transition-group(*)); everything else crossfades.
// - Only lists WITH a cover take part (without one: the plain crossfade of every screen change).
// - A page may hold the name only once: the header always has it, a card only after it was tapped (set right in the
//   tap, before the router starts the transition) — and the card the person came back from keeps it, so the photo
//   shrinks back into it. Tapping another card takes the name from the previous one first.
// - Reduced motion: no name at all → the screen change is the plain crossfade (no moving picture).
// - Firefox 144+, Chrome, Safari 18+: native; elsewhere the router simply changes the screen.

export const LIST_COVER_VT = 'list-cover'

let lastOpened: string | null = null

export function lastOpenedList(): string | null {
  return lastOpened
}

/** In the tap on a card with a cover: the name moves to this card's photo (synchronously, before navigating). */
export function nameOpenedCover(listId: string, photo: HTMLElement | null): void {
  lastOpened = listId
  if (!photo || typeof document === 'undefined') return
  for (const other of document.querySelectorAll<HTMLElement>('[data-list-cover-vt]')) {
    if (other !== photo) other.style.viewTransitionName = ''
  }
  photo.style.viewTransitionName = LIST_COVER_VT
}

onAccountEnded(() => {
  lastOpened = null
})
