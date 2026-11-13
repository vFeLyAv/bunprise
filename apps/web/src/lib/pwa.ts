import { registerSW } from 'virtual:pwa-register'
import { pushEnabled } from '../features/push/flag'
import { notificationPermission, readPushMarker } from '../features/push/platform'
import { currentLanguage, i18n } from './i18n'
import { internalPath } from './navigation'
import { toast } from './toast'

// Service worker registration in `prompt` mode (pilot-decisions §7, performance-plan 2.4):
// a new version never reloads the page by itself — a toast "Neue Version da · Aktualisieren"
// applies it. Registration happens after `load` so the first screen is not competing with it.

const HOUR = 60 * 60 * 1000
const MIN_GAP = 15 * 60 * 1000
let setupStarted = false

/** Poll for updates hourly and when the app comes back to the foreground (iPhone PWAs live for days). */
export function startUpdatePolling(registration: ServiceWorkerRegistration): void {
  let last = Date.now()
  const check = () => {
    if (!navigator.onLine) return
    last = Date.now()
    registration.update().catch(() => {})
  }
  setInterval(check, HOUR)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last > MIN_GAP) check()
  })
}

/**
 * Web Push (docs/spec/web-push-design.md §8): a tapped notification focuses this window and the service worker
 * (public/push-sw.js) asks for the app path — Start, where the invitation card is. Only internal paths.
 */
export function listenForNotificationTaps(): void {
  if (typeof navigator.serviceWorker?.addEventListener !== 'function') return
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; path?: unknown } | null
    if (!data || data.type !== 'bunprise:open') return
    const path = internalPath(typeof data.path === 'string' ? data.path : null)
    // the router is part of the shell already: this import only reaches the loaded module
    if (path) void import('../router').then(({ router }) => router.history.push(path))
  })
}

/**
 * Once per app start (features/push/device.ts). A push subscription can exist only after the browser's permission:
 * without it nothing is loaded. With it: this device was switched on for the signed-in account (the marker) → check
 * it is still registered; otherwise the subscription belongs to nobody here any more — a sign-out (the marker went
 * with the account's storage) or another account — and is dropped, with what it still shows. Sign-out reloads the
 * app, so this runs seconds later; the server stops at once anyway (a device lives only with its auth session).
 */
async function syncPushOnStart(): Promise<void> {
  const { localAccountId } = await import('./query')
  const userId = localAccountId()
  const marked = userId !== null && readPushMarker(userId) !== null
  if (marked && userId && pushEnabled()) {
    const { syncPushDevice } = await import('../features/push/device')
    await syncPushDevice(userId, currentLanguage())
    return
  }
  // nobody here switched it on (or the feature is off again): drop what the browser may still hold (Codex code review #2)
  if (notificationPermission() !== 'granted') return
  const { forgetPushOnThisDevice } = await import('../features/push/signOut')
  await forgetPushOnThisDevice()
}

export function setupPwaUpdates(): void {
  if (setupStarted || import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  setupStarted = true
  listenForNotificationTaps()
  const register = () => {
    const updateSW = registerSW({
      onNeedRefresh() {
        toast.info(i18n.t('common.update_available'), {
          actionLabel: i18n.t('common.update_now'),
          onAction: () => void updateSW(true),
          duration: 10 * 60 * 1000,
        })
      },
      onRegisteredSW(_url, registration) {
        if (registration) startUpdatePolling(registration)
        void syncPushOnStart().catch(() => undefined)
      },
    })
  }
  // The lazy update chunk can finish after load has already fired.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
