import i18next, { type BackendModule, type ResourceKey } from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { APP_NAME, BUNNY_NAME, HAMSTER_NAME, storageKeys } from './app'
import type { Locale } from './api/types'

// i18n rules (product-pilot.md section 8, performance-plan.md 4.5):
// - every user-facing string lives in src/locales/<lng>/<namespace>.json, DE + EN + RU + UK, never in code
//   (Russian and Ukrainian plurals: key_one / key_few / key_many / key_other; src/test/locales.test.ts checks them);
// - each namespace JSON keeps the spec's key groups as top-level objects, e.g. wishes.json =
//   { wish: {…}, reserve: {…} }. With `fallbackNS` every spec key works verbatim from any
//   namespace: t('wish.add'), t('errors.generic'), t('common.save');
// - namespaces load lazily (one chunk per file); routes call ensureNamespaces() in their loader
//   so the screen never flashes raw keys. `common` + `errors` are loaded before the first render
//   (only the German ones are preloaded with the shell; EN + RU + UK load like any other lazy chunk);
// - language: localStorage 'bunprise.lang' → navigator.languages → 'de' (own 10-line detector,
//   no plugin: every KB of the invite landing counts). A Russian browser ("ru-RU") gets Russian, a Ukrainian
//   one ("uk-UA", "uk") Ukrainian — each language only by its own code, never by a neighbour's.

export const LANGUAGES = ['de', 'en', 'ru', 'uk'] as const
export type Language = (typeof LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'de'

export const NAMESPACES = [
  'common',
  'errors',
  'auth',
  'onboarding',
  'feed',
  'occasion',
  'wishes',
  'invite',
  'settings',
  'legal',
  // tab bar, create menu, calendar tab (features/nav, features/calendar)
  'nav',
  // motion settings: Animationen · Kaninchen zeigen · Bei wenig Akku sparen (src/motion/MotionSettingsSection.tsx)
  'motion',
  // the occasion form: date + time pickers, place sheet (features/occasions/form)
  'occasionForm',
  // "Geschenk finden" / Find Gift (features/gifts, wave 2)
  'gifts',
  // the "Wunschlisten" tab and lists without an occasion (features/lists, wave 2b)
  'lists',
  // people, follow links, the gate /f, blocking, Profil › Privatsphäre (features/people, wave 2b)
  'people',
  // in-app invitations "Freunde einladen" (features/invitations, behind VITE_INVITES; loaded by its lazy parts)
  'invitations',
  // the comic reader «Pompon & Tapsi» (features/comic; loaded with the reader, never precached)
  'comic',
] as const
export type Namespace = (typeof NAMESPACES)[number]

const BOOT_NAMESPACES: Namespace[] = ['common', 'errors']

function isLanguage(value: string | null | undefined): value is Language {
  return (LANGUAGES as readonly string[]).includes(value ?? '')
}

/** localStorage (chosen in settings) → browser languages → default. */
export function detectLanguage(): Language {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(storageKeys.lang)
  } catch {
    /* storage unavailable */
  }
  const browser = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const candidate of [stored, ...browser]) {
    const code = candidate?.toLowerCase().split('-')[0]
    if (isLanguage(code)) return code
  }
  return DEFAULT_LANGUAGE
}

// one chunk per locale file: locales/de/wishes.json → wishes-de-*.js. The shell carries the file → chunk table of
// German (the default) and the boot namespaces (common + errors) of every language; the rest of EN, RU and UK sits in
// a tiny chunk of its own (./i18nOtherLanguages.ts). When the UI is not German, initI18n() starts that chunk together
// with the boot translations, so a screen's namespaces wait for no extra round trip — and the first screen of the
// German majority does not carry 50 chunk names it never uses (/soon budget, 27.10).
type Loaders = Record<string, () => Promise<{ default: ResourceKey }>>
const shellLoaders: Loaders = import.meta.glob<{ default: ResourceKey }>(['../locales/de/*.json', '../locales/*/{common,errors}.json'])

