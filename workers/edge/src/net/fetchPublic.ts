import { ApiError } from '../http'
import type { Fetch } from '../http'
import { assertPublicResolution, validateUrl } from './ssrf'
import type { Resolver } from './ssrf'

export const MAX_REDIRECTS = 4
const redirectStatuses = new Set([301, 302, 303, 307, 308])

export interface PublicFetchOptions {
  fetch: Fetch
  resolve: Resolver
  /** Our own hostname: never fetched, also not via a redirect. */
  ownHost: string
  signal: AbortSignal
  /** The complete, fixed request headers. Nothing from the client request is ever forwarded. */
  headers: Readonly<Record<string, string>>
  /** Applied to every validated redirect target, e.g. stripTracking for shop pages. */
  normalize?: (url: URL) => URL
  /** Lets the caller receive selected non-2xx answers (e.g. a shop's robot check) instead of fetch_failed. */
  acceptStatus?: (status: number, url: URL) => boolean
}

export interface PublicResponse {
  /** A 2xx (or acceptStatus) response whose body the caller must consume or cancel. */
  response: Response
  /** The URL that produced the response (after redirects). */
  url: URL
}

function discard(response: Response): void {
  void response.body?.cancel().catch(() => {})
}

function withoutFragment(url: URL): URL {
  const copy = new URL(url.href)
  copy.hash = ''
  return copy
}

/**
 * Fetch an already validated public URL with manual redirects (OWASP SSRF checklist):
 * every hop is re-validated (scheme, credentials, port, own host, private literals) and its
 * DNS answers must be public before the request is sent. The caller owns the deadline signal.
 */
export async function fetchPublic(initial: URL, options: PublicFetchOptions): Promise<PublicResponse> {
  const { signal } = options
  const normalize = options.normalize ?? withoutFragment
  let current = initial
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicResolution(current, options.resolve, signal)
    if (signal.aborted) throw new ApiError('timeout')
    const response = await options.fetch(current.href, {
      redirect: 'manual',
      signal,
      headers: { ...options.headers },
    })
    if (signal.aborted) {
      discard(response)
      throw new ApiError('timeout')
    }
    if (redirectStatuses.has(response.status)) {
      discard(response)
      const location = response.headers.get('location')
      if (!location || hop === MAX_REDIRECTS) throw new ApiError('fetch_failed')
      let target: string
      try {
        target = new URL(location, current).href
      } catch {
        throw new ApiError('fetch_failed')
      }
      try {
        current = normalize(validateUrl(target, options.ownHost))
      } catch (error) {
        if (error instanceof ApiError && error.code === 'invalid_request') throw new ApiError('blocked_target')
        throw error
      }
      continue
    }
    if (!response.ok && !options.acceptStatus?.(response.status, current)) {
      discard(response)
      throw new ApiError('fetch_failed')
    }
    return { response, url: current }
  }
  throw new ApiError('fetch_failed')
}
