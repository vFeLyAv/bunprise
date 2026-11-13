import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import {
  sendOccasionInvites,
  setGuestsCanInvite,
  withdrawOccasionInvite,
  type CandidateState,
  type InviteCandidate,
  type OccasionInviteInfo,
} from '../../lib/api/invitations'
import { toAppError } from '../../lib/errors'
import { formatDate } from '../../lib/time'
import { toast } from '../../lib/toast'
import { Avatar, Button, IconCheck, List, ListRow, Skeleton, Switch, fade, useSpring } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { candidatesQuery, invitationKeys, isFinal, useOccasionInviteInfo } from './queries'
import './invitations.css'

// "Freunde einladen" — the picker (design §2.2, §7). My friends (people I follow and who follow me) who are not in
// the occasion yet, by name: [Einladen] → "Eingeladen · bis 2. Nov." with "Zurückziehen". The state through MY eyes
// only: whether a friend waits, declined, ignored it or never got it (they switched invitations off …) all reads
// "Eingeladen" — the database sends nothing else (the sender's cloak, design §2.5). Inviting and withdrawing are
// optimistic (the row changes at once, rolls back with a toast if the server refuses). The host also switches
// "Gäste dürfen Freunde einladen" here (default off). A lazy chunk of the occasion screen.

export interface InviteFriendsSheetProps {
  open: boolean
  onClose: () => void
  occasionId: string
  userId: string
  isHost: boolean
  /** the host's name (a guest's note: "Ben erlaubt Gästen, …") */
  hostName: string
  /** "Mein Folgen-Link" in the empty state (the entry owns the link sheet's host) */
  onShareFollowLink?: () => void
}

type Override = { state: CandidateState; expires_at: string | null }

