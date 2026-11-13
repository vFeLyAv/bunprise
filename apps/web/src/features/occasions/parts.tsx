import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { AppError } from '../../lib/errors'
import { Button, EmptyState, Page, Skeleton, SkeletonList, TopBar, buttonClass } from '../../ui'
import { usePageTitle } from '../auth/shared'
import { occasionTransitionName } from '../../lib/viewTransition'
import { useGoBack } from './actions'
import { PressLink } from '../shell/MotionLink'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'

// Small pieces shared by the occasion screens (detail + form): states and the transition name.

/** The shared-element name of an occasion: the feed card and the screen's hero carry the same one. */
export { occasionTransitionName }

/** Display names can be missing; never show an empty line. */
export function useDisplayName(): (name: string | null | undefined) => string {
  const { t } = useTranslation('occasion')
  return (name) => (name && name.trim() !== '' ? name : t('occasion.name_fallback'))
}

/** Back to the previous screen, or to the feed when the screen was opened directly. */
export function useBackToFeed(): () => void {
  const router = useRouter()
  return useGoBack(() => {
    void router.navigate({ to: '/soon', replace: true })
  })
}

/** A skeleton text line at the real line height of its type step (the block keeps the text's height). */
function Line({ lh, width, height }: { lh: string; width: string; height: number }) {
  return (
    <span className={`flex ${lh} items-center`}>
      <Skeleton width={width} height={height} />
    </span>
  )
}

/**
 * Skeleton of the occasion screen in the content's own shapes (design-system 2.6): the title block (same
 * transition name as the hero: the feed card glides into it), the hero card, the answer card, the list.
 * It is at least one screen tall: the legal footer starts below the fold and only moves further down
 * when the (taller) content arrives — no visible layout shift (perf audit: CLS 0.068).
 */
export function OccasionSkeleton({ occasionId }: { occasionId?: string }) {
  return (
    <div aria-busy="true" className="flex min-h-[calc(100dvh-var(--topbar-h)-var(--sa-top))] flex-col gap-6 pt-4">
      <div aria-hidden="true" className="flex flex-col items-start gap-3" style={occasionId ? { viewTransitionName: occasionTransitionName(occasionId) } : undefined}>
        <Skeleton width={112} height={32} rounded="full" />
        <Line lh="h-(--lh-display)" width="78%" height={32} />
      </div>
      <div aria-hidden="true" className="glass-panel flex flex-col gap-5 rounded-card p-5">
        <div className="flex items-center gap-4">
          <Skeleton width={68} height={76} rounded="lg" />
          <div className="flex flex-1 flex-col gap-1">
            <Line lh="h-(--lh-headline)" width="62%" height={14} />
            <Line lh="h-(--lh-title-3)" width="28%" height={18} />
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Skeleton width={40} height={40} rounded="full" />
          <div className="flex flex-1 flex-col gap-1">
            <Line lh="h-(--lh-footnote)" width="18%" height={10} />
            <Line lh="h-(--lh-body)" width="52%" height={14} />
          </div>
        </div>
        <div className="flex gap-2 pl-13">
          <Skeleton width={112} height={36} rounded="full" />
          <Skeleton width={104} height={36} rounded="full" />
        </div>
        <div className="flex items-center gap-3 pt-4">
          <Skeleton width={40} height={40} rounded="full" />
          <Line lh="h-(--lh-subhead)" width="44%" height={12} />
        </div>
      </div>
      <div aria-hidden="true" className="glass-panel flex flex-col gap-3 rounded-card p-5">
        <Line lh="h-(--lh-title-3)" width="38%" height={18} />
        <Skeleton height={44} rounded="full" />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Line lh="h-(--lh-title-2)" width="54%" height={20} />
        <div className="glass-panel rounded-lg">
          <SkeletonList rows={3} />
        </div>
      </div>
    </div>
  )
}

/** One friendly page for "not found" and "no access" — the two are never told apart (product S15). */
export function OccasionUnavailable() {
  const { t } = useTranslation('occasion')
  const back = useBackToFeed()
  usePageTitle(t('occasion.title'))
  return (
    <Page topBar={<TopBar back={{ label: t('common.back'), onClick: back }} />}>
      <EmptyState
        mascot={<BunnyMoment kind="lost" minSize={120} maxSize={150} className="h-40 w-48" />}
        title={t('occasion.not_found')}
        text={t('occasion.not_found_hint')}
        action={
          <PressLink to="/soon" replace className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })}>
            {t('common.to_start')}
          </PressLink>
        }
      />
    </Page>
  )
}

/** Inline load error with retry (network, server hiccup); the skeleton returns while it retries. */
export function LoadError({ error, onRetry }: { error: AppError | null; onRetry: () => void }) {
  const { t } = useTranslation('occasion')
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-10">
      <p className="t-headline text-text">{t('errors.load_failed')}</p>
      {error && error.code !== 'load_failed' ? <p className="t-body text-text-2">{t(error.key, error.params)}</p> : null}
      <Button variant="secondary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}
