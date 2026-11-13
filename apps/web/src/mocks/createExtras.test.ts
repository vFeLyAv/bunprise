import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../lib/database.types'

// Demo parity of "Gleich mit eintragen" (features/occasions/extras): the demo server runs exactly the requests the
// new-occasion form sends after the occasion — the real API wrappers, the real link reading (the demo Worker's
// fictional "kopfhoerer" product) and the real save pipeline (extras/send.ts) — and the occasion's screen then shows
// the wishes and the bring-along entries; a wish picked from a list has moved (not copied).

const access = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(access.client),
  hasLocalSession: () => access.client !== null,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: () => () => {},
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../lib/toast', () => ({ toast: toasts }))

import { acceptConsents } from '../lib/api/consents'
import { createList, getListScreen, newListId } from '../lib/api/lists'
import { createOccasion, getOccasionScreen, newOccasionId } from '../lib/api/occasions'
import { updateMyProfile } from '../lib/api/profile'
import { asOwnerWishes } from '../lib/api/types'
import { createWish } from '../lib/api/wishes'
import { quickWishOf, type OccasionExtras } from '../features/occasions/extras/model'
import { readLink } from '../features/occasions/extras/readLink'
import { sendOccasionExtras } from '../features/occasions/extras/send'
import { createDemoHandlers, DEMO_CODE, DEMO_SUPABASE_URL } from './handlers'

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  access.client = null
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
})

async function signIn(email: string): Promise<string> {
  const client: SupabaseClient<Database> = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `demo-extras-${email}` },
  })
  await client.auth.signInWithOtp({ email })
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(verified.error).toBeNull()
  access.client = client
  await updateMyProfile({ display_name: 'Mila', locale: 'de' })
  await acceptConsents('de')
  return verified.data.user!.id
}

describe('demo: an occasion with wishes and bring-along entries added in its form', () => {
  it('saves them right after the occasion; the screen shows them, the picked wish moved', { timeout: 15_000 }, async () => {
    const userId = await signIn('mila-extras@example.test')
    // a list of mine with one wish ("Aus meinen Listen holen")
    const listId = newListId()
    await createList({ id: listId, title: 'Geburtstag', visibility: 'private', cover_tone: null, cover_icon: null, due_on: null }, userId)
    await createWish(listId, { title: 'Teekanne', price_cents: 2500 }, userId)
    const [teapot] = asOwnerWishes((await getListScreen(listId, userId)).wishes)

    // the occasion (sections "both"), as the form's create sends it
    const occasionId = newOccasionId()
    await createOccasion({ id: occasionId, title: 'Milas Gartenfest', starts_at: '2030-06-15T16:00:00.000Z', ends_at: null, tz: 'Europe/Berlin', all_day: true, place_text: null, description: null, sections: 'both' }, userId)

    const link = 'https://shop.example/kopfhoerer'
    const extras: OccasionExtras = {
      wishes: [quickWishOf(link, 'k1', readLink(link)), quickWishOf('Puzzle mit 1000 Teilen', 'k2', null)],
      picked: [{ wish: teapot!, listId, listTitle: 'Geburtstag' }],
      items: [{ key: 'a', title: 'Salat' }, { key: 'b', title: 'Getränke' }, { key: 'c', title: 'Gartenstühle' }],
    }
    const refresh = vi.fn(async () => undefined)
    await sendOccasionExtras({ queryClient: new QueryClient(), occasionId, userId, extras, t: ((key: string) => key) as never, refresh, readWaitMs: 5_000 })
    expect(toasts.error).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)

    const screen = await getOccasionScreen(occasionId, userId)
    expect(screen.occasion.sections).toBe('both')
    const wishes = asOwnerWishes(screen.wishlist?.wishes ?? [])
    expect(wishes.map((wish) => wish.title).sort()).toEqual(['Kabellose Kopfhörer', 'Puzzle mit 1000 Teilen', 'Teekanne'])
    expect(wishes.find((wish) => wish.title === 'Kabellose Kopfhörer')).toMatchObject({ price_cents: 7999, url: link })
    expect(screen.potluck?.items.map((item) => [item.title, item.claimed])).toEqual([
      ['Salat', false],
      ['Getränke', false],
      ['Gartenstühle', false],
    ])
    // moved, not copied: the list is empty now (one wish, never given twice)
    expect((await getListScreen(listId, userId)).wishes).toEqual([])
  })
})
