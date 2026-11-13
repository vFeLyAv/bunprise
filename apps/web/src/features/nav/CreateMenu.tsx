import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { onlineManager, useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { AnimatePresence, useDragControls, useIsPresent, useMotionValue, type PanInfo } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { FeedOccasion } from '../../lib/api/types'
import { feedQuery } from '../../lib/queries'
import { Button, Skeleton, fade, haptic, useBunniesShown, useLayerRoot, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { CREATE_MENU_ID, createMenu, useCreateMenuOpen, useCreateMenuOpening } from './createMenuStore'
import { GlyphChevronLeft, GlyphChevronRight, GlyphPlus } from './glyphs'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { GiftIllustration, PartyCalendarIllustration } from './illustrations'
import { ChunkBoundary } from './ChunkBoundary'
import { MenuDate, whenLabel } from './MenuDate'
import { useModal } from './modal'
import { wishTarget } from './occasionPicker'
import { listsEnabled } from '../lists/flag'
import { requestCreateList, useCreatedList } from '../lists/createFlow'
import { useListsOverview } from '../lists/queries'
import { useMotionLevel } from '../../motion/useMotionLevel'
import { pickMoment, type DirectorPick } from '../mascot-ui/director'
import { useCarry } from '../mascot-ui/carry'
import './createMenu.css'

const loadListWishStep = () => import('./ListWishStep').then((mod) => ({ default: mod.ListWishStep }))
// a failed load is kept by React.lazy: a retry needs a fresh one (ChunkBoundary onRetry)
let ListWishStep = lazy(loadListWishStep)
// the menu's own chunk loads when the browser is idle (TabBar): its wish step comes right along, so
// "Wunsch hinzufügen" works offline later too
if (listsEnabled()) void loadListWishStep().catch(() => undefined)
// «Ночью маскоты спят» (31.10): is it night for the bunny of the next opening? (mascot-ui/night.ts, loaded with this
// chunk — with import(): a static import put its chunk into the preload list of the first screen, see there)
let sleepsNow: () => boolean = () => false
void import('../mascot-ui/night').then((n) => { sleepsNow = n.sleepsNow }, () => undefined)

// The create menu (K5, the star of the main menu): the bar's "+" turns into "×" and a glass panel rises
// with two big buttons and (when lists are enabled) "Neue Wunschliste", while the page behind dims and
// blurs; a bunny moment plays over the panel's top edge, a different one at each opening (mascot-ui
// director, family 'create-menu': climbs out near a corner, hops along the edge, waves, jumps out of the
// "+" behind the panel and climbs out, sniffs with a tiny calendar) — always from hidden, never a bunny that
// is just there (Felix 22.10). Lazy; one animating mascot at a time (mascot-ui/stage.ts): when another one
// holds the stage, no bunny at all. Motion level 'reduced' → no bunny (a bunny frozen over the panel "keeps
// staring at you", Felix 20.10 — BunnyMoment's rule for card overlays); 'off' or "Kaninchen zeigen" off →
// no bunny and no room kept for it.
// Dismiss: tap outside, swipe the panel down, Esc or "×". A modal dialog (focus trap, inert page).
//
// "Wunsch hinzufügen": a wish goes into the wishlist of an occasion I host (occasionPicker.ts) — one →
// straight to its wish form, several → "Für welchen Anlass?" inside the panel, none → a friendly nudge
// to create an occasion first. Data: the existing feed query (no new RPC).
// Navigation from the menu runs without a view transition: the panel's own exit is the transition.

/** The bunny's host reaches this far below the panel's top edge: its paws rest on the glass. */
const PAW_OVERLAP_PX = 16
/** The jump out of the "+" lands this far below the panel's top edge: the whole bunny (≤ 120 px) is behind it. */
const JUMP_LANDING_DEPTH_PX = 128
/** Swipe the panel down past this share of its height, or flick it faster than this (px/s): closed. */
const CLOSE_RATIO = 0.3
const CLOSE_VELOCITY = 500

type Step = 'choose' | 'wish'

type MenuPick = Pick<DirectorPick, 'preset' | 'special'>

/**
 * Dev screenshots only (e2e/plus-menu-bunny-screens.spec.ts): `window.__bunpriseMenuMoment = { preset: 'wave' }`
 * (or `{ preset: 'peek-once', special: 'jump-out' }`) forces the moment of the next openings. Vite folds
 * `import.meta.env.DEV` to false in a build: a production bundle never reads it.
 */
function devMenuMoment(): MenuPick | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const forced = (window as Window & { __bunpriseMenuMoment?: MenuPick }).__bunpriseMenuMoment
  return forced?.preset ? forced : null
}

/**
 * The bunny moment of one opening (mascot-ui/director.ts, family 'create-menu'; null = none under reduced/off).
 * The jump out of the "+" needs the "+" to start from: without it the bunny just climbs out over the panel.
 * At night (23:00 – 07:00, «Nachts schlafen»; mascot-ui/night.ts) Pompon plays the approved `sleepy` instead: he
 * peeks over the edge, yawns and nods off there — no waking up here, the person in the menu is busy (Felix 31.10).
 */
function menuMoment(path: string, level: 'full' | 'reduced' | 'off', canJump: boolean): DirectorPick | null {
  const tab = path === '/lists' ? 'lists' : path === '/gifts' ? 'gifts' : path === '/settings' ? 'profile' : 'start'
  const pick = pickMoment('create-menu', { tab, motion: level, requestKey: createMenu.openingKey() })
  if (!pick) return null
  const moment: MenuPick = devMenuMoment() ?? (sleepsNow() ? { preset: 'sleepy' } : pick)
  if (moment.preset === 'sleepy') return { coat: 'fawn', edge: pick.edge, preset: 'sleepy' }
  if (moment.special === 'jump-out' && !canJump) return { coat: pick.coat, edge: pick.edge, preset: moment.preset }
  return { coat: pick.coat, edge: pick.edge, preset: moment.preset, ...(moment.special ? { special: moment.special } : {}) }
}

/** Close the menu and go: its exit animation runs while the next screen appears underneath. */
function closeThen(go: () => Promise<void> | void): void {
  createMenu.close()
  void go()
}

/** One of the two big buttons: picture, title, a short line, a spring press. */
function BigAction({ picture, title, hint, onPress, tone }: { picture: ReactNode; title: string; hint: string; onPress: () => void; tone: 'wish' | 'occasion' }) {
  const tap = useTapScale(0.95)
  const spring = useSpring('snappy')
  const reduced = useReducedMotionPref()
  return (
    <m.button
      type="button"
      className="cm-action"
      data-tone={tone}
      variants={{ hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.94 }, shown: { opacity: 1, y: 0, scale: 1 } }}
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      <span className="cm-action-picture">{picture}</span>
      <span className="cm-action-title">{title}</span>
      <span className="cm-action-hint">{hint}</span>
    </m.button>
  )
}

