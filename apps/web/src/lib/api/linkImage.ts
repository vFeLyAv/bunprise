import { asAccount, bearer } from './identity'
import { cleanHttpUrl, isAbortError, workerErrorOf, type LinkPreviewErrorCode } from './linkPreview'

// POST /api/link-image — our own Worker (workers/edge/src/linkImage.ts, SSRF-safe) downloads the product picture
// of a link preview (LinkPreview.imageUrl) and answers with the raw image bytes (Content-Type = the type it found
// by the magic bytes: JPEG / PNG / WebP / GIF / AVIF, never SVG; ≤ 5 MiB). The browser never talks to the shop:
// this same-origin call is the only way a shop picture reaches it, and only the wish OWNER's browser makes it.
// The caller then downscales + re-encodes the Blob (features/occasions/photo/pipeline.ts preparePhoto) and uploads
// it to our database (lib/api/wishPhotos.ts uploadWishPhoto); friends read it from there (getWishPhoto).
// - Pinned to one account like every API wrapper (identity.ts asAccount): the request carries the captured bearer
//   token; an answer that arrives after that account ended in this tab never reaches the caller.
// - Abortable: `signal` aborts the request; an abort rejects with the DOMException 'AbortError' (isAbortError()).
// - Every failure is a LinkImageError with one of the Worker's codes (the link preview's set) plus 'offline' /
//   'unavailable'. Nothing is trusted blindly: the answer's Content-Type must be one of the five image types and
//   the body 1 byte … 5 MiB, else 'unsupported_content' / 'too_large'.

export const LINK_IMAGE_PATH = '/api/link-image'

/** = MAX_IMAGE_BYTES of the Worker (5 MiB) */
export const LINK_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type LinkImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif'

const IMAGE_TYPES: ReadonlySet<string> = new Set<LinkImageType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/** The codes of the link preview (same Worker, same mapping). */
export type LinkImageErrorCode = LinkPreviewErrorCode

export class LinkImageError extends Error {
  readonly code: LinkImageErrorCode
  /** 429 only: seconds from the Retry-After header, when it had a usable value */
  readonly retryAfterSeconds: number | undefined

  constructor(code: LinkImageErrorCode, options: { retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(`link_image.${code}`, { cause: options.cause })
    this.name = 'LinkImageError'
    this.code = code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function isLinkImageError(err: unknown): err is LinkImageError {
  return err instanceof LinkImageError
}

/** The media type of a Content-Type header (parameters dropped, lower case), or null. */
export function imageTypeOf(header: string | null): LinkImageType | null {
  const mime = (header ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return IMAGE_TYPES.has(mime) ? (mime as LinkImageType) : null
}

export interface LinkImageOptions {
  signal?: AbortSignal
  /** the account of the screen (captureEpoch().userId): a request never silently switches accounts */
  expectedUserId?: string
}

/**
 * Downloads the picture at `imageUrl` (from LinkPreview.imageUrl) through our Worker → a Blob of one of the five
 * image types, 1 byte … 5 MiB. Rejects with a LinkImageError (or an AbortError when `signal` aborted, or the account
 * boundary's AppError when the account changed). Online only.
 */
export async function fetchLinkImage(imageUrl: string, { signal, expectedUserId }: LinkImageOptions = {}): Promise<Blob> {
  const target = cleanHttpUrl(imageUrl)
  if (!target) throw new LinkImageError('invalid_request')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new LinkImageError('offline')
  signal?.throwIfAborted()
  return asAccount(expectedUserId, async (account) => {
    let response: Response
    try {
      response = await fetch(new URL(LINK_IMAGE_PATH, window.location.origin), {
        method: 'POST',
        headers: {
          Authorization: bearer(account),
          'Content-Type': 'application/json',
          Accept: 'image/webp,image/avif,image/jpeg,image/png,image/gif',
        },
        body: JSON.stringify({ url: target }),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (isAbortError(err)) throw err
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      throw new LinkImageError(offline ? 'offline' : 'unavailable', { cause: err })
    }
    if (!response.ok) {
      const { code, retryAfterSeconds } = await workerErrorOf(response)
      throw new LinkImageError(code, retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    }
    const type = imageTypeOf(response.headers.get('Content-Type'))
    if (!type) {
      void response.body?.cancel().catch(() => {})
      throw new LinkImageError('unsupported_content')
    }
    const declared = Number(response.headers.get('Content-Length') ?? '')
    if (Number.isFinite(declared) && declared > LINK_IMAGE_MAX_BYTES) {
      void response.body?.cancel().catch(() => {})
      throw new LinkImageError('too_large')
    }
    let bytes: ArrayBuffer
    try {
      bytes = await response.arrayBuffer()
    } catch (err) {
      if (isAbortError(err)) throw err
      throw new LinkImageError('unavailable', { cause: err })
    }
    if (bytes.byteLength > LINK_IMAGE_MAX_BYTES) throw new LinkImageError('too_large')
    if (bytes.byteLength === 0) throw new LinkImageError('unsupported_content')
    return new Blob([bytes], { type })
  })
}
