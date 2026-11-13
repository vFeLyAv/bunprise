import type { ReactNode, Ref } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreenWish, OccasionScreenWishlist } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { toast } from '../../lib/toast'

// The giver's view of a list (lists wave 2, Felix 22.10): what the owner already received sits collapsed under
// "Schon erhalten", quieter, with the "Erhalten" mark — and cannot be reserved any more (the database refuses a new
// reservation of a received wish anyway). The reservation API is mocked and never called here; fictional data only.

const api = vi.hoisted(() => ({
  reserve: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  cancel: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
}))

vi.mock('../../lib/api/reservations', () => ({ reserveWish: api.reserve, cancelReservation: api.cancel, getMyReservations: vi.fn() }))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>
  return { Link, createLink: () => Link }
})
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref, scene }: { ref?: Ref<unknown>; scene?: string }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined }), [])
    return <div data-testid="mascot" data-scene={scene ?? ''} />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { GuestWishlist } from './GuestWishlist'
import ownerSource from './OwnerWishlist.tsx?raw'

const ME = 'viewer-profile'
const LIST = '88888888-8888-4888-8888-888888888888'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

function wish(id: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title: `Wunsch ${id.slice(-1).toUpperCase()}`, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved: false, reserved_by_me: false, photo: null, received_at: null, ...overrides,
  }
}

const open = () => wish(A, { title: 'Kopfhörer', priority: 3 })
/** received, nobody had reserved it */
const teapot = () => wish(B, { title: 'Teekanne', received_at: '2026-10-22T09:00:00Z' })
/** received, I had reserved it (I see that my gift arrived) */
const camera = () => wish(C, { title: 'Sofortbildfilm', received_at: '2026-10-21T09:00:00Z', reserved: true, reserved_by_me: true })

function list(wishes: OccasionScreenWish[], received: OccasionScreenWish[]): OccasionScreenWishlist {
  return { id: LIST, owner_id: 'paula-profile', title: 'Weihnachten', wishes, received, photo: null }
}

function renderGuest(wishlist: OccasionScreenWishlist) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <GuestWishlist
          wishlist={wishlist}
          standalone={{ listId: LIST, ownerName: 'Paula', limitText: 'Du hast schon 5 Wünsche von Paula reserviert.', onSettled: () => undefined }}
        />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

const ids = (els: Iterable<Element>) => [...els].map((el) => el.getAttribute('data-wish-id') ?? '')
const openIds = () => ids([...document.querySelectorAll('[data-wish-id]')].filter((el) => !el.closest('[data-received-section]')))
const receivedIds = () => ids(document.querySelectorAll('[data-received-section] [data-wish-id]'))
const receivedToggle = () => screen.getByRole('button', { name: /^Schon erhalten:/ })

function tile(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`tile ${id} not rendered`)
  return el
}

function openTile(id: string): HTMLElement {
  fireEvent.click(tile(id).querySelector('button.wt-open') as HTMLButtonElement)
  return screen.getByRole('dialog')
}

beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.localStorage.clear()
  toast.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  toast.clear()
  window.localStorage.clear()
})

describe('GuestWishlist: "Schon erhalten"', () => {
  it('received wishes sit under a collapsed "Schon erhalten" toggle with their count, apart from the open ones', () => {
    renderGuest(list([open()], [teapot(), camera()]))
    expect(openIds()).toEqual([A])
    const toggle = receivedToggle()
    expect(toggle.getAttribute('aria-label')).toBe('Schon erhalten: 2 Wünsche')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Schon erhalten')
    expect(toggle.querySelector('.wr-count')?.textContent).toBe('2')
    expect(receivedIds()).toEqual([])
  })

  it('open: the received tiles are muted, carry the "Erhalten" mark and no reservation chip', () => {
    renderGuest(list([open()], [teapot(), camera()]))
    const toggle = receivedToggle()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(receivedIds()).toEqual([B, C]) // the server's order (newest first)
    for (const id of [B, C]) {
      expect(tile(id).hasAttribute('data-muted')).toBe(true)
      expect(tile(id).querySelector('.wt-badge')?.textContent).toBe('Erhalten')
      expect(tile(id).querySelector('.wt-status')).toBeNull()
    }
    expect(tile(C).textContent).not.toMatch(/Reserviert|Von dir/)
    expect(tile(A).hasAttribute('data-muted')).toBe(false)
  })

  it('a received wish’s sheet offers no reservation: the calm note instead of "Ich schenke das"', () => {
    renderGuest(list([open()], [teapot()]))
    fireEvent.click(receivedToggle())
    const dialog = openTile(B)
    expect(within(dialog).getByText('Schon erhalten – das muss niemand mehr schenken.')).toBeTruthy()
    expect(dialog.querySelector('[data-received-note]')).not.toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Ich schenke das|Reservierung aufheben/ })).toBeNull()
    expect(within(dialog).queryByText('Die Person mit dem Wunsch sieht das nicht')).toBeNull()
    expect(api.reserve).not.toHaveBeenCalled()
  })

  it('my own gift that arrived: "Von dir reserviert" in its sheet, but still no reservation action', () => {
    renderGuest(list([open()], [camera()]))
    fireEvent.click(receivedToggle())
    const dialog = openTile(C)
    expect(within(dialog).getByText('Von dir reserviert')).toBeTruthy()
    expect(within(dialog).getByText('Schon erhalten – das muss niemand mehr schenken.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Ich schenke das|Reservierung aufheben/ })).toBeNull()
    expect(api.cancel).not.toHaveBeenCalled()
  })

  it('an open wish next to them keeps its reservation action', () => {
    renderGuest(list([open()], [teapot()]))
    const dialog = openTile(A)
    expect(within(dialog).getByRole('button', { name: 'Ich schenke das' })).toBeTruthy()
  })

  it('everything received: a calm line instead of the empty state, and the toggle', () => {
    renderGuest(list([], [teapot()]))
    expect(screen.getByText('Alles hier ist schon erhalten. Schau später nochmal rein.')).toBeTruthy()
    expect(screen.queryByText('Noch keine Wünsche')).toBeNull()
    expect(receivedToggle().getAttribute('aria-label')).toBe('Schon erhalten: 1 Wunsch')
  })
})

// Felix 26.10 «Psst с тапси хорошо, оставляем» (27.10 in the app): the reservation moment ends with Tapsi sealing the
// secret (the package's scene 'secret'). Secrecy: only the giver's own sheet, only after the server said yes.
describe('GuestWishlist: the reservation moment «Psst»', () => {
  it('Tapsi plays the scene "secret" only after the server confirmed the reservation', async () => {
    let confirm!: () => void
    api.reserve.mockImplementation(() => new Promise<void>((resolve) => { confirm = resolve }))
    renderGuest(list([open()], []))
    const dialog = openTile(A)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ich schenke das' }))
    // waiting for the server: no hamster, no moment
    expect(within(dialog).queryByTestId('mascot')).toBeNull()
    await act(async () => { confirm() })
    const tapsi = await within(dialog).findByTestId('mascot')
    expect(tapsi.dataset['scene']).toBe('secret')
  })

  it('a refused reservation brings no hamster at all', async () => {
    api.reserve.mockRejectedValue(new Error('refused'))
    renderGuest(list([open()], []))
    const dialog = openTile(A)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ich schenke das' }))
    await waitFor(() => expect(api.reserve).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(within(dialog).queryByTestId('mascot')).toBeNull()
  })

  it('the owner never gets it: the owner screen has no reservation moment at all', () => {
    expect(ownerSource).not.toMatch(/HamsterCheer|'secret'/)
  })
})
