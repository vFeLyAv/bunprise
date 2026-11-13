import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { captureEpoch } from '../../lib/accountBoundary'
import { assertCurrentAccount } from '../../lib/api/identity'
import { markOnboardingDone } from '../../lib/api/profile'
import { AppError, toAppError } from '../../lib/errors'
import type { OnboardingDestination } from './steps'

/** Which control started finishing (that one shows the spinner). */
export type FinishSource = 'skip' | 'create' | 'invite' | 'confirm'

export interface FinishOnboarding {
  finish: (to: OnboardingDestination, source: FinishSource) => Promise<void>
  /** set while the server write runs; every control is locked meanwhile */
  busy: FinishSource | null
  error: AppError | null
  /** forget the last error (the person moved on to another step) */
  clearError: () => void
}

/**
 * Resolves once the next frame is on screen. The screen change (a view transition: the browser holds
 * rendering while the router renders the next screen) starts only after the tap's own feedback — the
 * button's spinner — has been painted: the tap stays responsive (INP) however heavy the next screen is.
 */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0))
    else setTimeout(resolve, 0)
  })
}

/**
 * Leaving the onboarding (finish or "Überspringen") records profiles.onboarding_done_at for THIS account
 * (pilot-decisions §1) and only then navigates, replacing /welcome in the history. The write is pinned to
 * the account of the screen (expected user id, then a re-check), so a sign-in in another tab cannot
 * complete someone else's onboarding. Offline or on an error the person stays and can try again.
 * `alreadyDone` (the guard's get_me, ≤ 60 s old) skips the write: the first completion time stays.
 * An answer after the account ended in this tab (account boundary) neither navigates nor shows an error.
 */
export function useFinishOnboarding(userId: string, alreadyDone = false): FinishOnboarding {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<FinishSource | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const working = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const finish = useCallback(
    async (to: OnboardingDestination, source: FinishSource) => {
      if (working.current) return
      const epoch = captureEpoch()
      if (!epoch.isCurrent()) return
      if (!alreadyDone && typeof navigator !== 'undefined' && !navigator.onLine) {
        setError(new AppError('offline_action'))
        return
      }
      // `working` locks every control at once (a second tap does nothing); the spinner and the disabled
      // look follow in a transition, so the tap's own frame (the pressed button) paints first (INP)
      working.current = true
      startTransition(() => {
        setBusy(source)
        setError(null)
      })
      try {
        // the tap's own frame first; the request's work (session read, the call) starts right after it
        await afterNextPaint()
        if (!alreadyDone) {
          if (!epoch.isCurrent()) return
          await markOnboardingDone(userId)
          await assertCurrentAccount(userId)
        }
        // and the spinner's frame before the screen change (a fast answer could beat the next paint)
        await afterNextPaint()
        if (!mounted.current || !epoch.isCurrent()) return
        await navigate({ to, replace: true })
      } catch (err) {
        if (mounted.current && epoch.isCurrent()) setError(toAppError(err))
      } finally {
        working.current = false
        if (mounted.current && epoch.isCurrent()) setBusy(null)
      }
    },
    [alreadyDone, navigate, userId],
  )
  const clearError = useCallback(() => setError(null), [])

  return { finish, busy, error, clearError }
}
