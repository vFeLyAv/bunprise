import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../lib/database.types'

// The app's own API wrappers (src/lib/api) against the demo server: proves the mock answers exactly
// the requests the screens will send, and that failures arrive as the AppError codes they translate.
const access = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(access.client),
  hasLocalSession: () => access.client !== null,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: () => () => {},
}))

import { exportMyData } from '../lib/api/account'
import { acceptConsents } from '../lib/api/consents'
import { acceptInvite, createInvite, isInviteActive, isInviteTokenShape, listInvites, revokeInvite } from '../lib/api/invites'
import {
  createOccasion, deleteOccasion, getFeed, getOccasionScreen, leaveOccasion, newOccasionId, removeMember, setRsvp, updateOccasion,
} from '../lib/api/occasions'
import { updateMyProfile } from '../lib/api/profile'
import { cancelReservation, getMyReservations, reserveWish } from '../lib/api/reservations'
import { asGuestWishes, asOwnerWishes } from '../lib/api/types'
import { createWish, deleteWish, getWish, updateWish } from '../lib/api/wishes'
import { createDemoHandlers, DEMO_CODE, DEMO_INVITE_TOKEN, DEMO_OCCASIONS, DEMO_RESERVED_WISH_ID, DEMO_SUPABASE_URL } from './handlers'

type Client = SupabaseClient<Database>

const server = setupServer()
let clientCount = 0

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.spyOn(console, 'debug').mockImplementation(() => {}) // toAppError logs every mapped error in DEV
})
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  access.client = null
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
})

/** Signs a new demo account in on its own client and makes it the "current device". */
async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `demo-wrappers-${clientCount++}` },
  })
  await client.auth.signInWithOtp({ email })
  expect((await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })).error).toBeNull()
  access.client = client
  return client
}

/** Sign-in + the /welcome/profile step through the same wrappers the profile screen uses. */
async function becomes(email: string, name: string): Promise<Client> {
  const client = await signIn(email)
  await updateMyProfile({ display_name: name, locale: 'de' })
  await acceptConsents('de')
  return client
}

const use = (client: Client): void => { access.client = client }

