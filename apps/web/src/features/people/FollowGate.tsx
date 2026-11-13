import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { requestFollowViaLink } from '../../lib/api/follows'
import type { FollowPeek } from '../../lib/api/follows.types'
import type { Me } from '../../lib/api/types'
import { toAppError, type AppError, type ErrorCode } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { dropCodeFromAddress, putCodeInAddress } from '../../lib/linkAddress'
import { getLocalSession } from '../../lib/supabase'
import { Button, IconCheck, LargeTitle, Page, Skeleton, buttonClass, fade, useSpring } from '../../ui'
import { MotionScope } from '../../motion/MotionScope'
import { AuthError, useOnline } from '../auth/shared'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { AvatarPhoto, BannerPhoto } from '../profilePhotos/PersonPhoto'
import { PressLink } from '../shell/MotionLink'
import { BannerArt, bannerOf } from '../lists/banners'
import { GlyphLeave, GlyphLockSmall, GlyphNameTag } from './glyphs'
import { consumePendingFollow as forgetCode, getPendingFollow, setPendingFollow } from './pendingFollow'
import { followPeekQuery, invalidatePeople, ownMeQuery } from './queries'
import '../lists/lists.css'
import './people.css'

// The signed-in part of /f (W03, like features/invite/JoinGate.tsx) — a lazy chunk, loaded only with a session.
// 1. Fresh server state decides: no usable session → the impersonal landing; name or current legal records
//    missing → /welcome/profile?next=/f (the code stays in the tab).
// 2. A FRESH peek_follow_link (staleTime 0): banner, avatar and name of the link's owner, the three facts, and the
//    explicit "Folgen anfragen" (waits for the server; sent for the account named on THIS screen) / "Nicht jetzt".
//    Opening the link sends nothing by itself. Variants: own link · already following / asked · invalid
//    (errors.invite_invalid — the one answer for every link failure).
// Account boundary: an answer after the screen's account ended in this tab does nothing — it does not even put
// the code back.

/** This view's code has done its job: forget it (only it, never a newer one) and clean the address (add-friends-design §1). */
function consumePendingFollow(code?: string): void {
  if (forgetCode(code) !== null || code === undefined) dropCodeFromAddress('/f')
}

export interface FollowGateProps {
  onSignedOut: () => void
  onInvalid: () => void
}

type Gate = { kind: 'signed-out' } | { kind: 'incomplete' } | { kind: 'ready'; me: Me; userId: string }

/** not_allowed = an account deleted while its token is still valid (require_user). */
const SESSION_LOST: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['not_authenticated', 'session_expired', 'not_allowed'])
const TO_PROFILE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['consent_required', 'profile_incomplete'])

async function checkGate(queryClient: QueryClient): Promise<Gate> {
  const session = await getLocalSession()
  if (!session) return { kind: 'signed-out' }
  const userId = session.user.id
  // never a cached profile: the name this screen shows is the one the link's owner will see
  const me = await queryClient.fetchQuery({ ...ownMeQuery(userId), staleTime: 0, retry: false, networkMode: 'always' })
  return me.consents_ok && me.profile.display_name?.trim() ? { kind: 'ready', me, userId } : { kind: 'incomplete' }
}

/** The gate animates inside its own <MotionScope>: the /f landing around it has none (its budget). */
export default function FollowGate(props: FollowGateProps) {
  return (
    <MotionScope>
      <FollowGateInner {...props} />
    </MotionScope>
  )
}

function FollowGateInner({ onSignedOut, onInvalid }: FollowGateProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const gate = useQuery({
    queryKey: ['followGate'],
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
    else if (kind === 'incomplete') void navigate({ to: '/welcome/profile', search: { next: '/f' }, replace: true })
  }, [kind, navigate, onSignedOut])

  if (gate.data?.kind === 'ready') return <PeekStep me={gate.data.me} userId={gate.data.userId} onSignedOut={onSignedOut} onInvalid={onInvalid} />
  if (error && kind === undefined) return <GateError error={error} busy={gate.isFetching} onRetry={() => void gate.refetch()} />
  return <GateSkeleton />
}

