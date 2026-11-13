// The code of a link (/f#<code>, /i#<token>) stays in the address bar's FRAGMENT while it is still needed, so the
// "Open in browser" of an in-app browser (Telegram, Instagram …), a copied address or a reload carry it to wherever
// the person signs in (docs/spec/add-friends-design.md §1). The fragment never reaches a server: browsers send it
// neither in a request nor in the Referer (and public/_headers says no-referrer anyway). It leaves the address once
// the code has done its job (request sent, joined, "Nicht jetzt", a dead link).
// window.history is patched by the router (@tanstack/history): a replaceState here keeps the entry's state (its
// key, so the screen does not start over) and the router follows the new address. Part of the shell: keep it tiny.

function replaceAddress(url: string): void {
  try {
    window.history.replaceState(window.history.state, '', url)
  } catch {
    /* no history (tests without a window): nothing to clean */
  }
}

/** The address is `path` with a fragment: the fragment goes (the code's screen is done with it). */
export function dropCodeFromAddress(path: string): void {
  if (typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  if (pathname === path && hash) replaceAddress(pathname + search)
}

/** A failed attempt (offline, a server hiccup) keeps the code: it comes back into the address of its screen. */
export function putCodeInAddress(path: string, code: string): void {
  if (typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  if (pathname === path && !hash) replaceAddress(`${pathname}${search}#${code}`)
}
