import { createFileRoute, redirect } from '@tanstack/react-router'
import { compact, isUuid } from '../../lib/search'

// /calendar (wave 1's calendar tab) is a deep link now (wave 2, Felix 2026-10-20 evening): the calendar is
// Start's "Monat" view. Redirect there and keep `?created=<occasion id>` (K10), so the bunny still carries a
// new occasion onto its day (features/occasions/actions.ts opens /calendar?created=… after saving). Nothing
// renders here; the guard of `_authed` runs first, as for every signed-in screen.

export const Route = createFileRoute('/_authed/calendar')({
  validateSearch: (search: Record<string, unknown>): { created?: string } =>
    compact({ created: isUuid(search.created) ? search.created : undefined }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/soon', search: compact({ view: 'month' as const, created: search.created }), replace: true })
  },
})
