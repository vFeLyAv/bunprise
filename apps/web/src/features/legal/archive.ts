import type { ConsentKind, Locale } from '../../lib/api/types'

export type LegalDocumentKind = ConsentKind | 'impressum'

export interface LegalText {
  kind: LegalDocumentKind
  version: string
  locale: Locale
  text: string
}

export const IMPRINT_VERSION = 'pilot-draft'

// Every published version stays immutable. Raw text is a separate lazy chunk, never
// part of the app shell. This allow-list cannot fetch arbitrary paths or languages.
const archives = import.meta.glob<string>('../../legal/*.md', { query: '?raw', import: 'default' })

function archiveKey(kind: LegalDocumentKind, version: string, locale: Locale): string {
  return `../../legal/${kind}.${version}.${locale}.md`
}

/** Unknown server versions/languages fail closed; there is deliberately no fallback. */
export function hasLegalText(kind: LegalDocumentKind, version: string, locale: Locale): boolean {
  return Object.hasOwn(archives, archiveKey(kind, version, locale))
}

/** The returned text is the exact archived version that the legal page renders. */
export async function loadLegalText(kind: LegalDocumentKind, version: string, locale: Locale): Promise<LegalText | null> {
  const key = archiveKey(kind, version, locale)
  if (!Object.hasOwn(archives, key)) return null
  const load = archives[key]
  if (!load) return null
  return { kind, version, locale, text: await load() }
}
