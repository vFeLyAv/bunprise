import { useState, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { isPhotoLimitError } from '../../../lib/api/photos'
import type { OccasionScreen } from '../../../lib/api/types'
import { Button, Spinner, cn, type TileTone } from '../../../ui'
import { COVER_ASPECT_RATIO, COVER_FADE_PX, COVER_OVERLAP_PX } from './coverGeometry'
import { useAfterFirstPaint, useObjectUrl, useOccasionPhoto } from './queries'
import { discardPhotoJob, retryPhotoJob, usePhotoJob, type PhotoJob } from './uploads'
import './photo.css'

// The occasion screen's cover (wave 2): what the hero shows behind its title.
//   - the host's own change on its way (./uploads.ts) wins: a new photo shows at once from memory, a removal
//     shows the plain hero at once;
//   - otherwise the screen's meta (occasion.photo): the box is laid out in the first frame (tinted, pulsing),
//     the bytes are asked for after that frame (get_occasion_photo — the documented second RPC of the screen)
//     and fade in; a cover that cannot be loaded stays a calm tint (the layout never jumps);
//   - no photo: null → today's tinted hero (OccasionHero unchanged).

export type HeroCoverState =
  | { state: 'loading' | 'unavailable'; blob: null }
  | { state: 'ready'; blob: Blob }

/** What the hero shows as its cover right now, and the host's job of this occasion (if any). */
export function useHeroCover(screen: OccasionScreen, userId: string | undefined): { cover: HeroCoverState | null; job: PhotoJob | undefined } {
  const occasionId = screen.occasion.id
  const job = usePhotoJob(userId ?? '', occasionId)
  const painted = useAfterFirstPaint()
  const meta = screen.occasion.photo ?? null
  const local = job?.change.kind === 'upload' ? job.change.photo : null
  const removing = job?.change.kind === 'remove'
  const query = useOccasionPhoto(occasionId, local || removing ? null : meta, painted)
  if (local) return { cover: { state: 'ready', blob: local.blob }, job }
  if (removing || !meta) return { cover: null, job }
  if (query.data) return { cover: { state: 'ready', blob: query.data.blob }, job }
  return { cover: { state: query.isError ? 'unavailable' : 'loading', blob: null }, job }
}

export function HeroCover({ cover, tone }: { cover: HeroCoverState; tone: TileTone }) {
  const url = useObjectUrl(cover.blob)
  // the photo shows once it is decoded (onLoad); a new photo starts invisible again
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const style = {
    '--occ-cover-overlap': `${COVER_OVERLAP_PX}px`,
    '--occ-cover-fade': `${COVER_FADE_PX}px`,
    '--occ-cover-ratio': COVER_ASPECT_RATIO,
  } as CSSProperties
  return (
    <div aria-hidden="true" className="occ-cover" data-tint={tone} data-state={cover.state === 'ready' && loadedUrl === url ? 'ready' : cover.state} style={style}>
      {url ? (
        <img
          className="occ-cover-img"
          src={url}
          alt=""
          decoding="async"
          draggable={false}
          data-loaded={loadedUrl === url ? '' : undefined}
          onLoad={() => setLoadedUrl(url)}
        />
      ) : null}
    </div>
  )
}

/** The host's upload on its way: a small pill next to the day ("Foto wird hochgeladen …"). */
export function CoverJobPill({ job }: { job: PhotoJob }) {
  const { t } = useTranslation('occasion')
  if (job.status !== 'queued' && job.status !== 'sending') return null
  const label = job.change.kind === 'upload' ? t('occasion.cover_uploading') : t('occasion.cover_removing')
  return (
    <p role="status" className="glass-panel occ-cover-pill occ-cover-status">
      <Spinner />
      {label}
    </p>
  )
}

/** Offline or not saved: what happened and what to do, under the title. */
export function CoverJobNotice({ job, userId, occasionId }: { job: PhotoJob; userId: string; occasionId: string }) {
  const { t } = useTranslation('occasion')
  const queryClient = useQueryClient()
  if (job.status !== 'offline' && job.status !== 'failed') return null
  const upload = job.change.kind === 'upload'
  let text: string
  if (job.status === 'offline') text = upload ? t('occasion.cover_offline') : t('occasion.cover_remove_offline')
  else if (isPhotoLimitError(job.error)) text = t('occasion.cover_limit')
  else text = upload ? t('occasion.cover_failed') : t('occasion.cover_remove_failed')
  return (
    <div role="status" className={cn('glass-panel occ-cover-notice')}>
      <p className="occ-cover-notice-text">{text}</p>
      <div className="occ-cover-notice-actions">
        {!isPhotoLimitError(job.error) ? (
          <Button size="sm" variant="secondary" onClick={() => void retryPhotoJob(userId, occasionId, queryClient)}>
            {t('occasion.cover_retry')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => discardPhotoJob(userId, occasionId)}>
          {t('occasion.cover_discard')}
        </Button>
      </div>
    </div>
  )
}
