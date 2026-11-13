import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { ExportPage } from '../../features/account/AccountPages'

// S12 data export (JSON, online only). Own screen, not nested in settings ("_" suffix).

export const Route = createFileRoute('/_authed/settings_/export')({
  staticData: { allowWithoutConsent: true },
  loader: () => ensureNamespaces('settings'),
  component: () => <ExportPage userId={Route.useRouteContext().session.user.id} />,
})
