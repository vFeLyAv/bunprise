// motion 14: the `m.*` components animate inside a <LazyMotion>; the feature bundle (domMax) arrives as a
// lazy chunk (performance-plan.md 4.4). Components use `m.div`, never `motion.div` (LazyMotion `strict`
// throws on the latter).
//
// Wave 1 integration (docs/decisions/2026-10-20-motion-scope.md): the shell has NO LazyMotion any more —
// motion's LazyMotion pulls motion-dom's VisualElement module (≈ 10 KB gz) into the code of every first
// screen, and the invite landing /i (hard limit 150 KB gz) animates nothing. Each group of screens that
// animates wraps itself in <MotionScope> (./MotionScope.tsx): the signed-in layout, the start / sign-in /
// code / callback / legal screens, the invite's join step, the toasts, the error view.
//
// The features MUST be re-exported from their own module (./bundle.ts): a direct `import('motion/react')`
// would keep the whole library in a chunk that already imports it statically.

type FeatureBundle = Awaited<ReturnType<typeof importBundle>>

function importBundle() {
  return import('./bundle').then((mod) => mod.default)
}

let gate: Promise<unknown> = Promise.resolve()
let loading: Promise<FeatureBundle> | null = null
let loaded: FeatureBundle | null = null

/**
 * Boot (src/main.tsx): a visitor without a session gets the features once the first screen is painted —
 * their first screens have no entrance animation, so the bundle never competes with that screen's own chunk.
 */
export function deferMotionFeatures(until: Promise<unknown>): void {
  if (!loading) gate = until
}

/** Loads the feature bundle once (after the boot gate); a failed load (offline, an old deploy) may retry later. */
export function loadMotionFeatures(): Promise<FeatureBundle> {
  loading ??= gate.then(importBundle).then(
    (bundle) => {
      loaded = bundle
      return bundle
    },
    (err: unknown) => {
      loading = null
      throw err
    },
  )
  return loading
}

/** For a scope: a failed load leaves its elements simply still (never an unhandled rejection). */
function loadForScope(): Promise<FeatureBundle> {
  return loadMotionFeatures().catch(() => new Promise<FeatureBundle>(() => {}))
}

/**
 * What a <LazyMotion features={…}> gets: the bundle itself once it is here — a scope that mounts later
 * (the next screen) animates from its very first frame, no frame without features — else the loader.
 */
export function motionFeatures(): FeatureBundle | (() => Promise<FeatureBundle>) {
  return loaded ?? loadForScope
}
