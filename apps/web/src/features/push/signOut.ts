// Web Push leaves this device with the account (docs/spec/web-push-design.md §7 P8; Codex code review #2, #3): what
// the browser still shows is closed and its subscription is dropped. Called on "Abmelden" in Profil (before the
// redirect, features/account/AccountPages.tsx) and at the next app start for a subscription nobody here switched on
// (lib/pwa.ts → device.ts dropOrphanPush) — the latter also when the feature flag is off again. Tiny on purpose (no
// API module): it only talks to the browser. The demo never subscribes, so it does nothing there.
import { DEMO_MODE } from '../../lib/app'

export async function forgetPushOnThisDevice(): Promise<void> {
  if (DEMO_MODE || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return
  // the notifications first: also those of a subscription that is already gone (switched off earlier)
  for (const shown of await registration.getNotifications().catch(() => [])) shown.close()
  const subscription = await registration.pushManager?.getSubscription().catch(() => null)
  if (subscription) await subscription.unsubscribe().catch(() => false)
}
