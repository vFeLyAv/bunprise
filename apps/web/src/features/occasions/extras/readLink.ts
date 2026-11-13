import { captureEpoch } from '../../../lib/accountBoundary'
import { fetchLinkImage } from '../../../lib/api/linkImage'
import { fetchLinkPreview, isLinkPreviewError, type LinkPreview } from '../../../lib/api/linkPreview'
import { preparePhoto, type PreparedPhoto } from '../photo/pipeline'
import type { LinkRead } from './model'

// Reads a pasted shop link for a quick wish of the new-occasion form — the same way as the wish form
// (features/wishes/useLinkPreview + useLinkPhoto): title, EUR price, shop and details through OUR Worker
// (POST /api/link-preview), then the product photo, again only through our Worker (POST /api/link-image), prepared
// on the device (preparePhoto: ≤ 1600 px, no metadata). The browser never talks to a shop.
// Unlike the wish form this is a plain promise, not a hook: the occasion is saved and its screen left while a
// link may still be on its way — the save (extras/send.ts) waits for the promise a moment and uses what came.
// Every failure is calm: the wish keeps its link, its title falls back to the shop's name.
// Pinned to the account of the moment (captureEpoch): an answer for an account that ended in this tab is dropped.

/** The whole read (preview + photo) gives up after this long. */
export const READ_TIMEOUT_MS = 15_000

export interface ReadLinkDeps {
  fetchPreview?: typeof fetchLinkPreview
  fetchImage?: typeof fetchLinkImage
  prepare?: (blob: Blob) => Promise<PreparedPhoto>
  timeoutMs?: number
}

export async function readLink(url: string, deps: ReadLinkDeps = {}): Promise<LinkRead> {
  const { fetchPreview = fetchLinkPreview, fetchImage = fetchLinkImage, prepare = preparePhoto, timeoutMs = READ_TIMEOUT_MS } = deps
  const epoch = captureEpoch()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const options = { signal: controller.signal, ...(epoch.userId ? { expectedUserId: epoch.userId } : {}) }
  try {
    let preview: LinkPreview
    try {
      preview = await fetchPreview(url, options)
    } catch (err) {
      return { preview: null, photo: null, code: isLinkPreviewError(err) ? err.code : controller.signal.aborted ? 'timeout' : 'unavailable' }
    }
    if (!epoch.isCurrent()) return { preview: null, photo: null }
    const imageUrl = preview.imageUrl ?? null
    if (!imageUrl) return { preview, photo: null }
    try {
      const blob = await fetchImage(imageUrl, options)
      if (!epoch.isCurrent()) return { preview: null, photo: null }
      const photo = await prepare(blob)
      return epoch.isCurrent() ? { preview, photo } : { preview: null, photo: null }
    } catch {
      // no picture: the wish keeps the shop's tile
      return { preview, photo: null }
    }
  } finally {
    clearTimeout(timer)
  }
}
