import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { SammlungPage } from '../../features/sammlung/SammlungPage'

// «Pompons Sammlung» (Profil → the row above «Rechtliches»): the found hidden scenes + Pompon's wardrobe. Own screen
// ("_" suffix), a lazy chunk; device data only (features/sammlung/store.ts).

export const Route = createFileRoute('/_authed/settings_/sammlung')({
  loader: () => ensureNamespaces('settings'),
  component: () => <SammlungPage userId={Route.useRouteContext().session.user.id} />,
})
