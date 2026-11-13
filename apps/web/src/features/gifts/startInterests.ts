import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'
import { onAccountEnded } from '../../lib/accountBoundary'
import { GIFT_INTERESTS, type GiftInterest } from '../../lib/api/giftIdeas'

// What the person picked in the onboarding's wish box (Felix 25.10, "Was wünschst du dir?"): a few interest
// ids that "Ideen" → "Für mich" starts with, as if added by hand. ON THIS DEVICE ONLY — never sent as such; like
// every interest, only the ids the deck asks for leave the device (lib/api/giftIdeas.ts). localStorage under the
// app prefix (signing out clears it — lib/query.ts clearLocalState), owner-bound like `gifts.prefs`; a memory
// copy when storage is blocked. Not a guessed profile: only what the person tapped, and removing a chip in
// "Ideen" removes it here too. docs/storage-registry.md `gifts.start`.

export const GIFT_START_KEY = `${ACTIVE_STORAGE_PREFIX}gifts.start`
/** the deck takes at most eight interests (lib/api/giftIdeas.ts) */
const MAX = 8

interface StartRecord {
  v: 1
  owner: string
  interests: GiftInterest[]
}

let memory: StartRecord | null = null
onAccountEnded(() => {
  memory = null
})

function isInterest(value: unknown): value is GiftInterest {
  return typeof value === 'string' && (GIFT_INTERESTS as readonly string[]).includes(value)
}

/** Only known ids, each once, at most eight (storage is input like any other). */
function clean(ids: readonly unknown[]): GiftInterest[] {
  const out: GiftInterest[] = []
  for (const id of ids) if (isInterest(id) && !out.includes(id)) out.push(id)
  return out.slice(0, MAX)
}

function read(): unknown {
  try {
    const raw = window.localStorage.getItem(GIFT_START_KEY)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

/** The interests this account picked in the onboarding on this device ([] for any other account). */
export function readStartInterests(userId: string): GiftInterest[] {
  const stored = read()
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    const record = stored as Partial<StartRecord>
    if (record.v === 1 && record.owner === userId && Array.isArray(record.interests)) return clean(record.interests)
  }
  return memory?.owner === userId ? memory.interests : []
}

/** Replaces the picks; an empty list removes the record. */
export function saveStartInterests(userId: string, interests: readonly GiftInterest[]): void {
  const picked = clean(interests)
  memory = picked.length > 0 ? { v: 1, owner: userId, interests: picked } : null
  try {
    if (memory) window.localStorage.setItem(GIFT_START_KEY, JSON.stringify(memory))
    else window.localStorage.removeItem(GIFT_START_KEY)
  } catch {
    /* storage full or blocked: the memory copy keeps them for this visit */
  }
}

/** "Ideen" changed what it asks for: a pick the person took away there is forgotten here as well. */
export function keepStartInterests(userId: string, stillAsked: readonly GiftInterest[]): void {
  const current = readStartInterests(userId)
  const kept = current.filter((id) => stillAsked.includes(id))
  if (kept.length !== current.length) saveStartInterests(userId, kept)
}

/** Tests only. */
export function resetStartInterestsForTests(): void {
  memory = null
}
