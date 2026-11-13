// Map links from the free-text place of an occasion (product-pilot.md S7). No embedded map in the pilot.

/** ⚠️ product-pilot.md 9.3: verify on iOS 27 (possibly maps.apple.com/search?query=). */
export function appleMapsUrl(address: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(address.trim())}`
}

export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`
}

/** iPhone / iPad / Mac: show the Apple Maps button first. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod|Macintosh/.test(ua)
}

/** Opens an external URL in a new tab without handing it our window (noopener, noreferrer). */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
