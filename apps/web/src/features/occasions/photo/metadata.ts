import type { PhotoMime } from '../../../lib/api/photos'

// Byte-level checks of a re-encoded cover photo (no decoding, no dependencies):
//   photoBytesMatch()      — the database's rule (private.photo_bytes_match): the bytes are what the type says;
//   stripImageMetadata()   — the second line of defence after the canvas re-encode: drop every segment / chunk
//                            that can carry personal metadata (EXIF incl. GPS, XMP, IPTC, comments). A canvas
//                            never writes them, but some encoders add a small EXIF block — it goes, too;
//   findImageMetadata()    — what of that is in a file (tests and the browser check of the pipeline).
// Kept: what decoding needs (JFIF APP0, an ICC colour profile in APP2, Adobe APP14, every non-APP segment).

const JPEG_SOI = [0xff, 0xd8] as const

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = ''
  for (let i = at; i < at + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i] as number)
  return out
}

function u32le(bytes: Uint8Array, at: number): number {
  return ((bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16) | ((bytes[at + 3] as number) << 24)) >>> 0
}

function writeU32le(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >>> 8) & 0xff
  bytes[at + 2] = (value >>> 16) & 0xff
  bytes[at + 3] = (value >>> 24) & 0xff
}

/** The database's check (20261020160000_occasion_photos.sql private.photo_bytes_match), in TypeScript. */
export function photoBytesMatch(mime: PhotoMime, bytes: Uint8Array): boolean {
  const n = bytes.length
  if (mime === 'image/jpeg') {
    return n >= 6 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9
  }
  return (
    n >= 20 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(bytes, 12, 4)) &&
    u32le(bytes, 4) === n - 8
  )
}

// ---- JPEG ------------------------------------------------------------------------------------------

interface JpegSegment {
  marker: number
  /** start of the marker (0xFF) */
  start: number
  /** end (exclusive) of the segment */
  end: number
}

/** The header segments before the first scan (SOS); null when the structure is not a sane JPEG. */
function jpegHeaderSegments(bytes: Uint8Array): { segments: JpegSegment[]; scanStart: number } | null {
  if (bytes[0] !== JPEG_SOI[0] || bytes[1] !== JPEG_SOI[1]) return null
  const segments: JpegSegment[] = []
  let i = 2
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1] as number
    if (marker === 0xff) {
      i += 1 // fill byte
      continue
    }
    if (marker === 0xda) return { segments, scanStart: i } // SOS: the image data follows
    if (marker === 0xd9) return { segments, scanStart: i } // EOI without a scan (not an image, kept as is)
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, start: i, end: i + 2 })
      i += 2
      continue
    }
    if (i + 3 >= bytes.length) return null
    const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number)
    if (length < 2 || i + 2 + length > bytes.length) return null
    segments.push({ marker, start: i, end: i + 2 + length })
    i += 2 + length
  }
  return null
}

/** APP0 (JFIF), APP2 with an ICC profile and APP14 (Adobe colour transform) are needed for decoding. */
function keepJpegSegment(bytes: Uint8Array, segment: JpegSegment): boolean {
  const { marker, start } = segment
  if (marker === 0xfe) return false // COM: free text
  if (marker < 0xe0 || marker > 0xef) return true // not an APPn segment: tables, frame, restart …
  if (marker === 0xe0 || marker === 0xee) return true
  if (marker === 0xe2) return ascii(bytes, start + 4, 12) === 'ICC_PROFILE\0'
  return false // APP1 (EXIF incl. GPS, XMP), APP13 (IPTC / Photoshop), and the rest
}

