import type { FeedOccasion } from '../../lib/api/types'

// Who an occasion belongs to and that person's colour (wave 2, K-cal: "the calendar reads from afar").
// Pure: no React, no DOM — the month view, the people filter, Start's feed cards and the tests share it.
//
// Identity. get_feed() has no host id, only `host_name` (pilot-decisions §2), so a friend is keyed by the
// display name the server sends — trimmed, spaces collapsed, case-folded. That is the most stable identifier
// the data offers today; its limits: two friends with the same display name share a key (and a colour), and a
// friend who renames themselves gets a new one. A future `host_id` in the feed takes precedence by itself
// (personKey below), with no other change. Your own occasions (role 'host') are always "you".
//
// Colour. You = the accent. Every friend has one of PERSON_TONE_COUNT tones (styles/tiles.css --person-1…8),
// preferred by a stable hash of the key; a clash inside the people of your feed is resolved deterministically
// (the smaller key keeps its tone, the other takes the next free one — the palette order alternates hues, so
// "next" is a clearly different colour). Up to 8 friends never share a colour; the same set of friends always
// gets the same colours, and a newcomer can only move someone whose tone it shares. Never anything about
// reservations here.

export type PersonKey = string

/** Your own occasions (role 'host'). */
export const ME: PersonKey = 'me'
/** A friend's occasion without a host name (should not happen: occasions need a display name). */
export const UNKNOWN: PersonKey = 'unknown'

export const PERSON_TONE_COUNT = 8
export type FriendTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
/** 'me' = the accent; 1…8 = --person-1…8 (data-person-tone, styles/tiles.css) */
export type PersonTone = 'me' | FriendTone

export type HostedOccasion = Pick<FeedOccasion, 'role' | 'host_name'> & { host_id?: string | null }

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
}

/** The key of the person an occasion belongs to: 'me', 'id:<host id>' (when the feed has one), 'name:<name>'. */
export function personKey(occasion: HostedOccasion): PersonKey {
  if (occasion.role === 'host') return ME
  const id = typeof occasion.host_id === 'string' ? occasion.host_id.trim() : ''
  if (id) return `id:${id}`
  const name = normalizeName(occasion.host_name)
  return name ? `name:${name}` : UNKNOWN
}

/** FNV-1a (32 bit) over the UTF-16 code units → 1…8, like ui/tile.ts tileTone (but eight tones). */
export function preferredTone(key: PersonKey): FriendTone {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (((hash >>> 0) % PERSON_TONE_COUNT) + 1) as FriendTone
}

/** Plain code-unit order: the same on every device and in every language (no locale collation). */
function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The colour of every person in `keys` (duplicates allowed). Pass 1: everyone whose preferred tone is not
 * wanted by a smaller key gets it. Pass 2: the others, in key order, take the next free tone after their
 * preferred one. With more than 8 friends the tones repeat (preferred tone).
 */
export function assignTones(keys: Iterable<PersonKey>): Map<PersonKey, PersonTone> {
  const tones = new Map<PersonKey, PersonTone>()
  const friends = [...new Set(keys)].filter((key) => {
    if (key !== ME) return true
    tones.set(ME, 'me')
    return false
  })
  friends.sort(byKey)
  const taken = new Set<FriendTone>()
  const waiting: PersonKey[] = []
  for (const key of friends) {
    const tone = preferredTone(key)
    if (taken.has(tone)) waiting.push(key)
    else {
      taken.add(tone)
      tones.set(key, tone)
    }
  }
  for (const key of waiting) {
    const preferred = preferredTone(key)
    let tone: FriendTone = preferred
    for (let step = 1; step < PERSON_TONE_COUNT; step += 1) {
      const candidate = (((preferred - 1 + step) % PERSON_TONE_COUNT) + 1) as FriendTone
      if (!taken.has(candidate)) {
        tone = candidate
        break
      }
    }
    taken.add(tone)
    tones.set(key, tone)
  }
  return tones
}

export interface Person {
  key: PersonKey
  /** the display name as the server sends it; null for you */
  name: string | null
  /** what the filter chip says: the first name (friends); '' for you (the chip says "Du") */
  short: string
  /** up to two letters for the avatar circle; '' for you */
  initials: string
  tone: PersonTone
  /** how many occasions of the given list are theirs */
  count: number
}

/** "Anna Beispiel" → "AB"; one word → its first letter; Unicode-safe (same rule as ui/Avatar initials). */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase()
}

/** "Anna Beispiel" → "Anna". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/**
 * Everyone the occasions belong to, with their colours: you first (when one of them is yours — or always,
 * with `withMe`), then your friends by first name. Colours come from assignTones over ALL these people, so
 * the result does not depend on the order of the occasions.
 */
export function peopleOf(occasions: readonly HostedOccasion[], { withMe = false }: { withMe?: boolean } = {}): Person[] {
  const found = new Map<PersonKey, { name: string | null; count: number }>()
  if (withMe) found.set(ME, { name: null, count: 0 })
  for (const occasion of occasions) {
    const key = personKey(occasion)
    const entry = found.get(key)
    if (entry) entry.count += 1
    else found.set(key, { name: key === ME ? null : (occasion.host_name?.trim() || null), count: 1 })
  }
  const tones = assignTones(found.keys())
  const people: Person[] = [...found].map(([key, { name, count }]) => ({
    key,
    name,
    short: name ? firstName(name) : '',
    initials: name ? initialsOf(name) : '',
    tone: tones.get(key) ?? 'me',
    count,
  }))
  const collator = new Intl.Collator('de', { sensitivity: 'base' })
  return people.sort((a, b) => {
    if (a.key === ME) return -1
    if (b.key === ME) return 1
    return collator.compare(a.short, b.short) || byKey(a.key, b.key)
  })
}

