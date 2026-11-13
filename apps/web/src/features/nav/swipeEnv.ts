// Where the interactive edge-swipe-back runs (K11): only where the browser has no back gesture of its
// own — the installed PWA (display-mode standalone; iOS home-screen apps have none). In Safari's or
// Chrome's tab their own swipe-back keeps working untouched.
// Dev only: inside the desktop phone frame (try it with the mouse) or with `?swipeback=1` (screenshots);
// `?swipeback=0` turns it off. Production builds never read the URL for this.

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true
  } catch {
    /* no matchMedia */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function devOverride(inPhoneFrame: boolean): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  try {
    const value = new URLSearchParams(window.location.search).get('swipeback')
    if (value === '1') return true
    if (value === '0') return false
  } catch {
    /* unreadable URL */
  }
  return inPhoneFrame
}

/** Read once per mount of the signed-in layout (the URL flag survives the screen changes after it). */
export function swipeBackEnabled(inPhoneFrame: boolean): boolean {
  return isStandalone() || devOverride(inPhoneFrame)
}
