export type Fetch = typeof fetch
export type Clock = () => number

const statuses = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  method_not_allowed: 405,
  too_large: 413,
  unsupported_content: 415,
  blocked_target: 422,
  rate_limited: 429,
  // a provider is switched off (GIFT_IDEAS_SOURCES): the app answers from its own demo catalogue
  not_available: 501,
  fetch_failed: 502,
  upstream_unavailable: 502,
  timeout: 504,
} as const

export type ErrorCode = keyof typeof statuses

export class ApiError extends Error {
  readonly status: number

  constructor(readonly code: ErrorCode, readonly retryAfter?: number) {
    super(code)
    this.name = 'ApiError'
    this.status = statuses[code]
  }
}

export function json(value: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(value), { status, headers })
}

export function errorResponse(error: ApiError): Response {
  const headers = new Headers()
  if (error.code === 'rate_limited') {
    headers.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfter ?? 60))))
  }
  return json({ error: error.code }, error.status, headers)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Race as well as abort: an injected transport may not honour AbortSignal.
export async function withDeadline<T>(
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const timeout = new ApiError('timeout')
  let rejectDeadline: (reason: unknown) => void = () => {}
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject })
  const abort = () => {
    controller.abort(timeout)
    rejectDeadline(timeout)
  }
  const timer = setTimeout(abort, ms)
  parent?.addEventListener('abort', abort, { once: true })
  try {
    if (parent?.aborted) throw timeout
    return await Promise.race([operation(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
    // Also cancel sibling network operations if one branch failed early.
    controller.abort()
  }
}

export async function readBytes(
  response: Pick<Response, 'headers' | 'body'>,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const cancelBody = () => { void response.body?.cancel().catch(() => {}) }
  const declared = response.headers.get('Content-Length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    cancelBody()
    throw new ApiError('too_large')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  const chunks: Uint8Array[] = []
  let size = 0
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new ApiError('timeout')
      const { done, value } = await reader.read()
      if (signal?.aborted) throw new ApiError('timeout')
      if (done) break
      size += value.byteLength
      if (size > limit) throw new ApiError('too_large')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    signal?.removeEventListener('abort', cancel)
    cancel()
  }
}
