import { DEMO_MODE } from '../../lib/app'
import { AppError, isAppError } from '../../lib/errors'
import { fetchPushKey, getPushSettings, registerPushDevice, unregisterPushDevice, type PushDevice } from '../../lib/api/push'
import { notificationPermission, pushPlatform, readPushMarker, writePushMarker } from './platform'
import { forgetPushOnThisDevice } from './signOut'

// This browser's push subscription (docs/spec/web-push-design.md §3, §5) — a lazy chunk, loaded by the sheet and by
// the start-up check (lib/pwa.ts). Rules:
//   * the browser prompt only after the person pressed OUR button (a user gesture, never on a first visit);
//   * an endpoint is registered for one account only: if the database says it belongs to another account
//     (a shared device), this browser drops it and subscribes afresh — a new endpoint (Codex design review #2);
//   * sign-out drops the subscription in the service worker (lib/query.ts → public/push-sw.js "bunprise:signed-out");
//   * the demo never touches the browser: a fixed fake device, simulated by the MSW server (src/mocks/push.ts).

export type EnableResult = 'on' | 'denied' | 'unavailable' | 'unsupported'

const DEMO_DEVICE = (userId: string): PushDevice => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/demo-${userId}`,
  p256dh: `B${'D'.repeat(86)}`,
  auth: 'ZGVtby1hdXRoLXNlY3JldA',
})

/** base64url without padding (the database and the Worker accept nothing else). */
function base64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The one spelling the database and the Worker accept (Codex code review #1): percent escapes in upper case — the
 * same address for the push service (Microsoft's WNS writes them in lower case).
 */
export function canonicalEndpoint(endpoint: string): string {
  return endpoint.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase())
}

function deviceOf(subscription: PushSubscription): PushDevice {
  return { endpoint: canonicalEndpoint(subscription.endpoint), p256dh: base64Url(subscription.getKey('p256dh')), auth: base64Url(subscription.getKey('auth')) }
}

/** The service worker registration, or null when it does not come within 10 s (dev server, blocked SW). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (DEMO_MODE || pushPlatform() !== 'ready') return null
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** The endpoint this browser would report (the demo: its fake one). */
export async function currentEndpoint(userId: string): Promise<string | null> {
  if (DEMO_MODE) return readPushMarker(userId) ? DEMO_DEVICE(userId).endpoint : null
  const subscription = await currentSubscription()
  return subscription ? canonicalEndpoint(subscription.endpoint) : null
}

function sameKey(subscription: PushSubscription, key: string): boolean {
  const current = subscription.options?.applicationServerKey
  // compare the bytes (a non-canonical last base64 character would differ as text)
  return current ? base64Url(current) === base64Url(keyBytes(key).buffer) : false
}

async function subscribeFresh(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
}

/** Registers the subscription; one fresh retry when the endpoint belongs to another account. */
async function register(reg: ServiceWorkerRegistration, subscription: PushSubscription, key: string, userId: string, lang: string): Promise<void> {
  let current = subscription
  try {
    await registerPushDevice(deviceOf(current), lang, userId)
  } catch (err) {
    if (!isAppError(err, 'conflict')) throw err
    await current.unsubscribe().catch(() => false)
    current = await subscribeFresh(reg, key)
    await registerPushDevice(deviceOf(current), lang, userId)
  }
  writePushMarker({ user: userId, endpoint: canonicalEndpoint(current.endpoint), lang, at: Date.now() })
}

/**
 * "Erlauben" / the device switch on. Call it straight from the tap (the browser prompt needs the gesture).
 * 'denied' = the person said no in the browser prompt; 'unavailable' = push is not set up on the server.
 */
export async function enablePush(userId: string, lang: string): Promise<EnableResult> {
  if (DEMO_MODE) {
    await registerPushDevice(DEMO_DEVICE(userId), lang, userId)
    writePushMarker({ user: userId, endpoint: DEMO_DEVICE(userId).endpoint, lang, at: Date.now() })
    return 'on'
  }
  if (pushPlatform() !== 'ready') return 'unsupported'
  // the prompt first, while the tap still counts as a gesture (Safari is strict about it)
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const [key, reg] = await Promise.all([fetchPushKey().catch(() => null), registration()])
  if (!key || !reg) return 'unavailable'
  let subscription = await reg.pushManager.getSubscription()
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe().catch(() => false)
    subscription = null
  }
  subscription ??= await subscribeFresh(reg, key)
  try {
    await register(reg, subscription, key, userId, lang)
  } catch (err) {
    if (isAppError(err, 'not_found')) return 'unavailable' // the database switch is off
    throw err
  }
  return 'on'
}

/** The device switch off: the database forgets this device, the browser drops the subscription. */
export async function disablePush(userId: string): Promise<void> {
  const marker = readPushMarker(userId)
  const subscription = await currentSubscription().catch(() => null)
  const endpoint = (subscription ? canonicalEndpoint(subscription.endpoint) : null) ?? marker?.endpoint ?? (DEMO_MODE ? DEMO_DEVICE(userId).endpoint : null)
  if (endpoint) await unregisterPushDevice(endpoint, userId)
  writePushMarker(null)
  // the browser drops it, and what it still shows goes too (Codex code review #3)
  await forgetPushOnThisDevice()
}

/**
 * The start-up cleanup (lib/pwa.ts): this browser has a subscription that no account signed in here switched on —
 * after a sign-out (the marker went with the account's storage) or with another account. It is dropped, and what it
 * still shows is closed: nothing of the old account arrives or stays on screen (Codex design review #1).
 */
export async function dropOrphanPush(): Promise<void> {
  await forgetPushOnThisDevice()
}

const DAY = 24 * 60 * 60 * 1000

/**
 * The start-up check (lib/pwa.ts, at most once per app start, only while this device was switched on for this
 * account — the marker): the browser may have replaced the subscription (new endpoint / keys), the language may have
 * changed, the session may be new, the person may have revoked the permission in the browser settings
 * (Codex design review #6). One RPC only when something changed or once a day; nothing without the marker.
 */
export async function syncPushDevice(userId: string, lang: string): Promise<void> {
  const marker = readPushMarker(userId)
  if (!marker || DEMO_MODE || pushPlatform() !== 'ready') return
  if (notificationPermission() !== 'granted') {
    await unregisterPushDevice(marker.endpoint, userId).catch(() => undefined)
    writePushMarker(null)
    return
  }
  const reg = await registration()
  if (!reg) return
  let subscription = await reg.pushManager.getSubscription()
  const stale = !subscription || canonicalEndpoint(subscription.endpoint) !== marker.endpoint || marker.lang !== lang || Date.now() - marker.at > DAY
  if (!stale) return
  const key = await fetchPushKey().catch(() => null)
  if (!key) return
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe().catch(() => false)
    subscription = null
  }
  if (subscription && canonicalEndpoint(subscription.endpoint) === marker.endpoint && marker.lang === lang) {
    // only the daily look: is the device still registered for this session? (a sign-in elsewhere made a new one)
    const settings = await getPushSettings(marker.endpoint, userId)
    if (!settings.available) return
    if (settings.device) {
      writePushMarker({ ...marker, at: Date.now() })
      return
    }
  }
  if (marker.endpoint && marker.endpoint !== (subscription ? canonicalEndpoint(subscription.endpoint) : null)) {
    await unregisterPushDevice(marker.endpoint, userId).catch(() => undefined)
  }
  subscription ??= await subscribeFresh(reg, key)
  try {
    await register(reg, subscription, key, userId, lang)
  } catch (err) {
    if (!(err instanceof AppError)) throw err
    // not_found = switched off on the server; anything else: try again at the next start
  }
}
