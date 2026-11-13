import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { NAMESPACES } from '../lib/i18n'
// jsdom shims (matchMedia, IntersectionObserver) shared with the UI kit; no Web Animations fake here
import '../ui/test-shims-dom'

// Test setup: Testing Library cleanup + i18next with ALL German resources bundled synchronously
// (the app itself loads namespaces lazily — see lib/i18n.ts).

afterEach(cleanup)

// «Ночью маскоты спят» (features/mascot-ui/night.ts): the mascots' clock shows noon in every test, so the suite never
// depends on the hour it runs at (23:00 – 07:00 they would sleep); night tests pin their own time.
beforeEach(() => {
  globalThis.__bunpriseNightClock = () => new Date().setHours(12, 0, 0, 0)
})

const deFiles = import.meta.glob<{ default: Record<string, unknown> }>('../locales/de/*.json', { eager: true })
const de: Record<string, Record<string, unknown>> = {}
for (const [path, mod] of Object.entries(deFiles)) {
  const ns = path.split('/').pop()?.replace('.json', '') ?? ''
  de[ns] = mod.default
}

await i18next.use(initReactI18next).init({
  lng: 'de',
  fallbackLng: 'de',
  resources: { de },
  ns: [...NAMESPACES],
  defaultNS: 'common',
  fallbackNS: [...NAMESPACES],
  interpolation: { escapeValue: false, defaultVariables: { app: 'Bunprise', bunny: 'Pompon', hamster: 'Tapsi' } },
  react: { useSuspense: false },
})

// jsdom does not implement scrollTo (router scroll restoration)
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}
