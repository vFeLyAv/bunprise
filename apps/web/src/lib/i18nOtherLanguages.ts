import type { ResourceKey } from 'i18next'

// The file → chunk table of English, Russian and Ukrainian (locales/{en,ru,uk}/*.json, one lazy chunk each), split
// from lib/i18n.ts so that the shell does not carry ~50 chunk names for languages most visitors never load. The
// shell keeps their boot namespaces (common + errors); i18n.ts imports this table when the UI is not German, started
// together with those. The service worker precaches it with every other chunk (offline in every language works).
export const otherLanguages = import.meta.glob<{ default: ResourceKey }>('../locales/{en,ru,uk}/*.json')
