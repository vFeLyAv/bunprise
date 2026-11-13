import { normalizeWishUrl } from '../../lib/api/wishes'

// What the link field of the wish screen understands (pure, unit-tested in linkInput.test.ts):
// - extractLink(): the first web link inside pasted text ("Schau mal: https://shop.example/x 😍" → the link),
//   normalised like every saved link (normalizeWishUrl: https:// by default, http(s) only, ≤ 2048);
// - shouldAutoRead(): whether TYPED text already is a complete link worth reading (pasted text is read
//   at once). Bare hosts are read only with a path ("shop.example/teekanne") or "www." — so typing
//   "amazon.d…" does not fire a request on every pause; Enter or leaving the field reads anything valid.

/** Characters that end a link inside running text. */
const STOP = '\\s<>"\'«»“”„‘’'
const EXPLICIT = new RegExp(`https?:\\/\\/[^${STOP}]+`, 'i')
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
// a bare host never follows "@" (an e-mail address) or "://" (another scheme such as ftp://)
const BARE = new RegExp(`(?:^|[^a-z0-9@.:/-])((?:www\\.)?(?:${LABEL}\\.)+[a-z]{2,24}(?::\\d{2,5})?(?:[/?#][^${STOP}]*)?)`, 'i')

/** Drops what ends a sentence after a link ("…/kopfhoerer." → "…/kopfhoerer"); keeps balanced brackets. */
function trimTrailing(link: string): string {
  let out = link
  for (;;) {
    const last = out.at(-1)
    if (last === undefined) return out
    if ('.,;:!?'.includes(last)) out = out.slice(0, -1)
    else if (last === ')' && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) out = out.slice(0, -1)
    else if (last === ']' && (out.match(/\[/g)?.length ?? 0) < (out.match(/\]/g)?.length ?? 0)) out = out.slice(0, -1)
    else return out
  }
}

/** The first web link in `text`, normalised; null when there is none. */
export function extractLink(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const candidate = EXPLICIT.exec(trimmed)?.[0] ?? BARE.exec(trimmed)?.[1]
  if (!candidate) return null
  const url = normalizeWishUrl(trimTrailing(candidate))
  return url === null || url === 'invalid' ? null : url
}

/** Typed text (no paste): read it without waiting for Enter only when it clearly is a whole link. */
export function shouldAutoRead(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return false
  if (extractLink(trimmed) === null) return false
  if (/^https?:\/\/[^/]+\.[a-z]{2,24}(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) return true
  if (/^www\./i.test(trimmed)) return true
  return /^[^/?#]+\.[a-z]{2,24}(?::\d+)?[/?#]./i.test(trimmed)
}

/** "https://www.shop.example/a" → "shop.example" (what the shop chip shows when the Worker named nothing). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** The letter of a shop chip: the first letter or digit of the shop's name, upper-case ("" when none). */
export function shopLetter(site: string): string {
  const name = site.trim().replace(/^www\./i, '')
  for (const ch of name) {
    if (/[\p{L}\p{N}]/u.test(ch)) return ch.toLocaleUpperCase()
  }
  return ''
}
