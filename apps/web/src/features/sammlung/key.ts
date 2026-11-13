import { DEMO_MODE } from '../../lib/app'

// Where «Pompons Sammlung» lives: localStorage, one record per account, ONLY on this device (docs/storage-registry.md,
// design §6). Felix 28.10: «если просто выходишь из аккаунта, не надо стирать» — the record survives sign-out and an
// account switch; it goes only with the account (deleteMyAccount, lib/api/account.ts → forgetSammlung).
// Deliberately OUTSIDE the `bunprise.` prefix (like `bunprise-appIcon`): the sign-out clean-up (lib/query.ts
// clearLocalState) removes every `bunprise.` key but the device settings — an exception there would add bytes to the
// first screen (/soon budget). The demo keeps its own namespace and never touches a real record.

export const SAMMLUNG_PREFIX = DEMO_MODE ? 'bunprise-sammlung.demo.' : 'bunprise-sammlung.'

export const sammlungKey = (accountId: string): string => `${SAMMLUNG_PREFIX}${accountId}`

/** The account is gone: its collection goes too (this device; other devices keep an unreadable record). */
export function forgetSammlung(accountId: string): void {
  try {
    window.localStorage.removeItem(sammlungKey(accountId))
  } catch {
    /* storage unavailable: there is nothing stored either */
  }
}
