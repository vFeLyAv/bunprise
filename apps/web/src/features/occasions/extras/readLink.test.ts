import { afterEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests } from '../../../lib/accountBoundary'
import { LinkPreviewError, type LinkPreview } from '../../../lib/api/linkPreview'
import type { PreparedPhoto } from '../photo/pipeline'
import { readLink } from './readLink'

// Reading a pasted link for a quick wish (extras/readLink.ts): our Worker's preview, then the photo through our
// Worker, prepared on the device; every failure is calm. Fictional, reserved example addresses only.

const LINK = 'https://www.kuechenkontor.example/kaffeemuehle-kegel'
const IMAGE = 'https://img.kuechenkontor.example/kegel.jpg'
const PHOTO = { mime: 'image/webp', width: 10, height: 10, blob: new Blob(['p']) } as unknown as PreparedPhoto

function preview(patch: Partial<LinkPreview> = {}): LinkPreview {
  return { url: LINK, site: 'Küchenkontor', title: 'Handkaffeemühle', priceCents: 4990, partial: false, imageUrl: IMAGE, ...patch }
}

afterEach(() => resetAccountBoundaryForTests())

describe('readLink', () => {
  it('the preview, then the product photo — both through our Worker', async () => {
    const fetchPreview = vi.fn(async () => preview())
    const fetchImage = vi.fn(async () => new Blob(['raw']))
    const prepare = vi.fn(async () => PHOTO)
    await expect(readLink(LINK, { fetchPreview, fetchImage, prepare })).resolves.toEqual({ preview: preview(), photo: PHOTO })
    expect(fetchPreview).toHaveBeenCalledWith(LINK, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(fetchImage).toHaveBeenCalledWith(IMAGE, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('no picture or a picture that fails: the answer stays, without a photo', async () => {
    await expect(readLink(LINK, { fetchPreview: async () => preview({ imageUrl: null }) })).resolves.toEqual({ preview: preview({ imageUrl: null }), photo: null })
    const failing = { fetchPreview: async () => preview(), fetchImage: async () => Promise.reject(new Error('502')), prepare: async () => PHOTO }
    await expect(readLink(LINK, failing)).resolves.toEqual({ preview: preview(), photo: null })
  })

  it('no answer: the Worker’s code (offline, …), never a throw', async () => {
    await expect(readLink(LINK, { fetchPreview: async () => Promise.reject(new LinkPreviewError('offline')) })).resolves.toEqual({ preview: null, photo: null, code: 'offline' })
    await expect(readLink(LINK, { fetchPreview: async () => Promise.reject(new Error('?')) })).resolves.toEqual({ preview: null, photo: null, code: 'unavailable' })
  })

  it('gives up after its time', async () => {
    const hanging = (_url: string, options: { signal?: AbortSignal } = {}) =>
      new Promise<LinkPreview>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    await expect(readLink(LINK, { fetchPreview: hanging, timeoutMs: 10 })).resolves.toEqual({ preview: null, photo: null, code: 'timeout' })
  })

  it('an answer for an account that ended in this tab is dropped', async () => {
    const fetchPreview = async () => {
      endAccountEpoch()
      return preview()
    }
    await expect(readLink(LINK, { fetchPreview })).resolves.toEqual({ preview: null, photo: null })
  })
})
