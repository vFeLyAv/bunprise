import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { FollowState, SharedOccasion } from '../../lib/api/follows.types'
import { buildMailto } from '../../lib/api/account'
import { SUPPORT_EMAIL } from '../../lib/app'
import { EmptyState, Page, TopBar, buttonClass } from '../../ui'
import { usePageTitle } from '../auth/shared'
import { PressLink } from '../shell/MotionLink'

// Small pieces the people screens share (no data of their own): the way back, the one page for every refusal,
// "vor 2 Tagen", the relation label and the context line of a request (§2.10) — computed from MY data only
// (the shared occasions and my own follow state); where a request came from is never stored anywhere.

/** Back to where the person came from, else to /people. */
export function useBackToPeople(): () => void {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/people', replace: true })
  }
}

/** Whole calendar days between an instant and now (local), never negative. */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 0
  const start = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.max(0, Math.round((start(now) - start(then)) / 86_400_000))
}

/** "heute" · "gestern" · "vor 3 Tagen". */
export function useAgo(): (iso: string) => string {
  const { t } = useTranslation('people')
  return (iso: string) => {
    const days = daysAgo(iso)
    if (days === 0) return t('people.time.today')
    if (days === 1) return t('people.time.yesterday')
    return t('people.time.days', { count: days })
  }
}

/** "Annas Einweihung" or "Annas Einweihung, Bens Grillabend" (at most two, the first ones of the server's order). */
export function sharedTitles(shared: readonly SharedOccasion[]): string {
  return shared.slice(0, 2).map((occasion) => occasion.title).join(', ')
}

export type RequestContext =
  | { kind: 'shared'; text: string }
  | { kind: 'following' | 'requested'; text: string }
  | { kind: 'unknown'; text: string }

/**
 * The first of three that fits (§2.10): a shared occasion → "Du folgst {{name}}" / "Du hast {{name}}
 * angefragt" → highlighted: no shared occasion and no follow of mine — "Kennst du {{name}} persönlich?"
 * (anybody can call themselves "Mama" behind a forwarded link, P7).
 */
export function useRequestContext(): (name: string, shared: readonly SharedOccasion[], iFollow: FollowState) => RequestContext {
  const { t } = useTranslation('people')
  return (name, shared, iFollow) => {
    if (shared.length > 0) return { kind: 'shared', text: t('people.context.shared', { occasions: sharedTitles(shared) }) }
    if (iFollow === 'following') return { kind: 'following', text: t('people.context.following', { name }) }
    if (iFollow === 'requested') return { kind: 'requested', text: t('people.context.requested', { name }) }
    return { kind: 'unknown', text: t('people.context.unknown', { name }) }
  }
}

/** The relation label of a person (never about anybody else's followers): mutual / follows me / does not. */
export function RelationChip({ iFollow, followsMe, self = false }: { iFollow: FollowState; followsMe: FollowState; self?: boolean }) {
  const { t } = useTranslation('people')
  if (self) return <span className="pp-chip">{t('people.card.self')}</span>
  if (iFollow === 'following' && followsMe === 'following') return <span className="pp-chip" data-tone="mutual">{t('people.card.mutual')}</span>
  if (followsMe === 'following') return <span className="pp-chip" data-tone="follows">{t('people.card.follows_you')}</span>
  return <span className="pp-chip">{t('people.card.not_following_you')}</span>
}

/** "Melden": the pilot's mailto (the name is free text and may be an insult) — or the calm placeholder. */
export function useReportHref(profileId: string): string | null {
  const { t } = useTranslation('people')
  return SUPPORT_EMAIL.includes('@')
    ? buildMailto(SUPPORT_EMAIL, t('people.report.mail_subject', { id: profileId }), t('people.report.mail_body'))
    : null
}

/** ONE page for unknown, gone, blocked or not connected (never told apart). */
export function PersonUnavailable() {
  const { t } = useTranslation('people')
  const back = useBackToPeople()
  usePageTitle(t('people.card.title'))
  return (
    <Page topBar={<TopBar back={{ label: t('common.back'), onClick: back }} />}>
      <EmptyState
        title={t('people.card.unavailable_title')}
        text={t('people.card.unavailable_text')}
        action={
          <PressLink to="/people" replace className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })}>
            {t('people.card.to_people')}
          </PressLink>
        }
      />
    </Page>
  )
}
