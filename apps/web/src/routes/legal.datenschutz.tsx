import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../lib/i18n'
import { legalSearch } from '../lib/search'
import { LEGAL_VERSIONS } from '../lib/legal'
import { LegalPage, warmLegalText } from '../features/legal/LegalPage'

// S14 Datenschutzerklärung (public). Draft text: legal-pilot.md 4.2.
// The loader shares the page's lazy chunk and fetches the archived text first (no skeleton → no shift).

export const Route = createFileRoute('/legal/datenschutz')({
  validateSearch: legalSearch,
  codeSplitGroupings: [['loader', 'component']],
  loaderDeps: ({ search }) => ({ version: search.version, lang: search.lang }),
  loader: ({ deps }) =>
    Promise.all([ensureNamespaces('legal'), warmLegalText('privacy_notice', deps.version ?? LEGAL_VERSIONS.privacy_notice, deps.lang)]),
  component: PrivacyPage,
})

function PrivacyPage() {
  const { version, lang } = Route.useSearch()
  return <LegalPage kind="privacy_notice" version={version ?? LEGAL_VERSIONS.privacy_notice} locale={lang} />
}
