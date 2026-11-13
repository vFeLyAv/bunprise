import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Skeleton } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { ChunkBoundary } from '../nav/ChunkBoundary'
import type { ComicProgress } from './progress'
import { closeComic, loadComicBody, markComicLoaded, useComicState } from './store'

// The comic reader «Pompon & Tapsi» as the app's full-screen sheet (ui/Sheet 'full': drag down / Esc / "×" close it,
// Telegram's Back closes it like every sheet — lib/telegram/bridge.ts). Opened from the Start card (ComicStartCard)
// and from Profil › Über Bunprise (ComicProfileRow); a screen that offers it renders <ComicHost /> once.
// The sheet opens at once with a skeleton; the reader itself (ComicBody + @bunprise/mascot/comic) is a lazy chunk
// of its own, fetched on the tap only and never precached by the service worker (vite.config.ts, check-sw.mjs).
// Tab memory only (./store.ts): leaving the screen or the account closes it.

let ComicBody = lazy(loadComicBody)

/** Mount once per screen that offers the comic: renders the sheet from its first opening on. */
export function ComicHost() {
  const comic = useComicState()
  const [mounted, setMounted] = useState(false)
  if (comic.open && !mounted) setMounted(true)
  // leaving the screen closes it: another screen never opens with the reader that was meant here. Only a real unmount:
  // this host often mounts AT the opening (a lazy chunk), and React's development double run of effects must not close it.
  const alive = useRef(false)
  const shown = useRef(comic.token)
  useEffect(() => {
    shown.current = comic.token
  }, [comic.token])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      const token = shown.current
      setTimeout(() => {
        if (!alive.current) closeComic(token)
      }, 0)
    }
  }, [])
  if (!mounted) return null
  return <ComicSheet open={comic.open} token={comic.token} start={comic.start} />
}

function ComicSheet({ open, token, start }: { open: boolean; token: number; start: ComicProgress | null }) {
  const { t } = useTranslation(['comic', 'common'])
  return (
    <Sheet open={open} onClose={() => closeComic()} detent="full" title={t('comic.title')} closeLabel={t('common.close')}>
      <ChunkBoundary
        onRetry={() => {
          ComicBody = lazy(loadComicBody)
        }}
        fallback={(retry) => (
          <div role="alert" className="flex flex-col items-center gap-4 py-10 text-center">
            <p className="t-body text-text-2">{t(navigator.onLine ? 'comic.failed' : 'comic.offline')}</p>
            <Button variant="secondary" onClick={retry}>{t('common.retry')}</Button>
          </div>
        )}
      >
        {() => (
          <Suspense fallback={<ComicSkeleton label={t('comic.loading')} />}>
            <ComicBody key={token} start={start} onClose={() => closeComic()} onLoaded={markComicLoaded} />
          </Suspense>
        )}
      </ChunkBoundary>
    </Sheet>
  )
}

/** While the reader's chunk loads: the episode switch and a paper page, in their places (no spinner). */
function ComicSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="-mx-5 flex flex-col gap-3">
      <div className="px-5 pt-2"><Skeleton height={52} rounded="md" /></div>
      <div style={{ height: '70dvh', background: '#FFFFFF' }} />
    </div>
  )
}
