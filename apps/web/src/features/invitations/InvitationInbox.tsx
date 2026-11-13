import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { buildMailto } from '../../lib/api/account'
import { blockPerson } from '../../lib/api/follows'
import { respondOccasionInvite, type MyInvitation } from '../../lib/api/invitations'
import { SUPPORT_EMAIL } from '../../lib/app'
import { toAppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { formatDate, formatDateTime } from '../../lib/time'
import { toast } from '../../lib/toast'
import { Avatar, Button, Card, Skeleton, fade, haptic, useReducedMotionPref, useSpring } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { PushHint } from '../push/PushHint'
import { inboxQuery, invitationKeys, setInviteCount } from './queries'
import './invitations.css'

// The invitee's side of "Freunde einladen" (design §3.1, §7): a card above the occasions on Start —
// "Anna lädt dich ein · „Grillabend“ · Sa., 14. Nov., 18:00 · gilt bis 2. Nov." — several as a stack. A tap opens the
// sheet: what the occasion is (title, day and time, the host's NAME), what joining shares, [Beitreten] (waits for the
// server, then the occasion opens) and [Ablehnen] (optimistic: the card slides away at once; silent — the inviter
// never learns it). "Ablehnen und blockieren" and "Melden" sit under them.
// A lazy chunk: Start mounts it only while get_me counts visible invitations (features/invitations/dot.ts). The list
// lives in memory only. Nothing here is about the occasion's place, guests or list: the invitee sees those only
// after joining (the database does not send them before).

export interface InvitationInboxProps {
  userId: string
  /** get_me's count (the dot): the list is asked only while it is above 0 */
  count: number
}

export default function InvitationInbox({ userId, count }: InvitationInboxProps) {
  const { t, ready } = useTranslation('invitations')
  const queryClient = useQueryClient()
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const query = useQuery({ ...inboxQuery(userId), enabled: count > 0 })
  const [openId, setOpenId] = useState<string | null>(null)
  // the invitation in the sheet stays while the sheet slides out (its text must not change mid-animation)
  const [shown, setShown] = useState<MyInvitation | null>(null)
  const items = query.data ?? []
  const first = items[0]

  if (!ready || count === 0) return null
  if (!query.data) {
    // the first answer is on its way: one calm placeholder card, never a spinner
    return query.isError ? null : (
      <div aria-hidden="true" className="inv-card-skeleton">
        <Skeleton height={92} rounded="lg" className="rounded-[22px]" />
      </div>
    )
  }

  function open(invitation: MyInvitation) {
    setShown(invitation)
    setOpenId(invitation.id)
  }

  /** The answered invitation leaves the cache (and the dot) at once; the server's get_me follows. */
  function forget(id: string) {
    const left = (queryClient.getQueryData<MyInvitation[]>(invitationKeys.inbox(userId)) ?? []).filter((x) => x.id !== id)
    queryClient.setQueryData(invitationKeys.inbox(userId), left)
    setInviteCount(queryClient, userId, left.length)
  }

  function restore(invitation: MyInvitation) {
    const now = queryClient.getQueryData<MyInvitation[]>(invitationKeys.inbox(userId)) ?? []
    if (now.some((x) => x.id === invitation.id)) return
    const back = [...now, invitation].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id.localeCompare(b.id)))
    queryClient.setQueryData(invitationKeys.inbox(userId), back)
    setInviteCount(queryClient, userId, back.length)
  }

  return (
    <section aria-label={t('invitations.card.section_label', { count: items.length })} className="inv-inbox">
      <AnimatePresence initial={false} mode="popLayout">
        {first ? (
          <m.div
            key={first.id}
            className="inv-stack"
            data-count={Math.min(items.length, 3)}
            layout="position"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -60, scale: 0.96 }}
            transition={{ default: smooth, opacity: fade }}
          >
            <InvitationCard invitation={first} more={items.length - 1} onOpen={() => open(first)} />
          </m.div>
        ) : null}
      </AnimatePresence>
      {/* Web Push: the contextual question under the card (features/push/PushHint.tsx; behind VITE_PUSH, once per device) */}
      {first ? <PushHint userId={userId} /> : null}
      <InvitationSheet
        invitation={shown}
        open={openId !== null}
        userId={userId}
        onClose={() => setOpenId(null)}
        onAnswered={(invitation) => forget(invitation.id)}
        onUndo={restore}
      />
    </section>
  )
}

