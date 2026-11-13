import { useCallback, useEffect, useRef, useState } from 'react'
import { captureEpoch } from '../../lib/accountBoundary'
import { isAbortError } from '../../lib/api/linkPreview'
import { fetchLinkImage } from '../../lib/api/linkImage'
import { preparePhoto, type PreparedPhoto } from '../occasions/photo/pipeline'

// The product photo of the wish screen, read right after the link preview found a picture (LinkPreview.imageUrl):
//   idle → loading(imageUrl) → ready(imageUrl, photo) | failed(imageUrl)
// - the picture comes ONLY through our Worker (fetchLinkImage → POST /api/link-image), never from the shop;
// - it is downscaled + re-encoded on the device at once (preparePhoto: ≤ 1600 px, WebP/JPEG ≤ 400 KB, no
//   metadata), so what the card shows is exactly what will be uploaded, and a picture the browser cannot decode
//   (e.g. AVIF on an old browser) falls back to the shop tile now instead of failing at save;
// - one request at a time (a new link or reset aborts the one before), an answer counts only for the picture it
//   was asked for and only while the account of the screen is still the tab's account (like useLinkPreview);
// - every failure is calm: `failed`, the card keeps the shop's letter tile.

export type LinkPhotoState =
  | { status: 'idle' }
  | { status: 'loading'; imageUrl: string }
  | { status: 'ready'; imageUrl: string; photo: PreparedPhoto }
  | { status: 'failed'; imageUrl: string }

export interface LinkPhotoDeps {
  fetchImage?: typeof fetchLinkImage
  prepare?: (blob: Blob) => Promise<PreparedPhoto>
}

export function useLinkPhoto({ fetchImage = fetchLinkImage, prepare = preparePhoto }: LinkPhotoDeps = {}) {
  const [state, setState] = useState<LinkPhotoState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  /** resolves when the current request settled (the form waits for it a moment before saving) */
  const pending = useRef<Promise<void> | null>(null)
  // mirrors the state at once (settle() reads it right after a request settled, before React re-rendered)
  const stateRef = useRef<LinkPhotoState>(state)
  const commit = useCallback((next: LinkPhotoState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    pending.current = null
    if (stateRef.current.status !== 'idle') commit({ status: 'idle' })
  }, [commit])

  const request = useCallback(
    (imageUrl: string) => {
      controller.current?.abort()
      const own = new AbortController()
      controller.current = own
      const epoch = captureEpoch()
      commit({ status: 'loading', imageUrl })
      const counts = () => !own.signal.aborted && controller.current === own && epoch.isCurrent()
      const run = (async () => {
        try {
          const blob = await fetchImage(imageUrl, { signal: own.signal, ...(epoch.userId ? { expectedUserId: epoch.userId } : {}) })
          if (!counts()) return
          const photo = await prepare(blob)
          if (!counts()) return
          controller.current = null
          commit({ status: 'ready', imageUrl, photo })
        } catch (err) {
          if (!counts() || isAbortError(err)) return
          controller.current = null
          commit({ status: 'failed', imageUrl })
        }
      })()
      pending.current = run
    },
    [fetchImage, prepare, commit],
  )

  /** Waits (at most `maxMs`) for a picture that is still on its way; the state after that is what counts. */
  const settle = useCallback(async (maxMs = 4000): Promise<LinkPhotoState> => {
    const running = pending.current
    if (running && stateRef.current.status === 'loading') {
      await Promise.race([running, new Promise((resolve) => setTimeout(resolve, maxMs))])
    }
    return stateRef.current
  }, [])

  // the screen closes: a request still on its way is dropped
  useEffect(
    () => () => {
      controller.current?.abort()
      controller.current = null
    },
    [],
  )

  return { state, request, reset, settle }
}
