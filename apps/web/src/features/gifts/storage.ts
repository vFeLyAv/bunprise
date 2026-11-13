import { useCallback, useSyncExternalStore } from 'react'
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'
import { onAccountEnded } from '../../lib/accountBoundary'
import { parseGiftIdeasPage, type GiftIdea } from '../../lib/api/giftIdeas'

// What "Geschenk finden" keeps on THIS device (localStorage under the app prefix, so signing out clears it —
// lib/query.ts clearLocalState; the demo uses its own `bunprise.demo.` prefix). Both records name the
// account they belong to and are ignored for any other account (like `offlineFeed`). Never sent anywhere,
// never shown to anyone else. Rows for docs/storage-registry.md: see the wave-2 report (agent H).
// - `gifts.prefs`: { v: 1, owner, personalize } — the "Nicht personalisieren" switch (default: personalised).
// - `gifts.saved`: { v: 1, owner, people: { <profile id>: { name, items: [idea snapshot + saved_at] } } } —
//   "Merken für Anna": ideas kept for a person. The person never sees it (it never leaves the device).
//   At most SAVED_PER_PERSON ideas per person and SAVED_PEOPLE people (the oldest go first).
// No interest profile is stored (follows-design G3): interests are guessed again from the list each time.

export const GIFT_PREFS_KEY = `${ACTIVE_STORAGE_PREFIX}gifts.prefs`
export const GIFT_SAVED_KEY = `${ACTIVE_STORAGE_PREFIX}gifts.saved`
export const SAVED_PER_PERSON = 30
export const SAVED_PEOPLE = 20
const NAME_MAX = 40

export interface SavedIdea extends GiftIdea {
  saved_at: number
}

interface PrefsRecord {
  v: 1
  owner: string
  personalize: boolean
}

interface SavedPerson {
  name: string
  items: SavedIdea[]
}

interface SavedRecord {
  v: 1
  owner: string
  people: Record<string, SavedPerson>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the choice lives for this visit only (memory below) */
  }
}

// ---- a tiny external store, so every part of the screen sees a change at once ------------------------------

const listeners = new Set<() => void>()
let version = 0
/** memory copy for a blocked storage (private mode): this visit still works */
let memoryPrefs: PrefsRecord | null = null
let memorySaved: SavedRecord | null = null

function emit(): void {
  version += 1
  for (const listener of Array.from(listeners)) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === GIFT_PREFS_KEY || event.key === GIFT_SAVED_KEY || event.key === null) emit()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Forget account-owned fallback data as well as disk data when the account ends in this tab. */
function forgetGiftMemory(): void {
  memoryPrefs = null
  memorySaved = null
  snapshots.clear()
  emit()
}
onAccountEnded(forgetGiftMemory)
export const resetGiftStorageForTests = forgetGiftMemory

// ---- "Nicht personalisieren" -------------------------------------------------------------------------------

function prefsOf(userId: string): PrefsRecord | null {
  const stored = read(GIFT_PREFS_KEY)
  if (isRecord(stored) && stored.v === 1 && stored.owner === userId && typeof stored.personalize === 'boolean') {
    return { v: 1, owner: userId, personalize: stored.personalize }
  }
  return memoryPrefs?.owner === userId ? memoryPrefs : null
}

/** Personalised unless this account switched it off on this device. */
export function personalizeEnabled(userId: string): boolean {
  return prefsOf(userId)?.personalize ?? true
}

export function setPersonalize(userId: string, personalize: boolean): void {
  const record: PrefsRecord = { v: 1, owner: userId, personalize }
  memoryPrefs = record
  write(GIFT_PREFS_KEY, record)
  emit()
}

