import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import * as m from 'motion/react-m'
import { captureEpoch } from '../../lib/accountBoundary'
import { acceptInvite } from '../../lib/api/invites'
import { getMe } from '../../lib/api/profile'
import type { FeedScreen, Me } from '../../lib/api/types'
import { toAppError, type AppError, type ErrorCode } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { dropCodeFromAddress, putCodeInAddress } from '../../lib/linkAddress'
import { meQuery } from '../../lib/queries'
import { qk } from '../../lib/queryKeys'
import { getLocalSession } from '../../lib/supabase'
import { Button, Card, IconCalendar, IconCheck, IconLock, IconLogout, LargeTitle, Page, Skeleton, fade, useSpring } from '../../ui'
import { AuthError, useOnline } from '../auth/shared'
import { Mascot, type MascotHandle } from '../mascot-ui/Mascot'
import { MotionScope } from '../../motion/MotionScope'
import { consumePendingInvite, setPendingInvite } from './pending'

// The signed-in part of S10 /i — a lazy chunk, loaded only when this device has a session.
// 1. Fresh server state decides (stricter than the _authed guard's 60 s window, lib/consentGate.ts): no usable session →
//    the impersonal landing; name or current legal records missing → /welcome/profile?next=/i
//    (the token stays in the tab).
// 2. An explicit "Beitreten" (pilot-decisions §0.15, legal L12) that says what the members will
//    see. Opening the link never joins. accept_invite is server-confirmed, never optimistic: the
//    button waits for the answer; then the feed is refreshed, the occasion screen (chunk + data)
//    preloads while the bunny jumps (performance-plan 6.2), and the app moves on to it.
// Errors: invite_invalid → the same message as a missing link; consent_required /
// profile_incomplete → profile; a lost session → landing; anything else → inline, the link stays.
// Account boundary: the screen names ONE account (captured with the fresh get_me). "Beitreten" joins
// for exactly that account (acceptInvite's expected id: another current account → nothing is sent),
// and an answer after that account ended in this tab does nothing — not even keep the link.

export interface JoinGateProps {
  /** No usable session on this device: show the impersonal landing (create account / sign in). */
  onSignedOut: () => void
  /** The link is unknown, expired, revoked or used up: show the one "invalid link" message. */
  onInvalid: () => void
}

type Gate = { kind: 'signed-out' } | { kind: 'incomplete' } | { kind: 'ready'; me: Me; userId: string }

/** not_allowed = an account deleted while its token is still valid (require_user, §0.6). */
const SESSION_LOST: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['not_authenticated', 'session_expired', 'not_allowed'])

async function checkGate(queryClient: QueryClient): Promise<Gate> {
  const session = await getLocalSession()
  if (!session) return { kind: 'signed-out' }
  const userId = session.user.id
  // never a cached profile (the _authed guard may use a 60 s old answer, this screen does not): the
  // name it shows becomes visible to the members. Pinned to the session's account (a profile of
  // another account is refused by getMe)
  const me = await queryClient.fetchQuery({
    ...meQuery(), queryFn: () => getMe(userId), staleTime: 0, retry: false, networkMode: 'always',
  })
  return me.consents_ok && me.profile.display_name?.trim() ? { kind: 'ready', me, userId } : { kind: 'incomplete' }
}

/** The join step animates inside its own <MotionScope>: the invite landing around it has none (its budget). */
export default function JoinGate(props: JoinGateProps) {
  return (
    <MotionScope>
      <JoinGateInner {...props} />
    </MotionScope>
  )
}

function JoinGateInner({ onSignedOut, onInvalid }: JoinGateProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const gate = useQuery({
    queryKey: ['inviteGate'],
    queryFn: () => checkGate(queryClient),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: false,
  })
  const error = gate.isError ? toAppError(gate.error) : null
  const kind = gate.data?.kind ?? (error && SESSION_LOST.has(error.code) ? 'signed-out' : undefined)

  useEffect(() => {
    if (kind === 'signed-out') onSignedOut()
    else if (kind === 'incomplete') void navigate({ to: '/welcome/profile', search: { next: '/i' }, replace: true })
  }, [kind, navigate, onSignedOut])

  if (gate.data?.kind === 'ready') {
    return <JoinScreen me={gate.data.me} userId={gate.data.userId} onSignedOut={onSignedOut} onInvalid={onInvalid} />
  }
  if (error && kind === undefined) return <GateError error={error} busy={gate.isFetching} onRetry={() => void gate.refetch()} />
  return <JoinSkeleton />
}

