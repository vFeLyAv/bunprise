import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { compact, optionalString } from '../lib/search'
import { ensureNamespaces } from '../lib/i18n'
import { completeOAuthCallback, consumePostLoginTarget } from '../lib/api/auth'
import { AppError, toAppError } from '../lib/errors'
import { destinationAfterSignIn, signInTarget } from '../features/auth/flow'
import { AuthError, usePageTitle } from '../features/auth/shared'
import { Button, LargeTitle, Page, buttonClass } from '../ui'
import { MotionScope } from '../motion/MotionScope'

// OAuth return (public): supabase-js exchanges ?code= (PKCE); see completeOAuthCallback() in
// lib/api/auth.ts. Minimal screen, no mascot (performance-plan.md 6.3).

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (search: Record<string, unknown>): { code?: string; error?: string; error_description?: string } => compact({
    code: optionalString(search.code),
    error: optionalString(search.error),
    error_description: optionalString(search.error_description),
  }),
  loader: () => ensureNamespaces('auth'),
  component: AuthCallbackRoute,
})

// animates inside its own <MotionScope> (the shell has no LazyMotion: docs/decisions/2026-10-20-motion-scope.md)
function AuthCallbackRoute() {
  return (
    <MotionScope>
      <AuthCallbackPage />
    </MotionScope>
  )
}

function AuthCallbackPage() {
  const { t } = useTranslation('auth')
  const { queryClient } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const [recovery, setRecovery] = useState<{ error: AppError; retryProfile: boolean; next: string | undefined } | null>(null)
  const [retry, setRetry] = useState(0)
  const task = useRef<Promise<string> | null>(null)
  const signedIn = useRef<string | null>(null)
  const next = useRef<string | undefined>(undefined)
  usePageTitle(t('auth.callback_title'))

  useEffect(() => {
    let cancelled = false
    task.current ??= (async () => {
      next.current ??= signInTarget(consumePostLoginTarget())
      if (!signedIn.current) {
        const session = await completeOAuthCallback()
        signedIn.current = session.user.id
      }
      return destinationAfterSignIn(queryClient, signedIn.current, next.current)
    })()
    void task.current.then(
      (destination) => { if (!cancelled) void navigate({ href: destination, replace: true }) },
      (err: unknown) => {
        if (!cancelled) setRecovery({ error: toAppError(err), retryProfile: signedIn.current !== null, next: next.current })
      },
    )
    return () => { cancelled = true }
  }, [navigate, queryClient, retry])

  return (
    <Page className="flex flex-col gap-6 pt-8">
      <LargeTitle>{t('auth.callback_title')}</LargeTitle>
      <AuthError error={recovery?.error ?? null} />
      {recovery ? <>
        {recovery.retryProfile && <Button size="lg" onClick={() => { task.current = null; setRecovery(null); setRetry((value) => value + 1) }}>{t('common.retry')}</Button>}
        <Link to="/login" search={{ next: recovery.next }} className={buttonClass({ variant: 'secondary', size: 'lg' })}>{t('auth.title')}</Link>
      </> : <p role="status" className="t-body text-text-2">{t('common.loading')}</p>}
    </Page>
  )
}
