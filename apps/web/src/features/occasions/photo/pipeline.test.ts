import { describe, expect, it, vi } from 'vitest'
import { PHOTO_LIMITS } from '../../../lib/api/photos'
import { findImageMetadata } from './metadata'
import { QUALITY_STEPS, fitWithin, preparePhoto, type DecodedImage, type PhotoCanvas, type PhotoDeps } from './pipeline'

// The steps of the photo pipeline with fake browser pieces (jsdom has no canvas): refusals, the size,
// the quality steps, the JPEG fallback where a browser cannot write WebP, and the metadata guard.
// The real canvas re-encode (EXIF / GPS gone) is checked in a browser: e2e/occasion-photo.spec.ts.

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** A structurally valid WebP of `size` bytes. */
function fakeWebp(size: number): Uint8Array {
  const bytes = new Uint8Array(size).fill(7)
  bytes.set(ascii('RIFF'), 0)
  new DataView(bytes.buffer).setUint32(4, size - 8, true)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8 '), 12)
  new DataView(bytes.buffer).setUint32(16, size - 20, true)
  return bytes
}

/** A valid JPEG of `size` bytes; `exif` puts an EXIF block with a GPS tag in front (some encoders add one). */
function fakeJpeg(size: number, exif = false): Uint8Array {
  const app1 = exif ? [0xff, 0xe1, 0, 16, ...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 0x2a, 0x88, 0x25, 0, 0] : []
  const head = [0xff, 0xd8, ...app1, 0xff, 0xda, 0, 4, 1, 1]
  const bytes = new Uint8Array(Math.max(size, head.length + 2)).fill(3)
  bytes.set(head, 0)
  bytes.set([0xff, 0xd9], bytes.length - 2)
  return bytes
}

const blobOf = (bytes: Uint8Array, type: string) => new Blob([bytes.slice().buffer], { type })

interface FakeOptions {
  width?: number
  height?: number
  /** encoded size for (type, quality, canvas width) */
  size?: (type: string, quality: number, width: number) => number
  /** the browser cannot write WebP (Safari: answers with a PNG) */
  noWebp?: boolean
  exif?: boolean
  decodeFails?: boolean
}

function fakeDeps(options: FakeOptions = {}) {
  const calls: { type: string; quality: number; width: number; height: number }[] = []
  const drawn: { width: number; height: number }[] = []
  const closed = vi.fn()
  const deps: PhotoDeps = {
    async decode() {
      if (options.decodeFails) throw new Error('cannot decode')
      return { width: options.width ?? 4000, height: options.height ?? 3000, source: {} as CanvasImageSource, close: closed } satisfies DecodedImage
    },
    canvas(width, height): PhotoCanvas {
      return {
        width,
        height,
        draw: () => drawn.push({ width, height }),
        async encode(type, quality) {
          calls.push({ type, quality, width, height })
          if (type === 'image/webp' && options.noWebp) return blobOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')
          const size = options.size?.(type, quality, width) ?? 200_000
          return type === 'image/webp' ? blobOf(fakeWebp(size), type) : blobOf(fakeJpeg(size, options.exif), type)
        },
      }
    },
  }
  return { deps, calls, drawn, closed }
}

const file = (type = 'image/jpeg') => new File([new Uint8Array(16)], 'IMG_0001.jpg', { type })

describe('fitWithin', () => {
  it('scales the long side down to 1600 px, never up, at least 1 px', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10000, 3)).toEqual({ width: 1600, height: 1 })
  })
})

describe('preparePhoto', () => {
  it('refuses a file over 20 MB before decoding it', async () => {
    const { deps } = fakeDeps()
    const decode = vi.spyOn(deps, 'decode')
    const big = { size: PHOTO_LIMITS.inputMaxBytes + 1, type: 'image/jpeg' } as Blob
    await expect(preparePhoto(big, deps)).rejects.toMatchObject({ problem: 'too_large' })
    expect(decode).not.toHaveBeenCalled()
  })

  it('refuses a non-image type, an empty file and an undecodable one as not_image', async () => {
    await expect(preparePhoto(new File(['hello'], 'brief.pdf', { type: 'application/pdf' }), fakeDeps().deps)).rejects.toMatchObject({ problem: 'not_image' })
    await expect(preparePhoto(new File([], 'leer.jpg', { type: 'image/jpeg' }), fakeDeps().deps)).rejects.toMatchObject({ problem: 'not_image' })
    await expect(preparePhoto(file(), fakeDeps({ decodeFails: true }).deps)).rejects.toMatchObject({ problem: 'not_image' })
    // an empty type is tried (some desktop pickers send none)
    await expect(preparePhoto(new File([new Uint8Array(8)], 'foto', { type: '' }), fakeDeps().deps)).resolves.toMatchObject({ mime: 'image/webp' })
  })

  it('WebP at the first quality when it fits: 1600 px long side, the real size, bytes = blob', async () => {
    const { deps, calls, closed } = fakeDeps({ width: 4032, height: 3024 })
    const photo = await preparePhoto(file(), deps)
    expect(photo).toMatchObject({ mime: 'image/webp', width: 1600, height: 1200 })
    expect(calls).toEqual([{ type: 'image/webp', quality: QUALITY_STEPS[0], width: 1600, height: 1200 }])
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(photo.bytes)
    expect(closed).toHaveBeenCalledTimes(1) // the decoded image is released
  })

  it('steps the quality down until the file is ≤ 400 KB', async () => {
    const { deps, calls } = fakeDeps({ size: (_type, quality) => Math.round(quality * 600_000) }) // 0.64 → 384 000
    const photo = await preparePhoto(file(), deps)
    expect(calls.map((c) => c.quality)).toEqual([0.86, 0.8, 0.72, 0.64])
    expect(photo.bytes.length).toBeLessThanOrEqual(PHOTO_LIMITS.maxBytes)
  })

  it('a browser without WebP encoding (PNG back) gets JPEG — from then on without asking for WebP again', async () => {
    const { deps, calls } = fakeDeps({ noWebp: true, size: (_type, quality) => (quality > 0.8 ? 500_000 : 300_000) })
    const photo = await preparePhoto(file(), deps)
    expect(photo.mime).toBe('image/jpeg')
    expect(calls.map((c) => `${c.type}@${c.quality}`)).toEqual(['image/webp@0.86', 'image/jpeg@0.86', 'image/jpeg@0.8'])
  })

  it('makes the picture smaller when even the lowest quality is too big', async () => {
    const { deps, drawn } = fakeDeps({ size: (_type, _quality, width) => (width > 1300 ? 900_000 : 350_000) })
    const photo = await preparePhoto(file(), deps)
    expect(drawn.map((d) => d.width)).toEqual([1600, 1280])
    expect(photo).toMatchObject({ width: 1280, height: 960 })
  })

  it('gives up with "failed" when nothing gets small enough', async () => {
    await expect(preparePhoto(file(), fakeDeps({ size: () => 2_000_000 }).deps)).rejects.toMatchObject({ problem: 'failed' })
  })

  it('an encoder that adds EXIF / GPS: the uploaded bytes have none, and they are still a valid JPEG', async () => {
    const { deps } = fakeDeps({ noWebp: true, exif: true })
    const photo = await preparePhoto(file(), deps)
    expect(photo.mime).toBe('image/jpeg')
    expect(findImageMetadata(photo.bytes, 'image/jpeg')).toEqual([])
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(photo.bytes)
  })
})