function OccasionChoice({ occasion, onPick, index }: { occasion: FeedOccasion; onPick: (occasion: FeedOccasion) => void; index: number }) {
  const { t } = useTranslation('nav')
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const wishes = Math.max(0, Math.trunc(occasion.wish_count))
  return (
    <m.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...bouncy, delay: reduced ? 0 : 0.04 * index, opacity: fade }}
    >
      <m.button type="button" className="cm-choice" whileTap={tap} transition={spring} onPointerDown={() => haptic('tap')} onClick={() => onPick(occasion)}>
        <MenuDate occasion={occasion} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate t-headline text-text">{occasion.title}</span>
          <span className="mt-0.5 block truncate t-footnote text-text-2">
            {whenLabel(occasion)}
            {' · '}
            {wishes > 0 ? t('newmenu.wishes_count', { count: wishes }) : t('newmenu.no_wishes')}
          </span>
        </span>
        <GlyphChevronRight size={18} className="shrink-0 text-text-3" />
      </m.button>
    </m.li>
  )
}

/** The wish step's code could not load (offline before it was cached): say so in place, with a retry and the way back. */
function StepUnavailable({ titleId, onBack, onRetry }: { titleId: string; onBack: () => void; onRetry: () => void }) {
  const { t } = useTranslation('nav')
  return (
    <div className="flex flex-col gap-3">
      <div className="cm-step-head">
        <button type="button" className="cm-back" onClick={onBack} aria-label={t('newmenu.back')} data-tg-back="">
          <GlyphChevronLeft size={22} />
        </button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-center t-title-3 text-text">
          {t('newmenu.wish')}
        </h2>
        <span aria-hidden="true" className="w-11 shrink-0" />
      </div>
      <div role="alert" className="flex flex-col items-center gap-3 py-2 text-center">
        <p className="t-callout text-text-2">{t('newmenu.load_failed')}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t('newmenu.retry')}
        </Button>
      </div>
    </div>
  )
}