describe('lib/api wrappers against the demo server', () => {
  it('host: create the occasion with a client id, add and edit wishes, invite, rename, delete', async () => {
    await becomes('mila@example.test', 'Mila')
    const occasionId = newOccasionId()
    expect(await createOccasion({ id: occasionId, title: '  Milas Geburtstag ', starts_at: '2026-12-12T17:00:00.000Z', tz: 'Europe/Berlin', all_day: false, place_text: 'Stadtpark' }))
      .toEqual({ occasionId })
    const screen = await getOccasionScreen(occasionId)
    expect(screen.occasion).toMatchObject({ id: occasionId, title: 'Milas Geburtstag', all_day: false, place_text: 'Stadtpark' })
    expect(screen.viewer).toEqual({ role: 'host', rsvp: 'going' })
    const wishlistId = screen.wishlist!.id
    const headphones = await createWish(wishlistId, { title: ' Kopfhörer ', price_cents: 4990, url: 'https://example.com/k', priority: 3 })
    expect(headphones).toMatchObject({ wishlist_id: wishlistId, title: 'Kopfhörer', price_cents: 4990, currency: 'EUR', priority: 3, note: null })
    const book = await createWish(wishlistId, { title: 'Buch' })
    expect(book.priority).toBe(2)
    expect(await updateWish(book.id, { note: 'Ein Krimi', priority: 1 })).toMatchObject({ id: book.id, note: 'Ein Krimi', priority: 1 })
    // the edit form's deep link: the wish plus its list row (owner, occasion) in one request
    expect(await getWish(headphones.id)).toEqual({ ...headphones, wishlist: { id: wishlistId, occasion_id: occasionId, owner_id: screen.occasion.host.id } })
    const ownerView = asOwnerWishes((await getOccasionScreen(occasionId)).wishlist!.wishes)
    expect(ownerView.map((wish) => wish.title)).toEqual(['Kopfhörer', 'Buch'])
    expect(JSON.stringify(ownerView)).not.toMatch(/reserv/)

    const token = await createInvite(occasionId)
    expect(isInviteTokenShape(token)).toBe(true)
    const [link] = await listInvites(occasionId)
    expect(link).toMatchObject({ occasion_id: occasionId, max_uses: 50, use_count: 0, revoked_at: null })
    expect(isInviteActive(link!)).toBe(true)
    expect(link).not.toHaveProperty('token_hash')
    expect((await getOccasionScreen(occasionId)).invite).toEqual({ active: true, expires_at: link!.expires_at })
    await revokeInvite(link!.id)
    expect(isInviteActive((await listInvites(occasionId))[0]!)).toBe(false)
    expect((await getOccasionScreen(occasionId)).invite).toBeNull()

    expect(await updateOccasion(occasionId, { title: ' Milas 30. ', place_text: null })).toMatchObject({ id: occasionId, title: 'Milas 30.', place_text: null, host_id: expect.any(String) })
    await deleteWish(book.id)
    expect((await getOccasionScreen(occasionId)).wishlist!.wishes.map((wish) => wish.id)).toEqual([headphones.id])
    expect((await getFeed()).upcoming.find((row) => row.id === occasionId)).toMatchObject({ role: 'host', wish_count: 1, my_reservation_count: null })
    await deleteOccasion(occasionId)
    await expect(getOccasionScreen(occasionId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('guest: explicit Beitreten, RSVP, reserve (server-confirmed), cancel, leave', async () => {
    const host = await becomes('mila@example.test', 'Mila')
    const occasionId = newOccasionId()
    await createOccasion({ id: occasionId, title: 'Milas Geburtstag', starts_at: '2026-12-12T17:00:00.000Z', tz: 'Europe/Berlin', all_day: true })
    const wishlistId = (await getOccasionScreen(occasionId)).wishlist!.id
    const wish = await createWish(wishlistId, { title: 'Kopfhörer', priority: 3 })
    const token = await createInvite(occasionId)

    const guest = await becomes('jonas@example.test', 'Jonas')
    await expect(getOccasionScreen(occasionId)).rejects.toMatchObject({ code: 'not_found' }) // opening the link alone joins nothing
    await expect(getWish(wish.id)).rejects.toMatchObject({ code: 'not_found' }) // an outsider: no row at all
    expect(await acceptInvite(token)).toBe(occasionId)
    // a member reads the wish (RLS) — the list row names the host as owner, so the edit form refuses
    expect((await getWish(wish.id)).wishlist).toEqual({ id: wishlistId, occasion_id: occasionId, owner_id: (await getOccasionScreen(occasionId)).occasion.host.id })
    await setRsvp(occasionId, 'going')
    await reserveWish(wish.id)
    const guestView = asGuestWishes((await getOccasionScreen(occasionId)).wishlist!.wishes)
    expect(guestView).toEqual([expect.objectContaining({ id: wish.id, reserved: true, reserved_by_me: true })])
    expect((await getFeed()).upcoming.find((row) => row.id === occasionId)).toMatchObject({ role: 'member', rsvp: 'going', host_name: 'Mila', my_reservation_count: 1 })
    expect(await getMyReservations()).toEqual([expect.objectContaining({ wish_id: wish.id, wish_title: 'Kopfhörer', occasion_id: occasionId, status: 'active' })])

    use(host)
    const hostView = await getOccasionScreen(occasionId)
    expect(hostView.members.map((member) => [member.display_name, member.rsvp])).toEqual([['Mila', 'going'], ['Jonas', 'going']])
    expect(hostView.wishlist!.wishes).toEqual([expect.objectContaining({ id: wish.id, reserved: null, reserved_by_me: null })])

    use(guest)
    await cancelReservation(wish.id)
    expect(await getMyReservations()).toEqual([])
    await leaveOccasion(occasionId)
    await expect(getOccasionScreen(occasionId)).rejects.toMatchObject({ code: 'not_found' })
    expect(await acceptInvite(token)).toBe(occasionId) // "left" may come back by the same link

    use(host)
    await removeMember(occasionId, (await getOccasionScreen(occasionId)).members[1]!.profile_id)
    use(guest)
    await expect(acceptInvite(token)).rejects.toMatchObject({ code: 'invite_invalid' }) // removal revoked the link
  })

  it('the fixed demo link through the wrappers: "Bens Grillabend"', async () => {
    await signIn('neu@example.test')
    await expect(acceptInvite(DEMO_INVITE_TOKEN)).rejects.toMatchObject({ code: 'consent_required' })
    await acceptConsents('de')
    await expect(acceptInvite(DEMO_INVITE_TOKEN)).rejects.toMatchObject({ code: 'profile_incomplete' })
    await updateMyProfile({ display_name: 'Neu' })
    expect(await acceptInvite(DEMO_INVITE_TOKEN)).toBe(DEMO_OCCASIONS.barbecue)
    expect((await getFeed()).upcoming.map((row) => row.title)).toEqual(['Annas Einweihung', 'Bens Grillabend'])
    const exported = (await exportMyData()) as { memberships: unknown[]; account: { email: string | null } }
    expect(exported.account).toEqual({ email: 'neu@example.test' })
    expect(exported.memberships).toEqual([
      expect.objectContaining({ occasion_title: 'Annas Einweihung' }),
      expect.objectContaining({ occasion_title: 'Bens Grillabend' }),
    ])
  })

  it('failures arrive as the AppError codes the screens translate', async () => {
    const host = await becomes('mila@example.test', 'Mila')
    const occasionId = newOccasionId()
    await createOccasion({ id: occasionId, title: 'Milas Geburtstag', starts_at: '2026-12-12T17:00:00.000Z', tz: 'Europe/Berlin', all_day: true })
    const wish = await createWish((await getOccasionScreen(occasionId)).wishlist!.id, { title: 'Kopfhörer' })
    await expect(reserveWish(wish.id)).rejects.toMatchObject({ code: 'not_allowed', key: 'errors.not_allowed' }) // the owner
    await expect(createOccasion({ title: 'Mars', starts_at: '2026-12-12T17:00:00.000Z', tz: 'Mars/Olympus_Mons', all_day: true })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(createWish(wish.wishlist_id, { title: 'Teuer', currency: 'USD' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(acceptInvite('nope')).rejects.toMatchObject({ code: 'invite_invalid' })

    const jonas = await becomes('jonas@example.test', 'Jonas')
    await expect(reserveWish(wish.id)).rejects.toMatchObject({ code: 'not_allowed' }) // an outsider: the same code
    await expect(updateWish(wish.id, { title: 'Übernommen' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(updateOccasion(occasionId, { title: 'Übernommen' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(createWish(wish.wishlist_id, { title: 'Untergeschoben' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createInvite(occasionId)).rejects.toMatchObject({ code: 'not_found' })
    await expect(reserveWish(DEMO_RESERVED_WISH_ID)).rejects.toMatchObject({ code: 'already_reserved' }) // Ben was faster
    await expect(cancelReservation(DEMO_RESERVED_WISH_ID)).rejects.toMatchObject({ code: 'not_found' })

    use(host)
    await signIn('unfertig@example.test') // no name, no legal records yet
    await expect(createOccasion({ title: 'Zu früh', starts_at: '2026-12-12T17:00:00.000Z', tz: 'Europe/Berlin', all_day: true })).rejects.toMatchObject({ code: 'forbidden' })
    use(jonas)
    expect((await getFeed()).upcoming.map((row) => row.id)).toEqual([DEMO_OCCASIONS.housewarming])
  })
})
