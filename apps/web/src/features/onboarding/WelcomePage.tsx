import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { GiftInterest } from '../../lib/api/giftIdeas'
import type { Me } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import { Button, Page, TopBar, cn, useBunniesShown, useReducedMotionPref } from '../../ui'
import { Scene } from '../../ui/Scene'
import { useOnline, usePageTitle } from '../auth/shared'
import { playsInApp } from '../mascot-ui/inGallery'
import { readStartInterests, saveStartInterests } from '../gifts/startInterests'
import { getPendingInvite } from '../invite/pending'
import { BackButton, ProgressDots, type StepStatus } from './parts'
import { readPlatform, shouldOfferHomeScreen } from './platform'
import type { Costume, Outfit } from './pompon'
import { StepFrame, type StepMotion } from './StepFrame'
import { HelloStep, HomeScreenStep, InviteStep, StartStep, WishesStep, type ActionState } from './StepViews'
import {
  INITIAL_STATE,
  advance,
  canGoBack,
  canGoForward,
  currentView,
  finishesNow,
  progressOf,
  type OnboardingChoice,
  type OnboardingContext,
  type OnboardingEvent,
  type OnboardingView,
} from './steps'
import { useFinishOnboarding, type FinishSource } from './useFinishOnboarding'
import type { PomponHandle } from './WelcomePompon'
import './welcome.css'

// S4 onboarding /welcome (product-pilot S4/F3, brief 5.4; Felix 25.10 — the three screens approved in the mascot
// gallery, docs/handoffs/2026-10-25-welcome-gallery.md):
// 1. Pompon greets by name, the slogan; tap him (hearts). 2. "Was wünschst du dir?" — he holds a gift box, the
// tapped bubbles fly into it: first interests for "Ideen", kept on this device only. 3. "Was feierst du als
// Nächstes?" — an occasion card dresses him, "Los geht's!" is the one real action (the new-occasion form or the
// invite). iOS Safari only: "Zum Home-Bildschirm" last. "Überspringen" sits in the top bar from the first frame.
// Finishing or skipping records onboarding_done_at, then opens the chosen place (/occasions/new), the waiting
// invite (/i, which still asks for an explicit "Beitreten") or the feed (/soon). No server write besides that.
// The composition (design pass 2026-10-20): the warm scene, Pompon sitting on the top edge of a docked glass card;
// the steps slide INSIDE the card, Pompon stays (and changes what he wears). The feed is preloaded once idle.

const WelcomePompon = lazy(() => import('./WelcomePompon'))
// «Здесь я буду жить» (Felix 27.10): on the Home Screen step Pompon climbs into the app icon — its own lazy chunk
const HomeIconScene = lazy(() => import('./HomeIconScene'))

/**
 * The puppet's box width (its viewBox is wider than the bunny): 200–300 px, a little larger on taller screens. The
 * stage is 160–256 px high; his head reaches ~0.48 × the width above the card, a hat ~0.27 × more — it still fits.
 */
function bunnySize(): number {
  const h = typeof window === 'undefined' ? 0 : window.innerHeight
  const stage = Math.min(256, Math.max(160, h * 0.27))
  return Math.round(Math.min(300, Math.max(200, stage * 1.3)))
}

/**
 * Where the puppet sits: centred, its feet (y 246 of the 260-high viewBox) 8 px into the card, so he sits ON
 * the card's top edge (the stage's bottom edge); his hats reach up into the free stage above him.
 */
function seat(size: number): CSSProperties {
  return { position: 'absolute', left: '50%', bottom: -(8 + (size * 14) / 400), width: size, transform: 'translateX(-50%)' }
}

/** What Pompon wears or holds on each step. */
function outfitOf(view: OnboardingView, selected: Costume | null): Outfit {
  switch (view) {
    case 'hello':
      return 'none'
    case 'wishes':
      return 'box'
    case 'invite':
      return 'invite'
    case 'start':
    case 'homescreen':
      return selected ?? 'none'
  }
}

const choiceOf = (card: Costume): OnboardingChoice => (card === 'invite' ? 'invite' : 'create')

