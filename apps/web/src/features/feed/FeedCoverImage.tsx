import { useEffect, useRef, useState, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getOccasionPhoto } from '../../lib/api/photos'
import type { OccasionPhotoMeta } from '../../lib/api/types'
import { markDecoded, wasDecoded } from '../../lib/objectUrl'
import { occasionPhotoQuery, useAfterFirstPaint, useObjectUrl } from '../occasions/photo/queries'
import { inCoverQueue } from './coverQueue'
import './feedCover.css'

type FeedCoverState = 'loading' | 'ready' | 'unavailable'

// The lazy half of a Start card's cover (FeedCover.tsx shows the same box until this chunk is there): after the
// first paint it waits until the card is near the viewport, then loads the bytes through get_occasion_photo — the
// SAME query key per version as the occasion screen's hero (features/occasions/photo/queries.ts), so opening the
// occasion afterwards (or coming back from it) never downloads the cover twice; memory only (the persisted cache is
// the exact ['feed'], which carries the meta only). The download waits for a free slot (coverQueue.ts: two at once).

/** true once the element is near the viewport (±240 px), checked after the first paint. No IntersectionObserver: then. */
function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const painted = useAfterFirstPaint()
  const watches = typeof IntersectionObserver === 'function'
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!painted || !watches || seen || !element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [painted, watches, seen, ref])
  return painted && (seen || !watches)
}

function CoverImage({ occasionId, meta, onState }: { occasionId: string; meta: OccasionPhotoMeta; onState: (state: FeedCoverState) => void }) {
  const query = useQuery({
    ...occasionPhotoQuery(occasionId, meta.updated_at),
    queryFn: () => inCoverQueue(() => getOccasionPhoto(occasionId)),
  })
  const url = useObjectUrl(query.data?.blob)
  // the photo shows once it is decoded (onLoad); a new version starts invisible again. A picture decoded before in
  // this session (the card was on screen, the tab comes back) is there in the first frame: no placeholder, no fade
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const again = wasDecoded(url)
  const loaded = url !== null && (loadedUrl === url || again)
  const state: FeedCoverState = query.isError ? 'unavailable' : loaded ? 'ready' : 'loading'
  useEffect(() => onState(state), [onState, state])
  return url ? (
    <img
      className="feed-cover-img"
      src={url}
      alt=""
      decoding={again ? 'sync' : 'async'}
      draggable={false}
      data-loaded={loaded ? '' : undefined}
      onLoad={() => {
        markDecoded(url)
        setLoadedUrl(url)
      }}
    />
  ) : null
}

export default function FeedCoverImage({ occasionId, meta }: { occasionId: string; meta: OccasionPhotoMeta }) {
  const ref = useRef<HTMLSpanElement>(null)
  const near = useNearViewport(ref)
  // the bytes are in memory already (the card was shown before in this session): no waiting for the first paint
  // and the viewport — the cover is part of the card's first frame, like the rest of it
  const queryClient = useQueryClient()
  const [inMemory] = useState(() => queryClient.getQueryData(occasionPhotoQuery(occasionId, meta.updated_at).queryKey) !== undefined)
  const [state, setState] = useState<FeedCoverState>('loading')
  return (
    <span ref={ref} aria-hidden="true" className="feed-cover" data-state={state}>
      {near || inMemory ? <CoverImage occasionId={occasionId} meta={meta} onState={setState} /> : null}
    </span>
  )
}
