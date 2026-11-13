// App-wide constants (pilot-decisions §7). Renaming the app = change APP_NAME here
// (+ the static index.html / manifest, which cannot read TypeScript).

export const APP_NAME = 'Bunprise'

/** package.json version, injected at build time (vite.config.ts `define`). */
export const APP_VERSION: string = __APP_VERSION__

/** Working names (pilot-decisions §7, Felix may change): used as {{bunny}} / {{hamster}} in strings. */
export const BUNNY_NAME = 'Pompon'
export const HAMSTER_NAME = 'Tapsi'

/**
 * Contact address for reports ("Melden": occasions, follower lists, settings) — the work address Felix gave on
 * 24.10, the same as in the Impressum (legal/impressum.pilot-draft.*.md).
 */
export const SUPPORT_EMAIL = 'hello@bunprise.de'

/** Public origin for links we hand out (invite links). Falls back to the current origin. */
export const APP_URL: string =
  (import.meta.env.VITE_APP_URL ?? '').replace(/\/+$/, '') ||
  (typeof window !== 'undefined' ? window.location.origin : '')

/** True in `npm run dev:demo` — Supabase is replaced by in-browser mocks (src/mocks). */
export const DEMO_MODE = import.meta.env.VITE_DEMO === '1'

/** Google sign-in button only after Felix configured the provider (pilot-decisions §5). */
export const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_ENABLED === '1'

/** Enable only after the Apple provider is configured for this web origin. */
export const APPLE_ENABLED = import.meta.env.VITE_APPLE_ENABLED === '1'

/** Turnstile is off in the pilot: empty key = no widget, no third-party script (pilot-decisions §5). */
export const TURNSTILE_SITE_KEY: string | null = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || null

/** Every key we write to localStorage/sessionStorage starts with this prefix (cleared on sign-out). */
export const STORAGE_PREFIX = 'bunprise.'

export const storageKeys = {
  /** chosen UI language (kept on sign-out) */
  lang: 'bunprise.lang',
  /**
   * the motion setting of this device (wave 1, K9; kept on sign-out): JSON {level: 'full'|'reduced'|'off',
   * bunnies, batterySaver} — src/motion/level.ts; the earlier reserved values 'auto'|'reduce'|'full' still read
   */
  reduceMotion: 'bunprise.reduceMotion',
  /** 'auto' | 'reduce' */
  transparency: 'bunprise.transparency',
  /** 'light' | 'dark' — the colour theme chosen on this device (Einstellungen → Darstellung, lib/theme.ts); absent = system */
  theme: 'bunprise.theme',
  /** '1' | '0' — vibration switch (settings) */
  haptics: 'bunprise.haptics',
  /** '1' | '0' — sound switch (settings) */
  sounds: 'bunprise.sounds',
  /** JSON array of coachmark ids already shown */
  hintsSeen: 'bunprise.hintsSeen',
  /** supabase-js session (localStorage) */
  auth: 'bunprise.auth',
  /** persisted TanStack Query cache (allow-listed keys only) */
  queryCache: 'bunprise.query',
  /** Opted-in auth user.id for the offline feed; removed on sign-out/account change. */
  offlineFeed: 'bunprise.offlineFeed',
  /** sessionStorage: invite token kept until the person has signed in */
  pendingInvite: 'bunprise.pendingInvite',
  /** sessionStorage: 18+/terms checkboxes ticked on /login, written to consents after sign-in */
  pendingConsent: 'bunprise.pendingConsent',
  /** sessionStorage: where to go after login (invite landing, deep link) */
  postLoginNext: 'bunprise.postLoginNext',
  /** sessionStorage: reload-once guard for stale lazy chunks after a deploy */
  reloaded: 'bunprise.reloaded',
  /**
   * sessionStorage: "<platform> <version>" when this tab runs as a Telegram Mini App (lib/telegram/detect.ts);
   * kept on sign-out (a device fact, not account data) — no Telegram user data is stored
   */
  telegram: 'bunprise.tg',
  /** sessionStorage: 'light' | 'dark' — Telegram's colour scheme (launch theme / theme_changed); kept like `telegram` */
  telegramScheme: 'bunprise.tgScheme',
} as const

/** Demo sessions and caches must never read or overwrite a real account on this origin. */
export const ACTIVE_STORAGE_PREFIX = DEMO_MODE ? 'bunprise.demo.' : STORAGE_PREFIX
export const AUTH_STORAGE_KEY = DEMO_MODE ? `${ACTIVE_STORAGE_PREFIX}auth` : storageKeys.auth
export const QUERY_CACHE_KEY = DEMO_MODE ? `${ACTIVE_STORAGE_PREFIX}query` : storageKeys.queryCache
export const OFFLINE_FEED_KEY = DEMO_MODE ? `${ACTIVE_STORAGE_PREFIX}offlineFeed` : storageKeys.offlineFeed

/** Device preferences that survive sign-out (pilot-decisions §7). */
export const KEEP_ON_SIGN_OUT: readonly string[] = [storageKeys.lang, storageKeys.reduceMotion, storageKeys.transparency, storageKeys.theme]

/** Field limits — client = database (pilot-decisions §7). */
export const LIMITS = {
  occasionTitle: 80,
  occasionDescription: 500,
  placeText: 200,
  wishTitle: 120,
  wishNote: 500,
  wishUrl: 2048,
  displayName: 40,
} as const
