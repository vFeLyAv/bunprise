import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { MyReservation } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { myReservationsQuery } from '../../lib/queries'
import { Button, IconCheck, IconForward, Skeleton, haptic, useSpring, useTapScale } from '../../ui'
import { MotionLink } from '../shell/MotionLink'

// "Meine Geschenkpläne" (follows-design §2.4, §2.12) — GUEST module (the giver's own reservations; it may
// speak about them). A lazy chunk that loads only when the person opens the collapsed section: my_reservations()
// in memory (never persisted, contract §9.3). Active plans first, then those someone else ended in the last
// 90 days with an honest reason — "Kein Zugriff mehr …" with the advice to talk to mutual friends (followers do
// not know each other, P2). Nothing of this is ever visible to the person the gift is for.

export default function GiftPlans({ userId }: { userId: string }) {
  const { t } = useTranslation('lists')
  void userId // the query is pinned by the account boundary (wiped on every account change)
  const query = useQuery(myReservationsQuery())
  if (query.isPending) {
    return (
      <div aria-busy="true" className="glass-panel lf-plans">
        <span className="sr-only">{t('listGuest.plans.loading')}</span>
        <Skeleton height={44} rounded="lg" />
        <Skeleton height={44} rounded="lg" />
      </div>
    )
  }
  if (query.isError) {
    const error = toAppError(query.error)
    return (
      <div role="alert" className="glass-panel lf-plans">
        <p className="t-subhead text-text">{t('listGuest.plans.failed')}</p>
        {error.code !== 'load_failed' ? <p className="t-footnote text-text-2">{t(error.key, error.params)}</p> : null}
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  const plans = query.data
  const active = plans.filter((plan) => plan.status === 'active')
  const ended = plans.filter((plan) => plan.status !== 'active')
  if (plans.length === 0) {
    return <p className="glass-panel lf-plans t-subhead text-text-2">{t('listGuest.plans.empty')}</p>
  }
  return (
    <ul className="glass-panel lf-plans-list">
      {active.map((plan, index) => (
        <PlanRow key={`a-${plan.wish_id ?? index}-${plan.created_at}`} plan={plan} />
      ))}
      {ended.map((plan, index) => (
        <PlanRow key={`e-${plan.wish_id ?? index}-${plan.created_at}`} plan={plan} />
      ))}
    </ul>
  )
}

function PlanRow({ plan }: { plan: MyReservation }) {
  const { t } = useTranslation('lists')
  const tap = useTapScale(0.98)
  const spring = useSpring('snappy')
  const where = plan.list
    ? plan.list.owner_name
      ? t('listGuest.plans.list_of', { list: plan.list.title ?? '', name: plan.list.owner_name })
      : plan.list.title
    : plan.occasion_title
  const reason = plan.status === 'active' ? null : endedText(plan, t)
  const body = (
    <>
      <span aria-hidden="true" className="lf-plan-mark" data-active={plan.status === 'active' ? '' : undefined}>
        {plan.status === 'active' ? <IconCheck size={14} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate t-headline text-text">{plan.wish_title}</span>
        {where ? <span className="block truncate t-footnote text-text-2">{where}</span> : null}
        {reason ? <span className="mt-1 block t-footnote text-text-2">{reason}</span> : null}
        {plan.status === 'active' ? <span className="sr-only">{t('listGuest.plans.active')}</span> : null}
      </span>
    </>
  )
  // only while the list / occasion is still readable the row leads there (else only the snapshot remains)
  if (plan.status === 'active' && plan.list) {
    return (
      <li>
        <MotionLink to="/lists/$listId" params={{ listId: plan.list.id }} className="lf-plan" whileTap={tap} transition={spring} onPointerDown={() => haptic('tap')}>
          {body}
          <IconForward size={16} className="shrink-0 text-text-3" />
        </MotionLink>
      </li>
    )
  }
  if (plan.status === 'active' && plan.occasion_id) {
    return (
      <li>
        <MotionLink to="/occasions/$occasionId" params={{ occasionId: plan.occasion_id }} className="lf-plan" whileTap={tap} transition={spring} onPointerDown={() => haptic('tap')}>
          {body}
          <IconForward size={16} className="shrink-0 text-text-3" />
        </MotionLink>
      </li>
    )
  }
  return <li className="lf-plan">{body}</li>
}

function endedText(plan: MyReservation, t: (key: string) => string): string {
  switch (plan.end_reason) {
    // shared wishes (20261027200000): the one neutral reason for every reservation no longer on a list I see (Q1)
    case 'unavailable':
      return t('listGuest.plans.unavailable')
    case 'access_ended':
      return t('listGuest.plans.access_ended')
    case 'unfollowed':
      return t('listGuest.plans.unfollowed')
    case 'wish_deleted':
      return t('listGuest.plans.wish_deleted')
    case 'member_left':
      return t('listGuest.plans.member_left')
    case 'member_removed':
      return t('listGuest.plans.member_removed')
    case 'blocked':
      return t('listGuest.plans.blocked')
    default:
      return t('listGuest.plans.ended')
  }
}