function PeekStep({ me, userId, onSignedOut, onInvalid }: FollowGateProps & { me: Me; userId: string }) {
  const navigate = useNavigate()
  // the code of THIS view (a newer link re-keys the whole page, FollowPage.tsx)
  const [code] = useState(() => getPendingFollow())
  const peek = useQuery({ ...followPeekQuery(code ?? '', userId), enabled: code !== null })
  // (an error of a previous view does not count either: only what was fetched after this mount)
  const error = peek.isError && peek.isFetchedAfterMount ? toAppError(peek.error) : null

  useEffect(() => {
    if (code === null) onInvalid()
  }, [code, onInvalid])
  useEffect(() => {
    if (!error) return
    if (error.code === 'invite_invalid') {
      consumePendingFollow(code ?? undefined) // only this dead link, never a newer one
      onInvalid()
    } else if (TO_PROFILE.has(error.code)) void navigate({ to: '/welcome/profile', search: { next: '/f' }, replace: true })
    else if (SESSION_LOST.has(error.code)) onSignedOut()
  }, [error, code, navigate, onInvalid, onSignedOut])

  // Only an answer fetched for THIS view counts (`isFetchedAfterMount`): a newer link opened in the same tab must
  // never show the person of the previous link, not even for a frame. Keyed by what it shows, so its state starts over.
  if (peek.data && peek.isFetchedAfterMount && code !== null) {
    const { profile, relation } = peek.data
    return (
      <AskStep key={`${profile.id}:${relation.self ? 'self' : relation.i_follow}`} peek={peek.data} code={code} me={me} userId={userId}
        onInvalid={onInvalid} onSignedOut={onSignedOut} />
    )
  }
  if (error && error.code !== 'invite_invalid' && !TO_PROFILE.has(error.code) && !SESSION_LOST.has(error.code)) {
    return <GateError error={error} busy={peek.isFetching} onRetry={() => void peek.refetch()} />
  }
  return <GateSkeleton />
}

type Phase = 'idle' | 'sending' | 'requested' | 'following'

