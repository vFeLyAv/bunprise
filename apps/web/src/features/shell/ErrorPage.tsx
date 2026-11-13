import { useEffect, useRef } from 'react'
import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Page } from '../../ui/Page'
import { Button, buttonClass } from '../../ui/Button'
import { isAppError } from '../../lib/errors'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { MotionScope } from '../../motion/MotionScope'

// Route-level error screen: "Da ist etwas schiefgelaufen" + retry; the legal footer next to it comes from
// routes/__root.tsx RootError. Shows only our i18n keys, never a server message (nothing about
// reservations can leak through an error text). Loaded lazily by __root.tsx (the Button carries motion).
// The same calm, centred layout as "not found": a frosted card, a bunny on its edge that shrugs.

/** The bunny's host above the card (its paws rest 16 px onto the card). */
const BUNNY_HOST_PX = 132

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    if (import.meta.env.DEV) void import('../../dev/routeDiagnostics').then(module => module.reportRouteError(error)).catch(() => {})
  }, [error])
  const { t } = useTranslation()
  const appError = isAppError(error) ? error : null
  const card = useRef<HTMLElement>(null)
  // its own motion scope (the button presses): the shell has no LazyMotion (docs/decisions/2026-10-20-motion-scope.md)
  return (
    <MotionScope>
    <Page className="flex flex-col justify-center">
      <div className="relative mt-28">
        <BunnyMoment
          kind="shrug"
          cardRef={card}
          minSize={104}
          maxSize={120}
          className="pointer-events-none absolute inset-x-0 z-2"
          style={{ top: 16 - BUNNY_HOST_PX, height: BUNNY_HOST_PX }}
        />
        <section ref={card} className="glass-panel relative z-1 flex flex-col items-center gap-3 rounded-card px-5 pb-6 pt-8 text-center">
          <div role="alert" className="flex flex-col items-center gap-3">
            <h1 className="t-title-1 text-text">{t('common.error_title')}</h1>
            <p className="max-w-[32ch] t-body text-text-2">{t(appError?.key ?? 'errors.generic', appError?.params)}</p>
          </div>
          <div className="mt-3 w-full max-w-xs">
            <Button size="lg" fullWidth onClick={reset}>
              {t('common.retry')}
            </Button>
            <Link to="/soon" className={`${buttonClass({ variant: 'ghost', size: 'lg', fullWidth: true })} mt-2`}>
              {t('common.to_start')}
            </Link>
          </div>
        </section>
      </div>
    </Page>
    </MotionScope>
  )
}
