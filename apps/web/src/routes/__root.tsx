import { Suspense, lazy } from 'react'
import { Outlet, createRootRouteWithContext, useRouterState, type ErrorComponentProps } from '@tanstack/react-router'
import type { RouterContext } from '../lib/routerContext'
import { AccountSwitchGate } from '../features/shell/AccountSwitchGate'
import { OfflineBanner } from '../features/shell/OfflineBanner'
import { LegalFooter, legalFooterShown } from '../features/shell/LegalFooter'
import { NotFoundPage } from '../features/shell/NotFoundPage'

// App shell (framework-decision 9.2): providers live in main.tsx; here only what every screen
// shares — offline banner, the page, legal links (before sign-in; signed in they are the Profil tab's
// "Rechtliches" section — staticData.legalFooter, LegalFooter.tsx), toasts. This chunk is part of EVERY
// route's initial bundle, so: kit imports by file (never the barrel), no motion-feature / mascot imports,
// and the two pieces that touch motion components (toast viewport, error page button) load lazily.

const ToastHost = lazy(() => import('../ui/ToastHost').then((mod) => ({ default: mod.ToastHost })))
const LazyErrorPage = lazy(() => import('../features/shell/ErrorPage').then((mod) => ({ default: mod.ErrorPage })))

// A route error (e.g. a malformed id in a pasted link) replaces RootShell — the closest error
// boundary is this root route's — so the error view brings its own legal links: Impressum and
// Datenschutz stay reachable from every screen (CLAUDE.md "Legal", integration 2026-10-20).
function RootError(props: ErrorComponentProps) {
  return (
    <>
      <Suspense fallback={null}>
        <LazyErrorPage {...props} />
      </Suspense>
      <LegalFooter />
    </>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootShell,
  notFoundComponent: NotFoundPage,
  errorComponent: RootError,
})

function RootShell() {
  const footer = useRouterState({ select: (state) => legalFooterShown(state.matches) })
  return (
    <>
      <OfflineBanner />
      {/* no routed screen while the tab switches accounts in-app (lib/session.ts, reload-loop guard)
          or while the page is being replaced */}
      <AccountSwitchGate>
        <Outlet />
      </AccountSwitchGate>
      {footer ? <LegalFooter /> : null}
      {/* the toast viewport too: unmounted, it drops the previous account's toasts at once (no exit fade) */}
      <AccountSwitchGate>
        <Suspense fallback={null}>
          <ToastHost />
        </Suspense>
      </AccountSwitchGate>
    </>
  )
}
