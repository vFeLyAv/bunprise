import { useSyncExternalStore, type ReactNode } from 'react'
import { isAccountGateClosed, subscribeAccountSwitch } from '../../lib/accountBoundary'

// Account boundary (round-1 review, H2 residual): while the tab moves to another account WITHOUT a
// reload (lib/session.ts, reload-loop guard), the routed screens are not rendered at all. The previous
// account's screens unmount at once — their portals with them — and the next account's screens mount
// fresh once its guard is through. A switch to the same route (A on /soon → B on /soon) would
// otherwise keep A's screen: the router reuses the route element of an unchanged match.
// The page is hidden and inert during the switch as well (lib/accountBoundary.ts), so the moment
// between the switch and this re-render shows nothing either.
// Round 2: the gate is also closed while the page is leaving (full reload on its way): a mounted,
// hidden screen could still re-render and fetch with the next account. The root shell puts the toast
// viewport behind a gate too: unmounted, it drops the previous account's toasts at once instead of
// fading them out (160 ms) over the next account's screen.

function serverSnapshot(): boolean {
  return false
}

export function AccountSwitchGate({ children }: { children: ReactNode }) {
  const closed = useSyncExternalStore(subscribeAccountSwitch, isAccountGateClosed, serverSnapshot)
  return closed ? null : children
}
