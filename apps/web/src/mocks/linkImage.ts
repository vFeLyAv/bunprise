import { delay, http, HttpResponse } from 'msw'
import { decodeBase64 } from './photos'
import { demoProductBase64 } from './wishPhotos'

// Demo answers of our Worker's POST /api/link-image (docs/demo-mode.md; the real one: workers/edge/src/linkImage.ts).
// Same contract: body { "url": string } as JSON, the bearer token of a demo session, the answer is the raw image with
// its Content-Type (private, no-store). FICTIONAL and offline: every acceptable link gets the same bundled picture
// (assets/demo-product.webp, a generated coffee grinder — no shop, no people); no request leaves the browser.
//
//   link contains "fail"    → 502 { error: "fetch_failed" }
//   link contains "toobig"  → 413 { error: "too_large" }
//   link contains "svg"     → 415 { error: "unsupported_content" } (the Worker never passes SVG)
//   any other http(s) link  → 200 image/webp (480 × 480)
//
// The answer takes a moment (LINK_IMAGE_DELAY_MS), so the "loading picture" state is visible in the demo.

export const LINK_IMAGE_DELAY_MS = 700
const URL_MAX = 2048

export interface LinkImageHandlerOptions {
  /** the demo account this request's bearer token belongs to; null = none (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delay */
  delayMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** The fixture answer for one requested picture URL (pure; the handler adds auth, body checks and the delay). */
export function demoLinkImage(raw: string): { status: number; error?: string } {
  if (!isHttpUrl(raw)) return { status: 400, error: 'invalid_request' }
  const text = raw.toLowerCase()
  if (text.includes('fail')) return { status: 502, error: 'fetch_failed' }
  if (text.includes('toobig')) return { status: 413, error: 'too_large' }
  if (text.includes('svg')) return { status: 415, error: 'unsupported_content' }
  return { status: 200 }
}

export function createLinkImageHandlers({ viewerOf, delayMs = LINK_IMAGE_DELAY_MS }: LinkImageHandlerOptions) {
  const fail = (error: string, status: number) => HttpResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
  return [
    http.post('/api/link-image', async ({ request }) => {
      if (viewerOf(request) === null) return fail('unauthorized', 401)
      if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return fail('invalid_request', 400)
      let input: unknown
      try {
        input = await request.json()
      } catch {
        return fail('invalid_request', 400)
      }
      const url = isRecord(input) ? input.url : undefined
      if (typeof url !== 'string' || url.length === 0 || url.length > URL_MAX) return fail('invalid_request', 400)
      const answer = demoLinkImage(url)
      if (answer.status !== 400 && delayMs > 0) await delay(delayMs)
      if (answer.error !== undefined) return fail(answer.error, answer.status)
      const bytes = decodeBase64(demoProductBase64())
      if (!bytes) return fail('fetch_failed', 502)
      return new HttpResponse(bytes.slice().buffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }),
  ]
}
