import { createFileRoute } from '@tanstack/react-router'
import { uuidParam } from '../../lib/search'
import { ensureNamespaces } from '../../lib/i18n'
import { NewWishPage } from '../../features/wishes/WishEditorPages'

// S8 add a wish (owner only). Own screen, not nested in S7 ("_" suffix in the file name).
// The loader stays tiny (main bundle); the form and its data live in the split component chunk.

export const Route = createFileRoute('/_authed/occasions/$occasionId_/wishes/new')({
  params: uuidParam('occasionId'),
  loader: () => ensureNamespaces('wishes'),
  component: () => <NewWishPage occasionId={Route.useParams().occasionId} />,
})
