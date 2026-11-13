// "The neighbour tab slides in" (TabSwipe.tsx): an SPA renders one screen at a time, so when a tab screen is left —
// a tap on the bar, a swipe, a push into a pushed screen — a static copy of its visible parts (the top bar, <main>,
// the footer) is kept in memory, one per tab. A swipe shows it beside the moving page until the router has rendered
// the real screen in its place; a tab not seen yet in this page session shows a calm skeleton instead.
// Memory only, inert and hidden from assistive technology, never persisted — cleared when the account ends.
// Mascots live in shadow roots, which a copy does not carry: the copy shows the screen without its bunny.
// Pictures (Felix 26.10 «мелькает фото»): the copy holds the object URLs it shows (lib/objectUrl.ts), so the
// real screen that comes back gets the same, already decoded picture — and its <img>s paint in the same frame as
// the rest of the copy (decoding="sync", never lazy).
// At rest (Felix 28.10 «фотки дёргаются»): a screen may be left in the middle of a motion — the deck's cards
// nudging or flying in, a bubble that is about to go. The copy shows the screen as it comes back, not that
// moment: an element with `data-copy-rest="transform:…;opacity:…"` is put at that rest pose in the copy, one with
// `data-copy-hide` (a momentary bubble, a card on its way out) is left out of it (the real screen comes back
// without it). Before: the copy showed the card 25 px off, the bubble 8 px tall, and the real page jumped.

import { onAccountEnded } from '../../lib/accountBoundary'
import { holdObjectUrl } from '../../lib/objectUrl'
import { cleanCopy, screenParts } from './ghost'
import type { TabId } from './tabs'

interface TabCopy {
  node: HTMLElement
  /** gives back the object URLs the copy holds */
  release: () => void
}

const copies = new Map<TabId, TabCopy>()

/** A copied picture shows with the copy's first frame and keeps its bytes alive while the copy exists. */
function keepPictures(node: HTMLElement): () => void {
  const releases: Array<() => void> = []
  for (const img of Array.from(node.querySelectorAll('img'))) {
    img.setAttribute('decoding', 'sync')
    img.removeAttribute('loading')
    const src = img.getAttribute('src') ?? ''
    if (src.startsWith('blob:')) releases.push(holdObjectUrl(src))
  }
  return () => {
    for (const release of releases) release()
  }
}

/** Puts what was caught mid-motion at its rest pose and hides what is only momentary (see the top). */
export function restPoses(node: HTMLElement): void {
  for (const el of Array.from(node.querySelectorAll<HTMLElement>('[data-copy-rest]'))) {
    for (const declaration of (el.dataset.copyRest ?? '').split(';')) {
      const colon = declaration.indexOf(':')
      if (colon <= 0) continue
      el.style.setProperty(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
    }
  }
  for (const el of Array.from(node.querySelectorAll<HTMLElement>('[data-copy-hide]'))) el.style.display = 'none'
}

/** Copies the tab screen on display right now (call it before the next screen renders). */
export function captureTab(tab: TabId, appRoot: HTMLElement): void {
  const parts = screenParts(appRoot)
  if (parts.length === 0) return
  const node = document.createElement('div')
  node.className = 'tab-swipe-layer'
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('inert', '')
  for (const part of parts) {
    const copy = cleanCopy(part)
    // a page that leaves mid-swipe is moved or dimmed: the copy shows it at rest, from the top (a tab opens there)
    copy.style.removeProperty('transform')
    copy.style.removeProperty('opacity')
    node.append(copy)
  }
  // at the top of a page its bar has no glass material yet (TopBar's scroll edge)
  for (const el of Array.from(node.querySelectorAll('[data-scrolled]'))) el.removeAttribute('data-scrolled')
  restPoses(node)
  const release = keepPictures(node)
  copies.get(tab)?.release()
  copies.set(tab, { node, release })
}

/** The layer that slides in for a tab: its last copy, or the skeleton of a screen. */
export function tabLayer(tab: TabId): HTMLElement {
  return copies.get(tab)?.node ?? skeletonLayer()
}

function skeletonLayer(): HTMLElement {
  const node = document.createElement('div')
  node.className = 'tab-swipe-layer tab-swipe-skeleton'
  node.setAttribute('aria-hidden', 'true')
  for (const kind of ['title', 'card', 'row', 'row']) {
    const block = document.createElement('div')
    block.className = 'tab-swipe-block'
    block.dataset.kind = kind
    node.append(block)
  }
  return node
}

export function hasTabCopy(tab: TabId): boolean {
  return copies.has(tab)
}

export function clearTabCopies(): void {
  for (const copy of copies.values()) copy.release()
  copies.clear()
}

onAccountEnded(clearTabCopies)
