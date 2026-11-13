import { detectHtmlCharset, extractMetadata, hasCompleteMetadata } from './html/extract'
import { ApiError, withDeadline } from './http'
import type { Clock, Fetch } from './http'
import { LruCache } from './lru'
import { fetchPublic } from './net/fetchPublic'
import { createResolver, stripTracking, validateUrl } from './net/ssrf'
import type { Resolver } from './net/ssrf'
import {
  AMAZON_MAX_HTML_BYTES, amazonBlocked, amazonTld, canonicalAmazonUrl, createAmazonProgress, extractAmazon,
  isAmazonHost, isAmazonRobotCheck,
} from './sites/amazon'

export interface LinkPreview {
  url: string
  site: string
  title: string | null
  price_cents: number | null
  currency: 'EUR' | null
  partial: boolean
  /** Product picture: absolute http(s), ≤ 2048. Never fetched here; load it via POST /api/link-image. */
  image_url: string | null
  description: string | null
  brand: string | null
  color: string | null
  gtin: string | null
}

interface LinkPreviewOptions {
  fetch: Fetch
  now?: Clock
  resolve?: Resolver
}

const maxHtmlBytes = 1024 * 1024
const decodeBatchBytes = 16 * 1024
const maxReadCalls = 4096
// Amazon reads (≤ 1.5 MiB each) count against the same limit: at most 12 × 1.5 MiB of bytes.
const maxInFlight = 12
const amazonInspectionBytes = 128 * 1024

/** How much of a page to read and when to stop early. */
interface ReadPolicy {
  maxBytes: number
  isComplete: (html: string) => boolean
  /** Byte count of the next completeness check. */
  next: (previous: number, total: number) => number
}

function genericPolicy(pageUrl: URL): ReadPolicy {
  return {
    maxBytes: maxHtmlBytes,
    isComplete: (html) => hasCompleteMetadata(html, pageUrl),
    // Exponentially spaced scans bound the work of the full tag scanner.
    next: (previous, total) => Math.max(previous * 2, total * 2),
  }
}

function amazonPolicy(): ReadPolicy {
  // The Amazon check is incremental (indexOf from the previous end), so it can run more often.
  return { maxBytes: AMAZON_MAX_HTML_BYTES, isComplete: createAmazonProgress(), next: (_previous, total) => total + amazonInspectionBytes }
}

/**
 * Redirect hops: Amazon product URLs become https://www.amazon.<tld>/dp/<ASIN> (short links
 * amzn.eu / amzn.to / a.co land here too), everything else only loses tracking parameters.
 * If Amazon redirects the canonical URL to a variant of itself, that variant is kept, so the
 * canonicalisation can never cause a redirect loop.
 */
function redirectNormalizer(initial: URL): (url: URL) => URL {
  let previous = initial.href
  return (target) => {
    const canonical = canonicalAmazonUrl(target)
    const next = canonical && canonical.href !== previous ? canonical : stripTracking(target)
    previous = next.href
    return next
  }
}

function decoderFor(charset: string | undefined): TextDecoder {
  try {
    return new TextDecoder(charset ?? 'utf-8')
  } catch {
    return new TextDecoder('utf-8')
  }
}