function jpegMetadata(bytes: Uint8Array): string[] {
  const parsed = jpegHeaderSegments(bytes)
  if (!parsed) return []
  const found = new Set<string>()
  for (const segment of parsed.segments) {
    const payload = segment.start + 4
    if (segment.marker === 0xfe) found.add('comment')
    if (segment.marker === 0xed) found.add('iptc')
    if (segment.marker === 0xe1) {
      if (ascii(bytes, payload, 6) === 'Exif\0\0') {
        found.add('exif')
        // the GPSInfo tag (0x8825) in either byte order
        for (let i = payload; i + 1 < segment.end; i++) {
          if ((bytes[i] === 0x88 && bytes[i + 1] === 0x25) || (bytes[i] === 0x25 && bytes[i + 1] === 0x88)) {
            found.add('gps')
            break
          }
        }
      } else if (ascii(bytes, payload, 4) === 'http') {
        found.add('xmp')
      } else {
        found.add('app1')
      }
    }
  }
  return [...found].sort()
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parsed = jpegHeaderSegments(bytes)
  if (!parsed) return bytes
  const kept = parsed.segments.filter((segment) => keepJpegSegment(bytes, segment))
  if (kept.length === parsed.segments.length) return bytes
  const size = 2 + kept.reduce((sum, segment) => sum + (segment.end - segment.start), 0) + (bytes.length - parsed.scanStart)
  const out = new Uint8Array(size)
  out.set(JPEG_SOI, 0)
  let at = 2
  for (const segment of kept) {
    out.set(bytes.subarray(segment.start, segment.end), at)
    at += segment.end - segment.start
  }
  out.set(bytes.subarray(parsed.scanStart), at)
  return out
}

// ---- WebP ------------------------------------------------------------------------------------------

interface RiffChunk {
  fourcc: string
  start: number
  /** end (exclusive) including the pad byte */
  end: number
}

function webpChunks(bytes: Uint8Array): RiffChunk[] | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const chunks: RiffChunk[] = []
  let i = 12
  while (i + 8 <= bytes.length) {
    const size = u32le(bytes, i + 4)
    const end = i + 8 + size + (size % 2)
    if (end > bytes.length + 1) return null // a missing final pad byte is tolerated
    chunks.push({ fourcc: ascii(bytes, i, 4), start: i, end: Math.min(end, bytes.length) })
    i = end
  }
  return chunks
}

const WEBP_METADATA: Readonly<Record<string, string>> = { EXIF: 'exif', 'XMP ': 'xmp' }
/** VP8X flags: bit 3 = EXIF present, bit 2 = XMP present */
const VP8X_METADATA_FLAGS = 0x08 | 0x04

function webpMetadata(bytes: Uint8Array): string[] {
  const chunks = webpChunks(bytes)
  if (!chunks) return []
  const found = new Set<string>()
  for (const chunk of chunks) {
    const kind = WEBP_METADATA[chunk.fourcc]
    if (kind) found.add(kind)
  }
  return [...found].sort()
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks = webpChunks(bytes)
  if (!chunks) return bytes
  const kept = chunks.filter((chunk) => !WEBP_METADATA[chunk.fourcc])
  const vp8x = kept.find((chunk) => chunk.fourcc === 'VP8X')
  const flagsAt = vp8x ? vp8x.start + 8 : -1
  const flagsDirty = flagsAt >= 0 && ((bytes[flagsAt] as number) & VP8X_METADATA_FLAGS) !== 0
  if (kept.length === chunks.length && !flagsDirty) return bytes
  const size = 12 + kept.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0)
  const out = new Uint8Array(size)
  out.set(bytes.subarray(0, 12), 0)
  let at = 12
  for (const chunk of kept) {
    out.set(bytes.subarray(chunk.start, chunk.end), at)
    if (chunk === vp8x) out[at + 8] = (out[at + 8] as number) & ~VP8X_METADATA_FLAGS
    at += chunk.end - chunk.start
  }
  writeU32le(out, 4, size - 8)
  return out
}

// ---- public ----------------------------------------------------------------------------------------

/** The metadata kinds in the file: 'exif', 'gps', 'xmp', 'iptc', 'comment', 'app1' (sorted; [] = clean). */
export function findImageMetadata(bytes: Uint8Array, mime: PhotoMime): string[] {
  return mime === 'image/jpeg' ? jpegMetadata(bytes) : webpMetadata(bytes)
}

/** The same image without personal metadata (the input itself when there is nothing to drop). */
export function stripImageMetadata(bytes: Uint8Array, mime: PhotoMime): Uint8Array {
  return mime === 'image/jpeg' ? stripJpeg(bytes) : stripWebp(bytes)
}
