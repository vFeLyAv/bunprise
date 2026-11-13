// FIRST: a Telegram Mini App's launch fragment must leave the URL before the router reads it (lib/telegram/detect.ts).
import { IN_TELEGRAM } from './lib/telegram/detect'
// SECOND: the colour theme (Hell / Dunkel / Blau / Ozean chosen, Telegram's scheme) goes onto <html> before anything renders
import { applyTheme } from './lib/themeBoot'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from '@tanstack/react-router'
import { DEMO_MODE } from './lib/app'
import { initI18n } from './lib/i18n'
import { persistOptions, queryClient } from './lib/query'
import { watchSessionIdentity } from './lib/session'
import { exitSplashWhenReady, removeSplashNow } from './lib/splash'
import { hasLocalSession } from './lib/supabase'
import { guardViewTransitions } from './lib/viewTransitionGuard'
import { deferMotionFeatures, loadMotionFeatures } from './motion/features'
import { startMotionLevel } from './motion/level'
import { MotionLevelConfig, syncMotionGlobals } from './motion/MotionLevelConfig'
import { router } from './router'

// Design-system entry (src/styles/index.css → app.css + tokens.css), owned by the design agent.
// Loaded through a glob so the build also passes before the file exists; once it exists it is
// bundled exactly like a plain `import './styles/index.css'`.
import.meta.glob('./styles/index.css', { eager: true })

// Boot order (performance-plan.md 6.1): demo mocks → translations → session watcher → render →
// after the first screen: service worker (prompt mode; see lib/pwa.ts) and, only inside Telegram, the bridge
// to the Telegram client (lib/telegram/bridge.ts, docs/spec/telegram-mini-app.md).
//
// What the first screen does not need starts once the router has rendered it and the browser has
// painted it (perf audit 2026-10-20, docs/perf-report-2026-10-20.md): on a slow first visit these lazy
// loads otherwise share the network with the screen's own chunk and translations.
//   - The service worker and its precache of the whole app (additionally waits for an idle moment).
//   - motion's feature bundle (src/motion/bundle.ts, ≈ 30 KB gz) for visitors WITHOUT a stored
//     session: their first screens (start, sign-in, invite landing, legal pages) have no entrance
//     animation — `m.*` elements render as plain elements until the features arrive and animate from
//     then on. With a session the first screen may animate in (feed cards, the join screen), so the
//     features start at once, as before.
// No LazyMotion here (docs/decisions/2026-10-20-motion-scope.md): it would put motion-dom's
// VisualElement module (≈ 10 KB gz) into every first screen; each group of screens that animates has its
// own MotionScope (src/motion/MotionScope.tsx). The motion LEVEL (MotionConfig) stays global.

/** Resolves once the router has rendered the first location (after 3 s at the latest) and it is painted. */
function whenFirstScreenPainted(): Promise<void> {
  const resolved = new Promise<void>((resolve) => {
    let unsubscribe = () => {}
    const finish = () => {
      unsubscribe()
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 3000)
    unsubscribe = router.subscribe('onResolved', finish)
  })
  // rAF runs right before the next paint; the timeout queued from it runs once that frame is on screen
  return resolved.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))
}

/** Resolves when the main thread is idle (Safari has no requestIdleCallback: a short timeout instead). */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 2000 })
    else setTimeout(resolve, 500)
  })
}

/**
 * With a stored session the first screen needs Supabase at once (the guard's fresh get_me): open the
 * connection (DNS + TCP + TLS) while the shell boots. Never for visitors without a session — the start
 * page and the invite landing talk to nobody but our own origin. Not in demo mode (MSW answers).
 */
function preconnectSupabase(): void {
  const url = import.meta.env.VITE_SUPABASE_URL
  if (DEMO_MODE || !url) return
  try {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = new URL(url).origin
    link.crossOrigin = 'anonymous' // supabase-js fetches without credentials (the anonymous connection pool)
    document.head.append(link)
  } catch {
    /* a malformed URL is reported by the Supabase client on first use */
  }
}

function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {/* the app's motion level (setting × system × battery, src/motion/level.ts) drives motion's setup */}
      <MotionLevelConfig>
        <RouterProvider router={router} />
      </MotionLevelConfig>
    </PersistQueryClientProvider>
  )
}

async function boot(): Promise<void> {
  // <html data-theme> (only for a chosen theme or inside Telegram; else the CSS follows the system) — first thing;
  // Blau / Ozean also start loading their own stylesheet here
  const themed = applyTheme()
  // <html data-motion / data-bunnies> before anything renders (CSS durations, mascots; src/motion/level.ts)
  startMotionLevel()
  syncMotionGlobals()
  // overlapping navigations skip view transitions; their AbortErrors must not surface as page errors
  guardViewTransitions()
  if (import.meta.env.VITE_DEMO === '1') {
    await (await import('./mocks/browser')).startDemo()
  }
  // dev / demo only (a build drops it): ?night=1|0|22:59 — the sleeping mascots' clock for this tab (src/dev/nightOverride.ts)
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') (await import('./dev/nightOverride')).captureNightOverride()
  // dev / demo only: ?alive=fast|groom|auto — the quick check of the living moments (src/dev/aliveOverride.ts)
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') (await import('./dev/aliveOverride')).captureAliveOverride()
  // read after startDemo(): the demo world starts signed out on every load
  const signedIn = hasLocalSession()
  if (signedIn) preconnectSupabase()
  await initI18n()
  watchSessionIdentity()

  const firstScreen = whenFirstScreenPainted()
  // the launch screen (index.html #bp-splash) leaves once its entrance is over and this screen is painted with its
  // photos (2.5 s at the latest) — lib/splash.ts, docs/design/2026-10-26-splash.md
  void exitSplashWhenReady({ painted: firstScreen })
  if (signedIn) void loadMotionFeatures().catch(() => undefined)
  else deferMotionFeatures(firstScreen)

  let tree: ReactNode = <App />
  if (import.meta.env.DEV) {
    // phone-sized preview frame for development only; never part of the production bundle
    const { loadPhoneFrame } = await import('./lib/devFrame')
    const PhoneFrame = await loadPhoneFrame()
    if (PhoneFrame) tree = <PhoneFrame>{tree}</PhoneFrame>
  }

  // the Blau / Ozean stylesheet (started by applyTheme above): in before the first frame, so no warm night flashes
  await themed
  const container = document.getElementById('root')
  if (!container) throw new Error('index.html has no #root element')
  createRoot(container).render(<StrictMode>{tree}</StrictMode>)
  if (IN_TELEGRAM) {
    // the bridge to the Telegram client (ready, Back, links, haptics, safe areas): its own chunk, only in Telegram
    void firstScreen
      .then(() => import('./lib/telegram/bridge'))
      .then(({ startBridge }) => void startBridge())
      .catch(() => {
        /* without the bridge the app still works, only without Telegram's buttons */
      })
  }
  if (import.meta.env.PROD) {
    void firstScreen
      .then(whenIdle)
      .then(() => import('./lib/pwa'))
      .then(({ setupPwaUpdates }) => setupPwaUpdates())
      .catch(() => {
        /* An unavailable update chunk must not interrupt the already-rendered app. */
      })
  }
}

boot().catch((err: unknown) => {
  // the error text in #root must be visible, not behind the launch screen
  removeSplashNow()
  console.error(err)
  const container = document.getElementById('root')
  if (container) container.textContent = err instanceof Error ? err.message : String(err)
})