export function usePersonalize(userId: string): boolean {
  const snapshot = useCallback(() => personalizeEnabled(userId), [userId])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// ---- "Merken für <Name>" -----------------------------------------------------------------------------------

/** Re-checks a stored snapshot with the answer parser: storage is input like any other. */
function cleanSaved(value: unknown): SavedIdea | null {
  if (!isRecord(value) || typeof value.saved_at !== 'number' || !Number.isFinite(value.saved_at)) return null
  const page = parseGiftIdeasPage({ items: [value] })
  const idea = page?.items[0]
  return idea ? { ...idea, saved_at: value.saved_at } : null
}

function savedRecord(userId: string): SavedRecord {
  const stored = read(GIFT_SAVED_KEY)
  if (isRecord(stored) && stored.v === 1 && stored.owner === userId && isRecord(stored.people)) {
    const people: Record<string, SavedPerson> = {}
    for (const [profileId, person] of Object.entries(stored.people)) {
      if (!isRecord(person) || typeof person.name !== 'string' || !Array.isArray(person.items)) continue
      const items = person.items.map(cleanSaved).filter((idea): idea is SavedIdea => idea !== null).slice(0, SAVED_PER_PERSON)
      if (items.length > 0) people[profileId] = { name: [...person.name].slice(0, NAME_MAX).join(''), items }
    }
    return { v: 1, owner: userId, people }
  }
  if (memorySaved?.owner === userId) return memorySaved
  return { v: 1, owner: userId, people: {} }
}

function storeSaved(record: SavedRecord): void {
  // the people with the oldest newest-idea go first when there are too many
  const entries = Object.entries(record.people)
    .sort((a, b) => Math.max(...b[1].items.map((i) => i.saved_at)) - Math.max(...a[1].items.map((i) => i.saved_at)))
    .slice(0, SAVED_PEOPLE)
  const next: SavedRecord = { v: 1, owner: record.owner, people: Object.fromEntries(entries) }
  memorySaved = next
  write(GIFT_SAVED_KEY, next)
  emit()
}

export function savedFor(userId: string, profileId: string): SavedIdea[] {
  return savedRecord(userId).people[profileId]?.items ?? []
}

export function isSavedFor(userId: string, profileId: string, ideaId: string): boolean {
  return savedFor(userId, profileId).some((idea) => idea.id === ideaId)
}

/**
 * Keeps an idea for a person on this device (newest first; saving it again moves it to the top). `now` =
 * when it was kept: "Rückgängig" after removing one passes its old saved_at, and it returns to its old place.
 */
export function saveIdeaFor(userId: string, person: { profileId: string; name: string }, idea: GiftIdea, now = Date.now()): void {
  const record = savedRecord(userId)
  const current = record.people[person.profileId]?.items ?? []
  const items = [{ ...idea, saved_at: now }, ...current.filter((saved) => saved.id !== idea.id)]
    .sort((a, b) => b.saved_at - a.saved_at)
    .slice(0, SAVED_PER_PERSON)
  storeSaved({ ...record, people: { ...record.people, [person.profileId]: { name: [...person.name].slice(0, NAME_MAX).join(''), items } } })
}

export function forgetIdeaFor(userId: string, profileId: string, ideaId: string): void {
  const record = savedRecord(userId)
  const person = record.people[profileId]
  if (!person) return
  const items = person.items.filter((idea) => idea.id !== ideaId)
  const people = { ...record.people }
  if (items.length > 0) people[profileId] = { ...person, items }
  else delete people[profileId]
  storeSaved({ ...record, people })
}

const NONE: SavedIdea[] = []
/** one snapshot per account + person and store version (useSyncExternalStore needs a stable value) */
const snapshots = new Map<string, { version: number; value: SavedIdea[] }>()

function savedSnapshot(userId: string, profileId: string | null): SavedIdea[] {
  if (!profileId) return NONE
  const key = `${userId}|${profileId}`
  const known = snapshots.get(key)
  if (known && known.version === version) return known.value
  const value = savedFor(userId, profileId)
  snapshots.set(key, { version, value })
  return value
}

/** The ideas kept for one person, newest first (re-renders when they change, also from another tab). */
export function useSavedFor(userId: string, profileId: string | null): SavedIdea[] {
  const snapshot = useCallback(() => savedSnapshot(userId, profileId), [userId, profileId])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