function whenOf(invitation: MyInvitation): string {
  return formatDateTime(invitation.occasion.starts_at, { timeZone: invitation.occasion.tz, allDay: invitation.occasion.all_day })
}

/** A little envelope on the inviter's avatar (decorative). */
function GlyphEnvelope() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  )
}

function InvitationCard({ invitation, more, onOpen }: { invitation: MyInvitation; more: number; onOpen: () => void }) {
  const { t } = useTranslation('invitations')
  const titleId = useId()
  const name = invitation.inviter.display_name?.trim() || t('invitations.name_fallback')
  const title = t('invitations.card.title', { name })
  const when = t('invitations.card.when', { title: invitation.occasion.title, date: whenOf(invitation) })
  const until = t('invitations.card.valid_until', { date: formatDate(invitation.expires_at) })
  return (
    // the whole card is ONE control (a button, ≥ 44 px) that names everything it shows
    <Card hero padding="none" className="inv-card" aria-label={`${title}. ${when}. ${until}`} onPress={onOpen}>
      <span className="inv-card-row">
        <span className="inv-card-face">
          <Avatar name={name} seed={invitation.inviter.id} size={40}>
            <AvatarPhoto profileId={invitation.inviter.id} meta={invitation.inviter.photo ?? null} />
          </Avatar>
          <span className="inv-card-envelope"><GlyphEnvelope /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span id={titleId} className="block t-headline text-text">{title}</span>
          <span className="block t-subhead text-text-2 inv-clamp">{when}</span>
          <span className="mt-0.5 block t-footnote text-text-3">
            {until}
            {more > 0 ? ` · ${t('invitations.card.more', { count: more })}` : ''}
          </span>
        </span>
        <span aria-hidden="true" className="inv-card-chevron">›</span>
      </span>
    </Card>
  )
}

interface InvitationSheetProps {
  invitation: MyInvitation | null
  open: boolean
  userId: string
  onClose: () => void
  /** the invitation is answered (or gone): it leaves the list */
  onAnswered: (invitation: MyInvitation) => void
  /** a decline that did not reach the server: the card comes back */
  onUndo: (invitation: MyInvitation) => void
}

