import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../../lib/accountBoundary'
import type { LinkPreview } from '../../../lib/api/linkPreview'
import type { OwnerWish } from '../../../lib/api/types'
import { AppError } from '../../../lib/errors'
import { SharedWishesOffError } from '../../../lib/api/wishPlaces'
import type { PreparedPhoto } from '../photo/pipeline'
import { HOST_ID, OCCASION_ID, hostScreen } from '../test-utils'

// Saving what was added in the new-occasion form (extras/send.ts), against mocked API wrappers: the order, the
// waiting for a link, the one toast with "Nochmal" for what did not arrive, and the account boundary.

const api = vi.hoisted(() => ({
  addPotluckItem: vi.fn(),
  getOccasionScreen: vi.fn(),
  createWish: vi.fn(),
  moveWish: vi.fn(),
  saveWishPhoto: vi.fn(),
  addWishesToList: vi.fn(),
  calls: [] as string[],
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('../../../lib/api/potluck', () => ({ addPotluckItem: api.addPotluckItem }))
vi.mock('../../../lib/api/occasions', () => ({ getOccasionScreen: api.getOccasionScreen }))
vi.mock('../../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/wishes')>()),
  createWish: api.createWish,
  moveWish: api.moveWish,
}))
vi.mock('../../../lib/api/wishPlaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/wishPlaces')>()),
  addWishesToList: api.addWishesToList,
}))
vi.mock('../../wishes/wishPhotos', () => ({ saveWishPhoto: api.saveWishPhoto }))
vi.mock('../../../lib/toast', () => ({ toast: toasts }))

import type { OccasionExtras, QuickWish } from './model'
import { sendExtras, sendOccasionExtras, type SendExtrasOptions } from './send'

const LIST_ID = hostScreen().wishlist!.id
const LINK = 'https://www.kuechenkontor.example/kaffeemuehle-kegel'
const PHOTO = { blob: new Blob(['x'], { type: 'image/webp' }), mime: 'image/webp', width: 10, height: 10 } as unknown as PreparedPhoto

function preview(): LinkPreview {
  return { url: LINK, site: 'Küchenkontor', title: 'Handkaffeemühle', priceCents: 4990, partial: false, imageUrl: 'https://img.kuechenkontor.example/k.jpg' }
}

const typed = (key: string, title: string): QuickWish => ({ key, typed: title, url: null, read: null, answer: null })
const picked = (id: string, title: string) => ({ wish: { id, title } as OwnerWish, listId: 'list-b', listTitle: 'Geburtstag' })

let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>
const t = ((key: string, options?: { count?: number }) => (options?.count !== undefined ? `${key}:${options.count}` : key)) as unknown as SendExtrasOptions['t']

function options(extras: OccasionExtras, patch: Partial<SendExtrasOptions> = {}): SendExtrasOptions {
  return { queryClient: new QueryClient(), occasionId: OCCASION_ID, userId: HOST_ID, extras, t, refresh, readWaitMs: 50, ...patch }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  setRenderedAccount(HOST_ID)
  api.calls = []
  refresh = vi.fn<() => Promise<void>>(async () => {
    api.calls.push('refresh')
  })
  api.addPotluckItem.mockImplementation(async (_occasion: string, title: string) => {
    api.calls.push(`item:${title}`)
    return { id: `id-${title}` }
  })
  api.getOccasionScreen.mockImplementation(async () => {
    api.calls.push('screen')
    return hostScreen()
  })
  api.createWish.mockImplementation(async (listId: string, input: { title: string }) => {
    api.calls.push(`wish:${input.title}@${listId === LIST_ID ? 'list' : listId}`)
    return { id: `w-${input.title}` }
  })
  api.saveWishPhoto.mockImplementation(async (_qc: unknown, wishId: string) => {
    api.calls.push(`photo:${wishId}`)
    return { ok: true }
  })
  api.moveWish.mockImplementation(async (wishId: string, target: string) => {
    api.calls.push(`move:${wishId}@${target === LIST_ID ? 'list' : target}`)
  })
})
afterEach(() => {
  resetAccountBoundaryForTests()
  vi.unstubAllEnvs()
})

