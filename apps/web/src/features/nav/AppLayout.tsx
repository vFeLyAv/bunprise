import { Suspense, lazy, useEffect, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Outlet, useMatches } from '@tanstack/react-router'
import { MotionScope } from '../../motion/MotionScope'
import { useLayerRoot } from '../../ui/layers'
import { whenIdle } from '../feed/session'
import { createMenu, useCreateMenuOpen } from './createMenuStore'
import { swipeBackEnabled } from './swipeEnv'
import { TabBar } from './TabBar'
import { tabForRouteId } from './tabs'

// The signed-in layout (routes/_authed.tsx renders it; wave 1): the screen, then — as portals into the
// overlay layer, so nothing ever sits between a screen's <main> and the page end — the floating tab
// bar on the three top-level screens, the create menu (its own lazy chunk, loaded on idle or on the first
// "+") and, in the installed PWA only, the interactive edge-swipe-back on pushed screens. The swipe between
// the four tabs is a lazy chunk too, loaded once the first screen is idle (TabSwipe.tsx).
// Everything signed in animates inside this one <MotionScope> (the shell has no LazyMotion,
// docs/decisions/2026-10-20-motion-scope.md).

const CreateMenu = lazy(() => import('./CreateMenu'))
const EdgeSwipeBack = lazy(() => import('./EdgeSwipeBack'))
const TabSwipe = lazy(() => import('./TabSwipe'))

export interface AppLayoutProps {
  userId: string
  queryClient: QueryClient
}

export function AppLayout({ userId, queryClient }: AppLayoutProps) {
  const matches = useMatches()
  const leaf = matches[matches.length - 1]
  const tab = tabForRouteId(leaf?.routeId)
  const root = useLayerRoot()
  const [swipe] = useState(() => swipeBackEnabled(Boolean(root && typeof document !== 'undefined' && root !== document.body)))
  const menuOpen = useCreateMenuOpen()
  const [menuMounted, setMenuMounted] = useState(menuOpen)
  if (menuOpen && !menuMounted) setMenuMounted(true)
  const [tabSwipe, setTabSwipe] = useState(false)
  // the same idle budget as the tab bar's preloads: the first screen's own lazy pieces go first
  useEffect(() => whenIdle(() => setTabSwipe(true), 4000), [])

  // Toasts portal into the same overlay root as the tab bar, including the dev phone's safe-area context.
  useEffect(() => {
    if (!root || !tab) return
    root.style.setProperty('--toast-tabbar-clearance', 'calc(var(--nav-bar-h) + var(--nav-bar-bottom) + 8px)')
    return () => { root.style.removeProperty('--toast-tabbar-clearance') }
  }, [root, tab])

  // a pushed screen has no "+": leaving the top-level screens closes the menu (and so does signing out)
  useEffect(() => {
    if (!tab) createMenu.close()
  }, [tab])
  useEffect(() => () => createMenu.close(), [])

  return (
    <MotionScope>
      <Outlet />
      {tab ? <TabBar active={tab} userId={userId} queryClient={queryClient} /> : null}
      {menuMounted ? (
        <Suspense fallback={null}>
          <CreateMenu userId={userId} />
        </Suspense>
      ) : null}
      {swipe ? (
        <Suspense fallback={null}>
          <EdgeSwipeBack pushed={!tab} />
        </Suspense>
      ) : null}
      {tabSwipe ? (
        <Suspense fallback={null}>
          <TabSwipe tab={tab} />
        </Suspense>
      ) : null}
    </MotionScope>
  )
}
