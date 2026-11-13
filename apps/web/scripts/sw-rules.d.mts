// Types for scripts/sw-rules.mjs (imported by src/test/swCheck.test.ts; the app tsconfig has no allowJs).

export declare const FORBIDDEN_SAMPLE_URLS: readonly string[]
export declare const DENYLIST_SAMPLES: Readonly<Record<string, readonly string[]>>

/** The argument lists of every `registerRoute(` call in a built sw.js. */
export declare function registerRouteCalls(source: string): string[]

export interface ServiceWorkerAnalysis {
  /** empty = the service worker follows the cache rules */
  problems: string[]
  runtimeRoutes: number
  denylist: string[]
}

export declare function analyzeServiceWorker(source: string): ServiceWorkerAnalysis

/** Scripts sw.js may load with importScripts (Web Push listeners only). */
export declare const IMPORTED_SCRIPTS: readonly string[]

/** The literal paths a built sw.js loads with importScripts("…"). */
export declare function importedScripts(source: string): string[]

/** Problems of public/push-sw.js (empty = only the reviewed push / notificationclick listeners). */
export declare function analyzePushWorker(source: string): string[]