describe('saving the extras of a new occasion', () => {
  it('one at a time, in the form’s order: entries, the list’s id once, wishes (photo after each), moves — then one refresh', async () => {
    const extras: OccasionExtras = {
      items: [{ key: 'a', title: 'Salat' }, { key: 'b', title: 'Getränke' }],
      wishes: [
        { key: 'k', typed: '', url: LINK, read: null, answer: { preview: preview(), photo: PHOTO } },
        typed('p', 'Puzzle'),
      ],
      picked: [picked('w-old', 'Teekanne')],
    }
    await sendOccasionExtras(options(extras))
    expect(api.calls).toEqual([
      'item:Salat',
      'item:Getränke',
      'screen',
      'wish:Handkaffeemühle@list',
      'photo:w-Handkaffeemühle',
      'wish:Puzzle@list',
      'move:w-old@list',
      'refresh',
    ])
    // entries are free (nobody brings them yet), pinned to the account of the create
    expect(api.addPotluckItem).toHaveBeenCalledWith(OCCASION_ID, 'Salat', false, HOST_ID)
    expect(api.createWish).toHaveBeenCalledWith(LIST_ID, expect.objectContaining({ price_cents: 4990, url: LINK, shop_name: 'Küchenkontor' }), HOST_ID)
    expect(toasts.error).not.toHaveBeenCalled()
    expect(toasts.info).not.toHaveBeenCalled()
  })

  it('only bring-along entries: no screen request of its own', async () => {
    await sendOccasionExtras(options({ wishes: [], picked: [], items: [{ key: 'a', title: 'Salat' }] }))
    expect(api.calls).toEqual(['item:Salat', 'refresh'])
  })

  it('a link still being read holds its wish up a moment, then it is saved with the link and the shop’s name', async () => {
    const wish: QuickWish = { key: 'k', typed: '', url: LINK, read: new Promise(() => {}), answer: null }
    await sendOccasionExtras(options({ wishes: [wish], picked: [], items: [] }, { readWaitMs: 20 }))
    expect(api.createWish).toHaveBeenCalledWith(LIST_ID, expect.objectContaining({ title: 'kuechenkontor.example', url: LINK, price_cents: null }), HOST_ID)
  })

  it('an answer that arrives in time is used', async () => {
    const wish: QuickWish = { key: 'k', typed: '', url: LINK, read: Promise.resolve({ preview: preview(), photo: null }), answer: null }
    await sendOccasionExtras(options({ wishes: [wish], picked: [], items: [] }))
    expect(api.createWish).toHaveBeenCalledWith(LIST_ID, expect.objectContaining({ title: 'Handkaffeemühle' }), HOST_ID)
    expect(api.saveWishPhoto).not.toHaveBeenCalled()
  })

  it('what did not arrive: ONE toast with the count and the reason; "Nochmal" sends only the missing ones', async () => {
    api.addPotluckItem.mockImplementationOnce(async () => {
      throw new AppError('consent_required')
    })
    api.createWish.mockImplementationOnce(async () => {
      throw new AppError('network')
    })
    const extras: OccasionExtras = { items: [{ key: 'a', title: 'Salat' }, { key: 'b', title: 'Kuchen' }], wishes: [typed('p', 'Puzzle'), typed('q', 'Buch')], picked: [] }
    await sendOccasionExtras(options(extras))
    expect(toasts.error).toHaveBeenCalledTimes(1)
    const [text, toastOptions] = toasts.error.mock.calls[0] as [string, { actionLabel: string; onAction: () => void }]
    expect(text).toBe(`occasionForm.extras_failed:2 ${'errors.consent_required'}`)
    expect(toastOptions.actionLabel).toBe('common.retry')
    expect(refresh).toHaveBeenCalledTimes(1) // what did arrive shows anyway

    api.calls = []
    toastOptions.onAction()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(api.calls).toEqual(['item:Salat', 'screen', 'wish:Puzzle@list', 'refresh'])
    expect(toasts.error).toHaveBeenCalledTimes(1)
  })

  it('"Nochmal" does nothing for another account', async () => {
    api.addPotluckItem.mockRejectedValueOnce(new AppError('network'))
    await sendOccasionExtras(options({ items: [{ key: 'a', title: 'Salat' }], wishes: [], picked: [] }))
    const [, toastOptions] = toasts.error.mock.calls[0] as [string, { onAction: () => void }]
    setRenderedAccount('someone-else')
    api.calls = []
    toastOptions.onAction()
    await Promise.resolve()
    expect(api.calls).toEqual([])
  })

  it('no list on the screen (not mine): the wishes do not arrive and say so; the entries do', async () => {
    api.getOccasionScreen.mockResolvedValueOnce({ ...hostScreen(), wishlist: null })
    const outcome = await sendExtras(options({ items: [{ key: 'a', title: 'Salat' }], wishes: [typed('p', 'Puzzle')], picked: [picked('w-old', 'Teekanne')] }))
    expect(api.createWish).not.toHaveBeenCalled()
    expect(api.moveWish).not.toHaveBeenCalled()
    expect(outcome?.failed.wishes.map((wish) => wish.key)).toEqual(['p'])
    expect(outcome?.failed.picked).toHaveLength(1)
    expect(outcome?.failed.items).toEqual([])
  })

  it('a photo that did not arrive is said calmly; the wish stays', async () => {
    api.saveWishPhoto.mockResolvedValueOnce({ ok: false })
    await sendOccasionExtras(options({ items: [], picked: [], wishes: [{ key: 'k', typed: '', url: LINK, read: null, answer: { preview: preview(), photo: PHOTO } }] }))
    expect(toasts.error).not.toHaveBeenCalled()
    expect(toasts.info).toHaveBeenCalledWith('occasionForm.extras_photo_failed:1')
  })

  it('the account ended on the way: nothing more is sent, nothing refreshed, nothing said', async () => {
    api.addPotluckItem.mockImplementationOnce(async () => {
      endAccountEpoch()
      return { id: 'x' }
    })
    const outcome = await sendExtras(options({ items: [{ key: 'a', title: 'Salat' }, { key: 'b', title: 'Kuchen' }], wishes: [typed('p', 'Puzzle')], picked: [] }))
    expect(outcome).toBeNull()
    expect(api.addPotluckItem).toHaveBeenCalledTimes(1)
    expect(api.getOccasionScreen).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(toasts.error).not.toHaveBeenCalled()
  })
})