export default function InviteFriendsSheet({ open, onClose, occasionId, userId, isHost, hostName, onShareFollowLink }: InviteFriendsSheetProps) {
  const { t, ready } = useTranslation('invitations')
  const queryClient = useQueryClient()
  const online = useOnline()
  const query = useQuery({ ...candidatesQuery(occasionId, userId), enabled: open })
  const info = useOccasionInviteInfo(occasionId, userId, open && isHost)
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const [guestsOverride, setGuestsOverride] = useState<boolean | null>(null)
  const savingGuests = useRef(false)

  const list = (query.data ?? []).map((c): InviteCandidate => ({ ...c, ...overrides[c.profile.id] }))
  const nameOf = (c: InviteCandidate) => c.profile.display_name?.trim() || t('invitations.name_fallback')

  function mark(id: string, next: Override | null, working: boolean) {
    setOverrides((current) => {
      const copy = { ...current }
      if (next) copy[id] = next
      else delete copy[id]
      return copy
    })
    setBusy((current) => {
      const copy = new Set(current)
      if (working) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  /** The server's answer becomes the cached row; the optimistic override goes. */
  function settle(id: string, next: Override) {
    queryClient.setQueryData<InviteCandidate[]>(invitationKeys.candidates(occasionId), (rows) =>
      rows?.map((row) => (row.profile.id === id ? { ...row, ...next } : row)))
    mark(id, null, false)
  }

  function failed(id: string, err: unknown) {
    mark(id, null, false)
    const error = toAppError(err)
    if (error.code === 'limit_reached') toast.error(t('invitations.picker.limit'))
    else if (isFinal(error)) {
      toast.error(t('invitations.picker.unavailable'))
      void queryClient.invalidateQueries({ queryKey: invitationKeys.candidates(occasionId) })
    } else toast.error(t(error.key, error.params))
  }

  async function invite(candidate: InviteCandidate) {
    const id = candidate.profile.id
    if (busy.has(id) || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    mark(id, { state: 'invited', expires_at: null }, true)
    try {
      const [answer] = await sendOccasionInvites(occasionId, [id], userId)
      if (!epoch.isCurrent()) return
      const state: CandidateState = answer?.state === 'withdrawn' ? 'withdrawn' : 'invited'
      settle(id, { state, expires_at: answer?.expires_at ?? null })
    } catch (err) {
      if (epoch.isCurrent()) failed(id, err)
    }
  }

  async function withdraw(candidate: InviteCandidate) {
    const id = candidate.profile.id
    if (busy.has(id) || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    mark(id, { state: 'withdrawn', expires_at: candidate.expires_at }, true)
    try {
      await withdrawOccasionInvite(occasionId, id, userId)
      if (epoch.isCurrent()) settle(id, { state: 'withdrawn', expires_at: candidate.expires_at })
    } catch (err) {
      if (epoch.isCurrent()) failed(id, err)
    }
  }

  const storedGuests = info.data?.guests_can_invite
  const guestsAllowed = guestsOverride ?? storedGuests ?? false

  async function toggleGuests(next: boolean) {
    if (savingGuests.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    savingGuests.current = true
    setGuestsOverride(next) // optimistic: the switch moves at once
    try {
      await setGuestsCanInvite(occasionId, next, userId)
      if (!epoch.isCurrent()) return
      queryClient.setQueryData<OccasionInviteInfo>(invitationKeys.info(occasionId), (current) => (current ? { ...current, guests_can_invite: next } : current))
      setGuestsOverride(null)
    } catch {
      if (!epoch.isCurrent()) return
      setGuestsOverride(null) // rollback to the stored value
      toast.error(t('invitations.picker.guests_failed'))
    } finally {
      savingGuests.current = false
    }
  }

  const footer = (
    <Button size="lg" fullWidth onClick={onClose}>
      {t('invitations.picker.done')}
    </Button>
  )

  let body
  if (!ready || (query.isPending && open)) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex items-center gap-3">
            <Skeleton width={32} height={32} rounded="full" />
            <Skeleton width="45%" height={16} />
          </div>
        ))}
      </div>
    )
  } else if (query.isError) {
    body = <p role="status" className="t-body text-text-2">{isFinal(query.error) ? t('invitations.picker.unavailable') : t('invitations.picker.load_failed')}</p>
  } else if (list.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="t-headline text-text">{t('invitations.picker.empty_title')}</p>
        <p className="t-subhead text-text-2">{t('invitations.picker.empty_text')}</p>
        {onShareFollowLink ? (
          <Button variant="secondary" size="sm" onClick={onShareFollowLink}>{t('invitations.picker.empty_link')}</Button>
        ) : null}
      </div>
    )
  } else {
    body = (
      // a frosted panel under the rows: the sheet's own glass would let the screen behind shine through the names
      <List className="glass-panel inv-list">
        {list.map((candidate) => (
          <ListRow
            key={candidate.profile.id}
            leading={
              <Avatar name={nameOf(candidate)} seed={candidate.profile.id}>
                <AvatarPhoto profileId={candidate.profile.id} meta={candidate.profile.photo ?? null} />
              </Avatar>
            }
            title={nameOf(candidate)}
            subtitle={<RowStateText candidate={candidate} />}
            trailing={
              <RowAction candidate={candidate} name={nameOf(candidate)} busy={busy.has(candidate.profile.id)} online={online}
                onInvite={() => void invite(candidate)} onWithdraw={() => void withdraw(candidate)} />
            }
          />
        ))}
      </List>
    )
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('invitations.picker.title')} closeLabel={t('common.close')} footer={footer}>
      <div className="inv-picker">
        <p className="t-subhead text-text-2">{t('invitations.picker.lead')}</p>
        {!isHost ? <p role="note" className="glass-panel inv-note">{t('invitations.picker.guest_note', { host: hostName })}</p> : null}
        {body}
        <p className="t-footnote text-text-3">{t('invitations.picker.footer')}</p>
        {isHost ? (
          <div className="glass-panel inv-note">
            <Switch checked={guestsAllowed} disabled={!online || storedGuests === undefined} label={t('invitations.picker.guests_switch')}
              description={t('invitations.picker.guests_hint')} onChange={(next) => void toggleGuests(next)} />
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}

/** Under the name: "Eingeladen · bis So., 1. Nov." / "Zurückgezogen" — through MY eyes only (the cloak). */
function RowStateText({ candidate }: { candidate: InviteCandidate }) {
  const { t } = useTranslation('invitations')
  if (candidate.state === 'none') return null
  const until = candidate.expires_at ? formatDate(candidate.expires_at) : null
  return (
    <m.span key={candidate.state} className="inv-row-done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
      {candidate.state === 'invited' ? (
        <>
          <IconCheck size={14} />
          {until ? t('invitations.picker.invited_until', { date: until }) : t('invitations.picker.invited')}
        </>
      ) : t('invitations.picker.withdrawn')}
    </m.span>
  )
}

interface RowActionProps {
  candidate: InviteCandidate
  name: string
  busy: boolean
  online: boolean
  onInvite: () => void
  onWithdraw: () => void
}

/** The row's one action; a new state pops in place (snappy spring + fade, no layout jump). */
function RowAction({ candidate, name, busy, online, onInvite, onWithdraw }: RowActionProps) {
  const { t } = useTranslation('invitations')
  const snappy = useSpring('snappy')
  let content = null
  if (candidate.state === 'none') {
    content = (
      <Button size="sm" variant="secondary" disabled={!online || busy} aria-label={t('invitations.picker.invite_label', { name })} onClick={onInvite}>
        {t('invitations.picker.invite')}
      </Button>
    )
  } else if (candidate.state === 'invited') {
    content = (
      <Button size="sm" variant="ghost" disabled={!online || busy} aria-label={t('invitations.picker.withdraw_label', { name })} onClick={onWithdraw}>
        {t('invitations.picker.withdraw')}
      </Button>
    )
  }
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {content ? (
        <m.span key={candidate.state} className="inline-flex" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }} transition={{ scale: snappy, opacity: fade }}>
          {content}
        </m.span>
      ) : null}
    </AnimatePresence>
  )
}
