import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../lib/i18n'
import { legalSearch } from '../lib/search'
import { IMPRINT_VERSION, LegalPage, warmLegalText } from '../features/legal/LegalPage'

// S14 Impressum (public, works offline as part of the shell). Text: draft with <NAME>, <ADRESSE>
// placeholders, marked "ENTWURF – vor Veröffentlichung prüfen" (legal-pilot.md 4.1).
// The loader shares the page's lazy chunk and fetches the archived text first: the page renders with
// it at once (no skeleton → no layout shift of the footer).

export const Route = createFileRoute('/legal/impressum')({
  validateSearch: legalSearch,
  codeSplitGroupings: [['loader', 'component']],
  loaderDeps: ({ search }) => ({ version: search.version, lang: search.lang }),
  loader: ({ deps }) => Promise.all([ensureNamespaces('legal'), warmLegalText('impressum', deps.version ?? IMPRINT_VERSION, deps.lang)]),
  component: ImprintPage,
})

function ImprintPage() {
  const { version, lang } = Route.useSearch()
  return <LegalPage kind="impressum" version={version ?? IMPRINT_VERSION} locale={lang} />
}