function AskStep({ peek, code, me, userId, onInvalid, onSignedOut }: {
  peek: FollowPeek; code: string; me: Me; userId: string; onInvalid: () => void; onSignedOut: () => void
}) {
  const { t } = useTranslation('people')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnline()
  const bouncy = useSpring('bouncy')
  const owner = peek.profile
  const name = owner.display_name?.trim() || t('people.card.name_fallback')
  const known: Phase = peek.relation.i_follow === 'following' ? 'following' : peek.relation.i_follow === 'requested' ? 'requested' : 'idle'
  const [phase, setPhase] = useState<Phase>(known)
  const [error, setError] = useState<AppError | null>(null)
  const [sentNow, setSentNow] = useState(false)
  const working = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // a link of mine / someone I already follow or asked: nothing to send — the code has done its job
  useEffect(() => {
    if (peek.relation.self || known !== 'idle') consumePendingFollow(code)
  }, [peek.relation.self, known, code])

  async function ask() {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const taken = code
    consumePendingFollow(code)
    working.current = true
    setError(null)
    setPhase('sending')
    try {
      const answer = await requestFollowViaLink(taken, userId)
      if (!epoch.isCurrent()) return
      feedback('success')
      void invalidatePeople(queryClient).catch(() => undefined)
      if (!mounted.current) return
      setSentNow(true)
      setPhase(answer.status === 'following' ? 'following' : 'requested')
    } catch (err) {
      working.current = false
      // the account named on this screen ended here meanwhile: its code went with its drafts
      if (!epoch.isCurrent()) return
      if (!mounted.current) return
      const failure = toAppError(err)
      // not sent: the code stays in the tab (and in the address) for the next try — unless the server says the link is dead
      if (failure.code !== 'invite_invalid' && getPendingFollow() === null) {
        setPendingFollow(taken)
        putCodeInAddress('/f', taken)
      }
      if (failure.code === 'invite_invalid') onInvalid()
      else if (TO_PROFILE.has(failure.code)) void navigate({ to: '/welcome/profile', search: { next: '/f' }, replace: true })
      else if (SESSION_LOST.has(failure.code)) onSignedOut()
      else {
        feedback('error')
        setPhase('idle')
        setError(failure)
      }
    }
  }

  function notNow() {
    consumePendingFollow(code)
    void navigate({ to: '/soon' })
  }

  const hero = (
    <div className="pp-hero">
      <BannerArt banner={bannerOf(owner.banner, owner.id)} className="pp-banner" photo={<BannerPhoto profileId={owner.id} meta={owner.banner_photo} eager />} />
      <div className="pp-id">
        <ProfileAvatar seed={owner.id} name={owner.display_name} size={80} className="pp-avatar">
          <AvatarPhoto profileId={owner.id} meta={owner.photo} eager />
        </ProfileAvatar>
      </div>
    </div>
  )

  if (peek.relation.self) {
    return (
      <Page className="flex flex-col justify-center gap-6">
        <m.div className="flex flex-col gap-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
          {hero}
          <div>
            <LargeTitle className="mb-3">{t('people.gate.own_title')}</LargeTitle>
            <p className="t-body text-text-2">{t('people.gate.own_text')}</p>
          </div>
          <PressLink to="/lists" replace className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })}>
            {t('people.gate.to_lists')}
          </PressLink>
        </m.div>
      </Page>
    )
  }

  if (phase === 'requested' || phase === 'following') {
    const title = phase === 'following'
      ? (sentNow ? t('people.gate.following_now_title', { name }) : t('people.gate.following_title', { name }))
      : t('people.gate.requested_title')
    const text = phase === 'following' ? null : sentNow ? t('people.gate.requested_text', { name }) : t('people.gate.already_requested_text', { name })
    return (
      <Page className="flex flex-col justify-center gap-6">
        <m.div className="flex flex-col gap-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
          {hero}
          <div>
            <p className="pp-name mb-1">{name}</p>
            <h1 className="flex items-center gap-2 t-title-2 text-text">
              <m.span className="inline-flex text-accent-text" initial={sentNow ? { opacity: 0, scale: 0.8 } : false}
                animate={{ opacity: 1, scale: 1 }} transition={{ default: bouncy, opacity: fade }}>
                <IconCheck size={24} />
              </m.span>
              {title}
            </h1>
            {text ? <p className="mt-2 t-body text-text-2">{text}</p> : null}
          </div>
          <span role="status" className="sr-only">{title}</span>
          <div className="flex flex-col gap-3">
            <PressLink to="/people/$profileId" params={{ profileId: owner.id }} replace className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })}>
              {t('people.gate.to_person', { name })}
            </PressLink>
            <PressLink to="/lists" replace className={buttonClass({ variant: 'secondary', size: 'lg', fullWidth: true })}>
              {t('people.gate.to_lists')}
            </PressLink>
          </div>
        </m.div>
      </Page>
    )
  }

  return (
    <Page className="flex flex-col justify-center gap-6">
      <m.div className="flex flex-col gap-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
        {hero}
        <LargeTitle className="mb-0">{t('people.gate.ask_title', { name })}</LargeTitle>
        <div className="glass-panel pp-gate-card">
          <ul className="pp-facts">
            <Fact icon={<GlyphNameTag size={20} />}>{t('people.gate.fact_name', { name, me: me.profile.display_name ?? '' })}</Fact>
            <Fact icon={<GlyphLockSmall size={20} />}>{t('people.gate.fact_consent', { name })}</Fact>
            <Fact icon={<GlyphLeave size={20} />}>{t('people.gate.fact_stop')}</Fact>
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <AuthError error={error} />
          {!online ? <p role="status" className="t-footnote text-text-2">{t('errors.offline_action')}</p> : null}
          <Button size="lg" fullWidth disabled={!online} loading={phase === 'sending'} loadingLabel={t('people.gate.requesting')} onClick={() => void ask()}>
            {t('people.gate.request')}
          </Button>
          <Button size="lg" variant="ghost" fullWidth disabled={phase !== 'idle'} onClick={notNow}>
            {t('people.gate.not_now')}
          </Button>
        </div>
      </m.div>
    </Page>
  )
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="pp-fact">
      {icon}
      <span>{children}</span>
    </li>
  )
}

/** The rhythm of the ask step (banner, name, title, card, buttons): the content fades in place. */
function GateSkeleton() {
  const { t } = useTranslation('people')
  return (
    <Page className="flex flex-col justify-center gap-6">
      <div aria-busy="true" className="flex flex-col gap-6">
        <span role="status" className="sr-only">{t('common.loading')}</span>
        <Skeleton height={112} rounded="lg" />
        <div className="flex flex-col gap-3">
          <Skeleton width="40%" height={22} />
          <Skeleton width="70%" height={36} />
        </div>
        <Skeleton height={168} rounded="lg" />
        <Skeleton height={52} rounded="full" />
      </div>
    </Page>
  )
}

/** get_me / peek failed for another reason than a lost session or a dead link (offline, a server hiccup). */
function GateError({ error, busy, onRetry }: { error: AppError; busy: boolean; onRetry: () => void }) {
  const { t } = useTranslation('people')
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
