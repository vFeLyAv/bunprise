import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '../../lib/app'
import { hasLocalSession } from '../../lib/supabase'
import { LargeTitle, Page } from '../../ui/Page'
// the big button look as plain classes, shared with the shell (importing ui/Button would pull motion in)
import { PRIMARY_CTA, SECONDARY_CTA } from '../../ui/ctaClass'
import { getPendingInvite } from './pending'

// S10 /i — the component of the invite route = part of its initial bundle (budget /i ≤ 150 KB gz,
// docs/contract.md §10). Static imports are shell modules only (router, i18n, Page, icons, the
// pending token, the local-session flag — no Supabase client, no motion, no UI barrel).
// Separate lazy chunks, each loaded only when needed:
//   - Bunnies: the welcome stage's 'peek-once' — the bunny climbs over the top edge of the invitation
//     card and stays; the component chunk loads after the text rendered, the package after the first paint;
//   - JoinGate: session + profile check and the explicit "Beitreten" — only with a session.
// Before sign-in everything is impersonal: no host name, no title (no anonymous RPC, G-06).

const Bunnies = lazy(() => import('../mascot-ui/WelcomeBunnies'))
const JoinGate = lazy(() => import('./JoinGate'))
const LostBunny = lazy(() => import('../mascot-ui/BunnyMoment').then((module) => ({ default: module.BunnyMoment })))

/** The bunny's host reaches this far below the card's top edge: its paws rest on the card. */
const CARD_OVERLAP_PX = 16

type View = 'landing' | 'join' | 'invalid'

function initialView(): View {
  if (!getPendingInvite()) return 'invalid'
  return hasLocalSession() ? 'join' : 'landing'
}

export function InvitePage() {
  // Another link opened in this tab lands on the same route as a new history entry (the guard stored
  // its token): start over, so the view matches the newest link. Cleaning the fragment later
  // (lib/linkAddress.ts) keeps the entry's key: the view stays.
  const entry = useLocation({ select: (location) => location.state.__TSR_key ?? location.state.key ?? '' })
  return <InviteView key={entry} />
}

function InviteView() {
  const { t } = useTranslation('invite')
  const [view, setView] = useState(initialView)
  const title = t('invite.title')
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`
  }, [title])

  if (view === 'invalid') return <InvalidInvite />
  if (view === 'landing') return <Landing />
  // JoinGate shows its own skeleton while it checks the session; until its chunk arrives: nothing
  return (
    <Suspense fallback={null}>
      <JoinGate onSignedOut={() => setView('landing')} onInvalid={() => setView('invalid')} />
    </Suspense>
  )
}

/**
 * (b) Token kept, nobody signed in: who invites and to what stays hidden until the person joins.
 * The invitation is a card; the bunny peeks over its top edge (lazy, after the first paint).
 */
function Landing() {
  const { t } = useTranslation('invite')
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
          <div className="mb-4 flex items-center gap-2 t-headline"><img src="/icons/icon.svg" width={32} height={32} alt="" />{APP_NAME}</div>
          <LargeTitle className="mb-3">{t('invite.title')}</LargeTitle>
          <p className="t-title-3 text-text">{t('invite.lead')}</p>
          <p className="mt-2 t-body text-text-2">{t('invite.app_intro')}</p>
          <p className="mt-2 t-body text-text-2">{t('invite.what_is')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link to="/login" search={{ mode: 'signup', next: '/i' }} className={PRIMARY_CTA}>
            {t('invite.create_account')}
          </Link>
          <Link to="/login" search={{ mode: 'signin', next: '/i' }} className={SECONDARY_CTA}>
            {t('invite.sign_in')}
          </Link>
        </div>
      </div>
    </Page>
  )
}

/**
 * (a) One message for every unusable link: none in this tab, malformed, unknown, expired, revoked,
 * used up — the server answers invite_invalid for all of them and so do we (product S15, G-06).
 */
function InvalidInvite() {
  const { t } = useTranslation('invite')
  return (
    <Page className="flex flex-col justify-center">
      <section className="flex flex-col items-center gap-3 rounded-card bg-surface px-5 py-8 text-center elev-2">
        <div className="h-40 w-48"><Suspense fallback={null}><LostBunny kind="lost" minSize={120} maxSize={150} className="h-full w-full" /></Suspense></div>
        <div role="alert" className="flex flex-col items-center gap-2">
          <h1 className="t-title-2 text-text">{t('invite.invalid_title')}</h1>
          <p className="max-w-[32ch] t-body text-text-2">{t('invite.invalid_hint')}</p>
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
