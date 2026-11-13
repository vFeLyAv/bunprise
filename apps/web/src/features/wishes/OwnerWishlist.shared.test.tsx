import type { ReactNode, Ref } from 'react'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreenWish, OccasionScreenWishlist } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { getToasts, toast } from '../../lib/toast'

// The owner's wish grid with SHARED wishes (20261027200000, design §5.7 / WS12): the quiet line "auch in „…“", the
// muted tile "Vorübergehend ausgeblendet" (only while the emergency switch hides extra places), "Aus „…“ entfernen"
// (optimistic, server-confirmed, back on a no) and the reminder "Was hast du bekommen?" after an occasion. Nothing here
// depends on reservations. The API is mocked; fictional data only.

const api = vi.hoisted(() => ({
  removeWishFromList: vi.fn<(wishId: string, listId: string, expectedUserId?: string) => Promise<void>>(),
  deleteWishEverywhere: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  dismissReceivedPrompt: vi.fn<(occasionId: string, expectedUserId?: string) => Promise<void>>(),
  setWishReceived: vi.fn<(wishId: string, received: boolean, expectedUserId?: string) => Promise<{ received_at: string | null }>>(),
}))

vi.mock('../../lib/api/wishPlaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPlaces')>()),
  removeWishFromList: api.removeWishFromList,
  deleteWishEverywhere: api.deleteWishEverywhere,
  dismissReceivedPrompt: api.dismissReceivedPrompt,
}))
vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  setWishReceived: api.setWishReceived,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return <a href={href} className={className}>{children}</a>
  }
  return { Link, createLink: () => Link }
})
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => () => Promise.resolve() }))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref }: { ref?: Ref<unknown> }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined }), [])
    return <div data-testid="mascot" />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { OwnerWishlist } from './OwnerWishlist'
import { resetPendingWishDeletes } from './pendingDeletes'

const ME = '00000000-0000-4000-8000-0000000000aa'
const OCCASION = '22222222-2222-4222-8222-222222222222'
const PARTY_LIST = '11111111-1111-4111-8111-111111111111'
const MY_WISHES = '11111111-1111-4111-8111-111111111112'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

function wish(id: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title: `Wunsch ${id.slice(-1).toUpperCase()}`, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved: null, reserved_by_me: null, photo: null, received_at: null, ...overrides,
  }
}
const sharedPlace = { id: MY_WISHES, title: 'Meine Wünsche', kind: 'standalone' as const, occasion_id: null, home: true, paused: false }

function renderOwner(wishlist: OccasionScreenWishlist) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <OwnerWishlist wishlist={wishlist} occasionId={OCCASION} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { queryClient, invalidate }
}

const list = (wishes: OccasionScreenWish[], extra: Partial<OccasionScreenWishlist> = {}): OccasionScreenWishlist =>
  ({ id: PARTY_LIST, owner_id: ME, title: 'Sommerfest', wishes, received: [], photo: null, ...extra })
const tile = (id: string) => document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)

beforeAll(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterAll(() => {
  MotionGlobalConfig.instantAnimations = false
})
beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  resetPendingWishDeletes()
  toast.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  resetPendingWishDeletes()
  resetAccountBoundaryForTests()
})

describe('owner tiles of shared wishes', () => {
  it('says where else a wish lives; a wish only here says nothing', () => {
    renderOwner(list([wish(A, { title: 'Kopfhörer', home: false, paused: false, also_in: [sharedPlace] }), wish(B, { title: 'Buch', home: true, also_in: [] })]))
    expect(within(tile(A)!).getByText('auch in „Meine Wünsche“')).toBeTruthy()
    expect(tile(B)!.querySelector('[data-wish-places]')).toBeNull()
  })

  it('WS12: an extra place hidden by the emergency switch is a muted tile "Vorübergehend ausgeblendet"; its menu is unchanged', () => {
    renderOwner(list([wish(A, { title: 'Kopfhörer', home: false, paused: true, also_in: [sharedPlace] })]))
    expect(tile(A)!.hasAttribute('data-muted')).toBe(true)
    expect(within(tile(A)!).getByText('Vorübergehend ausgeblendet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' }))
    expect(within(screen.getByRole('dialog', { name: 'Kopfhörer' })).getByRole('button', { name: 'Aus „Sommerfest“ entfernen' })).toBeTruthy()
  })

  it('"Aus „Sommerfest“ entfernen": gone at once, server-confirmed, every screen family refetches', async () => {
    let resolve: () => void = () => undefined
    api.removeWishFromList.mockReturnValue(new Promise<void>((res) => { resolve = res }))
    const { invalidate } = renderOwner(list([wish(A, { title: 'Kopfhörer', also_in: [sharedPlace] })]))
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Kopfhörer' })).getByRole('button', { name: 'Aus „Sommerfest“ entfernen' }))
    expect(api.removeWishFromList).toHaveBeenCalledWith(A, PARTY_LIST, ME)
    await waitFor(() => expect(tile(A)).toBeNull())
    resolve()
    await waitFor(() => expect(getToasts().map((item) => item.text)).toContain('Aus „Sommerfest“ entfernt – in deinen anderen Listen bleibt er.'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['free-wishes'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gifts'] })
  })

  it('a refusal brings the tile back and says why', async () => {
    api.removeWishFromList.mockRejectedValue(Object.assign(new Error('x'), { code: 'P0001', message: 'validation', details: null, hint: null }))
    renderOwner(list([wish(A, { title: 'Kopfhörer', also_in: [sharedPlace] })]))
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Kopfhörer' })).getByRole('button', { name: 'Aus „Sommerfest“ entfernen' }))
    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0))
    await waitFor(() => expect(tile(A)).not.toBeNull())
  })
})

describe('"Was hast du bekommen?"', () => {
  it('shows only when the server says so; the sheet ticks "Erhalten" and "Fertig" closes it for good', async () => {
    api.setWishReceived.mockResolvedValue({ received_at: '2026-10-27T10:00:00Z' })
    api.dismissReceivedPrompt.mockResolvedValue(undefined)
    renderOwner(list([wish(A, { title: 'Kopfhörer' }), wish(B, { title: 'Buch' })], { received_prompt: true }))
    fireEvent.click(screen.getByRole('button', { name: /Was hast du bekommen\?/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Was hast du bekommen?' }, { timeout: 3000 })
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Kopfhörer' }))
    expect(api.setWishReceived).toHaveBeenCalledWith(A, true, ME)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }))
    await waitFor(() => expect(api.dismissReceivedPrompt).toHaveBeenCalledWith(OCCASION, ME))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Was hast du bekommen\?/ })).toBeNull())
  })

  it('no key (a guest-shaped or older answer) or false: no reminder', () => {
    renderOwner(list([wish(A)], { received_prompt: false }))
    expect(screen.queryByRole('button', { name: /Was hast du bekommen\?/ })).toBeNull()
  })
})
