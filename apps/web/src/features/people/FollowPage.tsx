import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '../../lib/app'
import { hasLocalSession } from '../../lib/supabase'
import { IconLink } from '../../ui/iconLink'
import { Page } from '../../ui/Page'
// the big button look as plain classes, shared with the shell (importing ui/Button would pull motion in)
import { PRIMARY_CTA, SECONDARY_CTA } from '../../ui/ctaClass'
import { listsEnabled } from '../lists/flag'
import { getPendingFollow } from './pendingFollow'

// /f — the component of the follow-link route = part of its initial bundle (like /i, docs/contract.md §10: it must
// stay under the invite landing's budget). Static imports are shell modules only (router, i18n, Page, the link
// icon, the pending code, the local-session flag, the release flag — no Supabase client, no motion, no UI barrel).
// Separate lazy chunks, each loaded only when needed: the bunny over the invitation card, and FollowGate (fresh
// get_me + peek_follow_link + the explicit "Folgen anfragen") — only with a session.
// Before sign-in everything is impersonal: no name, no banner, no RPC at all (follows-design §2.9, A5).
// The flag off (follows-design §00 p. 9): a calm "Bald verfügbar", no request of any kind.

const Bunnies = lazy(() => import('../mascot-ui/WelcomeBunnies'))
const FollowGate = lazy(() => import('./FollowGate'))

/** The bunny's host reaches this far below the card's top edge: its paws rest on the card. */
const CARD_OVERLAP_PX = 16

type View = 'landing' | 'gate' | 'invalid'

function initialView(): View {
  if (!getPendingFollow()) return 'invalid'
  return hasLocalSession() ? 'gate' : 'landing'
}

export function FollowPage() {
  return listsEnabled() ? <FollowEntry /> : <FollowSoon />
}

function FollowEntry() {
  // Another link opened in this tab lands on the same route as a new history entry (beforeLoad stored its code;
  // an address typed by hand has no state and gets a fresh key): start over, so the view matches the newest link.
  // Cleaning the fragment later (lib/linkAddress.ts) keeps the entry's key: the view stays.
  const entry = useLocation({ select: (location) => location.state.__TSR_key ?? location.state.key ?? '' })
  return <FollowView key={entry} />
}

function useDocumentTitle() {
  const { t } = useTranslation('people')
  const title = t('people.gate.title')
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`
  }, [title])
}

function FollowView() {
  const [view, setView] = useState(initialView)
  useDocumentTitle()
  if (view === 'invalid') return <InvalidFollowLink />
  if (view === 'landing') return <Landing />
  // FollowGate shows its own skeleton while it checks the session; until its chunk arrives: nothing
  return (
    <Suspense fallback={null}>
      <FollowGate onSignedOut={() => setView('landing')} onInvalid={() => setView('invalid')} />
    </Suspense>
  )
}

/** Code kept, nobody signed in: who wants to share stays hidden until after the sign-in (no name, no RPC). */
function Landing() {
  const { t } = useTranslation('people')
  const card = useRef<HTMLDivElement>(null)
  return (
    <Page className="flex flex-col justify-center">
      <div className="relative h-44">
        <Suspense fallback={null}>
          <Bunnies
            choreography="peek-once"
            cardRef={card}
            edgeInset={CARD_OVERLAP_PX}
            minSize={120}
            maxSize={170}
            className="pointer-events-none absolute inset-0"
            style={{ bottom: -CARD_OVERLAP_PX }}
          />
        </Suspense>
      </div>
      <div ref={card} className="flex flex-col gap-6 rounded-card bg-surface px-5 pb-6 pt-8 elev-2">
        <div>
          {/* the pilot line "Private Testversion · 18+" is the legal footer's, right under this card */}
          <h1 className="mb-3 t-title-1 text-text [text-wrap:balance]">{t('people.gate.lead')}</h1>
          <p className="t-body text-text-2">{t('people.gate.what_is')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link to="/login" search={{ mode: 'signup', next: '/f' }} className={PRIMARY_CTA}>
            {t('people.gate.create_account')}
          </Link>
          <Link to="/login" search={{ mode: 'signin', next: '/f' }} className={SECONDARY_CTA}>
            {t('people.gate.sign_in')}
          </Link>
        </div>
      </div>
    </Page>
  )
}

/** One message for every unusable link (none in this tab, malformed, unknown, expired, revoked, full, blocked). */
export function InvalidFollowLink() {
  const { t } = useTranslation('people')
  return (
    <Page className="flex flex-col justify-center">
      <section className="flex flex-col items-center gap-3 rounded-card bg-surface px-5 py-8 text-center elev-2">
        <span className="mb-2 grid place-items-center rounded-full bg-fill text-text-2" style={{ width: 72, height: 72 }}>
          <IconLink size={32} />
        </span>
        <div role="alert" className="flex flex-col items-center gap-2">
          <h1 className="t-title-2 text-text">{t('people.gate.invalid_title')}</h1>
          <p className="max-w-[32ch] t-body text-text-2">{t('errors.invite_invalid')}</p>
        </div>
        <div className="mt-3 w-full max-w-xs">
          <Link to="/" className={SECONDARY_CTA}>
            {t('common.to_start')}
          </Link>
        </div>
      </section>
    </Page>
  )
}

/** The flag is off: the link has nowhere to go yet — say so calmly, ask nobody anything. */
function FollowSoon() {
  const { t } = useTranslation('people')
  useDocumentTitle()
  return (
    <Page className="flex flex-col justify-center">
      <section className="flex flex-col items-center gap-3 rounded-card bg-surface px-5 py-8 text-center elev-2">
        <span className="mb-2 grid place-items-center rounded-full bg-fill text-text-2" style={{ width: 72, height: 72 }}>
          <IconLink size={32} />
        </span>
        <h1 className="t-title-2 text-text">{t('people.gate.soon_title')}</h1>
        <p className="max-w-[32ch] t-body text-text-2">{t('people.gate.soon_text')}</p>
        <div className="mt-3 w-full max-w-xs">
          <Link to="/" className={SECONDARY_CTA}>
            {t('common.to_start')}
          </Link>
        </div>
      </section>
    </Page>
  )
}
