import { createFileRoute } from '@tanstack/react-router'
import { getLocalSession } from '../lib/supabase'
import { compact, optionalEnum, optionalString } from '../lib/search'
import { ensureNamespaces } from '../lib/i18n'
import { LoginForm } from '../features/auth/LoginForm'
import { MotionScope } from '../motion/MotionScope'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { next?: string; mode?: 'signup' | 'signin'; method?: 'google' | 'apple' | 'email' } => compact({
    next: optionalString(search.next),
    mode: optionalEnum(search.mode, ['signup', 'signin']),
    method: optionalEnum(search.method, ['google', 'apple', 'email']),
  }),
  // Already signed in → the feed; signing in for a link (next=/f or /i) → its code rides along in the fragment
  // (features/auth/carryLink.ts: guardLogin). A stored session that cannot be read keeps the form.
  beforeLoad: async ({ location, search }) => {
    const session = await getLocalSession().catch(() => null)
    const { guardLogin } = await import('../features/auth/carryLink')
    guardLogin(session !== null, search, location.hash)
  },
  loader: () => ensureNamespaces('auth'),
  component: LoginPage,
})

// animates inside its own <MotionScope> (the shell has no LazyMotion: docs/decisions/2026-10-20-motion-scope.md)
function LoginPage() {
  const { mode = 'signin', method, next } = Route.useSearch()
  return (
    <MotionScope>
      <LoginForm key={`${mode}:${method ?? 'choose'}:${next ?? ''}`} mode={mode} method={method} next={next} />
    </MotionScope>
  )
}