function InvitationSheet({ invitation, open, userId, onClose, onAnswered, onUndo }: InvitationSheetProps) {
  const { t } = useTranslation('invitations')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnline()
  const [joining, setJoining] = useState(false)
  // "Ablehnen und blockieren" asks once more (blocking is a strong step, like everywhere else in the app)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const working = useRef(false)
  if (!invitation) return null
  const inviter = invitation.inviter.display_name?.trim() || t('invitations.name_fallback')
  const host = invitation.host_name?.trim() || t('invitations.name_fallback')
  const me = queryClient.getQueryData<{ profile: { id: string; display_name: string | null } }>(qk.me())
  const myName = me?.profile.id === userId ? me.profile.display_name?.trim() || '' : ''
  const report = SUPPORT_EMAIL.includes('@')
    ? buildMailto(SUPPORT_EMAIL, t('invitations.sheet.report_mail_subject', { id: invitation.id }), t('invitations.sheet.report_mail_body'))
    : null

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: qk.me(), exact: true })
    void queryClient.invalidateQueries({ queryKey: invitationKeys.inbox(userId) })
  }

  async function join() {
    if (!invitation || working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    working.current = true
    setJoining(true)
    try {
      const joined = await respondOccasionInvite(invitation.id, true, userId)
      if (!epoch.isCurrent()) return
      haptic('success')
      onAnswered(invitation)
      onClose()
      void queryClient.invalidateQueries({ queryKey: qk.feed() })
      refresh()
      if (joined) await navigate({ to: '/occasions/$occasionId', params: { occasionId: joined.occasion_id } })
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      if (error.code === 'consent_required' || error.code === 'profile_incomplete') {
        onClose()
        void navigate({ to: '/welcome/profile', search: { next: '/soon' } })
      } else if (error.code === 'invite_invalid') {
        onAnswered(invitation)
        onClose()
        toast.error(t('invitations.sheet.gone'))
        refresh()
      } else {
        toast.error(t(error.key, error.params))
      }
    } finally {
      working.current = false
      setJoining(false)
    }
  }

  /** Silent and optimistic: the card goes at once; it comes back only if the server never got the answer. */
  async function decline(alsoBlock: boolean) {
    if (!invitation || working.current) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const target = invitation
    working.current = true
    onAnswered(target)
    onClose()
    try {
      await respondOccasionInvite(target.id, false, userId).catch((err: unknown) => {
        // gone already (withdrawn, expired …): nothing to undo
        if (toAppError(err).code !== 'invite_invalid') throw err
      })
      if (alsoBlock) await blockPerson(target.inviter.id, userId)
      if (!epoch.isCurrent()) return
      toast.success(alsoBlock ? t('invitations.sheet.declined_blocked', { name: inviter }) : t('invitations.sheet.declined'))
      refresh()
    } catch (err) {
      if (!epoch.isCurrent()) return
      onUndo(target)
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
    } finally {
      working.current = false
    }
  }

  const footer = (
    <div className="flex flex-col gap-2">
      <Button size="lg" fullWidth disabled={!online} loading={joining} loadingLabel={t('invitations.sheet.joining')} onClick={() => void join()}>
        {t('invitations.sheet.join')}
      </Button>
      <Button size="lg" fullWidth variant="secondary" disabled={joining} onClick={() => void decline(false)}>
        {t('invitations.sheet.decline')}
      </Button>
      <div className="flex flex-wrap items-center justify-center gap-x-4">
        <Button size="sm" variant="ghost" className="text-danger" disabled={joining || !online} onClick={() => { onClose(); setConfirmBlock(true) }}>
          {t('invitations.sheet.decline_block')}
        </Button>
        {report ? (
          <a href={report} className="inv-report t-subhead text-text-2">{t('invitations.sheet.report')}</a>
        ) : null}
      </div>
      <p className="text-center t-footnote text-text-3">{t('invitations.sheet.silent', { name: inviter })}</p>
    </div>
  )

  return (
    <>
    <Confirm
      open={confirmBlock}
      destructive
      title={t('invitations.sheet.block_title', { name: inviter })}
      message={t('invitations.sheet.block_message', { name: inviter })}
      confirmLabel={t('invitations.sheet.decline_block')}
      cancelLabel={t('common.cancel')}
      onConfirm={() => { setConfirmBlock(false); void decline(true) }}
      onCancel={() => setConfirmBlock(false)}
    />
    <Sheet open={open} onClose={() => (joining ? undefined : onClose())} title={t('invitations.sheet.title', { name: inviter })}
      closeLabel={t('common.close')} footer={footer}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="glass-panel inv-occasion">
          <p className="t-title-3 font-bold text-text">„{invitation.occasion.title}“</p>
          <p className="mt-1 t-subhead text-text-2">{whenOf(invitation)}</p>
          <p className="mt-1 t-subhead text-text-2">{t('invitations.sheet.host', { name: host })}</p>
        </div>
        <p className="t-body text-text">
          {t('invitations.sheet.privacy', { host, me: myName || t('invitations.sheet.your_name') })}
          {invitation.from_host ? '' : ` ${t('invitations.sheet.privacy_inviter', { host, inviter })}`}
        </p>
        <p className="t-subhead text-text-2">{t('invitations.sheet.after')}</p>
      </div>
    </Sheet>
    </>
  )
}
