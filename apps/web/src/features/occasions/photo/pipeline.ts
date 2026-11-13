import { PHOTO_LIMITS, type PhotoMime, type PhotoUpload } from '../../../lib/api/photos'
import { photoBytesMatch, stripImageMetadata } from './metadata'

// A picked file → the cover that is uploaded (all in the browser, nothing leaves the device here):
//   1. refuse calmly: more than 20 MB, or a type that is not an image (an empty type is tried);
//   2. decode (createImageBitmap — EXIF orientation applied —, an <img> as the fallback);
//   3. draw onto a canvas at most 1600 px on the long side (white under transparent parts);
//   4. encode WebP; where the browser cannot (Safari answers with a PNG), JPEG; step the quality down
//      until the file is ≤ 400 KB (then a smaller size, should even the lowest quality be too big);
//   5. the re-encode leaves EXIF / GPS / XMP behind (a canvas has none of the original's metadata);
//      stripImageMetadata() drops anything an encoder might still add, and the bytes must pass the same
//      structure check as in the database.
// The browser pieces are injectable (PhotoDeps) so the steps are unit-tested without a canvas.

export type PhotoProblem = 'not_image' | 'too_large' | 'failed'

export class PhotoPrepareError extends Error {
  readonly problem: PhotoProblem
  constructor(problem: PhotoProblem, options?: { cause?: unknown }) {
    super(`photo: ${problem}`, options)
    this.name = 'PhotoPrepareError'
    this.problem = problem
  }
}

export interface PreparedPhoto extends PhotoUpload {
  /** the same bytes as a Blob (preview, cache seed after the upload) */
  blob: Blob
}

/** A part of the source image in its own pixels (the avatar's centred square). */
export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

/** A decoded source image of a known size. */
export interface DecodedImage {
  width: number
  height: number
  source: CanvasImageSource
  close(): void
}

export interface PhotoCanvas {
  width: number
  height: number
  /** draws the source (or only its `crop` rectangle) scaled to the canvas, over white */
  draw(image: DecodedImage, crop?: SourceRect): void
  /** the encoded image; `type` is what the browser really produced (it may ignore an unsupported one) */
  encode(type: PhotoMime, quality: number): Promise<Blob | null>
}

export interface PhotoDeps {
  decode(file: Blob): Promise<DecodedImage>
  canvas(width: number, height: number): PhotoCanvas
}

/** Qualities tried from the top; the first file ≤ 400 KB wins. */
export const QUALITY_STEPS = [0.86, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4] as const
/** After the lowest quality: the size shrinks by this factor (at most SHRINK_ROUNDS times). */
const SHRINK = 0.8
const SHRINK_ROUNDS = 3

/** The target size: at most `max` px on the long side, never upscaled, at least 1 × 1. */
export function fitWithin(width: number, height: number, max: number = PHOTO_LIMITS.targetSide): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function looksLikeImage(file: Blob): boolean {
  // HEIC and other camera types come with an image/* type; an empty type (some desktop pickers) is tried
  return file.type === '' || file.type.startsWith('image/')
}

/**
 * Options of one use: the profile photo (20261024120000) is a centred square of at most 512 px — it is shown
 * round and small; covers and banners keep the whole picture at up to 1600 px (the default).
 */
export interface PrepareOptions {
  /** the long side's maximum (default PHOTO_LIMITS.targetSide) */
  maxSide?: number
  /** keep only the centred square of the picture */
  square?: boolean
}

/** The centred square of a picture (its short side). */
export function centredSquare(width: number, height: number): SourceRect {
  const side = Math.min(width, height)
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }
}

/** The pipeline. Throws PhotoPrepareError ('not_image' | 'too_large' | 'failed'). */
export async function preparePhoto(file: Blob, deps: PhotoDeps = browserPhotoDeps(), options: PrepareOptions = {}): Promise<PreparedPhoto> {
  if (file.size > PHOTO_LIMITS.inputMaxBytes) throw new PhotoPrepareError('too_large')
  if (!looksLikeImage(file) || file.size === 0) throw new PhotoPrepareError('not_image')

  let image: DecodedImage
  try {
    image = await deps.decode(file)
  } catch (err) {
    throw new PhotoPrepareError('not_image', { cause: err })
  }
  try {
    if (!(image.width > 0 && image.height > 0)) throw new PhotoPrepareError('not_image')
    const crop = options.square ? centredSquare(image.width, image.height) : undefined
    let size = fitWithin(crop?.width ?? image.width, crop?.height ?? image.height, options.maxSide)
    let webp = true // until the browser shows that it cannot encode WebP
    for (let round = 0; round <= SHRINK_ROUNDS; round++) {
      const canvas = deps.canvas(size.width, size.height)
      canvas.draw(image, crop)
      for (const quality of QUALITY_STEPS) {
        const wanted: PhotoMime = webp ? 'image/webp' : 'image/jpeg'
        let blob = await canvas.encode(wanted, quality)
        if (blob && wanted === 'image/webp' && blob.type !== 'image/webp') {
          webp = false // e.g. Safari: an unsupported type comes back as PNG — JPEG from now on
          blob = await canvas.encode('image/jpeg', quality)
        }
        if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) throw new PhotoPrepareError('failed')
        if (blob.size > PHOTO_LIMITS.maxBytes) continue
        return await finish(blob, blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg', size)
      }
      size = { width: Math.max(1, Math.round(size.width * SHRINK)), height: Math.max(1, Math.round(size.height * SHRINK)) }
    }
    throw new PhotoPrepareError('failed')
  } finally {
    image.close()
  }
}

async function finish(blob: Blob, mime: PhotoMime, size: { width: number; height: number }): Promise<PreparedPhoto> {
  const encoded = new Uint8Array(await blob.arrayBuffer())
  const bytes = stripImageMetadata(encoded, mime)
  if (bytes.length > PHOTO_LIMITS.maxBytes || !photoBytesMatch(mime, bytes)) throw new PhotoPrepareError('failed')
  const clean = bytes === encoded ? blob : new Blob([bytes.slice().buffer], { type: mime })
  return { mime, bytes, blob: clean, width: size.width, height: size.height }
}

// ---- the browser's pieces ------------------------------------------------------------------------------

async function decodeWithBitmap(file: Blob): Promise<DecodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (err) {
    // an engine that does not know the option throws a TypeError; the default orients from the image, too
    if (!(err instanceof TypeError)) throw err
    bitmap = await createImageBitmap(file)
  }
  return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
}

async function decodeWithImage(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close: () => URL.revokeObjectURL(url) }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

function canvasOf(width: number, height: number): PhotoCanvas {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return {
    width,
    height,
    draw(image, crop) {
      const ctx = element.getContext('2d')
      if (!ctx) throw new PhotoPrepareError('failed')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, width, height)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      if (crop) ctx.drawImage(image.source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
      else ctx.drawImage(image.source, 0, 0, width, height)
    },
    encode(type, quality) {
      return new Promise((resolve) => element.toBlob(resolve, type, quality))
    },
  }
}

export function browserPhotoDeps(): PhotoDeps {
  return {
    async decode(file) {
      if (typeof createImageBitmap === 'function') {
        try {
          return await decodeWithBitmap(file)
        } catch {
          /* some engines decode a type only through <img> — try that */
        }
      }
      return decodeWithImage(file)
    },
    canvas: canvasOf,
  }
}
