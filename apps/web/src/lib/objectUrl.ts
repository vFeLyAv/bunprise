import { useEffect } from 'react'

// Object URLs for pictures that come from OUR database as Blobs (occasion covers, wish photos): ONE URL per
// Blob (every component that shows the same Blob shares it, a re-render never reloads the <img>), counted by the
// components that show it and revoked shortly after the last one is gone. The short delay keeps StrictMode's
// mount → unmount → mount and a quick screen change from revoking a URL that is shown again at once; a URL that
// was created but never shown is revoked the same way. (Moved here from features/occasions/photo/queries.ts so
// the wish photos use the very same bookkeeping.)
// The copy of a tab screen that slides in beside the page (features/nav/tabCopies.ts) holds the URLs it shows
// (holdObjectUrl): the real screen that comes back gets the SAME URL for the same Blob — the browser still has
// that picture decoded, and wasDecoded() lets the <img> show it in the very first frame (no placeholder, no fade:
// Felix 26.10 «мелькает фото»).

const REVOKE_AFTER_MS = 1000
const objectUrls = new Map<Blob, { url: string; users: number; timer?: ReturnType<typeof setTimeout> }>()
/** URLs whose picture was decoded once in this page session (an <img> reported its load). */
const decodedUrls = new Set<string>()

function scheduleRevoke(blob: Blob): void {
  const entry = objectUrls.get(blob)
  if (!entry || entry.users > 0) return
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    if (entry.users > 0 || objectUrls.get(blob) !== entry) return
    objectUrls.delete(blob)
    decodedUrls.delete(entry.url)
    URL.revokeObjectURL(entry.url)
  }, REVOKE_AFTER_MS)
}

function objectUrlOf(blob: Blob): string | null {
  if (typeof URL.createObjectURL !== 'function') return null
  let entry = objectUrls.get(blob)
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), users: 0 }
    objectUrls.set(blob, entry)
    scheduleRevoke(blob) // revoked unless a component starts showing it
  }
  return entry.url
}

/** An object URL for a Blob while the component shows it (null without a Blob). */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = blob ? objectUrlOf(blob) : null
  useEffect(() => {
    if (!blob) return
    const entry = objectUrls.get(blob)
    if (!entry) return
    entry.users += 1
    clearTimeout(entry.timer)
    return () => {
      entry.users -= 1
      scheduleRevoke(blob)
    }
  }, [blob])
  return url
}

/**
 * Keeps an object URL alive while something outside React shows it (the copy of a tab screen). A URL this file
 * does not know (revoked already, or not ours) is left alone. Returns the release; releasing twice is harmless.
 */
export function holdObjectUrl(url: string): () => void {
  for (const [blob, entry] of objectUrls) {
    if (entry.url !== url) continue
    entry.users += 1
    clearTimeout(entry.timer)
    let held = true
    return () => {
      if (!held) return
      held = false
      entry.users -= 1
      scheduleRevoke(blob)
    }
  }
  return () => undefined
}

/** An <img> of this URL has loaded: shown again (another screen, a tab that comes back) it appears at once. */
export function markDecoded(url: string): void {
  decodedUrls.add(url)
}

/** Was this picture decoded before in this page session? Then show it at once (`decoding="sync"`, no fade). */
export function wasDecoded(url: string | null | undefined): boolean {
  return url ? decodedUrls.has(url) : false
}