// ONE WISH IN SEVERAL LISTS (20261027200000, VITE_SHARED_WISHES): the picked wishes are added in ONE call and stay in
// their own lists; a server that cannot share yet (no migration / switch off) gets the old moves instead.
describe('picked wishes with shared wishes on', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SHARED_WISHES', '1')
    api.addWishesToList.mockImplementation(async (listId: string, ids: string[]) => {
      api.calls.push(`add:${ids.join(',')}@${listId === LIST_ID ? 'list' : listId}`)
      return { added: ids.length }
    })
  })

  it('adds every picked wish in one call — nothing moves', async () => {
    await sendOccasionExtras(options({ wishes: [], items: [], picked: [picked('w-a', 'Teekanne'), picked('w-b', 'Tasse')] }))
    expect(api.calls).toEqual(['screen', 'add:w-a,w-b@list', 'refresh'])
    expect(api.addWishesToList).toHaveBeenCalledWith(LIST_ID, ['w-a', 'w-b'], HOST_ID)
    expect(api.moveWish).not.toHaveBeenCalled()
  })

  it('the database cannot share yet: they move one by one, like before', async () => {
    api.addWishesToList.mockRejectedValue(new SharedWishesOffError())
    const outcome = await sendExtras(options({ wishes: [], items: [], picked: [picked('w-a', 'Teekanne')] }))
    expect(api.calls).toEqual(['screen', 'move:w-a@list', 'refresh'])
    expect(outcome?.failed.picked).toEqual([])
  })

  it('another refusal: every picked wish is reported missing (and sent again by "Nochmal")', async () => {
    api.addWishesToList.mockRejectedValue(new AppError('limit_reached'))
    const outcome = await sendExtras(options({ wishes: [], items: [], picked: [picked('w-a', 'Teekanne'), picked('w-b', 'Tasse')] }))
    expect(outcome?.failed.picked.map((entry) => entry.wish.id)).toEqual(['w-a', 'w-b'])
    expect(outcome?.error?.code).toBe('limit_reached')
    expect(api.moveWish).not.toHaveBeenCalled()
  })
})
