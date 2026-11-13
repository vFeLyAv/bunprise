import { Suspense, lazy, useRef, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getLocalSession } from '../lib/supabase'
import { ensureNamespaces } from '../lib/i18n'
import { APP_NAME } from '../lib/app'
import { BrandMark, Page, buttonClass } from '../ui'
import { Scene } from '../ui/Scene'
import { usePageTitle } from '../features/auth/shared'
import { AuthMethods } from '../features/auth/AuthMethods'
import { PressLink } from '../features/shell/MotionLink'
import { MotionScope } from '../motion/MotionScope'
import '../features/auth/start.css'

// S1 start (public). With a live session → straight to the feed, no flash of S1.
// The hero (ADR glass, Felix's welcome idea): a warm scene, the brand and the promise at the top, and the
// welcome bunnies peeking over the top edge of a docked glass card that holds Google / Apple / E-Mail. The
// bunnies are a lazy chunk after the first paint (features/mascot-ui/WelcomeBunnies.tsx): the route's
// initial chunk carries none of the stage, and the buttons work from the first frame.

const WelcomeBunnies = lazy(() => import('../features/mascot-ui/WelcomeBunnies'))

/** The bunnies' host reaches this far below the card's top edge: their paws rest on the card. */
const CARD_OVERLAP_PX = 16

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (await getLocalSession()) throw redirect({ to: '/soon' })
  },
  loader: () => ensureNamespaces('common', 'auth'),
  component: StartRoute,
})

// animates inside its own <MotionScope> (the shell has no LazyMotion: docs/decisions/2026-10-20-motion-scope.md)
function StartRoute() {
  return (
    <MotionScope>
      <StartPage />
    </MotionScope>
  )
}

/** The main bunny's width: larger on taller screens (the stage takes the free height), 150–210 px. */
function heroBunnySize(): number {
  const h = typeof window === 'undefined' ? 0 : window.innerHeight
  return Math.round(Math.min(210, Math.max(150, h * 0.21)))
}

function StartPage() {
  const { t } = useTranslation(['common', 'auth'])
  const card = useRef<HTMLDivElement>(null)
  const [bunnySize] = useState(heroBunnySize)
  usePageTitle(APP_NAME)
  return (
    <Page flush className="scene-page flex flex-col">
      <Scene />
      <header className="flex flex-col items-center gap-5 pt-2 text-center">
        <BrandMark name={APP_NAME} />
        <div>
          <h1 className="start-title t-display text-text">{t('start.title')}</h1>
          <p className="mx-auto mt-3 max-w-[32ch] t-body text-text-2">{t('start.subtitle')}</p>
        </div>
      </header>
      {/* the stage between the promise and the card takes the free height; the bunnies peek over the card */}
      <div className="scene-stage start-stage scene-bleed">
        <Suspense fallback={null}>
          <WelcomeBunnies
            choreography="welcome"
            oncePerVisit="start"
            cardRef={card}
            edgeInset={CARD_OVERLAP_PX}
            minSize={bunnySize}
            maxSize={220}
            className="scene-stage-host"
            style={{ bottom: -CARD_OVERLAP_PX }}
          />
        </Suspense>
      </div>
      <div ref={card} className="scene-card scene-bleed px-safe pt-8">
        <AuthMethods mode="signup" surface="glass" />
        <p className="mt-3 text-center t-footnote text-text-2">{t('auth.no_password_hint')}</p>
        <PressLink to="/login" search={{ mode: 'signin' }} className={`${buttonClass({ variant: 'ghost', size: 'md', fullWidth: true })} mt-2`}>
          {t('auth.already_account')}
        </PressLink>
      </div>
    </Page>
  )
}
