import type { ReactNode, Ref } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { AppError } from '../../lib/errors'
import { Button, EmptyState, Page, Skeleton, TopBar, buttonClass, cn } from '../../ui'
import { usePageTitle } from '../auth/shared'
import { PressLink } from '../shell/MotionLink'
import { CoverTile } from './covers'
import { DateChip } from './OwnerListCard'
import type { DateWords } from './dates'
import type { TileTone } from '../../ui'

// Small pieces both list screens share (no data of their own): the way back, the one page for every refusal,
// the skeleton in the content's shapes and the title block (cover + title + a line of facts).

/** Back to where the person came from, else to the tab. */
export function useBackToLists(): () => void {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/lists', replace: true })
  }
}

/** ONE page for unknown, deleted, "Nur ich", not followed, removed, blocked (§2.7) — never told apart. */
export function ListUnavailable() {
  const { t } = useTranslation('lists')
  const back = useBackToLists()
  usePageTitle(t('lists.screen.title'))
  return (
    <Page topBar={<TopBar back={{ label: t('common.back'), onClick: back }} />}>
      <EmptyState
        title={t('lists.screen.unavailable_title')}
        text={t('lists.screen.unavailable_text')}
        action={
          <PressLink to="/lists" replace className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })}>
            {t('lists.screen.to_lists')}
          </PressLink>
        }
      />
    </Page>
  )
}

/** A transient load error (network): text + retry; final answers never get here. */
export function ListLoadError({ error, onRetry }: { error: AppError | null; onRetry: () => void }) {
  const { t } = useTranslation('lists')
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-10">
      <p className="t-headline text-text">{t('lists.screen.load_failed')}</p>
      {error && error.code !== 'load_failed' ? <p className="t-body text-text-2">{t(error.key, error.params)}</p> : null}
      <Button variant="secondary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}

/** The list screen's skeleton in its own shapes (title block, hint, tiles): nothing jumps when it arrives. */
export function ListSkeleton({ photo = false }: { photo?: boolean }) {
  return (
    <div aria-busy="true" className={cn('flex min-h-[calc(100dvh-var(--topbar-h)-var(--sa-top))] flex-col gap-6 pt-4', photo && 'ls-covered')}>
      <div aria-hidden="true" className="flex flex-col items-start gap-3">
        {photo ? null : <Skeleton width={56} height={56} rounded="lg" />}
        <Skeleton width="72%" height={34} />
        <Skeleton width="42%" height={16} />
      </div>
      <div aria-hidden="true" className="wg-grid">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="wt-skeleton glass-panel">
            <Skeleton width="100%" height="auto" rounded="lg" className="aspect-square" />
            <Skeleton width="78%" height={14} className="mt-2.5" />
            <Skeleton width="46%" height={12} className="mt-1.5" />
          </div>
        ))}
      </div>
    </div>
  )
}

export interface ListTitleBlockProps {
  tone: TileTone
  icon: Parameters<typeof CoverTile>[0]['icon']
  title: string
  /** the facts under the title ("12 Wünsche · Follower") */
  facts: ReactNode
  date: DateWords | null
  /** the long date ("Am Mittwoch, 24. Dezember 2026"), for assistive technology and the line under the facts */
  dateText: string | null
  /** under someone's banner: the cover sits small in the facts line instead of on its own row */
  compact?: boolean
  /** the list has a cover photo above (the header): no symbol tile — the photo is the list's picture */
  photo?: boolean
  /**
   * The row with the symbol tile and the date (the owner's own list, 31.10): Pompon sits on its right end
   * (features/wishes/listPlay.ts). Its free right end stays free — nothing else goes there.
   */
  seatRef?: Ref<HTMLDivElement>
}

/** Cover tile + date chip, the large title, the facts — the rhythm of the occasion screen's top. */
export function ListTitleBlock({ tone, icon, title, facts, date, dateText, compact = false, photo = false, seatRef }: ListTitleBlockProps) {
  return (
    <div className="ls-title-block" data-photo={photo ? '' : undefined}>
      {compact ? null : photo ? (
        date ? <div ref={seatRef} className="flex items-center gap-3"><DateChip words={date} /></div> : null
      ) : (
        <div ref={seatRef} className="flex items-center gap-3">
          <CoverTile tone={tone} icon={icon} size={56} className="ls-cover-tile" />
          {date ? <DateChip words={date} /> : null}
        </div>
      )}
      <h1 className="t-display text-text [overflow-wrap:anywhere]">{title}</h1>
      <div className="ls-facts">
        {compact && !photo ? <CoverTile tone={tone} icon={icon} size={28} /> : null}
        {facts}
        {compact && date ? <DateChip words={date} /> : null}
      </div>
      {dateText ? <p className="t-subhead text-text-2">{dateText}</p> : null}
    </div>
  )
}
