import type { LinkPreview, LinkPreviewErrorCode } from '../../../lib/api/linkPreview'
import type { OccasionSections, OwnerWish, WishInput } from '../../../lib/api/types'
import { LIMITS } from '../../../lib/app'
import { cleanTitle, POTLUCK_MAX, titleProblem } from '../../potluck/cache'
import { extractLink, hostOf } from '../../wishes/linkInput'
import type { PreparedPhoto } from '../photo/pipeline'

// "Gleich mit eintragen" (Felix 26.10): what the host adds while creating an occasion, so nothing has to be
// added afterwards — wishes (a title, or a shop link read by our Worker like the wish form), wishes picked from
// my own lists (they MOVE into the new list once the occasion exists — a move, never a copy) and entries of the
// bring-along list. Everything is optional and saved after the occasion itself (extras/send.ts): it never
// blocks creating the occasion. Pure: no React, no requests. Owner side: nothing of the secret part here.

/** What our Worker said about a pasted link (null = no answer: offline, shop down …) and its product photo. */
export interface LinkRead {
  preview: LinkPreview | null
  photo: PreparedPhoto | null
  code?: LinkPreviewErrorCode
}

export interface QuickWish {
  /** client key (lists, motion) — never sent */
  key: string
  /** what the person typed besides the link ('' = nothing) — wins over the link's own title */
  typed: string
  /** the cleaned link, null for a wish without one */
  url: string | null
  /** the reading of the link while it travels (the save waits for it a moment, extras/send.ts) */
  read: Promise<LinkRead> | null
  /** the answer once it is there */
  answer: LinkRead | null
}

/** A wish of one of my lists, chosen in "Aus meinen Listen holen": it moves once the occasion exists. */
export interface PickedWish {
  wish: OwnerWish
  listId: string
  listTitle: string
}

export interface BringEntry {
  key: string
  title: string
}

export interface OccasionExtras {
  wishes: QuickWish[]
  picked: PickedWish[]
  items: BringEntry[]
}

export const NO_EXTRAS: OccasionExtras = { wishes: [], picked: [], items: [] }

/** At most this many quick wishes in the form; more go in on the occasion's screen. */
export const QUICK_WISHES_MAX = 20

export { extrasCount, withPendingItems } from './pending'

export function wishCount(extras: OccasionExtras): number {
  return extras.wishes.length + extras.picked.length
}

/** Only what the chosen "Was gibt's?" offers is saved (switched-off parts stay in the form, unsent). */
export function extrasFor(extras: OccasionExtras, sections: OccasionSections): OccasionExtras {
  return {
    wishes: sections === 'bring' ? [] : extras.wishes,
    picked: sections === 'bring' ? [] : extras.picked,
    items: sections === 'wishes' ? [] : extras.items,
  }
}

/** The form's layout animations follow this (rows come and go, a link answer arrives). */
export function extrasLayoutKey(extras: OccasionExtras, sections: OccasionSections, wishesOpen: boolean): string {
  const reading = extras.wishes.filter((wish) => isReading(wish)).length
  return `x:${sections}:${wishesOpen ? 'o' : 'c'}:${extras.wishes.length}:${extras.picked.length}:${extras.items.length}:${reading}`
}

export function isReading(wish: QuickWish): boolean {
  return wish.read !== null && wish.answer === null
}

const codePoints = (text: string) => Array.from(text).length

function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text
}

/**
 * One line of the wish field: the first web link in it (normalised) and the rest as the person's own title
 * ("Kaffeemühle https://shop.example/x" → title "Kaffeemühle" + the link). Whitespace collapsed.
 */
export function parseWishText(text: string): { url: string | null; typed: string } {
  const clean = text.replace(/\s+/g, ' ').trim()
  const url = extractLink(clean)
  if (!url) return { url: null, typed: clean }
  // the link as it was typed (with or without scheme) leaves the text; what remains is the person's title
  const rest = clean
    .split(' ')
    .filter((word) => extractLink(word) !== url)
    .join(' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim()
  return { url, typed: rest }
}

export type WishTextProblem = 'empty' | 'too_long'

export function wishTextProblem(text: string): WishTextProblem | null {
  const { url, typed } = parseWishText(text)
  if (!url && typed === '') return 'empty'
  if (codePoints(typed) > LIMITS.wishTitle) return 'too_long'
  return null
}

/** A new quick wish from the field's text (validated before by wishTextProblem). */
export function quickWishOf(text: string, key: string, read: Promise<LinkRead> | null): QuickWish {
  const { url, typed } = parseWishText(text)
  return { key, typed, url, read: url ? read : null, answer: null }
}

/** The shop's name for the tile: the answer's site, else the link's host. */
export function siteOf(wish: QuickWish): string | null {
  if (!wish.url) return null
  return wish.answer?.preview?.site.trim() || hostOf(wish.answer?.preview?.url ?? wish.url) || null
}

/**
 * What the wish is called: the person's own words, else the shop's title, else (no title found) the shop's name —
 * the wish is never lost for a missing title; it can be renamed on the occasion's screen.
 */
export function titleOf(wish: QuickWish): string {
  const own = wish.typed.trim()
  if (own) return own
  const found = wish.answer?.preview?.title?.trim()
  if (found) return found
  return siteOf(wish) ?? ''
}

/** The payload of createWish (lib/api/wishes.ts cleans and checks it once more, like the database). */
export function wishInputOf(wish: QuickWish): WishInput {
  const preview = wish.answer?.preview ?? null
  const input: WishInput = {
    title: cut(titleOf(wish), LIMITS.wishTitle),
    price_cents: preview?.priceCents ?? null,
    currency: 'EUR',
    url: preview?.url ?? wish.url,
    note: null,
    priority: 2,
  }
  if (preview) {
    if (preview.description) input.description = preview.description
    if (preview.brand) input.brand = preview.brand
    if (preview.color) input.color = preview.color
    if (preview.gtin) input.gtin = preview.gtin
    const site = preview.site.trim()
    if (site) input.shop_name = site
  }
  return input
}

/** The answer arrived (for this wish only). */
export function withAnswer(extras: OccasionExtras, key: string, answer: LinkRead): OccasionExtras {
  return { ...extras, wishes: extras.wishes.map((wish) => (wish.key === key ? { ...wish, answer } : wish)) }
}

export type BringProblem = 'empty' | 'too_long' | 'one_line' | 'duplicate' | 'full'

/** An entry of the bring-along list as the database checks it (1..80 characters, one line) — and no twins. */
export function bringProblem(text: string, items: readonly BringEntry[]): BringProblem | null {
  const problem = titleProblem(text)
  if (problem) return problem
  if (items.length >= POTLUCK_MAX) return 'full'
  const title = cleanTitle(text).toLocaleLowerCase()
  if (items.some((item) => item.title.toLocaleLowerCase() === title)) return 'duplicate'
  return null
}

