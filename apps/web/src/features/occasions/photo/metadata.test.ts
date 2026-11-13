import { describe, expect, it } from 'vitest'
import { findImageMetadata, photoBytesMatch, stripImageMetadata } from './metadata'

// Synthetic files with the metadata a phone camera writes: EXIF with a GPS position, XMP, IPTC, a comment.
// The re-encode on a canvas never carries them over (checked in a real browser by
// e2e/occasion-photo.spec.ts); stripImageMetadata() is the second line of defence and must leave a
// structurally valid file that the database accepts.

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const segment = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload]

/** EXIF (big endian TIFF) whose IFD0 points to a GPS IFD (tag 0x8825) with a latitude. */
const EXIF_WITH_GPS = [
  ...ascii('Exif'), 0, 0,
  ...ascii('MM'), 0x00, 0x2a, 0, 0, 0, 8, // TIFF header, IFD0 at 8
  0, 1, // one entry
  0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, // GPSInfo → offset 26
  0, 0, 0, 0, // next IFD
  0, 1, 0x00, 0x02, 0, 5, 0, 0, 0, 3, 0, 0, 0, 44, // GPSLatitude (rational × 3)
  0, 0, 0, 0,
  0, 0, 0, 52, 0, 0, 0, 1, 0, 0, 0, 31, 0, 0, 0, 1, 0, 0, 0, 7, 0, 0, 0, 1, // 52° 31′ 7″ — a made-up place
]

function jpegWithMetadata(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), // APP0 (kept)
    ...segment(0xe1, EXIF_WITH_GPS), // APP1 EXIF + GPS (dropped)
    ...segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]), // APP1 XMP (dropped)
    ...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9]), // APP2 ICC (kept)
    ...segment(0xed, [...ascii('Photoshop 3.0'), 0, 1, 2, 3]), // APP13 IPTC (dropped)
    ...segment(0xfe, ascii('Mila am See')), // COM (dropped)
    ...segment(0xdb, [0, ...Array.from({ length: 64 }, () => 1)]), // DQT (kept)
    ...segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]), // SOF0 16×16 (kept)
    ...segment(0xc4, [0, ...Array.from({ length: 16 }, () => 0)]), // DHT (kept)
    ...segment(0xda, [1, 1, 0, 0, 63, 0]), // SOS
    0x12, 0x34, 0xff, 0x00, 0x56, // entropy-coded data (with a stuffed 0xFF 00)
    0xff, 0xd9,
  ])
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
}
const chunk = (fourcc: string, payload: number[]) => [...ascii(fourcc), ...u32le(payload.length), ...payload, ...(payload.length % 2 ? [0] : [])]

function webp(chunks: number[][]): Uint8Array {
  const body = [...ascii('WEBP'), ...chunks.flat()]
  return Uint8Array.from([...ascii('RIFF'), ...u32le(body.length), ...body])
}

describe('JPEG', () => {
  it('finds EXIF with GPS, XMP, IPTC and the comment', () => {
    expect(findImageMetadata(jpegWithMetadata(), 'image/jpeg')).toEqual(['comment', 'exif', 'gps', 'iptc', 'xmp'])
  })

  it('strips them all, keeps JFIF, the ICC profile, the tables, the frame and the image data byte for byte', () => {
    const input = jpegWithMetadata()
    const out = stripImageMetadata(input, 'image/jpeg')
    expect(findImageMetadata(out, 'image/jpeg')).toEqual([])
    const text = String.fromCharCode(...out)
    for (const gone of ['Exif', 'xap/1.0', 'Photoshop', 'Mila am See']) expect(text).not.toContain(gone)
    for (const kept of ['JFIF', 'ICC_PROFILE']) expect(text).toContain(kept)
    // everything from the scan on is untouched
    const scan = (bytes: Uint8Array) => bytes.subarray(bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0xda))
    expect(scan(out)).toEqual(scan(input))
    expect(photoBytesMatch('image/jpeg', out)).toBe(true)
    expect(out.length).toBeLessThan(input.length)
  })

  it('a clean file comes back as the same array (nothing copied), and stripping twice changes nothing', () => {
    const clean = stripImageMetadata(jpegWithMetadata(), 'image/jpeg')
    expect(stripImageMetadata(clean, 'image/jpeg')).toBe(clean)
  })

  it('a broken structure is left alone (the database check still decides)', () => {
    const broken = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3])
    expect(stripImageMetadata(broken, 'image/jpeg')).toBe(broken)
  })
})

describe('WebP', () => {
  const vp8x = (flags: number) => chunk('VP8X', [flags, 0, 0, 0, 15, 0, 0, 15, 0, 0])
  const image = chunk('VP8 ', [1, 2, 3, 4, 5, 6, 7])

  it('drops EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size', () => {
    const input = webp([vp8x(0x08 | 0x04 | 0x20), chunk('ICCP', [9, 9, 9]), image, chunk('EXIF', EXIF_WITH_GPS), chunk('XMP ', ascii('<x:xmpmeta/>'))])
    expect(findImageMetadata(input, 'image/webp')).toEqual(['exif', 'xmp'])
    const out = stripImageMetadata(input, 'image/webp')
    expect(findImageMetadata(out, 'image/webp')).toEqual([])
    expect(out[20]! & 0x0c).toBe(0) // EXIF / XMP flags off
    expect(out[20]! & 0x20).toBe(0x20) // the ICC flag stays (its chunk stays)
    expect(String.fromCharCode(...out)).toContain('ICCP')
    expect(photoBytesMatch('image/webp', out)).toBe(true) // RIFF size = length − 8
  })

  it('a simple VP8 file (what a canvas writes) is returned as is', () => {
    const simple = webp([image])
    expect(findImageMetadata(simple, 'image/webp')).toEqual([])
    expect(stripImageMetadata(simple, 'image/webp')).toBe(simple)
    expect(photoBytesMatch('image/webp', simple)).toBe(true)
  })
})

describe('photoBytesMatch (the database rule)', () => {
  it('needs the start and end markers of a JPEG and the exact RIFF frame of a WebP', () => {
    expect(photoBytesMatch('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]))).toBe(true)
    expect(photoBytesMatch('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]))).toBe(false)
    expect(photoBytesMatch('image/webp', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]))).toBe(false)
    const good = webp([chunk('VP8L', [1, 2, 3, 4, 5, 6, 7, 8])])
    expect(photoBytesMatch('image/webp', good)).toBe(true)
    expect(photoBytesMatch('image/webp', Uint8Array.from([...good, 0]))).toBe(false)
    expect(photoBytesMatch('image/webp', webp([chunk('ABCD', [1, 2, 3, 4, 5, 6, 7, 8])]))).toBe(false)
  })
})