/** Step 2 of "Wunsch hinzufügen": choose the occasion, or the friendly "create one first". */
function WishStep({ titleId, onBack, onPick, onCreateOccasion }: { titleId: string; onBack: () => void; onPick: (occasion: FeedOccasion) => void; onCreateOccasion: () => void }) {
  const { t } = useTranslation('nav')
  const feed = useQuery(feedQuery())
  const target = wishTarget(feed.data)
  const offline = !onlineManager.isOnline()

  // exactly one occasion arrived while this step was waiting for the feed: go straight there
  const picked = useRef(false)
  useEffect(() => {
    if (target.kind === 'one' && !picked.current) {
      picked.current = true
      onPick(target.occasion)
    }
  }, [target, onPick])

  let body: ReactNode
  if (target.kind === 'none') {
    body = (
      <div className="flex flex-col items-center gap-3 pt-1 text-center">
        <p className="max-w-[32ch] t-callout text-text-2">{t('newmenu.none_text')}</p>
        <Button variant="primary" size="lg" fullWidth className="mt-2" icon={<GlyphPlus size={20} />} onClick={onCreateOccasion}>
          {t('newmenu.none_action')}
        </Button>
      </div>
    )
  } else if (target.kind === 'many' || target.kind === 'one') {
    const list = target.kind === 'many' ? target.occasions : [target.occasion]
    body = (
      <>
        <p className="px-1 t-footnote text-text-2">{t('newmenu.pick_hint')}</p>
        <ul className="cm-choices" data-cm-scroll="">
          {list.map((occasion, index) => (
            <OccasionChoice key={occasion.id} occasion={occasion} index={index} onPick={onPick} />
          ))}
        </ul>
      </>
    )
  } else if (feed.isError) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 py-2 text-center">
        <p className="t-callout text-text-2">{t('newmenu.error')}</p>
        <Button variant="secondary" onClick={() => void feed.refetch()}>
          {t('newmenu.retry')}
        </Button>
      </div>
    )
  } else if (offline) {
    body = <p role="status" className="py-2 text-center t-callout text-text-2">{t('newmenu.offline')}</p>
  } else {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span role="status" className="sr-only">{t('newmenu.loading')}</span>
        {[0, 1].map((row) => (
          <div key={row} aria-hidden="true" className="cm-choice cm-choice-skeleton">
            <Skeleton width={56} height={64} rounded="md" />
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton width="62%" height={15} />
              <Skeleton width="44%" height={11} />
            </span>
          </div>
        ))}
      </div>
    )
  }

  const title = target.kind === 'none' ? t('newmenu.none_title') : t('newmenu.pick_title')
  return (
    <div className="flex flex-col gap-3">
      <div className="cm-step-head">
        <button type="button" className="cm-back" onClick={onBack} aria-label={t('newmenu.back')} data-tg-back="">
          <GlyphChevronLeft size={22} />
        </button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-center t-title-3 text-text">
          {title}
        </h2>
        <span aria-hidden="true" className="w-11 shrink-0" />
      </div>
      {body}
    </div>
  )
}

/**
 * Glides the panel to a new height (step change): it is anchored at the bottom, so a taller step would
 * push its top edge (and the bunny on it) up at once. A ResizeObserver offsets the panel by the
 * difference and the smooth spring takes it back — transform only (like the kit Sheet).
 */
