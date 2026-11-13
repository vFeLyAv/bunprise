export const NOW = Date.UTC(2026, 9, 20, 12)
export const SUPABASE_URL = 'https://project.supabase.co'

export async function jwtFixture() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  )
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const jwks = { keys: [{ ...publicKey, kid: 'fixture-key', alg: 'ES256', use: 'sig' }] }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = async (subject = 'fixture-user') => {
    const body = `${encode({ alg: 'ES256', kid: 'fixture-key' })}.${encode({
      exp: NOW / 1000 + 3600, iss: `${SUPABASE_URL}/auth/v1`,
      aud: 'authenticated', role: 'authenticated', sub: subject,
    })}`
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(body),
    )
    return `${body}.${Buffer.from(signature).toString('base64url')}`
  }
  return { jwks, token }
}

export function feature(properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    properties: { osm_type: 'N', osm_id: 123, ...properties },
    geometry: { type: 'Point', coordinates: [10.45, 51.16] },
  }
}

export const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0))

export function padded(head: readonly number[], size = 256): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size)
  bytes.set(head)
  return bytes
}

const be32 = (value: number): number[] => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
const le16 = (value: number): number[] => [value & 255, (value >>> 8) & 255]
const le32 = (value: number): number[] => [...le16(value & 0xffff), ...le16(value >>> 16)]

/** Shop icon fixtures: valid headers with real dimensions (not decodable pictures). */
export const iconFixtures = {
  png: (width: number, height = width, size = 128) =>
    padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...be32(width), ...be32(height)], size),
  gif: (width: number, height = width) => padded([...ascii('GIF89a'), ...le16(width), ...le16(height)], 64),
  webp: (width: number, height = width) =>
    padded([...ascii('RIFF'), 0x40, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0x10, 0, 0, 0,
      ...le32(width - 1).slice(0, 3), ...le32(height - 1).slice(0, 3)], 64),
  jpeg: (width: number, height = width) =>
    padded([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
      0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3], 96),
  /** A Windows icon with one embedded PNG frame per given size (0 = 256). */
  ico: (...sizes: number[]) => {
    const frames = sizes.map(() => Array.from(padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 32)))
    let offset = 6 + 16 * sizes.length
    const directory = sizes.flatMap((size, index) => {
      const entry = [size & 255, size & 255, 0, 0, 1, 0, 32, 0, ...le32(frames[index]!.length), ...le32(offset)]
      offset += frames[index]!.length
      return entry
    })
    return new Uint8Array([0, 0, 1, 0, ...le16(sizes.length), ...directory, ...frames.flat()])
  },
} as const

/** Minimal byte prefixes with valid magic numbers; not decodable pictures. */
export const imageFixtures = {
  'image/jpeg': padded([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF')]),
  'image/png': padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR')]),
  'image/gif': padded(ascii('GIF89a')),
  'image/webp': padded([...ascii('RIFF'), 0xf8, 0, 0, 0, ...ascii('WEBPVP8 ')]),
  'image/avif': padded([0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avifmif1miaf')]),
} as const
