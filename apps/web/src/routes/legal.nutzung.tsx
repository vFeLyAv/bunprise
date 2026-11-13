import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../lib/i18n'
import { legalSearch } from '../lib/search'
import { LEGAL_VERSIONS } from '../lib/legal'
import { LegalPage, warmLegalText } from '../features/legal/LegalPage'

// S14 Nutzungsbedingungen (public). Draft text: legal-pilot.md 4.3.
// The loader shares the page's lazy chunk and fetches the archived text first (no skeleton → no shift).

export const Route = createFileRoute('/legal/nutzung')({
  validateSearch: legalSearch,
  codeSplitGroupings: [['loader', 'component']],
  loaderDeps: ({ search }) => ({ version: search.version, lang: search.lang }),
  loader: ({ deps }) => Promise.all([ensureNamespaces('legal'), warmLegalText('terms', deps.version ?? LEGAL_VERSIONS.terms, deps.lang)]),
  component: TermsPage,
})

function TermsPage() {
  const { version, lang } = Route.useSearch()
  return <LegalPage kind="terms" version={version ?? LEGAL_VERSIONS.terms} locale={lang} />
}