let otherLoaders: Promise<Loaders> | null = null
function otherLanguageLoaders(): Promise<Loaders> {
  otherLoaders ??= import('./i18nOtherLanguages').then(
    (mod) => mod.otherLanguages,
    (err: unknown) => {
      otherLoaders = null // offline or a stale deploy: the next namespace load tries again
      throw err
    },
  )
  return otherLoaders
}

function loaderFor(language: string, namespace: string): Promise<Loaders[string] | undefined> {
  const key = `../locales/${language}/${namespace}.json`
  const own = shellLoaders[key]
  if (own || language === DEFAULT_LANGUAGE) return Promise.resolve(own)
  return otherLanguageLoaders().then((loaders) => loaders[key])
}

const lazyBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    loaderFor(language, namespace).then((load) => {
      if (!load) throw new Error(`No locale resource for ${language}/${namespace}`)
      return load()
    }).then(
      (mod) => callback(null, mod.default),
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), null),
    )
  },
}

export const i18n = i18next

let initPromise: Promise<void> | null = null

/** Initialises i18next once (lazy backend → react). Resolves when common + errors are loaded. */
export function initI18n(): Promise<void> {
  if (!initPromise) {
    const lng = detectLanguage()
    // in parallel with common + errors: the table of the screens' namespaces (see shellLoaders)
    if (lng !== DEFAULT_LANGUAGE) void otherLanguageLoaders().catch(() => undefined)
    initPromise = i18next
      .use(lazyBackend)
      .use(initReactI18next)
      .init({
        lng,
        supportedLngs: [...LANGUAGES],
        fallbackLng: DEFAULT_LANGUAGE,
        load: 'languageOnly',
        ns: BOOT_NAMESPACES,
        defaultNS: 'common',
        fallbackNS: [...NAMESPACES],
        partialBundledLanguages: true,
        interpolation: {
          escapeValue: false, // React escapes
          defaultVariables: { app: APP_NAME, bunny: BUNNY_NAME, hamster: HAMSTER_NAME },
        },
        react: { useSuspense: false },
      })
      .then(() => {
        applyHtmlLang(currentLanguage())
        i18next.on('languageChanged', (lng) => applyHtmlLang(lng))
      })
  }
  return initPromise
}

function applyHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
}

/** Make sure these namespaces are loaded (use in route loaders). */
export function ensureNamespaces(...namespaces: Namespace[]): Promise<void> {
  return i18next.loadNamespaces(namespaces).then(() => undefined)
}

export function currentLanguage(): Language {
  const code = (i18next.resolvedLanguage ?? i18next.language ?? DEFAULT_LANGUAGE).split('-')[0]
  return isLanguage(code) ? code : DEFAULT_LANGUAGE
}

/**
 * The language of server records and archived texts, which exist in DE + EN only: profiles.locale and
 * consents.locale (a CHECK constraint allows 'de' | 'en'), the legal archive (src/legal/*.md), place
 * requests. (Gift-idea requests carry the UI language itself since 30.10: the Worker has de/en/ru/uk texts.) A UI language without its own legal texts (Russian, Ukrainian) reads the German ones — the
 * legal page says so in that language — so its consent records and profile say 'de'.
 */
export function contentLocale(language: Language = currentLanguage()): Locale {
  return language === 'en' ? 'en' : 'de'
}

/** Switches the UI language and remembers it on the device (bunprise.lang, kept on sign-out). */
export function changeLanguage(lng: Language): Promise<void> {
  try {
    window.localStorage.setItem(storageKeys.lang, lng)
  } catch {
    /* storage unavailable */
  }
  return i18next.changeLanguage(lng).then(() => undefined)
}

/**
 * `const t = useT('wishes')` — translation function with the screen's namespace loaded.
 * Keys are the spec keys: t('wish.add'), t('reserve.button'), t('common.save').
 */
export function useT(...namespaces: Namespace[]) {
  const { t } = useTranslation(namespaces.length ? namespaces : ['common'])
  return t
}
