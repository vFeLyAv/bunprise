// The tab bar's destinations (wave 2, Felix 2026-10-20 evening; supersedes the wave-1 bar Start · Kalender · + ·
// Profil and pilot-decisions G-14 "no tab bar"). Pure: no React, no router — the layout, the tab bar and the
// tests share these rules.
//
//   [ Start · Listen ]  ( + )  [ Ideen · Profil ]
//
// Four top-level screens carry the bar; every other screen under _authed is a "pushed" screen (occasion,
// editors, onboarding, account sub-pages, a list's own page): the bar is hidden there, like on iOS.
// The calendar is no tab any more: it is Start's "Monat" view (/soon?view=month; /calendar redirects there).

export type TabId = 'start' | 'lists' | 'gifts' | 'profile'

export interface TabDef {
  id: TabId
  /** route path (also the link target) */
  to: '/soon' | '/lists' | '/gifts' | '/settings'
  /** i18n key in the `nav` namespace (short labels: they fit four tabs at 320 px, DE and EN) */
  label: 'nav.start' | 'nav.lists' | 'nav.gifts' | 'nav.profile'
}

/** Bar order: Start · Listen · ( + ) · Ideen · Profil — the create button sits in the exact centre. */
export const TABS: readonly TabDef[] = [
  { id: 'start', to: '/soon', label: 'nav.start' },
  { id: 'lists', to: '/lists', label: 'nav.lists' },
  { id: 'gifts', to: '/gifts', label: 'nav.gifts' },
  { id: 'profile', to: '/settings', label: 'nav.profile' },
]

/** The two glass capsules around the "+": two tabs each, so the "+" is the bar's exact centre. */
export const TAB_GROUPS = {
  left: ['start', 'lists'],
  right: ['gifts', 'profile'],
} as const satisfies Record<string, readonly TabId[]>

export type TabGroup = keyof typeof TAB_GROUPS

/** The capsule of each tab and its slot inside it (the selection pill's position). */
export function tabPlace(id: TabId): { group: TabGroup; slot: number } {
  const left = (TAB_GROUPS.left as readonly TabId[]).indexOf(id)
  return left >= 0 ? { group: 'left', slot: left } : { group: 'right', slot: (TAB_GROUPS.right as readonly TabId[]).indexOf(id) }
}

/**
 * Router ids of the top-level screens (file routes under the pathless `_authed` layout). A tab's screen may
 * be a plain file (`lists.tsx` → "/_authed/lists") or an index under a layout (`lists.index.tsx` →
 * "/_authed/lists/"): both count, the list's own page ("/_authed/lists/$listId", "/_authed/lists_/$listId")
 * is a pushed screen.
 */
const ROUTE_TABS: Readonly<Record<string, TabId>> = {
  '/_authed/soon': 'start',
  '/_authed/lists': 'lists',
  '/_authed/lists/': 'lists',
  '/_authed/gifts': 'gifts',
  '/_authed/gifts/': 'gifts',
  '/_authed/settings': 'profile',
}

/** The tab of a top-level route id, else null (pushed screen: no bar). */
export function tabForRouteId(routeId: string | null | undefined): TabId | null {
  return (routeId && ROUTE_TABS[routeId]) || null
}

/** The tab of a pathname ("/soon", "/lists/", …), else null. Exact match: "/settings/export" is pushed. */
export function tabForPath(pathname: string | null | undefined): TabId | null {
  if (!pathname) return null
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return TABS.find((tab) => tab.to === path)?.id ?? null
}

/** Index of a tab in the bar's tab order (left to right, the "+" between index 1 and 2), -1 for none. */
export function tabIndex(id: TabId | null): number {
  return id ? TABS.findIndex((tab) => tab.id === id) : -1
}
