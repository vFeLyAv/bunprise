/**
 * The launch screen's exit (Felix 26.10, docs/design/2026-10-26-splash.md): apps/web/src/lib/splash.ts, main.tsx calls
 * `exitSplashWhenReady({ painted: firstScreen })`. packages/mascot/demo/splash/controller.ts is the gallery's identical
 * copy, run against its mock app (apps/web/src/lib/splash.test.ts compares them; the behaviour tests live with the
 * gallery, packages/mascot/test/splash.test.ts).
 *
 * The splash itself is static HTML + CSS (in apps/web/index.html; the gallery's copy is demo/splash/splash.html): it appears with the first paint and
 * plays its entrance on its own. This module only decides WHEN it leaves and removes it afterwards:
 *   1. its entrance has finished (the CSS animations named `bps-in-*`, read through getAnimations(); where the
 *      browser cannot list them, `fallbackMs` after navigation start) and at least `floorMs` have passed;
 *   2. the app is ready: its first screen is painted (`painted`) and then nothing above the fold is still loading
 *      (`whenSettled`) — or `capMs` after navigation start have passed, whichever comes first (a slow network never
 *      keeps anyone behind it; an empty page is never revealed: `painted` is always awaited);
 *   3. ONE class (.bps-out) starts the CSS exit; the element is removed on its transitionend (a timeout backs that
 *      up). Once per document: in-app navigation, tab switches and bfcache restores never show it again.
 * Reading animations is not animating them: nothing here drives the splash's motion.
 */

export const SPLASH_ID = 'bp-splash';
export const SPLASH_OUT_CLASS = 'bps-out';
/** CSS animations with this prefix are the entrance (splash.html); the blink and the failsafe are not awaited. */
export const ENTRANCE_PREFIX = 'bps-in';
/** ms after navigation start: the splash leaves by then even if photos are still loading (once the screen is painted). */
export const SPLASH_CAP_MS = 2500;
/** ms after navigation start: never earlier than this, whatever the entrance says (it must not just blink). */
export const SPLASH_FLOOR_MS = 450;
/** ms after navigation start: the entrance counts as done where the browser cannot list animations. */
export const SPLASH_FALLBACK_MS = 650;
/** What still counts as loading on the first screen: skeletons and the feed covers waiting for their photo. */
export const SETTLE_SELECTOR = '[aria-busy="true"], .skeleton, [data-state="loading"]';

export type SplashPhase = 'entered' | 'ready' | 'exit' | 'removed';

export interface SplashExitOptions {
  /** resolves once the app's first screen is painted (main.tsx: whenFirstScreenPainted()) */
  painted: Promise<unknown>;
  /** after `painted`: resolves once the first screen has settled; default whenSettled() */
  settled?: (doc: Document, signal: AbortSignal) => Promise<unknown>;
  doc?: Document;
  capMs?: number;
  floorMs?: number;
  fallbackMs?: number;
  /** ms since navigation start (tests inject a clock) */
  now?: () => number;
  /** timing readout for the gallery */
  onPhase?: (phase: SplashPhase, at: number) => void;
}

const running = new WeakMap<Document, Promise<void>>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** The largest time in a computed list like "0.32s, 0.04s" or "120ms", in ms. */
export function longestMs(list: string): number {
  return list.split(',').reduce((max, part) => {
    const v = part.trim();
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) return max;
    return Math.max(max, v.endsWith('ms') ? n : n * 1000);
  }, 0);
}

