import { useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'
import { ensureNamespaces } from '../../lib/i18n'
import { readComicProgress, type ComicProgress } from './progress'

// Is the comic reader open, and where does it begin — tab memory only (never stored), apart from the sheet itself
// (ComicHost.tsx), so the Start card's rules (ComicStartSlot.tsx) can follow it without loading the sheet.

export interface ComicState {
  open: boolean
  /** +1 per opening: a new opening is a new reader */
  token: number
  /** where to begin ("Weiterlesen"), null = episode 1 from the top */
  start: ComicProgress | null
  /** the reader has loaded in this tab (the Start card goes away then) */
  loaded: boolean
}

let state: ComicState = { open: false, token: 0, start: null, loaded: false }
const listeners = new Set<() => void>()

function set(next: ComicState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useComicState(): ComicState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

let body: Promise<typeof import('./ComicBody')> | null = null
/** The reader's chunk (one fetch per tab; a failed one is tried again next time). */
export function loadComicBody(): Promise<typeof import('./ComicBody')> {
  body ??= import('./ComicBody').catch((err: unknown) => {
    body = null
    throw err
  })
  return body
}

/**
 * Opens the reader where the person stopped ("Weiterlesen") or at the start. Its strings and the sheet (small chunks)
 * are awaited, so the sheet never shows raw keys; the reader's chunk loads meanwhile and fills the open sheet.
 */
export async function openComic(): Promise<void> {
  void loadComicBody().catch(() => undefined)
  // the strings and the sheet (small); the reader's chunk keeps loading inside the open sheet
  await Promise.all([ensureNamespaces('comic'), import('./ComicHost')]).catch(() => undefined)
  set({ ...state, open: true, token: state.token + 1, start: readComicProgress() })
}

/** Closes the reader — with `token`: only that opening (a host that went away never closes a newer one). */
export function closeComic(token?: number): void {
  if (state.open && (token === undefined || token === state.token)) set({ ...state, open: false })
}

/** Called by the reader once it is there: the Start card is done (lib/hints.ts 'story-1' is written by it). */
export function markComicLoaded(): void {
  if (!state.loaded) set({ ...state, loaded: true })
}

/** The account ended in this tab (lib/accountBoundary.ts); also tests. */
export function resetComicState(): void {
  set({ open: false, token: state.token, start: null, loaded: false })
}

onAccountEnded(resetComicState)
