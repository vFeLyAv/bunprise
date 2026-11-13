// "The previous screen peeks underneath" (K11 swipe-back): an SPA keeps only one screen mounted, so at
// the moment of every push (history PUSH — the old screen is still in the document) a static copy of the
// screen's visible parts is kept in memory: its top bar, <main>, the legal footer and the tab bar, plus the
// scroll offset. During a swipe-back the copy lies under the moving screen; when the router has rendered
// the real previous screen, the copy goes. Memory only, a handful of entries, inert and hidden from
// assistive technology, never persisted — and cleared with the signed-in layout and when the account ends.

import { onAccountEnded } from '../../lib/accountBoundary'

export interface Ghost {
  /** detached container (.swipe-ghost) with the copied parts */
  node: HTMLElement
  /** the screen's scroll offset when it was left (px) */
  scrollTop: number
}

/** Ghosts by history index (TanStack history `__TSR_index`): the entry that the copy shows. */
const ghosts = new Map<number, Ghost>()
const MAX_GHOSTS = 6

/** The screen's own parts among the app root's children (the overlays live elsewhere or are skipped). */
export function screenParts(appRoot: HTMLElement): HTMLElement[] {
  return Array.from(appRoot.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && /^(HEADER|MAIN|FOOTER)$/.test(el.tagName) && !el.closest('.swipe-ghost'),
  )
}

/** A copy that cannot collide with the live document: no ids, no view-transition names (CSS), inert. */
export function cleanCopy(original: HTMLElement): HTMLElement {
  const copy = original.cloneNode(true) as HTMLElement
  copy.removeAttribute('id')
  for (const el of Array.from(copy.querySelectorAll('[id]'))) el.removeAttribute('id')
  copy.removeAttribute('data-tabbar')
  for (const el of Array.from(copy.querySelectorAll('[data-tabbar]'))) el.removeAttribute('data-tabbar')
  // typed values are properties, not attributes: carry them over (a form behind a form)
  const from = original.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  const to = copy.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  from.forEach((field, index) => {
    const target = to[index]
    if (!target) return
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio') && target instanceof HTMLInputElement) target.checked = field.checked
    else target.value = field.value
  })
  return copy
}

/** Copies the screen that is on display right now (call it before the next screen renders). */
export function captureGhost(appRoot: HTMLElement, layerRoot: HTMLElement, scrollTop: number): Ghost {
  const node = document.createElement('div')
  node.className = 'swipe-ghost'
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('inert', '')
  const scroll = document.createElement('div')
  scroll.className = 'swipe-ghost-scroll'
  scroll.style.transform = `translate3d(0, ${-Math.max(0, scrollTop)}px, 0)`
  node.append(scroll)
  for (const part of screenParts(appRoot)) {
    const copy = cleanCopy(part)
    // the fixed top bar stays at the top of the ghost; the page content is shifted by the scroll offset
    if (part.tagName === 'HEADER') node.append(copy)
    else scroll.append(copy)
  }
  const tabbar = layerRoot.querySelector<HTMLElement>('nav[data-tabbar]')
  if (tabbar) node.append(cleanCopy(tabbar))
  const dim = document.createElement('div')
  dim.className = 'swipe-ghost-dim'
  node.append(dim)
  return { node, scrollTop }
}

export function storeGhost(index: number, ghost: Ghost): void {
  // a push drops every entry from `index` on (that forward history is gone)
  for (const key of Array.from(ghosts.keys())) if (key >= index) ghosts.delete(key)
  ghosts.set(index, ghost)
  const keys = Array.from(ghosts.keys()).sort((a, b) => a - b)
  while (keys.length > MAX_GHOSTS) {
    const oldest = keys.shift()
    if (oldest !== undefined) ghosts.delete(oldest)
  }
}

export function ghostFor(index: number): Ghost | null {
  return ghosts.get(index) ?? null
}

export function clearGhosts(): void {
  ghosts.clear()
}

/** Tests only. */
export function ghostCount(): number {
  return ghosts.size
}

onAccountEnded(clearGhosts)
