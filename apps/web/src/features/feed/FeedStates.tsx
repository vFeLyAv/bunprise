import { useTranslation } from 'react-i18next'
import type { AppError } from '../../lib/errors'
import { Button, Skeleton } from '../../ui'
import '../../styles/feed.css'

/**
 * Loading: card-shaped skeletons with the same padding, radius and line rhythm as FeedCard, so the
 * content crossfades in place (CLS 0, design-system-motion §2.6). Built from the kit's Skeleton
 * blocks — SkeletonList draws 72 px list rows, which would not match the card layout.
 */
export function FeedSkeleton({ cards = 3 }: { cards?: number }) {
  const { t } = useTranslation()
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span role="status" className="sr-only">{t('common.loading')}</span>
      <div aria-hidden="true" className="mb-0.5 flex h-(--lh-title-2) items-center">
        <Skeleton width={112} height={20} />
      </div>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} aria-hidden="true" className="glass-panel flex gap-4 rounded-lg p-4">
          <Skeleton width={56} height={64} rounded="lg" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex h-(--lh-footnote) items-center">
              <Skeleton width="56%" height={11} />
            </div>
            <div className="mt-0.5 flex h-(--lh-title-3) items-center">
              <Skeleton width={index % 2 ? '64%' : '82%'} height={18} />
            </div>
            <div className="mt-1 flex h-(--lh-subhead) items-center">
              <Skeleton width="46%" height={12} />
            </div>
            <div className="mt-3 flex gap-1.5">
              <Skeleton width={92} height={24} rounded="full" />
              <Skeleton width={68} height={24} rounded="full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Start's month view while its chunk (or the feed) loads: the people row and the month card at their real
 * sizes (features/calendar/calendar.css: pills 36 px; card 12 + 44 + 28 + 6 × 66 + 5 × 2 + 8 = 498 px), so the
 * calendar fades in without moving anything. Its own markup: the calendar's stylesheet is in the lazy chunk.
 */
export function MonthSkeleton() {
  const { t } = useTranslation()
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span role="status" className="sr-only">{t('common.loading')}</span>
      <div aria-hidden="true" className="flex h-9 gap-2 overflow-hidden">
        {[52, 64, 82, 76, 70].map((width, index) => (
          <Skeleton key={index} width={width} height={36} rounded="full" className="shrink-0" />
        ))}
      </div>
      <div aria-hidden="true" className="glass-panel flex h-[498px] flex-col gap-3 rounded-card px-4 pt-5">
        <div className="flex items-center justify-between">
          <Skeleton width={150} height={22} />
          <Skeleton width={72} height={22} rounded="full" />
        </div>
        <div className="mt-3 grid grid-cols-7 gap-y-7">
          {Array.from({ length: 35 }, (_, index) => (
            <span key={index} className="flex justify-center">
              <Skeleton width={22} height={14} />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** get_feed failed and nothing is cached: say so calmly and offer a retry (product-pilot §3 "Error"). */
export function FeedError({ error, onRetry }: { error: AppError; onRetry: () => void }) {
  const { t } = useTranslation('feed')
  // A specific reason (no connection, signed out …) when there is one; otherwise a calm reassurance.
  const detail = error.code === 'generic' || error.code === 'load_failed' ? t('feed.error_hint') : t(error.key, error.params)
  return (
    <section className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div role="alert" className="flex flex-col items-center gap-2">
        <h2 className="t-title-2 text-text">{t('errors.load_failed')}</h2>
        <p className="max-w-[32ch] t-body text-text-2">{detail}</p>
      </div>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </section>
  )
}

/** Offline and nothing cached: no endless skeleton; the query resumes by itself when back online. */
export function FeedOffline() {
  const { t } = useTranslation('feed')
  return (
    <section role="status" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <h2 className="t-title-2 text-text">{t('common.offline_short')}</h2>
      <p className="max-w-[32ch] t-body text-text-2">{t('feed.offline_hint')}</p>
    </section>
  )
}
