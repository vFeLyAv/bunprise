import { useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'

// The moments around "Anlegen" (follows-design §2.6, §2.13), module memory of this tab only:
// 1. the create sheet puts the new card into "Meine" at once (optimistic) and notes it here — with the
//    rect it starts from and whether Pompon carries it (motion level "Voll" and bunnies shown only);
// 2. the grid hides that card until the carried card lies on it, then shows it with a short highlight;
// 3. once the server confirmed the list, the grid opens it (the list's own screen with "+ Wunsch").
// A failed create rolls the card back (the sheet does that) and `saved` resolves false: nothing opens.
// Also the entry point for the "+" menu's "Neue Wunschliste" (integration step, features/nav): ask the tab
// to open its create sheet once it is on screen (requestCreateList()).

export interface CreatedList {
  listId: string
  /** viewport rect the carry starts from (the sheet's "Anlegen" button) */
  from: DOMRect | null
  /** play the carry (motion "Voll", bunnies shown) — else the card simply appears */
  carry: boolean
  /** resolves true once the server has the list, false when it was rolled back */
  saved: Promise<boolean>
}

let created: CreatedList | null = null
let createRequested = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function noteCreated(entry: CreatedList): void {
  created = entry
  emit()
}

export function clearCreated(listId: string): void {
  if (created?.listId !== listId) return
  created = null
  emit()
}

export function useCreatedList(): CreatedList | null {
  return useSyncExternalStore(subscribe, () => created, () => created)
}

/** "+ → Neue Wunschliste" (integration): the lists tab opens its create sheet when it is (or comes) on screen. */
export function requestCreateList(): void {
  createRequested = true
  for (const listener of requestListeners) queueMicrotask(listener)
}

const requestListeners = new Set<() => void>()

/**
 * The tab listens while it is mounted: a request made before (the tab was not on screen yet) or while it is
 * there opens the sheet once — after the current render (a microtask), never inside it.
 */
export function onCreateRequest(open: () => void): () => void {
  const listener = () => {
    // a listener of an unmounted tab (StrictMode's test mount, a quick tab change) leaves the request alone
    if (!createRequested || !requestListeners.has(listener)) return
    createRequested = false
    open()
  }
  requestListeners.add(listener)
  if (createRequested) queueMicrotask(listener)
  return () => {
    requestListeners.delete(listener)
  }
}

// module memory of the shown account: forgotten when that account ends in this tab
onAccountEnded(() => {
  created = null
  createRequested = false
})
