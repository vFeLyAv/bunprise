import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OccasionScreen } from '../../lib/api/types'

// Test helpers of the occasions feature (fixtures with invented names, no real data).

export const OCCASION_ID = '11111111-1111-4111-8111-111111111111'
export const HOST_ID = '22222222-2222-4222-8222-222222222222'
export const GUEST_ID = '33333333-3333-4333-8333-333333333333'
export const OTHER_GUEST_ID = '44444444-4444-4444-8444-444444444444'

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

export function renderWithClient(ui: ReactElement, client: QueryClient = makeQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </QueryClientProvider>
  )
  return { client, ...render(ui, { wrapper }) }
}

/** What the host gets from get_occasion_screen: reservation flags are literal nulls. */
export function hostScreen(patch: Partial<OccasionScreen> = {}): OccasionScreen {
  return {
    occasion: {
      id: OCCASION_ID,
      title: 'Milas Gartenfest',
      starts_at: '2030-06-15T16:00:00.000Z',
      tz: 'Europe/Berlin',
      all_day: false,
      place_text: 'Café am Markt',
      description: 'Bring gute Laune mit.',
      created_at: '2030-01-01T10:00:00.000Z',
      host: { id: HOST_ID, display_name: 'Mila' },
    },
    viewer: { role: 'host', rsvp: 'going' },
    members: [
      { profile_id: HOST_ID, display_name: 'Mila', role: 'host', rsvp: 'going' },
      { profile_id: GUEST_ID, display_name: 'Jonas', role: 'member', rsvp: 'none' },
      { profile_id: OTHER_GUEST_ID, display_name: 'Ida', role: 'member', rsvp: 'maybe' },
    ],
    invite: null,
    wishlist: {
      id: '55555555-5555-4555-8555-555555555555',
      owner_id: HOST_ID,
      title: 'Milas Gartenfest',
      wishes: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          title: 'Thermoskanne',
          url: null,
          price_cents: 4999,
          currency: 'EUR',
          note: null,
          priority: 3,
          created_at: '2030-01-02T10:00:00.000Z',
          reserved: null,
          reserved_by_me: null,
        },
      ],
    },
    ...patch,
  }
}

/** The same occasion as Jonas (a guest) sees it. */
export function guestScreen(patch: Partial<OccasionScreen> = {}): OccasionScreen {
  const base = hostScreen()
  return {
    ...base,
    viewer: { role: 'member', rsvp: 'none' },
    invite: null,
    wishlist: base.wishlist && {
      ...base.wishlist,
      wishes: base.wishlist.wishes.map((wish) => ({ ...wish, reserved: true, reserved_by_me: false })),
    },
    ...patch,
  }
}

/** A promise you settle from the test (for "while the server is still answering" checks). */
export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
