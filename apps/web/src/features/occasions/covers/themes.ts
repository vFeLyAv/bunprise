// The cover motifs of occasions without a photo (Felix 26.10, docs/design/2026-10-26-occasion-covers.md): the
// allow-list of keys stored in occasions.cover_theme (20261027140000_occasion_cover_theme.sql checks the SAME list —
// packages/db-tests/test/occasions/cover-theme.test.ts compares them). A key never changes once shipped; only new
// ones may be added (with a migration). This file is EAGER (the Start card asks it whether to lay out a cover box)
// and stays tiny: names live in the locale files (occasionForm.cover_<id>), pictures in ./art (lazy, one chunk per
// motif), the detection in ./detect.ts (lazy, the form only).

/** Every motif, in the order of the picker (the most common occasions first). */
export const THEME_IDS = ['birthday', 'party', 'gamenight', 'dinner', 'bbq', 'movie', 'sport', 'picnic', 'concert', 'housewarming', 'wedding', 'baby', 'christmas', 'newyear', 'halloween', 'easter'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** The stored "switched off" value: the host chose "Kein Motiv". */
export const COVER_NONE = 'none'

/** What occasions.cover_theme may hold: a motif, 'none' (switched off) or null (never chosen = no motif). */
export type StoredCover = ThemeId | typeof COVER_NONE | null

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

/**
 * The motif to SHOW for a stored value (the Start card, the occasion's hero): a known key, else nothing — null,
 * 'none', a key this app does not know (a newer server) and a missing key (a server before the migration) alike.
 * A photo always wins over it (the callers ask only without one).
 */
export function shownCover(value: unknown): ThemeId | null {
  return isThemeId(value) ? value : null
}

/**
 * The stored value as the edit form needs it: undefined = the server sent no key (before the migration: the form
 * offers no motif choice and never writes the column), else the value (an unknown key reads as null).
 */
export function storedCover(value: unknown): StoredCover | undefined {
  if (value === undefined) return undefined
  if (value === COVER_NONE) return COVER_NONE
  return isThemeId(value) ? value : null
}
