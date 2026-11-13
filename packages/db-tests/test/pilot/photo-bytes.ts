/**
 * Synthetic cover-photo bytes for the occasion photo tests (not a test file itself).
 *
 * Valid dimension-bearing headers around deterministic filler, not compressed pixels. Real browser-
 * encoded samples independently exercise the parser in photo-dimensions.test.ts. No people or metadata.
 */

/** A deterministic filler byte (never 0xFF, so the filler can never look like a JPEG marker). */
function filler(i: number, seed: number): number {
  return (i * 31 + seed * 17) % 251
}

/** SOI + baseline one-component SOF + SOS + dummy entropy + EOI. */
export function fakeJpeg(size: number, seed = 1, width = 1600, height = 1067): Uint8Array {
  if (size < 27) throw new Error('fakeJpeg: at least 27 bytes')
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = filler(i, seed)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0], 0)
  bytes.set([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0], 15)
  bytes.set([0xff, 0xd9], size - 2)
  return bytes
}

/** RIFF plus VP8/VP8L, optionally preceded by VP8X with matching dimensions. Odd sizes are malformed. */
export function fakeWebp(size: number, seed = 1, chunk = 'VP8 ', width = 1600, height = 1067): Uint8Array {
  if (size < 30 || (chunk === 'VP8X' && size < 48)) throw new Error('fakeWebp: insufficient header space')
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = filler(i, seed)
  const ascii = (text: string, at: number) => bytes.set([...text].map((c) => c.charCodeAt(0)), at)
  ascii('RIFF', 0)
  new DataView(bytes.buffer).setUint32(4, size - 8, true)
  ascii('WEBP', 8)
  ascii(chunk, 12)
  let payload = 20
  const view = new DataView(bytes.buffer)
  if (chunk === 'VP8X') {
    view.setUint32(16, 10, true)
    bytes.fill(0, 20, 30)
    bytes.set([(width - 1) & 255, ((width - 1) >> 8) & 255, ((width - 1) >> 16) & 255], 24)
    bytes.set([(height - 1) & 255, ((height - 1) >> 8) & 255, ((height - 1) >> 16) & 255], 27)
    ascii('VP8 ', 30)
    payload = 38
  }
  view.setUint32(payload - 4, size - payload, true)
  if (chunk === 'VP8L') {
    bytes[payload] = 0x2f
    view.setUint32(payload + 1, (width - 1) | ((height - 1) << 14), true)
  } else {
    bytes.set([0x10, 0, 0, 0x9d, 1, 0x2a], payload)
    view.setUint16(payload + 6, width, true)
    view.setUint16(payload + 8, height, true)
  }
  return bytes
}

/** Standard base64 (with padding), the way the app sends p_data_base64. */
export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** The bytes back from the RPC's base64 `data` / `data_base64`. */
export function fromB64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'))
}

/** The largest photo the database takes: 400 KB. */
export const MAX_PHOTO_BYTES = 409_600
