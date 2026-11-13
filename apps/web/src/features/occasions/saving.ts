import { useSyncExternalStore } from 'react'
import { onAccountEnded } from '../../lib/accountBoundary'
import type { OccasionSections } from '../../lib/api/types'
import type { OccasionFormValues } from './form'
import type { OccasionExtras } from './extras/model'

// Memory only — never browser storage (product S6: "the form draft lives only in the tab's memory"):
// 1. the save state of an occasion while an optimistic create/edit travels to the server,
//    so the occasion screen can say "saving" and celebrate once the server confirmed it;
// 2. the form draft of a failed save, so the form reopens with the person's own input.
// Drafts are keyed by account, so a later sign-in on the same tab never sees someone else's text.
// Everything here belongs to the account the tab shows: when it ends (lib/accountBoundary.ts), all of
// it is forgotten — like after a full reload. Otherwise an answer that arrives for the ended account
// (it changes nothing any more) would leave its occasion "saving" for the next account (round-2
// review: B's "…" menu of that occasion stayed disabled).

export type SaveState = 'saving' | 'created'

const saveStates = new Map<string, SaveState>()
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

export function setSaveState(occasionId: string, state: SaveState | null): void {
  if (state === null) saveStates.delete(occasionId)
  else saveStates.set(occasionId, state)
  emit()
}

export function getSaveState(occasionId: string): SaveState | undefined {
  return saveStates.get(occasionId)
}

// The "created" moment runs once per occasion: the first screen that shows it starts the clock,
// and leaving the screen early does not stop or restart it (otherwise the bunny jumped again
// after every visit to the wish form within the moment).
const celebrations = new Map<string, ReturnType<typeof setTimeout>>()

export function startCelebration(occasionId: string, durationMs: number): void {
  if (celebrations.has(occasionId)) return
  celebrations.set(
    occasionId,
    setTimeout(() => {
      celebrations.delete(occasionId)
      if (saveStates.get(occasionId) === 'created') setSaveState(occasionId, null)
    }, durationMs),
  )
}

/** Live save state of one occasion (undefined = nothing pending). */
export function useSaveState(occasionId: string): SaveState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => saveStates.get(occasionId),
    () => undefined,
  )
}

export interface OccasionDraft {
  values: OccasionFormValues
  /** create only: the client id of the failed attempt — reused, so an insert that did arrive is not doubled */
  id?: string
  /** create only: "Was gibt's?" as chosen (absent = the default) */
  sections?: OccasionSections
  /** create only: the wishes and bring-along entries added in the form (extras/model.ts) */
  extras?: OccasionExtras
}

/** 'new' for the create form, otherwise the occasion id of the edit form. */
export type DraftTarget = 'new' | (string & {})

const drafts = new Map<string, OccasionDraft>()
const draftKey = (userId: string, target: DraftTarget) => `${userId}:${target}`

export function keepDraft(userId: string, target: DraftTarget, draft: OccasionDraft): void {
  drafts.set(draftKey(userId, target), draft)
}

/** Read without removing (safe inside a state initializer, which StrictMode runs twice). */
export function peekDraft(userId: string, target: DraftTarget): OccasionDraft | undefined {
  return drafts.get(draftKey(userId, target))
}

export function clearDraft(userId: string, target: DraftTarget): void {
  drafts.delete(draftKey(userId, target))
}

/** Save states, celebrations and drafts of the account that ended in this tab. */
function forgetAll(): void {
  for (const timer of celebrations.values()) clearTimeout(timer)
  celebrations.clear()
  saveStates.clear()
  drafts.clear()
  emit()
}

onAccountEnded(forgetAll)

/** Tests only. */
export function resetSavingForTests(): void {
  forgetAll()
}
