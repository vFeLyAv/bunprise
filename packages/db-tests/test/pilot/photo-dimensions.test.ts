import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'
import { expectRpcError, rpc, seedPilot, type Seed } from './seed'
import { b64, fakeJpeg, fakeWebp, fromB64 } from './photo-bytes'

const fixtures = JSON.parse(readFileSync(new URL('./photo-fixtures.json', import.meta.url), 'utf8')) as {
  jpeg: string; webp: string; webpAlpha: string; wideJpeg: string; wideWebp: string
}
let t: TestDb
let s: Seed
beforeAll(async () => { t = await createTestDb(); s = await seedPilot(t) })
afterAll(() => t.close())
const dimensions = (mime: string, bytes: Uint8Array) => scalar<number[] | null>(t.db, 'select private.photo_dimensions($1, $2)', [mime, bytes])
const setPhoto = (mime: string, bytes: Uint8Array, width: number, height: number) =>
  rpc(t, s.a, 'set_occasion_photo', [s.occasionId, mime, b64(bytes), width, height])

describe('encoded photo dimensions and allocation limits', () => {
  it.each(['jpeg', 'webp', 'webpAlpha'] as const)('accepts a real browser-encoded 2x3 %s and stores verified dimensions', async (name) => {
    const mime = name === 'jpeg' ? 'image/jpeg' : 'image/webp'
    const bytes = fromB64(fixtures[name])
    expect(await dimensions(mime, bytes)).toEqual([2, 3])
    await setPhoto(mime, bytes, 2, 3)
    expect(await scalar(t.db, 'select jsonb_build_array(width, height) from occasion_photos where occasion_id=$1', [s.occasionId])).toEqual([2, 3])
    await expectRpcError(setPhoto(mime, bytes, 1, 1), 'validation')
  })

  it.each([['image/jpeg', 'wideJpeg'], ['image/webp', 'wideWebp']] as const)('rejects a real encoded 4096x1 %s claimed to be 1x1', async (mime, name) => {
    const bytes = fromB64(fixtures[name])
    expect(bytes.byteLength).toBeLessThan(409600)
    expect(await dimensions(mime, bytes)).toBeNull()
    await expectRpcError(setPhoto(mime, bytes, 1, 1), 'validation')
  })

  it.each(['VP8 ', 'VP8L', 'VP8X'])('checks actual %s dimensions and the claimed width/height independently', async (chunk) => {
    const bytes = fakeWebp(100, 1, chunk, 23, 37)
    expect(await dimensions('image/webp', bytes)).toEqual([23, 37])
    await expectRpcError(setPhoto('image/webp', bytes, 23, 36), 'validation')
    for (const [width, height] of [[2049, 1], [1, 2049], [4096, 1]]) {
      await expectRpcError(setPhoto('image/webp', fakeWebp(100, 1, chunk, width, height), 1, 1), 'validation')
    }
  })

  it('rejects VP8X canvas/bitstream disagreement, animation and duplicate frames', async () => {
    const mismatch = fakeWebp(100, 1, 'VP8X', 2, 3)
    new DataView(mismatch.buffer).setUint16(44, 4096, true)
    const animation = fakeWebp(100, 1, 'VP8X', 2, 3)
    animation[20] = 2
    const animationChunk = fakeWebp(100, 1, 'VP8X', 2, 3)
    animationChunk.set([65, 78, 77, 70], 30)
    const duplicate = new Uint8Array(12 + 2 * 28)
    const frame = fakeWebp(40, 1, 'VP8 ', 2, 3)
    duplicate.set(frame)
    duplicate.set(frame.subarray(12), 40)
    new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true)
    for (const bytes of [mismatch, animation, animationChunk, duplicate]) {
      await expectRpcError(setPhoto('image/webp', bytes, 2, 3), 'validation')
    }
  })

  it('rejects JPEG missing/duplicate frame, zero size, late DNL and oversized frame headers', async () => {
    const valid = fakeJpeg(64, 1, 2, 3)
    const noFrame = valid.slice(); noFrame[3] = 0xe0
    const zero = fakeJpeg(64, 1, 2, 0)
    const huge = fakeJpeg(64, 1, 65535, 3)
    const duplicate = new Uint8Array(77)
    duplicate.set(valid.subarray(0, 15))
    duplicate.set(valid.subarray(2, 15), 15)
    duplicate.set(valid.subarray(15), 28)
    const lateDnl = new Uint8Array(70)
    lateDnl.set(valid.subarray(0, 62))
    lateDnl.set([255, 220, 0, 4, 0x10, 0, 255, 217], 62)
    for (const bytes of [noFrame, zero, huge, duplicate, lateDnl]) {
      await expectRpcError(setPhoto('image/jpeg', bytes, 2, 3), 'validation')
    }
  })

  it('returns validation for truncations and malicious length fields, never a raw bytea exception', async () => {
    for (const [mime, bytes] of [['image/jpeg', fakeJpeg(64)], ['image/webp', fakeWebp(64)]] as const) {
      for (let length = 0; length < bytes.length; length++) {
        expect(await dimensions(mime, bytes.slice(0, length))).toBeNull()
      }
    }
    const badJpeg = fakeJpeg(64); badJpeg[4] = 255; badJpeg[5] = 255
    const badWebp = fakeWebp(64); new DataView(badWebp.buffer).setUint32(16, 0xffffffff, true)
    await expectRpcError(setPhoto('image/jpeg', badJpeg, 1600, 1067), 'validation')
    await expectRpcError(setPhoto('image/webp', badWebp, 1600, 1067), 'validation')
  })

  it('does not grant the private parser to API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await scalar(t.db, 'select has_function_privilege($1, $2, $3)', [role, 'private.photo_dimensions(text,bytea)', 'execute'])).toBe(false)
    }
  })
})