function headerCharset(contentType: string): string | undefined {
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function joinBytes(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function readHtml(response: Response, signal: AbortSignal, policy: ReadPolicy): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase()
  if (mime !== 'text/html' && mime !== 'application/xhtml+xml') {
    void response.body?.cancel().catch(() => {})
    throw new ApiError('unsupported_content')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const charset = headerCharset(contentType)
  let decoder = charset ? decoderFor(charset) : undefined
  let total = 0
  let html = ''
  let nextInspection = decodeBatchBytes
  let batchLength = 0
  const batch: Uint8Array[] = []
  const decodeBatch = (final: boolean): void => {
    const bytes = joinBytes(batch, batchLength)
    if (!decoder) {
      const sniff = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096))
      decoder = decoderFor(detectHtmlCharset(sniff))
    }
    html += decoder.decode(bytes, { stream: !final })
    batch.length = 0
    batchLength = 0
  }
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (let reads = 0; reads < maxReadCalls; reads++) {
      if (signal.aborted) throw new ApiError('timeout')
      const result = await reader.read()
      if (signal.aborted) throw new ApiError('timeout')
      if (result.done) break
      // Shop pages over a MiB are normal: keep the first MiB (head + early JSON-LD) and parse that.
      const room = policy.maxBytes - total
      const full = result.value.byteLength >= room
      const chunk = full ? result.value.subarray(0, room) : result.value
      total += chunk.byteLength
      if (chunk.byteLength) {
        batch.push(chunk)
        batchLength += chunk.byteLength
      }
      if (full) break
      // Tiny transport chunks must not cause one decode or parser scan per read.
      if (batchLength >= decodeBatchBytes) {
        decodeBatch(false)
        // Spaced scans also bound work on pages without complete metadata.
        if (total >= nextInspection) {
          nextInspection = policy.next(nextInspection, total)
          if (policy.isComplete(html)) return html + decoder!.decode()
        }
      }
    }
    // EOF and both resource caps return whatever metadata has arrived.
    decodeBatch(true)
    return html
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

export function createLinkPreview(options: LinkPreviewOptions) {
  const resolve = options.resolve ?? createResolver(options.fetch)
  const cache = new LruCache<string, LinkPreview>(200, 10 * 60 * 1000, options.now)
  let inFlight = 0
  return async (input: string, ownHost: string, subject: string, parentSignal?: AbortSignal): Promise<LinkPreview> => {
    const requested = validateUrl(input.trim(), ownHost)
    // The fragment never reaches the shop, but it belongs to the user's link (anchors, hash routes).
    const fragment = requested.hash
    const withFragment = (preview: LinkPreview): LinkPreview => {
      // A canonical Amazon URL stays canonical: its fragments are page state, not product identity.
      if (!fragment || amazonTld(new URL(preview.url).hostname)) return { ...preview }
      const url = new URL(preview.url)
      url.hash = fragment
      return url.href.length <= 2048 ? { ...preview, url: url.href } : { ...preview }
    }
    const initial = canonicalAmazonUrl(requested) ?? stripTracking(requested)
    const key = JSON.stringify([subject, initial.href])
    const cached = cache.get(key)
    if (cached) {
      validateUrl(cached.url, ownHost)
      return withFragment(cached)
    }
    if (inFlight >= maxInFlight) throw new ApiError('rate_limited', 5)
    inFlight++
    try {
      const { preview, cacheable } = await withDeadline(5000, async (signal) => {
        const { response, url } = await fetchPublic(initial, {
          fetch: options.fetch,
          resolve,
          ownHost,
          signal,
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
            accept: 'text/html',
            'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
          },
          normalize: redirectNormalizer(initial),
          // Amazon answers bots with HTTP 503 + robot check: that is a calm partial answer, not an error.
          acceptStatus: (status, target) => status === 503 && isAmazonHost(target.hostname),
        })
        if (!isAmazonHost(url.hostname)) {
          const html = await readHtml(response, signal, genericPolicy(url))
          return { preview: { url: url.href, ...extractMetadata(html, url.hostname, url) }, cacheable: true }
        }
        const answerUrl = (canonicalAmazonUrl(url) ?? canonicalAmazonUrl(initial) ?? url).href
        if (!response.ok) {
          void response.body?.cancel().catch(() => {})
          return { preview: { url: answerUrl, ...amazonBlocked() }, cacheable: false }
        }
        const html = await readHtml(response, signal, amazonPolicy())
        // A robot check is not cached: the next attempt may get the real page.
        return { preview: { url: answerUrl, ...extractAmazon(html, url) }, cacheable: !isAmazonRobotCheck(html) }
      }, parentSignal)
      if (cacheable) cache.set(key, preview)
      return withFragment(preview)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('fetch_failed')
    } finally {
      inFlight--
    }
  }
}
