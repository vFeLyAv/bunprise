import { COVER_NONE, type StoredCover, type ThemeId } from './themes'

// The occasion form's motif choice (docs/design/2026-10-26-occasion-covers.md, "Выбор в форме"). Pure logic: the
// page keeps a CoverPick, the form shows its CoverView, and saving stores coverToSave(view) in occasions.cover_theme.
//   - automatic: the motif of the title (detected on the device, ./detect.ts) — it follows title edits; nothing
//     found = no motif, as before;
//   - picked by hand: that motif, whatever the title says;
//   - switched off ("Kein Motiv"): stored as 'none', so the automatic motif does not come back.
// Opening an occasion again: a stored motif that is still the motif of its stored title (and day) counts as
// automatic and keeps following the title; any other stored motif was the host's own pick and stays. null (never
// chosen: every occasion before the feature) opens as automatic — the form then shows the motif BEFORE saving.

export type CoverPick =
  | { kind: 'auto' }
  | { kind: 'off' }
  | { kind: 'theme'; theme: ThemeId }
  /** edit: the stored motif and the title/day it was stored with (automatic while they still agree) */
  | { kind: 'saved'; theme: ThemeId; title: string; date: string }

/** The detection (./detect.ts themeOf with the occasion's day 'YYYY-MM-DD'); null while its chunk is loading. */
export type DetectCover = (title: string, date: string) => ThemeId | null

export type CoverMode = 'auto' | 'manual' | 'off'

export interface CoverView {
  /** the motif guests will see without a photo (null = none) */
  theme: ThemeId | null
  mode: CoverMode
  /** the motif of the current title (null = nothing found) — first in the picker */
  suggestion: ThemeId | null
}

export const AUTO_PICK: CoverPick = { kind: 'auto' }

/** The form's start: 'none' → off, null / unknown → automatic, a motif → saved (decided against its old title). */
export function initialCoverPick(stored: StoredCover, title: string, date: string): CoverPick {
  if (stored === COVER_NONE) return { kind: 'off' }
  if (stored === null) return AUTO_PICK
  return { kind: 'saved', theme: stored, title, date }
}

/** What the form shows for a pick; null while the detection is not loaded yet. */
export function coverView(pick: CoverPick, detect: DetectCover | null, title: string, date: string): CoverView | null {
  if (!detect) return null
  const suggestion = detect(title, date)
  switch (pick.kind) {
    case 'auto':
      return { theme: suggestion, mode: 'auto', suggestion }
    case 'off':
      return { theme: null, mode: 'off', suggestion }
    case 'theme':
      return { theme: pick.theme, mode: 'manual', suggestion }
    case 'saved':
      return detect(pick.title, pick.date) === pick.theme
        ? { theme: suggestion, mode: 'auto', suggestion }
        : { theme: pick.theme, mode: 'manual', suggestion }
  }
}

/**
 * The pick after a tap in the picker: null = "Kein Motiv" (off); the title's own motif = automatic again (it then
 * follows the title, like a stored motif that matches its title); any other motif = picked by hand.
 */
export function pickFor(choice: ThemeId | null, view: CoverView): CoverPick {
  if (choice === null) return { kind: 'off' }
  if (choice === view.suggestion) return AUTO_PICK
  return { kind: 'theme', theme: choice }
}

/**
 * The value to store: the motif, 'none' when switched off, null when automatic found nothing. undefined = not
 * known (the detection never loaded): the caller sends nothing and the stored value stays.
 */
export function coverToSave(view: CoverView | null): StoredCover | undefined {
  if (!view) return undefined
  return view.mode === 'off' ? COVER_NONE : view.theme
}

/** The picker's order: the title's motif first, then the rest in the list's order. */
export function pickerOrder(all: readonly ThemeId[], suggestion: ThemeId | null): ThemeId[] {
  return suggestion ? [suggestion, ...all.filter((id) => id !== suggestion)] : [...all]
}

/** The part of the motif's look that changes the form's height (its layout animations follow it). */
export function coverLayoutKey(view: CoverView | null, browsing: boolean): string {
  if (!view) return 'cover-loading'
  const strip = view.theme !== null || view.mode === 'off' || browsing
  return `cover:${view.theme !== null ? 'motif' : view.mode}:${view.mode === 'off' && view.suggestion ? 'undo' : ''}:${strip ? 'strip' : ''}`
}
