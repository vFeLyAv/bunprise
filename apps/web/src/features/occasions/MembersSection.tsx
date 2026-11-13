import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { OccasionScreen, OccasionScreenMember, Rsvp } from '../../lib/api/types'
import { Avatar, Button, Card, List, ListRow, ListRowContent, listItemClass, listRowClass } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { listsEnabled } from '../lists/flag'
import { useOnline } from '../auth/shared'
import { useRemoveMember } from './actions'
import { useDisplayName } from './parts'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { useInvitedBy } from '../invitations/OccasionInviteEntry'
import { InviteActions } from './InviteSection'
import type { SaveState } from './saving'

// "Wer kommt" (S7, F6/F7): every member sees who is in and their RSVP; the host is always in.
// Host only: "Entfernen" per guest (confirmation; the server also revokes the active invite link).
// On top of the list, the ways to invite (./InviteSection.tsx, Felix 27.10 — they used to be a card at the top of
// the screen): "Freunde einladen" (host; a guest while allowed) and "Per Link einladen" (host).
// Nothing here knows about reservations — neither data nor words.

const RSVP_LABEL: Record<Rsvp, string> = {
  going: 'occasion.member_going',
  maybe: 'occasion.member_maybe',
  declined: 'occasion.member_declined',
  none: 'occasion.member_none',
}

export function countRsvps(members: readonly OccasionScreenMember[]): Record<Rsvp, number> {
  const counts: Record<Rsvp, number> = { going: 0, maybe: 0, declined: 0, none: 0 }
  for (const member of members) counts[member.role === 'host' ? 'going' : member.rsvp] += 1
  return counts
}

export interface MembersSectionProps {
  screen: OccasionScreen
  userId: string
  /** when the screen data was last written (query.dataUpdatedAt) — the host's invite link */
  updatedAt?: number
  /** optimistic create/edit still on its way: no invite actions yet */
  saveState?: SaveState
  /** opened from the calendar's "Freunde einladen" pill (K10): the invite rows come into view with the focus */
  focusInvite?: boolean
}

export function MembersSection({ screen, userId, updatedAt = 0, saveState, focusInvite = false }: MembersSectionProps) {
  const { t } = useTranslation('occasion')
  const online = useOnline()
  const displayName = useDisplayName()
  const titleId = useId()
  const isHost = screen.viewer.role === 'host'
  const removal = useRemoveMember(screen.occasion.id, userId)
  // the host only: "eingeladen von Anna" (features/invitations; empty for guests and without the flag)
  const invitedBy = useInvitedBy(screen, userId)
  const subtitleOf = (member: OccasionScreenMember): string => {
    const base = member.role === 'host' ? t('occasion.member_host') : t(RSVP_LABEL[member.rsvp])
    const invited = invitedBy.get(member.profile_id)
    return invited === undefined ? base : `${base} · ${invited}`
  }
  // keep the last target while the sheet slides out, so its text does not change mid-animation
  const [target, setTarget] = useState<OccasionScreenMember | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const members = [...screen.members].sort((a, b) => Number(b.role === 'host') - Number(a.role === 'host'))
  const counts = countRsvps(members)
  const summary = [
    t('occasion.going', { count: counts.going }),
    counts.maybe > 0 ? t('occasion.maybe', { count: counts.maybe }) : null,
    counts.declined > 0 ? t('occasion.not_going', { count: counts.declined }) : null,
    counts.none > 0 ? t('occasion.no_reply', { count: counts.none }) : null,
  ].filter((part): part is string => part !== null)
  const targetName = displayName(target?.display_name)

  // the faces of the people who come (host first), overlapping like a little crowd — only by the edge: the next
  // face (with its 2 px ring) must not cover the initials of the one before ("BM" read as "BI" at -10 px)
  const faces = members.filter((member) => member.role === 'host' || member.rsvp === 'going').slice(0, 5)

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="t-title-2 text-text">
            {t('occasion.who_is_coming')}
          </h2>
          <p className="mt-1 t-footnote text-text-2">{summary.join(' · ')}</p>
          {/* the host's moment of a new occasion (it used to be the invite card's): saving … → saved, invite now */}
          {isHost ? (
            <p role="status" className="mt-1 t-footnote font-semibold text-accent-text empty:hidden">
              {saveState === 'saving' ? t('occasion.saving_hint') : saveState === 'created' ? t('occasion.created_hint') : ''}
            </p>
          ) : null}
        </div>
        {faces.length > 1 ? (
          <span aria-hidden="true" className="flex shrink-0 -space-x-1 pb-0.5" data-facepile>
            {faces.map((member) => (
              <Avatar key={member.profile_id} name={displayName(member.display_name)} seed={member.profile_id} ring>
                <AvatarPhoto profileId={member.profile_id} meta={member.photo} />
              </Avatar>
            ))}
          </span>
        ) : null}
      </div>
      <Card padding="none">
        <InviteActions screen={screen} userId={userId} updatedAt={updatedAt} saveState={saveState} focus={focusInvite} />
        <List>
          {members.map((member) => {
            const name = displayName(member.display_name)
            const isMe = member.profile_id === userId
            if (!isMe && listsEnabled()) return <li key={member.profile_id} className={`${listItemClass} flex items-center`}>
              <Link to="/people/$profileId" params={{ profileId: member.profile_id }} className={`${listRowClass({ tall: true, pressable: true })} min-w-0 flex-1`}>
                <ListRowContent leading={<Avatar name={name} seed={member.profile_id}><AvatarPhoto profileId={member.profile_id} meta={member.photo} /></Avatar>} title={name}
                  subtitle={subtitleOf(member)} chevron />
              </Link>
              {isHost && member.role !== 'host' ? <Button variant="ghost" size="sm" className="mr-2 shrink-0" disabled={!online || removal.busy}
                aria-label={t('occasion.remove_guest_label', { name })} onClick={() => { setTarget(member); setConfirmOpen(true) }}>{t('occasion.remove_guest')}</Button> : null}
            </li>
            return (
              <ListRow
                key={member.profile_id}
                leading={<Avatar name={name} seed={member.profile_id}><AvatarPhoto profileId={member.profile_id} meta={member.photo} /></Avatar>}
                title={isMe ? t('occasion.member_you', { name }) : name}
                subtitle={subtitleOf(member)}
                trailing={
                  isHost && member.role !== 'host' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!online || removal.busy}
                      aria-label={t('occasion.remove_guest_label', { name })}
                      onClick={() => {
                        setTarget(member)
                        setConfirmOpen(true)
                      }}
                    >
                      {t('occasion.remove_guest')}
                    </Button>
                  ) : undefined
                }
              />
            )
          })}
        </List>
      </Card>
      {isHost ? (
        <Confirm
          open={confirmOpen}
          destructive
          title={t('occasion.remove_guest_confirm', { name: targetName })}
          message={t('occasion.remove_guest_message', { name: targetName })}
          confirmLabel={t('occasion.remove_guest')}
          cancelLabel={t('common.cancel')}
          loading={removal.busy}
          onConfirm={() => {
            if (!target) return
            void removal.run(target.profile_id, targetName).then((done) => {
              if (done) setConfirmOpen(false)
            })
          }}
          onCancel={() => {
            if (!removal.busy) setConfirmOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}
