import { useLayoutEffect, type RefObject } from 'react'

// The card's height follows the phone: the deck takes what is left between its top and the floating tab bar,
// minus the round buttons below it — so on every phone the card AND its buttons are in view without
// scrolling (an iPhone 15 with its safe areas as well as a tall Android). Within [MIN, MAX]: smaller would
// crowd the picture, larger is a poster. Measured before paint (no jump) whenever the screen renders and when
// the window or the content above the deck changes size; written to the section as --gift-deck-h (gifts.css
// has the CSS fallback).
// When the deck starts below the first screen ("Noch frei" above it on a small phone), it is fitted to the
// screen the person scrolls to instead: the section right under the top bar, card and buttons above the tab bar.

export const DECK_MIN_PX = 290
export const DECK_MAX_PX = 470
/** the stack's peek below the card */
export const DECK_PEEK_PX = 19
/** a little air between the buttons and the tab bar */
export const DECK_AIR_PX = 8
/** Pompon's row above the card without a speech bubble (104 px bunny × 0.65, feet tucked 12 px behind the card):
 *  the scrolled fit counts at most this much, so the card does not change size when the bubble comes and goes */
export const DECK_LEAD_MAX_PX = 56
/** below the deck: the stack's peek, the round buttons with their one-line captions (≈ 78) and a little air —
 *  the measured buttons replace the 78 when they are on screen (a caption may take two lines) */
export const BELOW_DECK_PX = DECK_PEEK_PX + 78 + DECK_AIR_PX

/**
 * Pure: the card height for a deck starting at `deckTop` (page coordinates) in a viewport that ends at `bottom`.
 * `scrolledTop` = where the deck's top lands when the page is scrolled to it (under the top bar); used when the
 * deck does not fit on the first screen.
 */
export function fitDeckHeight(deckTop: number, bottom: number, below = BELOW_DECK_PX, minimum = DECK_MIN_PX, scrolledTop: number | null = null): number {
  const room = bottom - deckTop - below
  const fit = room < minimum && scrolledTop !== null ? bottom - scrolledTop - below : room
  return Math.round(Math.max(minimum, Math.min(DECK_MAX_PX, fit)))
}

/** The px value of a length custom property where `host` sits (resolves var() and calc()). */
function resolveLength(host: HTMLElement, value: string): number {
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:${value}`
  host.appendChild(probe)
  const px = probe.getBoundingClientRect().height
  probe.remove()
  return Number.isFinite(px) ? px : 0
}

export function useDeckFit(sectionRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!section || typeof window === 'undefined') return undefined
    const measure = () => {
      const anchor = section.querySelector<HTMLElement>('[data-deck-slot]')
      if (!anchor) return
      // the dev phone frame scrolls .pf-app; production scrolls the page
      const scroller = section.closest<HTMLElement>('.pf-app')
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY
      const originTop = scroller ? scroller.getBoundingClientRect().top : 0
      const viewport = scroller ? scroller.clientHeight : window.innerHeight
      if (viewport <= 0) return
      const anchorTop = anchor.getBoundingClientRect().top
      const deckTop = anchorTop - originTop + scrollTop
      // what the floating tab bar keeps free at the bottom (nav.css), or just the home indicator without it
      const barSpace = document.documentElement.hasAttribute('data-tabbar') ? resolveLength(section, 'var(--nav-bar-space, 0px)') : resolveLength(section, 'var(--sa-bottom, 0px)')
      // scrolled to the deck: the section starts under the top bar, Pompon's row sits above the card
      const lead = Math.min(DECK_LEAD_MAX_PX, Math.max(0, anchorTop - section.getBoundingClientRect().top))
      const scrolledTop = resolveLength(section, 'calc(var(--topbar-h, 0px) + var(--sa-top, 0px))') + lead
      const controls = section.querySelector<HTMLElement>('[data-deck-controls]')
      const below = controls ? DECK_PEEK_PX + controls.offsetHeight + DECK_AIR_PX : BELOW_DECK_PX
      const details = anchor.querySelector<HTMLElement>('article[data-depth="0"] [data-gift-details]')
      const picture = details?.previousElementSibling
      // Short screens and larger text may need more than the nominal minimum. Never clip a card's
      // actions to keep its controls above the bar; let the page scroll when its content needs room.
      const minimum = details ? Math.max(DECK_MIN_PX, details.offsetHeight + (picture ? parseFloat(getComputedStyle(picture).minHeight) || 0 : 0)) : DECK_MIN_PX
      const height = `${fitDeckHeight(deckTop, viewport - barSpace, below, minimum, scrolledTop)}px`
      if (section.style.getPropertyValue('--gift-deck-h') !== height) section.style.setProperty('--gift-deck-h', height)
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(section)
    // the content above the deck ("Noch frei" arriving, a list chip row) moves it without resizing it
    if (section.parentElement) observer?.observe(section.parentElement)
    const details = section.querySelector<HTMLElement>('article[data-depth="0"] [data-gift-details]')
    if (details) observer?.observe(details)
    const controls = section.querySelector<HTMLElement>('[data-deck-controls]')
    if (controls) observer?.observe(controls)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  })
}
