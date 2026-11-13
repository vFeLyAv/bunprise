import { Suspense, lazy, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { QueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { fade, haptic, instant, useLayerRoot, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { lastStartView, subscribeStartView, whenIdle, type StartView } from '../feed/session'
import { CREATE_MENU_ID, createMenu, useCreateMenuPhase } from './createMenuStore'
import { GlyphGift, GlyphHome, GlyphLists, GlyphPlus } from './glyphs'
import { ProfileAvatar } from './ProfileAvatar'
import { appScroller, useScrollCompact } from './scroller'
import { getTabDrag, useTabDrag } from './tabDrag'
import { TABS, TAB_GROUPS, tabPlace, type TabDef, type TabGroup, type TabId } from './tabs'
import { useMyName } from './useMyName'
import { useRequestDot } from './requestDot'
import { useInviteCount } from '../invitations/dot'
import './nav.css'

// The floating glass tab bar (wave 2, Felix 2026-10-20 evening): [ Start · Listen ] ( + ) [ Ideen · Profil ],
// on the four top-level screens only (the layout decides). iOS 26 Liquid Glass groups above the home
// indicator, with real backdrop blur: two tabs in each capsule, the big "+" in the exact centre between them.
// The selected tab's pill springs from tab to tab inside a capsule and hops over to the other one; scrolling
// down shrinks the bar to a compact form. The calendar is no tab any more — it is Start's "Monat" view, and
// the Start tab remembers which view you left (features/feed/session.ts).
// The "+" is the only create button there is: with the menu open it turns into "×" in place (its glyph
// rotates; the bar is lifted above the menu's scrim, its capsules dim, none of it takes taps — the menu's
// own invisible close button lies right under the "×"), and back into "+" when the menu closes.
// Rendered into the overlay layer (a portal), so nothing sits between a screen's <main> and the page end.

/** Loads the menu's code and the mascot when the browser is idle, so the first "+" opens at once. */
function preloadMenu(): void {
  void import('./CreateMenu').catch(() => undefined)
  void import('../mascot-ui/WelcomeBunnies').then((mod) => mod.preloadWelcome()).catch(() => undefined)
}

// my own profile photo over the initials (20261024120000): its own small chunk, rendered once the browser is idle
const TabPhoto = lazy(() => import('../profilePhotos/TabPhoto'))

function useStartView(): StartView {
  return useSyncExternalStore(subscribeStartView, lastStartView, () => 'list')
}

interface TabLinkProps {
  tab: TabDef
  active: boolean
  label: string
  icon: ReactNode
  /** Start: back to the view you left there ("Monat" → /soon?view=month) */
  startView: StartView
  requests?: string
  /** the tab you are on: a tap scrolls its screen back to the top instead (iOS, Telegram) */
  toTop?: () => void
}

function TabLink({ tab, active, label, icon, startView, requests, toTop }: TabLinkProps) {
  const tap = useTapScale(0.88)
  const spring = useSpring('snappy')
  return (
    <Link
      to={tab.to}
      search={tab.id === 'start' && startView === 'month' ? { view: 'month' } : undefined}
      // tab ↔ tab: no crossfade of the page — the switch is instant like iOS, the pill's spring moves
      viewTransition={false}
      aria-current={active ? 'page' : undefined}
      aria-label={requests}
      className="tabbar-tab"
      data-tab={tab.id}
      onClick={(event) => {
        haptic('select')
        if (toTop) {
          event.preventDefault()
          toTop()
        }
      }}
    >
      <m.span className="tabbar-icon relative" tabIndex={-1} whileTap={tap} transition={spring}>
        {icon}
        {requests && <span aria-hidden="true" className="tabbar-request-dot" />}
      </m.span>
      <span className="tabbar-label">{label}</span>
    </Link>
  )
}

function CreateButton({ label, open }: { label: string; open: boolean }) {
  const tap = useTapScale(0.88)
  const spring = useSpring('snappy')
  return (
    <m.button
      type="button"
      className="tabbar-create glass-float glass-accent"
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? CREATE_MENU_ID : undefined}
      data-create-trigger=""
      whileTap={tap}
      transition={spring}
      onPointerDown={() => {
        haptic('tap')
        preloadMenu()
      }}
      onClick={() => createMenu.open()}
    >
      <GlyphPlus size={26} />
    </m.button>
  )
}

/**
 * The selected tab's lens inside one glass capsule. It slides between the two slots with the smooth spring
 * and squashes a little on the way (`moves` restarts the keyframes); it pops in when the selection hops over
 * from the other capsule and shrinks away when it leaves.
 */
function Pill({ group, visible, slot, moves }: { group: TabGroup; visible: boolean; slot: number; moves: number }) {
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const bouncy = useSpring('bouncy')
  // a swipe between the tabs (TabSwipe.tsx): the pill follows the finger, without a spring of its own
  const pose = useTabDrag()?.[group]
  return (
    <m.span
      aria-hidden="true"
      className="tabbar-pill"
      initial={false}
      animate={pose ? { x: `${pose.slot * 100}%`, opacity: pose.opacity, scale: pose.scale } : { x: `${slot * 100}%`, opacity: visible ? 1 : 0, scale: visible || reduced ? 1 : 0.55 }}
      transition={pose ? instant : { x: smooth, scale: bouncy, opacity: fade }}
    >
      <m.span
        key={moves}
        className="tabbar-pill-shape"
        initial={false}
        animate={reduced || moves === 0 ? { scaleX: 1, scaleY: 1 } : { scaleX: [1, 1.22, 1], scaleY: [1, 0.84, 1] }}
        transition={reduced ? { duration: 0 } : { duration: 0.42, ease: [0.3, 0.7, 0.2, 1], times: [0, 0.38, 1] }}
      />
    </m.span>
  )
}

export interface TabBarProps {
  active: TabId
  userId: string
  /** the app's query client (router context): the avatar reads the cached get_me from it */
  queryClient: QueryClient
}

const BY_ID = new Map(TABS.map((tab) => [tab.id, tab]))

export function TabBar({ active, userId, queryClient }: TabBarProps) {
  const { t, ready } = useTranslation('nav')
  const root = useLayerRoot()
  const phase = useCreateMenuPhase()
  const menuOpen = phase === 'open'
  // open or still closing: the bar stays above the menu's scrim until the menu has gone
  const menuLayer = phase !== 'closed'
  const compact = useScrollCompact(active, menuLayer)
  const name = useMyName(userId, queryClient)
  const requests = useRequestDot(userId, queryClient)
  // in-app invitations to occasions (features/invitations, behind VITE_INVITES): the same dot on "Start"
  const invites = useInviteCount(userId, queryClient) > 0
  const startView = useStartView()
  const place = tabPlace(active)
  // a slide inside one capsule squashes that capsule's pill (a new key restarts the keyframes); a hop to the
  // other capsule pops its pill in without a squash
  const [moves, setMoves] = useState<Record<TabGroup, number>>({ left: 0, right: 0 })
  const [last, setLast] = useState(active)
  // where each capsule's pill rests while the selection is in the other capsule
  const [rest, setRest] = useState<Record<TabGroup, number>>(() => ({ left: 0, right: 0, [place.group]: place.slot }))
  if (active !== last) {
    setLast(active)
    // a swipe that lands: the pill is already there (it followed the finger), no squash on top
    if (tabPlace(last).group === place.group && !getTabDrag()) setMoves((current) => ({ ...current, [place.group]: current[place.group] + 1 }))
    setRest((current) => (current[place.group] === place.slot ? current : { ...current, [place.group]: place.slot }))
  }

  // the screens end above the bar (nav.css: <html data-tabbar>)
  useLayoutEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-tabbar', '')
    return () => html.removeAttribute('data-tabbar')
  }, [])

  const [idle, setIdle] = useState(false)
  useEffect(() => whenIdle(() => {
    preloadMenu()
    setIdle(true)
  }, 4000), [])
  const reduced = useReducedMotionPref()
  const toTop = () => appScroller(root).target.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })

  if (!root) return null
  const label = (key: TabDef['label']) => (ready ? t(key) : '')

  const icon = (id: TabId): ReactNode => {
    const on = active === id
    switch (id) {
      case 'start':
        return <GlyphHome active={on} size={26} />
      case 'lists':
        return <GlyphLists active={on} size={26} />
      case 'gifts':
        return <GlyphGift active={on} size={26} />
      default:
        return (
          <span className="tabbar-avatar">
            <ProfileAvatar seed={userId} name={name} size={26}>
              {idle ? <Suspense fallback={null}><TabPhoto userId={userId} /></Suspense> : null}
            </ProfileAvatar>
          </span>
        )
    }
  }

  const capsule = (group: TabGroup) => {
    const here = place.group === group
    return (
      <div className={`tabbar-group tabbar-group-${group}`}>
        <span aria-hidden="true" className="tabbar-glass glass-float" />
        <Pill group={group} visible={here} slot={here ? place.slot : rest[group]} moves={moves[group]} />
        <ul className="tabbar-row">
          {TAB_GROUPS[group].map((id) => {
            const tab = BY_ID.get(id)
            if (!tab) return null
            return (
              <li key={id}>
                <TabLink tab={tab} active={active === id} label={label(tab.label)} icon={icon(id)} startView={startView} requests={id === 'lists' && requests && ready ? t('nav.lists_requests') : id === 'start' && invites && ready ? t('nav.start_invites') : undefined} toTop={active === id ? toTop : undefined} />
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return createPortal(
    <nav
      aria-label={ready ? t('nav.label') : undefined}
      className="tabbar"
      data-tabbar=""
      data-compact={compact ? '' : undefined}
      data-menu-open={menuOpen ? '' : undefined}
      data-menu-layer={menuLayer ? '' : undefined}
    >
      <div className="tabbar-inner">
        {capsule('left')}
        <div className="tabbar-create-slot">
          <CreateButton label={ready ? t('nav.create') : ''} open={menuOpen} />
        </div>
        {capsule('right')}
      </div>
    </nav>,
    root,
  )
}