/** Resolves once the splash's entrance animations have finished (or the fallback time has passed). */
function entranceDone(el: HTMLElement, now: () => number, fallbackMs: number, capMs: number): Promise<void> {
  if (typeof el.getAnimations !== 'function') return sleep(fallbackMs - now());
  const entrance = el.getAnimations({ subtree: true }).filter((a) => {
    const name = (a as Partial<CSSAnimation>).animationName;
    return typeof name === 'string' && name.startsWith(ENTRANCE_PREFIX);
  });
  const finished = Promise.all(entrance.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
  // a hidden tab may hold animations back: never longer than the cap
  return Promise.race([finished, sleep(capMs - now())]);
}

/**
 * Resolves once nothing in the viewport is still loading: no element matching `selector` (skeletons, covers waiting
 * for their photo) and every <img> loaded and decoded. Checked once per frame; `signal` stops it.
 */
export function whenSettled(doc: Document, signal?: AbortSignal, selector: string = SETTLE_SELECTOR): Promise<void> {
  const view = doc.defaultView ?? window;
  return new Promise((resolve) => {
    const visible = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < view.innerHeight && r.left < view.innerWidth;
    };
    const next = (): void => {
      if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(check);
      else setTimeout(check, 16);
    };
    const check = (): void => {
      if (signal?.aborted) return resolve();
      const waiting = Array.from(doc.querySelectorAll(selector)).some(visible);
      const images = Array.from(doc.images).filter(visible);
      if (waiting || images.some((img) => !img.complete)) return next();
      const decoded = images.map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined));
      void Promise.all(decoded).then(() => resolve());
    };
    check();
  });
}

/** Starts the exit; resolves once the element is gone. */
function leave(el: HTMLElement, view: Window): Promise<void> {
  return new Promise((resolve) => {
    let gone = false;
    const done = (): void => {
      if (gone) return;
      gone = true;
      el.remove();
      resolve();
    };
    el.classList.add(SPLASH_OUT_CLASS);
    const style = view.getComputedStyle(el);
    const total = longestMs(style.transitionDuration) + longestMs(style.transitionDelay);
    // motion level "Aus": no transition, so no transitionend would ever come
    if (total === 0) return done();
    el.addEventListener('transitionend', (e) => {
      if (e.target === el && e.propertyName === 'opacity') done();
    });
    setTimeout(done, total + 150);
  });
}

/**
 * Lets the splash leave once its entrance is over and the app is ready (see the file comment). Safe to call more than
 * once: the same promise comes back. Resolves when the element is removed (or at once when there is none).
 */
export function exitSplashWhenReady(opts: SplashExitOptions): Promise<void> {
  const doc = opts.doc ?? document;
  const known = running.get(doc);
  if (known) return known;
  const el = doc.getElementById(SPLASH_ID);
  if (!el) return Promise.resolve();
  const view = doc.defaultView ?? window;
  const now = opts.now ?? (() => view.performance.now());
  const capMs = opts.capMs ?? SPLASH_CAP_MS;
  const phase = (p: SplashPhase): void => {
    try {
      opts.onPhase?.(p, now());
    } catch {
      /* a readout must never break the exit */
    }
  };

  // bfcache: a page restored from memory mid-splash drops it at once
  view.addEventListener('pageshow', (e) => {
    if (e.persisted) el.remove();
  });

  const entered = Promise.all([entranceDone(el, now, opts.fallbackMs ?? SPLASH_FALLBACK_MS, capMs), sleep((opts.floorMs ?? SPLASH_FLOOR_MS) - now())])
    .then(() => phase('entered'));
  const stop = new AbortController();
  const ready = opts.painted
    .catch(() => undefined)
    .then(() => Promise.race([(opts.settled ?? whenSettled)(doc, stop.signal), sleep(capMs - now())]))
    .catch(() => undefined)
    .then(() => {
      stop.abort();
      phase('ready');
    });
  const result = Promise.all([entered, ready])
    .then(() => {
      if (!el.isConnected) return undefined;
      phase('exit');
      return leave(el, view);
    })
    // whatever went wrong, the splash must never stay in front of the app
    .catch(() => el.remove())
    .then(() => phase('removed'));
  running.set(doc, result);
  return result;
}

/** Drops the splash at once, without the exit (boot errors: the error text in #root must be visible). */
export function removeSplashNow(doc: Document = document): void {
  doc.getElementById(SPLASH_ID)?.remove();
}
