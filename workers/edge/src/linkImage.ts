import { ApiError, withDeadline } from './http'
import type { Fetch } from './http'
import { fetchPublic } from './net/fetchPublic'
import { createResolver, validateUrl } from './net/ssrf'
import type { Resolver } from './net/ssrf'

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif'

export interface LinkImage {
  type: ImageType
  bytes: Uint8Array<ArrayBuffer>
}

interface LinkImageOptions {
  fetch: Fetch
  resolve?: Resolver
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DEADLINE_MS = 8000
// Each request may buffer up to 5 MiB: a small cap keeps the isolate far below its memory limit.
const maxInFlight = 6
// Bounds the work a trickling server can cause; 64 Ki reads cover 5 MiB in 80-byte chunks.
const maxReadCalls = 64 * 1024
const sniffBytes = 64
const initialCapacity = 64 * 1024

// SVG is never accepted: it is a document that can carry scripts.
const declaredTypes: Readonly<Record<string, ImageType>> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
  'image/avif': 'image/avif',
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = ''
  for (let index = start; index < start + length && index < bytes.length; index++) {
    text += String.fromCharCode(bytes[index] ?? 0)
  }
  return text
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
}

function isAvif(bytes: Uint8Array): boolean {
  // ISO-BMFF: [size][ftyp][major brand][minor version][compatible brands...]
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') return false
  const size = (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0
  if (size < 16) return false
  // Real ftyp boxes are a few dozen bytes; a huge declared size must not mean a long scan.
  const end = Math.min(size, bytes.length, 128)
  const brands = [ascii(bytes, 8, 4)]
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(bytes, offset, 4))
  return brands.some((brand) => brand === 'avif' || brand === 'avis')
}

/** Identify a raster image by its magic bytes; anything else (SVG, HTML, unknown) → undefined. */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  const gif = ascii(bytes, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (isAvif(bytes)) return 'image/avif'
  return undefined
}

function discard(response: Response): void {
  void response.body?.cancel().catch(() => {})
}

/** Reads a declared raster image (magic bytes must match, never SVG) up to `maxBytes`; also used by the catalogue photos. */
export async function readImage(response: Response, signal: AbortSignal, maxBytes = MAX_IMAGE_BYTES): Promise<LinkImage> {
  const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const declared = Object.hasOwn(declaredTypes, mime) ? declaredTypes[mime] : undefined
  if (!declared) {
    discard(response)
    throw new ApiError('unsupported_content')
  }
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    discard(response)
    throw new ApiError('too_large')
  }
  if (!response.body) throw new ApiError('unsupported_content')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  // One growing buffer instead of a list of chunks: tiny chunks cannot multiply memory.
  let buffer = new Uint8Array(Math.min(initialCapacity, maxBytes))
  let size = 0
  let sniffed = false
  const verify = (): void => {
    sniffed = true
    if (sniffImageType(buffer.subarray(0, size)) !== declared) throw new ApiError('unsupported_content')
  }
  try {
    for (let reads = 0; ; reads++) {
      if (reads >= maxReadCalls) throw new ApiError('fetch_failed')
      if (signal.aborted) throw new ApiError('timeout')
      const { done, value } = await reader.read()
      if (signal.aborted) throw new ApiError('timeout')
      if (done) break
      if (size + value.byteLength > maxBytes) throw new ApiError('too_large')
      if (size + value.byteLength > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(buffer.byteLength * 2, size + value.byteLength)))
        grown.set(buffer.subarray(0, size))
        buffer = grown
      }
      buffer.set(value, size)
      size += value.byteLength
      // Check the magic bytes as soon as possible, before downloading the rest.
      if (!sniffed && size >= sniffBytes) verify()
    }
    if (!sniffed) verify()
    // A view, not a copy: the response body reads exactly these bytes.
    return { type: declared, bytes: buffer.subarray(0, size) }
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

/** The bytes go back with fixed headers only; nothing from the shop's response is forwarded. */
export function imageResponse(image: LinkImage): Response {
  return new Response(image.bytes, {
    status: 200,
    headers: {
      'Content-Type': image.type,
      'Content-Length': String(image.bytes.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}

export function createLinkImage(options: LinkImageOptions) {
  const resolve = options.resolve ?? createResolver(options.fetch)
  let inFlight = 0
  return async (input: string, ownHost: string, parentSignal?: AbortSignal): Promise<LinkImage> => {
    const url = validateUrl(input.trim(), ownHost)
    url.hash = ''
    if (inFlight >= maxInFlight) throw new ApiError('rate_limited', 5)
    inFlight++
    try {
      return await withDeadline(DEADLINE_MS, async (signal) => {
        const { response } = await fetchPublic(url, {
          fetch: options.fetch,
          resolve,
          ownHost,
          signal,
          // No cookies, no referrer, no client headers: only this fixed set reaches the shop.
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; BunprisePreview/0.1)',
            accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8',
          },
        })
        return readImage(response, signal)
      }, parentSignal)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('fetch_failed')
    } finally {
      inFlight--
    }
  }
}
