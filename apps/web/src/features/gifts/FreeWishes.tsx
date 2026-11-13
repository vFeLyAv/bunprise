import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { getFreeWishes } from '../../lib/api/lists'
import type { FreeWish, FreeWishList } from '../../lib/api/lists.types'
import { formatApproxPrice } from '../../lib/format'
import { currentLanguage } from '../../lib/i18n'
import { Button, IconForward, Skeleton, haptic } from '../../ui'
import { listsEnabled } from '../lists/flag'
import { requestOpenWish } from '../wishes/openWish'
import { BUDGET_NO_LIMIT, euros } from './budget'
import { listKeyOfWish } from './sources'
import './gifts.css'

// "Noch frei auf Annas Liste" — the giver's block above the ideas (pilot-decisions §000.7), from get_free_wishes:
// - only the wishes of the list chosen above (the list chips / "aus „…“"), so the block and the deck below
//   speak about the same list; switching the chip switches both;
// - compact: the first FREE_ROWS (server order) with their price, "Alle n" opens the list itself — the deck
//   stays in reach on a phone;
// - it says WHY it is empty: the budget ("Bis 25 € ist … nichts frei" + "Budget egal") or nothing left at all;
//   offline it says so instead of a skeleton that never ends (the query waits paused until the network is back).
// Kept outside gift inference: availability can change this block, never interests or product payloads.
// Never mounted for oneself (the owner never sees what is still free — IdeasSection guards it, and so does this).

/**
 * The place of a wish that matches the chosen list (shared wishes, design §5.6 / WS11): one wish can live in several
 * lists; the filter, the row's navigation and "Alle n" all use THIS place, so a tap never opens another list.
 * Without a match (an older server: only `list`) it is `list`.
 */
export function placeFor(wish: Pick<FreeWish, 'list' | 'lists'>, listKey: string): FreeWishList | null {
  const match = (wish.lists ?? []).find((place) => listKeyOfWish(place) === listKey)
  if (match) return match
  return listKeyOfWish(wish.list) === listKey ? wish.list : null
}

/** rows shown before "Alle n" */
export const FREE_ROWS = 3

export interface FreeWishesProps {
  userId: string
  profileId: string
  /** first name, for the title */
  name: string
  /** the chosen list (GiftListRef key): only its wishes are shown */
  listKey: string
  /** the budget's upper end (cents); BUDGET_NO_LIMIT = no limit */
  maxCents: number
  /** "Budget egal": the budget is why nothing is shown */
  onAnyBudget: () => void
}

export default function FreeWishes(props: FreeWishesProps) {
  if (!listsEnabled() || props.userId === props.profileId) return null
  return <GiverWishes {...props} />
}

function GiverWishes({ userId, profileId, name, listKey, maxCents, onAnyBudget }: FreeWishesProps) {
  const { t } = useTranslation('gifts')
  const navigate = useNavigate()
  const locale = currentLanguage()
  const query = useQuery({
    queryKey: ['free-wishes', userId, profileId, maxCents],
    queryFn: () => getFreeWishes(profileId, maxCents, userId),
    staleTime: 0,
    // another budget: the rows stay until the new answer is there (no skeleton flash, no jump of the deck)
    placeholderData: keepPreviousData,
  })
  const title = t('gifts.free_title', { name })
  // the wishes on the chosen list, each with ITS place there (one wish may live in several lists)
  const wishes = query.data
    ? query.data.ideas.flatMap((wish) => {
        const place = placeFor(wish, listKey)
        return place ? [{ ...wish, place }] : []
      })
    : []
  const shown = wishes.slice(0, FREE_ROWS)
  const budgeted = maxCents < BUDGET_NO_LIMIT

  /** a wish (or, without one, the list) opens on its own screen; a stale screen of another account opens nothing */
  function open(list: FreeWishList, wishId: string | null) {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    if (wishId) requestOpenWish(list.id, wishId)
    if (list.occasion_id) void navigate({ to: '/occasions/$occasionId', params: { occasionId: list.occasion_id } })
    else void navigate({ to: '/lists/$listId', params: { listId: list.id } })
  }

  let body
  if (query.isPending) {
    body =
      query.fetchStatus === 'paused' ? (
        <p className="t-callout text-text-2">{t('gifts.free_offline')}</p>
      ) : (
        <Skeleton height={44} />
      )
  } else if (query.isError) {
    body = (
      <Button variant="ghost" onClick={() => void query.refetch()}>
        {t('gifts.retry')}
      </Button>
    )
  } else if (wishes.length === 0) {
    body = budgeted ? (
      <div className="flex flex-col items-start gap-1">
        <p className="t-callout text-text-2">{t('gifts.free_empty_budget', { name, max: euros(maxCents, locale) })}</p>
        <Button variant="ghost" size="sm" className="-ml-3" onClick={onAnyBudget}>
          {t('gifts.empty_any_budget')}
        </Button>
      </div>
    ) : (
      <p className="t-callout text-text-2">{t('gifts.free_empty', { name })}</p>
    )
  } else {
    body = (
      <ul className="-mx-2 -mb-2 flex flex-col">
        {shown.map((wish) => {
          const price = formatApproxPrice(wish.price_cents, { currency: wish.currency, locale })
          return (
            <li key={wish.wish_id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left tr-colors active:bg-fill"
                onPointerDown={() => haptic('tap')}
                onClick={() => open(wish.place, wish.wish_id)}
              >
                <span className="line-clamp-2 min-w-0 flex-1 t-body text-text [overflow-wrap:anywhere]">{wish.title}</span>
                {price ? <span className="shrink-0 t-subhead tabular-nums text-text-2">{price}</span> : null}
                <IconForward size={16} className="shrink-0 text-text-3" />
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const first = wishes[0]
  return (
    <section className="flex flex-col gap-1 rounded-(--r-card) px-4 py-3.5 glass-panel" aria-label={title} data-free-wishes="">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="min-w-0 t-headline text-text">{title}</h2>
        {first && wishes.length > FREE_ROWS ? (
          <button
            type="button"
            className="hit-expand shrink-0 whitespace-nowrap t-subhead font-semibold text-accent-text"
            onPointerDown={() => haptic('tap')}
            onClick={() => open(first.place, null)}
          >
            {t('gifts.free_all', { count: wishes.length })}
          </button>
        ) : null}
      </div>
      {body}
    </section>
  )
}