/**
 * The own profile from the guard's get_me (a server answer of this account, at most 60 s old and
 * newer than this tab's last profile write — lib/consentGate.ts).
 */
function ownProfile(me: Me | undefined, userId: string): Me['profile'] | null {
  return me && me.profile.id === userId ? me.profile : null
}

export function WelcomePage({ userId }: { userId: string }) {
  const { t } = useTranslation('onboarding')
  const queryClient = useQueryClient()
  const router = useRouter()
  const online = useOnline()
  const reduced = useReducedMotionPref()
  const bunnies = useBunniesShown()
  const viewport = useRef<HTMLDivElement>(null)
  const pompon = useRef<PomponHandle | null>(null)
  const [size] = useState(bunnySize)
  const [profile] = useState(() => ownProfile(queryClient.getQueryData<Me>(qk.me()), userId))
  const [context] = useState<OnboardingContext>(() => ({
    homeScreen: shouldOfferHomeScreen(readPlatform()),
    pendingInvite: getPendingInvite() !== null,
  }))
  const [state, setState] = useState(INITIAL_STATE)
  const [distance, setDistance] = useState(0)
  // the wish box: on this device only (features/gifts/startInterests.ts) — coming back shows what is in it
  const [picked, setPicked] = useState<readonly GiftInterest[]>(() => readStartInterests(userId))
  // the occasion card; a waiting invite starts with the envelope in Pompon's paws
  const [selected, setSelected] = useState<Costume | null>(() => (context.pendingInvite ? 'invite' : null))
  const [petted, setPetted] = useState(false)
  // the Home Screen step's icon scene is up: the seated Pompon fades out meanwhile (back on the earlier steps)
  const [iconShown, setIconShown] = useState(false)
  const alreadyDone = Boolean(profile?.onboarding_done_at)
  const { finish, busy, error, clearError } = useFinishOnboarding(userId, alreadyDone)
  usePageTitle(t('onb.title'))

  const view = currentView(state)
  const progress = progressOf(view, context)
  const stepMotion: StepMotion = { direction: state.direction, distance }
  const name = profile?.display_name?.trim()
  const homeIcon = view === 'homescreen' && bunnies && playsInApp('homeicon')
  const pomponAway = homeIcon && iconShown
  // Recording the end of the onboarding needs the server; moving between the steps does not.
  const offline = !online && !alreadyDone
  let status: StepStatus | null = null
  if (error) status = { tone: 'error', text: t(error.key, error.params) }
  else if (offline) status = { tone: 'info', text: t('onb.offline_finish') }

  useEffect(() => {
    // After a step change the pressed button left with the old step: hand the focus (and the
    // screen reader) to the heading of the step that is coming in.
    if (state.direction === 0) return
    viewport.current?.querySelector<HTMLElement>('section:not([aria-hidden="true"]) [data-step-heading]')?.focus()
  }, [state])

  useEffect(() => {
    // The feed is where most people go next ("Überspringen", "Fertig"): load its chunk and data once this
    // screen is painted and the browser is idle, so the tap later only switches screens (perf audit §6.6).
    let cancelled = false
    const preload = () => {
      if (!cancelled) void router.preloadRoute({ to: '/soon' }).catch(() => undefined)
    }
    const idle = typeof window.requestIdleCallback === 'function'
    const handle = idle ? window.requestIdleCallback(preload, { timeout: 2500 }) : window.setTimeout(preload, 1200)
    return () => {
      cancelled = true
      if (idle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [router])

  function dispatch(event: OnboardingEvent, source: FinishSource = 'skip') {
    if (busy) return
    const step = advance(state, event, context)
    if (step.kind === 'finish') {
      void finish(step.to, source)
      return
    }
    if (step.state === state) return
    // A step slides by the full viewport width (and fades out on the way).
    setDistance(viewport.current?.getBoundingClientRect().width ?? 0)
    setState(step.state)
    clearError()
  }

  function actionState(event: OnboardingEvent, source: FinishSource): ActionState {
    return { disabled: busy !== null || (offline && finishesNow(state, event, context)), loading: busy === source }
  }

  /** A bubble in or out of the box. Device only: nothing of it goes to the server here. */
  function toggleWish(id: GiftInterest, bubble: HTMLButtonElement) {
    const adding = !picked.includes(id)
    const next = adding ? [...picked, id] : picked.filter((known) => known !== id)
    if (adding) void pompon.current?.catchWish(bubble)
    setPicked(next)
    saveStartInterests(userId, next)
  }

  function renderStep() {
    switch (view) {
      case 'hello':
        return (
          <HelloStep
            greeting={name ? t('onb.hello_name', { name }) : t('onb.hello_anon')}
            disabled={busy !== null}
            status={status}
            petHint={bunnies && !petted}
            onNext={() => dispatch({ type: 'next' })}
          />
        )
      case 'wishes':
        return <WishesStep picked={picked} disabled={busy !== null} status={status} onToggle={toggleWish} onNext={() => dispatch({ type: 'next' })} />
      case 'start': {
        const choice = selected ? choiceOf(selected) : null
        const go: ActionState = choice ? actionState({ type: 'choose', choice }, choice) : { disabled: true, loading: false }
        return (
          <StartStep
            pendingInvite={context.pendingInvite}
            selected={selected}
            action={go}
            status={status}
            onSelect={setSelected}
            onGo={() => {
              if (!choice) return
              pompon.current?.celebrate()
              dispatch({ type: 'choose', choice }, choice)
            }}
          />
        )
      }
      case 'invite':
        return (
          <InviteStep action={actionState({ type: 'confirm' }, 'confirm')} status={status} onConfirm={() => dispatch({ type: 'confirm' }, 'confirm')} />
        )
      case 'homescreen':
        return (
          <HomeScreenStep action={actionState({ type: 'confirm' }, 'confirm')} status={status} onConfirm={() => dispatch({ type: 'confirm' }, 'confirm')} />
        )
    }
  }

  return (
    <Page
      flush
      className="scene-page flex flex-col"
      topBar={
        <TopBar
          left={
            <BackButton visible={canGoBack(state)} label={t('common.back')} disabled={busy !== null} onBack={() => dispatch({ type: 'back' })} />
          }
          title={<ProgressDots current={progress.current} total={progress.total} label={t('onb.progress', progress)} />}
          right={
            <Button
              variant="ghost"
              size="md"
              disabled={busy !== null || offline}
              loading={busy === 'skip'}
              loadingLabel={t('onb.finishing')}
              onClick={() => dispatch({ type: 'skip' }, 'skip')}
            >
              {t('onb.skip')}
            </Button>
          }
        />
      }
    >
      <Scene />
      {/* Pompon sits on the card's top edge; a fixed stage height, so the steps never move him. */}
      <div className="scene-stage scene-stage-fixed scene-bleed">
        <div className="scene-stage-host">
          <div className={cn('wl-seat', pomponAway && 'wl-seat-away')} inert={pomponAway || undefined}>
            <Suspense fallback={null}>
              <WelcomePompon ref={pompon} outfit={outfitOf(view, selected)} size={size} label={t('onb.pet_label')} onPet={() => setPetted(true)} style={seat(size)} />
            </Suspense>
          </div>
          {homeIcon ? (
            <Suspense fallback={null}>
              <HomeIconScene onShown={setIconShown} />
            </Suspense>
          ) : null}
        </div>
      </div>
      <div className="scene-card scene-bleed flex flex-auto flex-col px-safe pt-8">
        {/* Bleeds into the card's gutter so a sliding step leaves at the screen edge on a phone. */}
        <div ref={viewport} className="relative -mx-4 flex flex-auto flex-col overflow-x-clip px-4">
          <AnimatePresence mode="popLayout" custom={stepMotion}>
            <StepFrame
              key={view}
              motion={stepMotion}
              reduced={reduced}
              canForward={canGoForward(state)}
              canBack={canGoBack(state)}
              locked={busy !== null}
              onSwipe={(direction) => dispatch({ type: direction === 'forward' ? 'next' : 'back' })}
            >
              {renderStep()}
            </StepFrame>
          </AnimatePresence>
        </div>
      </div>
    </Page>
  )
}