// ---- the people filter ("Alle · Du · Anna · …") ----------------------------------------------------------

/** null = everyone ("Alle"); else the people whose occasions show. */
export type PeopleSelection = ReadonlySet<PersonKey> | null

/**
 * The selection that is really in effect: people who are not in the feed any more drop out; nobody left or
 * everybody chosen = everyone (null). Returns the same set when nothing changed (stable for memo deps).
 */
export function normalizeSelection(selection: PeopleSelection, people: readonly Pick<Person, 'key'>[]): PeopleSelection {
  if (!selection) return null
  const known = new Set(people.map((person) => person.key))
  const kept = [...selection].filter((key) => known.has(key))
  if (kept.length === 0 || kept.length >= known.size) return null
  return kept.length === selection.size ? selection : new Set(kept)
}

/**
 * A tap on a person: from "Alle" it shows only theirs; then each tap adds or removes that person; the last
 * one removed (or everyone chosen) is "Alle" again.
 */
export function toggleSelection(selection: PeopleSelection, key: PersonKey, people: readonly Pick<Person, 'key'>[]): PeopleSelection {
  const next = new Set(selection ?? [])
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return normalizeSelection(next, people)
}

// ---- what a day chip says --------------------------------------------------------------------------------

/** Birthday (its own cake glyph) or anything else (one sparkle glyph). */
export type OccasionKind = 'birthday' | 'other'

/**
 * A birthday word anywhere in a token: "Geburtstag", "Kindergeburtstag", "Geburtstagsfeier", "Birthday", "B-Day",
 * Russian "(День) рождения", "Днюха", Ukrainian "(День) народження", "Уродини"… ("Рождество" / "Різдво" = Christmas
 * is not one).
 */
const BIRTHDAY_WORD = /geburtstag|birthday|b-?day|burzeltag|wiegenfest|рождени|днюх|народжен|уродин/i
/** "Geb." as its own token ("Annas Geb."), Russian "ДР" ("ДР Миши"), Ukrainian "ДН" ("ДН Олі") */
const BIRTHDAY_SHORT = /^(?:geb\.|др|дн)$/i

export function occasionKind(title: string): OccasionKind {
  const tokens = title.trim().split(/\s+/)
  return tokens.some((token) => BIRTHDAY_WORD.test(token) || BIRTHDAY_SHORT.test(token)) ? 'birthday' : 'other'
}

/** Words a short label skips (DE + EN + RU + UK): prepositions, articles, possessives and "party / Feier" fillers. */
const FILLER = new Set([
  'von', 'vom', 'bei', 'beim', 'zum', 'zur', 'für', 'mit', 'am', 'im', 'in', 'an', 'auf', 'und', 'nach',
  'der', 'die', 'das', 'dem', 'den', 'des', 'ein', 'eine', 'einen', 'mein', 'meine', 'meinen', 'meiner', 'meins',
  'unser', 'unsere', 'unseren', 'unserer', 'party', 'feier', 'fest',
  'of', 'for', 'the', 'a', 'an', 'my', 'our', 'at', 'with', 'and', 'to', 'celebration', 'bash',
  'у', 'в', 'во', 'на', 'с', 'со', 'и', 'для', 'к', 'ко', 'мой', 'моя', 'моё', 'мои', 'наш', 'наша', 'наше', 'наши',
  'вечеринка', 'праздник',
  'з', 'із', 'зі', 'і', 'й', 'та', 'до', 'мій', 'моє', 'мої', 'наші', 'вечірка', 'свято',
])

const HAS_WORD = /[\p{L}\p{N}]/u
/** A capitalised first word that reads as a name's possessive: "Annas", "Anna's", "Jonas'", "Bens". */
const POSSESSIVE = /^\p{Lu}[\p{L}\p{M}-]*(?:s|['’]s|['’])$/u

function bare(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '').replace(/(?<=\p{L})\.$/u, '')
}

/**
 * The short form a day chip shows (the colour already says WHO, the glyph WHAT KIND): a birthday names whose
 * ("Milas Geburtstag" → "Milas", "Geburtstag von Ben" → "Ben"); anything else names what ("Annas Einweihung" →
 * "Einweihung", "Spieleabend bei Mila" → "Spieleabend"). The CSS ends it with an ellipsis where it is too long.
 * Falls back to the first word of the title.
 */
export function chipLabel(title: string, kind: OccasionKind = occasionKind(title)): string {
  const tokens = title.trim().split(/\s+/).filter((token) => HAS_WORD.test(token))
  const words = tokens.map(bare).filter(Boolean)
  const fallback = words[0] ?? title.trim()
  const meaningful = words.filter((word) => !FILLER.has(word.toLocaleLowerCase('de')))
  if (kind === 'birthday') {
    // bare() turned "Geb." into "Geb"
    // "День рождения Ани" / "День народження Олі": "День" belongs to the birthday words, "ДР" / "ДН" is one
    const rest = meaningful.filter((word) => !BIRTHDAY_WORD.test(word) && !['geb', 'день', 'др', 'дн'].includes(word.toLocaleLowerCase('de')))
    return rest[0] ?? fallback
  }
  const rest = meaningful.length >= 2 && POSSESSIVE.test(meaningful[0] ?? '') ? meaningful.slice(1) : meaningful
  return rest[0] ?? fallback
}