function useHeightGlide(measured: RefObject<HTMLElement | null>, moved: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = measured.current
    const target = moved.current
    if (!active || !el || !target || typeof ResizeObserver !== 'function' || typeof target.animate !== 'function') return
    let last = el.offsetHeight
    let glide: Animation | null = null
    const ro = new ResizeObserver(() => {
      const height = el.offsetHeight
      const delta = height - last
      last = height
      if (Math.abs(delta) < 2) return
      const cs = getComputedStyle(el)
      const duration = parseFloat(cs.getPropertyValue('--dur-smooth')) || 0
      if (duration <= 0) return
      glide?.cancel()
      glide = target.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0px)' }], {
        duration,
        easing: cs.getPropertyValue('--ease-smooth').trim() || 'cubic-bezier(.2,.7,.3,1)',
      })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      glide?.cancel()
    }
  }, [measured, moved, active])
}

/** Keep a full silhouette above the panel on short screens; controls always get the space first. */
function useMenuMascotSize(panelRef: RefObject<HTMLElement | null>, dialogRef: RefObject<HTMLElement | null>): number {
  const [size, setSize] = useState(124)
  useEffect(() => {
    const panel = panelRef.current
    const dialog = dialogRef.current
    const sheet = panel?.closest<HTMLElement>('.cm-sheet')
    if (!panel || !dialog || !sheet) return
    const measure = () => {
      if (dialog.clientHeight <= 0) return
      // Layout heights, not animated client rectangles: opening/dragging must not resize the puppet.
      const room = dialog.clientHeight - (parseFloat(getComputedStyle(sheet).bottom) || 0) - panel.offsetHeight - 12
      setSize(Math.min(124, Math.floor(room / 1.2)))
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(panel)
    observer?.observe(dialog)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [panelRef, dialogRef])
  return size
}

export interface CreateMenuProps {
  /** the signed-in account (the feed query belongs to it) */
  userId: string
}

export default function CreateMenu({ userId }: CreateMenuProps) {
  const open = useCreateMenuOpen()
  const opening = useCreateMenuOpening()
  const root = useLayerRoot()
  const [newList, setNewList] = useState(false)
  // closing waits for this menu's exit (the bar's "+" stays above the fading scrim until then)
  useEffect(() => createMenu.attach(), [])
  if (!root) return null
  return (
    <>
      {createPortal(
        <AnimatePresence mode="wait" onExitComplete={() => createMenu.settled()}>{open ? <MenuLayer key={`${userId}:${opening}`} userId={userId} onNewList={() => setNewList(true)} /> : null}</AnimatePresence>,
        root,
      )}
      <NewListHost userId={userId} open={newList} onClose={() => setNewList(false)} />
    </>
  )
}

const CreateListSheet = lazy(() => import('../lists/CreateListSheet'))

/**
 * "+ → Neue Wunschliste" away from the Listen tab: the create sheet opens over the screen you are on, so
 * "×" leaves you right there (it used to switch to Listen first and strand you there). Only a list that was
 * really created leads on to Listen, where Pompon carries its card in and the list opens (lists/createFlow.ts).
 * On the Listen tab itself the tab's own sheet opens (requestCreateList).
 */
function NewListHost({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const path = useLocation({ select: (location) => location.pathname })
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  // the follower count and the 20-list limit of the sheet (one get_lists_overview, only once it is used)
  const overview = useListsOverview(userId, mounted)
  const created = useCreatedList()
  // a list noted before this host came along (still being carried in on Listen) is none of its business
  const seen = useRef(created)
  useEffect(() => {
    if (created === seen.current) return
    seen.current = created
    // away from Listen nothing else creates lists: this sheet made it — on to Listen, where it lands
    if (created && path !== '/lists') void navigate({ to: '/lists', viewTransition: false })
  }, [created, path, navigate])
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <CreateListSheet
        open={open}
        onClose={onClose}
        userId={userId}
        followers={overview.data?.stats.followers ?? null}
        standaloneCount={overview.data ? overview.data.my_lists.filter((card) => card.kind === 'standalone').length : null}
      />
    </Suspense>
  )
}

function MenuLayer({ userId, onNewList }: { userId: string; onNewList: () => void }) {
  const { t } = useTranslation(['nav', 'lists'])
  const withLists = listsEnabled()
  const navigate = useNavigate()
  const reduced = useReducedMotionPref()
  const bunnies = useBunniesShown()
  const level = useMotionLevel()
  const path = useLocation({ select: (location) => location.pathname })
  const [origin] = useState(() => document.querySelector('.tabbar-create')?.getBoundingClientRect())
  const [pick] = useState(() => menuMoment(path, level, !!origin))
  const carry = useCarry()
  // every jump-out pick jumps (it used to jump once per session and then only sat there: Felix 22.10)
  const [jumping, setJumping] = useState(() => pick?.special === 'jump-out' && bunnies && !!origin)
  const smooth = useSpring('smooth')
  // still mounted while its exit animation runs: from the first frame of closing the page is usable again
  // (no focus trap, no inert page, no scroll lock, no taps caught by the fading layer)
  const requestedOpen = useCreateMenuOpen()
  const present = useIsPresent()
  const open = requestedOpen && present
  const [momentReady, setMomentReady] = useState(false)
  useEffect(() => {
    if (!open || reduced || !bunnies) return
    const timer = setTimeout(() => setMomentReady(true), 350)
    return () => clearTimeout(timer)
  }, [open, reduced, bunnies])
  const titleId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const glideRef = useRef<HTMLDivElement>(null)
  const mascotSize = useMenuMascotSize(panelRef, dialogRef)
  const [step, setStep] = useState<Step>(() => createMenu.entry())
  const y = useMotionValue(0)
  const drag = useDragControls()
  const close = useCallback(() => createMenu.close(), [])
  useModal(open, containerRef, dialogRef, close)
  useHeightGlide(panelRef, glideRef, !reduced)
  useEffect(() => {
    if (!momentReady || !open || !jumping || reduced || !bunnies || mascotSize < 48 || !panelRef.current || !origin) return
    let active = true
    const controller = new AbortController()
    // It pops out of the "+" (over the tab bar) and its arc goes BEHIND the panel (the stage is cut out there:
    // never over the cards). It lands out of sight under the panel's top edge, where the climb-out then begins —
    // only once the jump is over (onDone: it has left the stage). A climb that started while the jump still held
    // the stage could not play and showed its end pose: the bunny "teleported" onto the edge (Felix 22.10).
    const panel = panelRef.current.getBoundingClientRect()
    const landing = { left: panel.left, top: panel.top + JUMP_LANDING_DEPTH_PX, width: panel.width, height: 80 }
    void carry({ from: origin, to: landing, item: 'none', signal: controller.signal, hideBehind: panelRef.current, onDone: () => { if (active) setJumping(false) } })
    return () => { active = false; controller.abort() }
  }, [carry, jumping, origin, momentReady, open, reduced, bunnies, mascotSize])

  // focus the first big button once the panel is up (the dialog itself until then) — never once the menu
  // is closing: the focus went back to the "+" then
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('.cm-action, .cm-back')
      ;(first ?? dialogRef.current)?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [step, open])

  const toOccasionForm = useCallback(() => {
    closeThen(() => navigate({ to: '/occasions/new', viewTransition: false }))
  }, [navigate])

  const toWishForm = useCallback(
    (occasion: FeedOccasion) => {
      closeThen(() => navigate({ to: '/occasions/$occasionId/wishes/new', params: { occasionId: occasion.id }, viewTransition: false }))
    },
    [navigate],
  )

  const feed = useQuery(feedQuery())
  const startWish = () => {
    if (withLists) { setStep('wish'); return }
    const target = wishTarget(feed.data)
    if (target.kind === 'one') toWishForm(target.occasion)
    else setStep('wish')
  }

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const height = panelRef.current?.offsetHeight ?? 0
    if (info.offset.y > height * CLOSE_RATIO || info.velocity.y > CLOSE_VELOCITY) close()
  }

  return (
    <div ref={containerRef} className="cm-layer" data-closing={open ? undefined : ''} aria-hidden={!open || undefined} inert={!open}>
      <m.div
        aria-hidden="true"
        className="cm-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.45, 0, 0.2, 1] }}
        onClick={close}
      />
      <div ref={dialogRef} id={CREATE_MENU_ID} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="cm-dialog">
        <m.div
          className="cm-sheet"
          style={{ y }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 64, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0, transition: fade } : { opacity: 0, y: 72, scale: 0.97, transition: { ...smooth, opacity: { duration: 0.18 } } }}
          transition={reduced ? fade : { ...smooth, opacity: fade }}
          drag={reduced ? false : 'y'}
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.08, bottom: 0.9 }}
          dragMomentum={false}
          onDragEnd={onDragEnd}
          onPointerDown={(event) => {
            // the finger can pull the panel down from anywhere but the scrolling occasion list
            if ((event.target as Element).closest('[data-cm-scroll]')) return
            const panel = panelRef.current
            if (panel && panel.scrollHeight > panel.clientHeight + 1 && panel.contains(event.target as Node)) return
            if (!reduced) drag.start(event)
          }}
        >
          <div ref={glideRef} className="cm-glide">
          {bunnies && momentReady && !reduced && mascotSize >= 48 ? (
            <div className="cm-bunny" aria-hidden="true">
              {!jumping ? <BunnyMoment
                key={mascotSize}
                kind="peek"
                {...(pick ? { pick } : {})}
                once="always"
                momentClass="response"
                whenSeen="none"
                onceKey="create-menu"
                edgeInset={PAW_OVERLAP_PX}
                cardRef={panelRef}
                minSize={Math.min(104, mascotSize)}
                maxSize={mascotSize}
                className="pointer-events-none absolute inset-0"
                style={{ bottom: -PAW_OVERLAP_PX }}
              /> : null}
            </div>
          ) : null}
          <div ref={panelRef} className="cm-panel glass-sheet">
            <AnimatePresence mode="popLayout" initial={false}>
              {step === 'choose' ? (
                <m.div
                  key="choose"
                  className="flex flex-col gap-4"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
                  transition={{ ...smooth, opacity: fade }}
                >
                  <h2 id={titleId} className="text-center t-title-3 text-text">
                    {t('newmenu.title')}
                  </h2>
                  <m.div
                    className="cm-actions"
                    initial="hidden"
                    animate="shown"
                    transition={reduced ? { duration: 0 } : { staggerChildren: 0.07, delayChildren: 0.06 }}
                  >
                    <BigAction
                      tone="wish"
                      picture={<GiftIllustration size={60} />}
                      title={t('newmenu.wish')}
                      hint={t('newmenu.wish_hint')}
                      onPress={startWish}
                    />
                    <BigAction
                      tone="occasion"
                      picture={<PartyCalendarIllustration size={60} />}
                      title={t('newmenu.occasion')}
                      hint={t('newmenu.occasion_hint')}
                      onPress={toOccasionForm}
                    />
                  </m.div>
                  {withLists ? <Button variant="ghost" fullWidth onClick={() => {
                    if (path === '/lists') {
                      requestCreateList()
                      createMenu.close()
                    } else closeThen(onNewList)
                  }}>{t('lists:lists.first_wish.new_list')}</Button> : null}
                </m.div>
              ) : (
                <m.div
                  key="wish"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
                  transition={{ ...smooth, opacity: fade }}
                >
                  {withLists ? <ChunkBoundary
                    onRetry={() => { ListWishStep = lazy(loadListWishStep) }}
                    fallback={(retry) => <StepUnavailable titleId={titleId} onBack={() => setStep('choose')} onRetry={retry} />}
                  >
                    {() => <Suspense fallback={<Skeleton height={120} />}>
                      <ListWishStep userId={userId} titleId={titleId} onBack={() => setStep('choose')} />
                    </Suspense>}
                  </ChunkBoundary> : <WishStep titleId={titleId} onBack={() => setStep('choose')} onPick={toWishForm} onCreateOccasion={toOccasionForm} />}
                </m.div>
              )}
            </AnimatePresence>
          </div>
          </div>
        </m.div>
        {/* The dialog's close button, exactly under the bar's "+" (the same geometry as .tabbar). The
            person sees the bar's own button turned into "×" (TabBar: lifted above this layer, taking no
            taps while the menu is open); this one draws nothing but its focus ring — so there is never a
            second round button that could linger, double or slide while the menu leaves. */}
        <div className="cm-dock">
          <div className="cm-dock-row">
            <span />
            <span className="grid place-items-center">
              <button type="button" className="cm-close" aria-label={t('nav.close_menu')} onClick={close} />
            </span>
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}
