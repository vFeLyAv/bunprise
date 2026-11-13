import { createFileRoute } from '@tanstack/react-router'
import { uuidParam } from '../../lib/search'
import { ensureNamespaces } from '../../lib/i18n'
import { EditWishPage } from '../../features/wishes/WishEditorPages'

// S8 edit a wish (owner only). The loader stays tiny (main bundle); the form lives in the split chunk.
// The page checks the owner itself: a deep link reads the wish with its list (lib/api/wishes.ts getWish).

export const Route = createFileRoute('/_authed/wishes/$wishId/edit')({
  params: uuidParam('wishId'),
  loader: () => ensureNamespaces('wishes'),
  component: EditWishRoute,
})

function EditWishRoute() {
  const { wishId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <EditWishPage key={wishId} wishId={wishId} userId={session.user.id} />
}
