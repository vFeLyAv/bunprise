import { Suspense, lazy, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'
import { QueryClientContext, useQueryClient } from '@tanstack/react-query'
import { qk } from '../../lib/queryKeys'
import { useTranslation } from 'react-i18next'
import type { OccasionInviteInfo } from '../../lib/api/invitations'
import type { OccasionScreen } from '../../lib/api/types'
import { useOnline } from '../auth/shared'
import { listsEnabled } from '../lists/flag'
import { FollowLinkSheetHost, openFollowLinkSheet } from '../people/linkSheetHost'
import { invitesEnabled } from './flag'
import { invitationKeys, useOccasionInviteInfo } from './queries'
import './invitations.css'

// The occasion screen's way into "Freunde einladen" (design §7; since 27.10 both in "Wer kommt", Felix:
// features/occasions/InviteSection.tsx draws the row):
//   host  — always, until the occasion starts (next to "Per Link einladen");
//   guest — only while the host allows it ("Gäste dürfen Freunde einladen").
// The picker itself is a lazy chunk (./InviteFriendsSheet), loaded on the first press (its code is fetched already on
// pointer down). get_occasion_invite_info is asked lazily, after the screen's first paint; nothing at all while the
// flag is off. Nothing here knows about the wish list's private part.

const InviteFriendsSheet = lazy(() => import('./InviteFriendsSheet'))
const preloadSheet = () => void import('./InviteFriendsSheet').catch(() => undefined)

/** The host may invite until the start (an all-day occasion: until its end of day) — before the server answered. */
function beforeCutoff(screen: OccasionScreen, now = Date.now()): boolean {
  const start = Date.parse(screen.occasion.starts_at)
  if (!Number.isFinite(start)) return false
  return screen.occasion.all_day ? start + 24 * 3_600_000 > now : start > now
}

/** What the screen's "Freunde einladen" row needs while this person may invite. */
export interface InviteFriendsControl {
  /** "Freunde einladen" */
  label: string
  /** a guest's row: "Anna erlaubt es Gästen"; null for the host */
  hint: string | null
  /** offline: the picker needs the server */
  disabled: boolean
  /** pointer down: fetch the picker's code early */
  preload: () => void
  /** opens the picker */
  start: () => void
}

export interface InviteFriendsProps {
  screen: OccasionScreen
  userId: string
  /** draws the entry — `null` while this person may not invite (or the feature is off): then the screen shows none */
  children: (control: InviteFriendsControl | null) => ReactNode
}

/** "Freunde einladen" for the occasion screen: the picker sheet plus whatever `children` draws to open it. */
export function InviteFriends({ screen, userId, children }: InviteFriendsProps) {
  if (!invitesEnabled()) return <>{children(null)}</>
  return <Entry screen={screen} userId={userId}>{children}</Entry>
}

function Entry({ screen, userId, children }: InviteFriendsProps) {
  const { t, ready } = useTranslation('invitations')
  const online = useOnline()
  const queryClient = useQueryClient()
  const isHost = screen.viewer.role === 'host'
  const occasionId = screen.occasion.id
  const info = useOccasionInviteInfo(occasionId, userId)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const can = info.data?.can_invite ?? (isHost && beforeCutoff(screen))
  if (!ready || !can) return <>{children(null)}</>
  const hostName = screen.occasion.host.display_name?.trim() || t('invitations.name_fallback')

  function start() {
    setMounted(true)
    setOpen(true)
  }

  /** Somebody may have joined meanwhile ("Wer kommt"): the screen asks the server again when the picker closes. */
  function close() {
    setOpen(false)
    void queryClient.invalidateQueries({ queryKey: qk.occasion(occasionId) })
  }

  const control: InviteFriendsControl = {
    label: t(isHost ? 'invitations.entry.host_button' : 'invitations.entry.guest_row'),
    hint: isHost ? null : t('invitations.entry.guest_row_hint', { host: hostName }),
    disabled: !online,
    preload: preloadSheet,
    start,
  }

  return (
    <>
      {children(control)}
      {mounted ? (
        <Suspense fallback={null}>
          <InviteFriendsSheet open={open} onClose={close} occasionId={occasionId} userId={userId} isHost={isHost} hostName={hostName}
            onShareFollowLink={listsEnabled() ? () => { setOpen(false); openFollowLinkSheet() } : undefined} />
        </Suspense>
      ) : null}
      {mounted && listsEnabled() ? <FollowLinkSheetHost userId={userId} /> : null}
    </>
  )
}

/**
 * "eingeladen von Anna" for the HOST's member list (Р3): profile id → the ready label, only while the database
 * shows it (the inviter is an active guest, nobody of the three blocked). Empty for guests and while the flag is off.
 */
export function useInvitedBy(screen: OccasionScreen, userId: string): ReadonlyMap<string, string> {
  // without the flag nothing is loaded at all (the namespace of the occasion screen is loaded anyway)
  const enabled = invitesEnabled()
  const { t, ready } = useTranslation(enabled ? 'invitations' : 'occasion')
  const isHost = screen.viewer.role === 'host'
  // cache-only (like the request dot): the "Freunde einladen" entry in "Wer kommt" asks get_occasion_invite_info; a screen
  // without a query client (tests of the member list alone) simply shows no label
  const client = useContext(QueryClientContext)
  const key = invitationKeys.info(screen.occasion.id)
  const subscribe = useCallback((onChange: () => void) => client?.getQueryCache().subscribe(onChange) ?? (() => undefined), [client])
  const info = useSyncExternalStore(
    subscribe,
    () => (client && enabled && isHost ? client.getQueryData<OccasionInviteInfo>(key) : undefined),
    () => undefined,
  )
  const map = new Map<string, string>()
  if (!enabled || !isHost || !ready || userId === '') return map
  for (const row of info?.invited_by ?? []) {
    map.set(row.profile_id, t('invitations.entry.invited_by', { name: row.inviter.display_name?.trim() || t('invitations.name_fallback') }))
  }
  return map
}