function JoinScreen({ me, userId, onSignedOut, onInvalid }: JoinGateProps & { me: Me; userId: string }) {
  const { t } = useTranslation('invite')
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigate = useNavigate()
  const online = useOnline()
  const bunny = useRef<MascotHandle | null>(null)
  const bouncy = useSpring('bouncy')
  const [phase, setPhase] = useState<'idle' | 'joining' | 'joined'>('idle')
  // a member (or the host) who opens the link again: the server only opens the occasion (no second use) — say
  // "Du bist schon dabei!" instead of "Du bist dabei!". Known from this account's own feed in memory; the link
  // itself names no occasion before the answer, so the question cannot be skipped (open item: a peek RPC).
  const [already, setAlready] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const working = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function join() {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    const token = consumePendingInvite()
    dropCodeFromAddress('/i') // used: the address is clean again (add-friends-design §1); a failure puts it back
    if (!token) {
      onInvalid()
      return
    }
    working.current = true
    setError(null)
    setPhase('joining')
    const feed = queryClient.getQueryData<FeedScreen>(qk.feed())
    const mine = new Set([...(feed?.upcoming ?? []), ...(feed?.past ?? [])].map((row) => row.id))
    let occasionId: string
    try {
      occasionId = await acceptInvite(token, userId)
    } catch (err) {
      working.current = false
      // The account named on this screen ended here meanwhile: its link went with its drafts.
      if (!epoch.isCurrent()) return
      const failure = toAppError(err)
      // not joined: the link stays in the tab (and in the address) for the next try — unless the server says it is dead
      if (failure.code !== 'invite_invalid') {
        setPendingInvite(token)
        putCodeInAddress('/i', token)
      }
      if (!mounted.current) return
      if (failure.code === 'invite_invalid') onInvalid()
      else if (failure.code === 'consent_required' || failure.code === 'profile_incomplete') {
        void navigate({ to: '/welcome/profile', search: { next: '/i' }, replace: true })
      } else if (SESSION_LOST.has(failure.code)) onSignedOut()
      else {
        setPhase('idle')
        setError(failure)
      }
      return
    }
    // joined (server-confirmed); working stays true: the screen is done
    if (!epoch.isCurrent()) return
    void queryClient.invalidateQueries({ queryKey: qk.feed() })
    if (!mounted.current) return
    setAlready(mine.has(occasionId))
    setPhase('joined')
    feedback('success')
    void router.preloadRoute({ to: '/occasions/$occasionId', params: { occasionId } }).catch(() => undefined)
    await bunny.current?.play('jump')
    if (mounted.current && epoch.isCurrent()) await navigate({ to: '/occasions/$occasionId', params: { occasionId }, replace: true })
  }

  return (
    <Page className="flex flex-col justify-center gap-6">
      <m.div className="flex flex-col gap-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
        <div className="flex justify-center py-4">
          <Mascot kind="bunny" size="m" ref={bunny} />
        </div>
        <div>
          <LargeTitle className="mb-3">{t('invite.join_title')}</LargeTitle>
          {/* one heading only (blocker 22): the lead is calm body text under the question */}
          <p className="t-body text-text-2">{t('invite.lead')}</p>
        </div>
        <Card>
          <ul className="flex flex-col gap-4">
            <Fact icon={<IconLock size={20} />}>{t('invite.join_visible', { name: me.profile.display_name ?? '' })}</Fact>
            <Fact icon={<IconCalendar size={20} />}>{t('invite.join_after')}</Fact>
            <Fact icon={<IconLogout size={20} />}>{t('invite.join_leave')}</Fact>
          </ul>
        </Card>
        <div className="flex flex-col gap-3">
          <AuthError error={error} />
          {!online ? <p role="status" className="t-footnote text-text-2">{t('errors.offline_action')}</p> : null}
          <Button size="lg" fullWidth disabled={!online} loading={phase === 'joining'} loadingLabel={t('invite.joining')}
            onClick={() => void join()}>
            {phase === 'joined' ? (
              <m.span className="inline-flex items-center gap-2" initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }} transition={{ default: bouncy, opacity: fade }}>
                <IconCheck size={20} />
                {already ? t('invite.already_in') : t('invite.joined')}
              </m.span>
            ) : t('invite.join')}
          </Button>
          <Button size="lg" variant="ghost" fullWidth disabled={phase !== 'idle'} onClick={() => void navigate({ to: '/soon' })}>
            {t('invite.not_now')}
          </Button>
        </div>
        <span role="status" className="sr-only">{phase === 'joined' ? (already ? t('invite.already_in') : t('invite.joined')) : ''}</span>
      </m.div>
    </Page>
  )
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-accent-text">{icon}</span>
      <span className="t-subhead text-text">{children}</span>
    </li>
  )
}

/** Same rhythm as JoinScreen (bunny box, title, card, button), so the content fades in place. */
function JoinSkeleton() {
  const { t } = useTranslation('invite')
  return (
    <Page className="flex flex-col justify-center gap-6">
      <div aria-busy="true" className="flex flex-col gap-6">
        <span role="status" className="sr-only">{t('common.loading')}</span>
        <div className="flex justify-center py-4">
          <div aria-hidden="true" style={{ width: 160, aspectRatio: '400 / 260' }} />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton width="62%" height={36} />
          <Skeleton width="88%" height={22} />
        </div>
        <Skeleton height={168} rounded="lg" />
        <Skeleton height={52} rounded="full" />
      </div>
    </Page>
  )
}

/** get_me failed for another reason than a lost session (offline, server hiccup): calm + retry. */
function GateError({ error, busy, onRetry }: { error: AppError; busy: boolean; onRetry: () => void }) {
  const { t } = useTranslation('invite')
  return (
    <Page className="flex flex-col justify-center">
      <section className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <div role="alert" className="flex flex-col items-center gap-2">
          <h1 className="t-title-2 text-text">{t('errors.load_failed')}</h1>
          <p className="max-w-[32ch] t-body text-text-2">{t(error.key, error.params)}</p>
        </div>
        <Button variant="secondary" className="mt-3" loading={busy} loadingLabel={t('common.loading')} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </section>
    </Page>
  )
}
