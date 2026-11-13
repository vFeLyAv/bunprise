import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { DeletePage } from '../../features/account/AccountPages'

// S13 delete account (type LÖSCHEN / DELETE, immediate and final). Own screen ("_" suffix).

export const Route = createFileRoute('/_authed/settings_/delete')({
  staticData: { allowWithoutConsent: true },
  loader: () => ensureNamespaces('settings'),
  component: () => <DeletePage userId={Route.useRouteContext().session.user.id} />,
})
