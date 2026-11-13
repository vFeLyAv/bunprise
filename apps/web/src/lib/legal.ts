import type { ConsentKind } from './api/types'

// Mirror of the legal-version migrations (pilot-decisions §0): privacy_notice from
// 20261031120000_legal_versions_pilot_6.sql (6th release: built per feature set by docs/legal-drafts/pilot-6/build.mjs;
// "Anzahl", "Passt zusammen", Google-only "Zum Kalender hinzufügen", …), terms from
// 20261027220000_legal_versions_pilot_5.sql (unchanged in pilot-6), age_18plus from the seed.
// The database (legal_versions, read through get_me()) is the source of truth at runtime; this
// constant is the compile-time mirror for the consent inserts, and src/test/legal.test.ts fails
// when the two drift. A new text version = new migration row + new value here.

export type LegalVersionMap = Record<ConsentKind, string>

export const LEGAL_VERSIONS: LegalVersionMap = {
  terms: 'terms-2026-10-pilot-5',
  privacy_notice: 'privacy-2026-10-pilot-6',
  age_18plus: 'age-18plus-2026-10-pilot-1',
}
