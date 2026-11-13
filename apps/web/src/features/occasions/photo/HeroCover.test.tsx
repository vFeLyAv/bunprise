import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../lib/errors'
import { guestScreen, HOST_ID, hostScreen, renderWithClient } from '../test-utils'

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/photos')>()),
  getOccasionPhoto: api.get,
  setOccasionPhoto: api.set,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ children }: { children?: unknown }) => children
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { useRouter: () => ({ navigate: vi.fn() }), useCanGoBack: () => true, Link, createLink: () => Link }
})

import { OccasionHero } from '../OccasionHero'
import { COVER_ASPECT_RATIO } from './coverGeometry'
import type { PreparedPhoto } from './pipeline'
import { peekPhotoJob, resetPhotoUploadsForTests, startPhotoJob } from './uploads'

// The occasion hero with a cover (wave 2): laid out in the first frame (the screen's meta), the bytes asked
// for only after that frame, faded in once decoded; the host's upload on its way from memory; no photo → the
// wave-1 hero unchanged.

const META = { width: 1200, height: 800, updated_at: 'v1' }
const withCover = (screen = hostScreen()) => ({ ...screen, occasion: { ...screen.occasion, photo: META } })
const cover = () => document.querySelector<HTMLElement>('.occ-cover')
const coverBlob = new Blob(['webp'], { type: 'image/webp' })
const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])
const local: PreparedPhoto = { mime: 'image/jpeg', bytes, blob: new Blob([bytes.slice().buffer], { type: 'image/jpeg' }), width: 1600, height: 900 }

/** rAF → timeout: what useAfterFirstPaint waits for. */
async function afterFirstPaint() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPhotoUploadsForTests()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cover'), revokeObjectURL: vi.fn() }))
  api.get.mockResolvedValue({ mime: 'image/webp', blob: coverBlob, width: 1200, height: 800, updated_at: 'v1' })
})
afterEach(() => vi.restoreAllMocks())

describe('the hero cover', () => {
  it('no photo: the wave-1 hero, no cover box, nothing asked for', async () => {
    renderWithClient(<OccasionHero screen={hostScreen()} userId={HOST_ID} />)
    await afterFirstPaint()
    expect(cover()).toBeNull()
    expect(document.querySelector('header')?.classList.contains('occ-hero-covered')).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Milas Gartenfest' })).toBeTruthy()
  })

  it('with a photo: the tinted box at once, the bytes only after the first paint, then the photo fades in', async () => {
    renderWithClient(<OccasionHero screen={withCover(guestScreen())} />)
    expect(cover()?.dataset.state).toBe('loading')
    expect(cover()?.getAttribute('aria-hidden')).toBe('true')
    expect(cover()?.style.getPropertyValue('--occ-cover-ratio')).toBe(COVER_ASPECT_RATIO) // = the form's preview
    expect(api.get).not.toHaveBeenCalled() // the first frame is the screen itself
    await afterFirstPaint()
    expect(api.get).toHaveBeenCalledTimes(1)
    const img = await waitFor(() => {
      const found = cover()?.querySelector('img')
      if (!found) throw new Error('no img yet')
      return found
    })
    expect(img.getAttribute('src')).toBe('blob:cover')
    expect(img.hasAttribute('data-loaded')).toBe(false)
    fireEvent.load(img)
    expect(img.hasAttribute('data-loaded')).toBe(true)
    expect(cover()?.dataset.state).toBe('ready')
    expect(document.querySelector('header')?.classList.contains('occ-hero-covered')).toBe(true)
  })

  it('a cover that cannot be loaded stays a calm tint (the layout does not jump)', async () => {
    api.get.mockRejectedValue(new AppError('not_found'))
    renderWithClient(<OccasionHero screen={withCover()} userId={HOST_ID} />)
    await afterFirstPaint()
    await waitFor(() => expect(cover()?.dataset.state).toBe('unavailable'))
    expect(cover()?.querySelector('img')).toBeNull()
  })

  it("the host's new photo on its way shows at once from memory, with a small status pill", async () => {
    api.set.mockReturnValue(new Promise(() => {}))
    const { client } = renderWithClient(<OccasionHero screen={hostScreen()} userId={HOST_ID} />)
    await act(async () => {
      void startPhotoJob(HOST_ID, hostScreen().occasion.id, { kind: 'upload', photo: local }, client)
    })
    expect(cover()?.querySelector('img')?.getAttribute('src')).toBe('blob:cover')
    expect(screen.getByRole('status').textContent).toContain('Foto wird hochgeladen …')
    expect(api.get).not.toHaveBeenCalled() // nothing to download: the bytes are here
  })

  it('a failed upload says so and offers "Nochmal" and "Verwerfen"', async () => {
    api.set.mockRejectedValueOnce(new AppError('generic'))
    const { client } = renderWithClient(<OccasionHero screen={hostScreen()} userId={HOST_ID} />)
    await act(async () => {
      await startPhotoJob(HOST_ID, hostScreen().occasion.id, { kind: 'upload', photo: local }, client)
    })
    expect(screen.getByText('Das Titelfoto wurde nicht gespeichert.')).toBeTruthy()
    api.set.mockReturnValueOnce(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal' }))
    await waitFor(() => expect(peekPhotoJob(HOST_ID, hostScreen().occasion.id)?.status).toBe('sending'))
    expect(screen.queryByText('Das Titelfoto wurde nicht gespeichert.')).toBeNull()
  })

  it('offline: the plain explanation; "Verwerfen" forgets the photo and the hero is plain again', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    api.set.mockRejectedValueOnce(new AppError('network'))
    const { client } = renderWithClient(<OccasionHero screen={hostScreen()} userId={HOST_ID} />)
    await act(async () => {
      await startPhotoJob(HOST_ID, hostScreen().occasion.id, { kind: 'upload', photo: local }, client)
    })
    expect(screen.getByText('Offline – das Foto wird hochgeladen, sobald du wieder online bist. Lass die App bis dahin offen.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nochmal' })).toBeTruthy() // manual recovery also works when the online event is missed
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    expect(cover()).toBeNull()
  })

  it("a guest never sees another account's job (jobs are keyed by account)", async () => {
    api.set.mockReturnValue(new Promise(() => {}))
    const { client } = renderWithClient(<OccasionHero screen={guestScreen()} userId="33333333-3333-4333-8333-333333333333" />)
    await act(async () => {
      void startPhotoJob(HOST_ID, guestScreen().occasion.id, { kind: 'upload', photo: local }, client)
    })
    expect(cover()).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
