import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, OccasionScreen } from '../../lib/api/types'

// "Geschenk finden" end to end in jsdom: the real screen, the real deck, the real API client against a
// stubbed same-origin fetch (answered by the demo provider), the real device storage. Checked: what the
// request may carry (categories and a budget — never names, wish titles, links or anything about
// reservations), "Nicht personalisieren", the keyboard and button alternatives of the swipe, the finite
// deck, the offers' honesty rules, "Für mich", the on-device fallback, and that nothing goes to a third party.
// Invented fixtures only.

const USER = 'account-me'
const ANNA = '0b7c8a1e-4444-4a5b-9c3d-0000000000a1'
const OCC_ANNA = '0b7c8a1e-4444-4a5b-9c3d-0000000000b1'
const OCC_MINE = '0b7c8a1e-4444-4a5b-9c3d-0000000000b2'

const account = vi.hoisted(() => ({ session: { user: { id: 'account-me' }, access_token: 'fixture-token' } }))
vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))
const occasions = vi.hoisted(() => ({ getFeed: vi.fn(), getOccasionScreen: vi.fn() }))
const listsApi = vi.hoisted(() => ({ getListsOverview: vi.fn(), getFreeWishes: vi.fn(), getListScreen: vi.fn(), createList: vi.fn(), newListId: vi.fn(() => 'list-new') }))
vi.mock('../../lib/api/lists', () => listsApi)
vi.mock('../../lib/api/occasions', () => ({ getFeed: occasions.getFeed, getOccasionScreen: occasions.getOccasionScreen }))
// Pompon is tested in features/wishes + mascot-ui; here: which mood the screen asks for and what he says
vi.mock('../wishes/BunnyPeek', () => ({
  BunnyPeek: ({ mood, says }: { mood: string; says?: string | null }) => (
    <div data-testid="pompon" data-mood={mood}>
      {says}
    </div>
  ),
}))
vi.mock('../mascot-ui/MoveMoment', () => ({ default: ({ kind, variant, illustration }: { kind: string; variant?: string; illustration?: boolean }) => <div data-testid="move-moment" data-kind={kind} data-variant={variant} data-illustration={illustration} /> }))
// the outer LazyMotion below carries the features; the screen's own scope would load them lazily
vi.mock('../../motion/MotionScope', () => ({ MotionScope: ({ children }: { children: React.ReactNode }) => children }))
const wishes = vi.hoisted(() => ({ createWish: vi.fn() }))
vi.mock('../../lib/api/wishes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/wishes')>()), createWish: wishes.createWish }))

import { resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { qk } from '../../lib/queryKeys'
import { getToasts, toast } from '../../lib/toast'
import { answerDemoGiftIdeas } from './demo/answer'
import { GiftsPage } from './GiftsPage'
import { resetGiftSessionForTests } from './session'
import { readStartInterests, resetStartInterestsForTests, saveStartInterests } from './startInterests'
import { personalizeEnabled, resetGiftStorageForTests, savedFor } from './storage'
import { resetGiftDecksForTests } from './useGiftDeck'

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

const FEED: FeedScreen = {
  upcoming: [
    { id: OCC_ANNA, title: 'Annas Einweihung', starts_at: soon(3), tz: 'Europe/Berlin', all_day: false, place_text: null, role: 'member', rsvp: 'going', host_name: 'Anna Beispiel', member_count: 3, wish_count: 6, my_reservation_count: 1 },
    { id: OCC_MINE, title: 'Milas Geburtstag', starts_at: soon(12), tz: 'Europe/Berlin', all_day: false, place_text: null, role: 'host', rsvp: 'going', host_name: 'Mila Sommer', member_count: 1, wish_count: 2, my_reservation_count: null },
  ],
  past: [],
}

const wish = (id: string, title: string, priority: 1 | 2 | 3, price: number | null, url: string | null, reserved: boolean | null) => ({
  id, title, url, price_cents: price, currency: 'EUR', note: 'Gern aus Holz', priority, created_at: '2026-10-14T10:00:00Z', reserved, reserved_by_me: reserved === null ? null : false,
})

const SCREENS: Record<string, OccasionScreen> = {
  [OCC_ANNA]: {
    occasion: { id: OCC_ANNA, title: 'Annas Einweihung', starts_at: soon(3), tz: 'Europe/Berlin', all_day: false, place_text: 'Café am Markt', description: null, created_at: '2026-10-14T10:00:00Z', host: { id: ANNA, display_name: 'Anna Beispiel' } },
    viewer: { role: 'member', rsvp: 'going' },
    members: [],
    invite: null,
    wishlist: {
      id: 'list-anna',
      owner_id: ANNA,
      title: 'Annas Einweihung',
      wishes: [
        wish('w1', 'Kaffeemühle mit Handkurbel', 3, 4500, 'https://example.com/kaffeemuehle', true),
        wish('w2', 'Große Zimmerpflanze', 3, 3500, null, false),
        wish('w3', 'Kinogutschein', 2, 2500, null, false),
        wish('w4', 'Leinen-Geschirrtücher', 2, 1800, 'https://example.com/geschirrtuecher', false),
        wish('w5', 'Brettspiel für zwei', 1, 3000, null, false),
        wish('w6', 'Duftkerze', 1, 1500, null, false),
      ],
    },
  },
  [OCC_MINE]: {
    occasion: { id: OCC_MINE, title: 'Milas Geburtstag', starts_at: soon(12), tz: 'Europe/Berlin', all_day: false, place_text: null, description: null, created_at: '2026-10-14T10:00:00Z', host: { id: USER, display_name: 'Mila Sommer' } },
    viewer: { role: 'host', rsvp: 'going' },
    members: [],
    invite: null,
    wishlist: { id: 'list-mine', owner_id: USER, title: 'Milas Geburtstag', wishes: [wish('m1', 'Kabellose Kopfhörer', 3, 7999, null, null), wish('m2', 'Ukulele', 2, 5900, null, null)] },
  },
}

type Answer = (body: Record<string, unknown>) => Response | Promise<Response>
const fetchMock = vi.fn<typeof fetch>()
let answer: Answer = (body) => json(answerDemoGiftIdeas(body as never))

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

function bodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

function renderGifts(held?: number, feed: FeedScreen = FEED) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(qk.feed(), feed)
  for (const [id, screenData] of Object.entries(SCREENS)) queryClient.setQueryData(qk.occasion(id), held !== undefined && id === OCC_ANNA ? {
    ...screenData, wishlist: { ...screenData.wishlist!, wishes: screenData.wishlist!.wishes.map((wish, index) => ({ ...wish, reserved: index < held })) },
  } : screenData)
  const root = createRootRoute({ component: () => <Outlet /> })
  const gifts = createRoute({ getParentRoute: () => root, path: '/gifts', component: () => <GiftsPage userId={USER} /> })
  const occasion = createRoute({ getParentRoute: () => root, path: '/occasions/$occasionId', component: () => <main>occasion</main> })
  const occasionNew = createRoute({ getParentRoute: () => root, path: '/occasions/new', component: () => <main>new occasion</main> })
  const list = createRoute({ getParentRoute: () => root, path: '/lists/$listId', component: () => <main>list</main> })
  const router = createRouter({ routeTree: root.addChildren([gifts, occasionNew, occasion, list]), history: createMemoryHistory({ initialEntries: ['/gifts'] }) })
  return render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

/** "Ideen anpassen → Interessen": the sheet where interests are added or taken away by hand (27.10: no chips under the deck). */
async function interestSheet(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: /^Interessen: / }))
  return screen.findByRole('dialog', { name: 'Interessen anpassen' })
}

/** The card on top (the cards behind are hidden from assistive tech). */
async function topCard(): Promise<HTMLElement> {
  return screen.findByRole('article', { name: /^Idee \d+( von \d+)?: / })
}

beforeAll(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterAll(() => {
  MotionGlobalConfig.instantAnimations = false
})

beforeEach(() => {
  listsApi.getListsOverview.mockResolvedValue({ my_lists: [], following: [] })
  listsApi.getFreeWishes.mockResolvedValue({ person: { id: ANNA, display_name: 'Anna Beispiel', banner: null }, ideas: [] })
  window.localStorage.clear()
  occasions.getFeed.mockResolvedValue(FEED)
  occasions.getOccasionScreen.mockImplementation(async (id: string) => SCREENS[id])
  answer = (body) => json(answerDemoGiftIdeas(body as never))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.origin !== window.location.origin || url.pathname !== '/api/gift-ideas') throw new Error(`unexpected request ${url.href}`)
    return answer(JSON.parse(String(init?.body)) as Record<string, unknown>)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  listsApi.getFreeWishes.mockClear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  act(() => {
    resetGiftDecksForTests()
    resetGiftSessionForTests()
    resetGiftStorageForTests()
    toast.clear()
  })
  resetAccountBoundaryForTests()
  window.localStorage.clear()
  vi.useRealTimers()
})

describe('"Für jemanden": ideas from a list I can see', () => {
  it('0 versus 5 held wishes produces the identical product request, with a separate giver-only block', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    const first = renderGifts(0)
    await topCard()
    expect(await screen.findByRole('region', { name: 'Noch frei auf Annas Liste' })).toBeTruthy()
    const request = bodies()[0]
    first.unmount()
    act(() => { resetGiftDecksForTests(); resetGiftSessionForTests() })
    fetchMock.mockClear()
    renderGifts(5)
    await topCard()
    expect(bodies()[0]).toEqual(request)
    expect(listsApi.getFreeWishes).toHaveBeenCalledWith(ANNA, 4000, USER)
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    await waitFor(() => expect(document.querySelector('[data-free-wishes]')).toBeNull())
    expect(listsApi.getFreeWishes.mock.calls.every(([profileId]) => profileId !== USER)).toBe(true)
  })
  it('guesses Anna’s interests on the device and asks only for categories and a budget', async () => {
    renderGifts()
    expect(await screen.findByRole('radio', { name: /Anna/ })).toBeTruthy()
    const card = await topCard()
    expect(within(card).getByRole('heading', { name: 'Handmühle aus Walnussholz' })).toBeTruthy()
    // no box that lists "because Anna wishes for: Kaffee & Tee, …" (Felix 27.10) — the row only says how many
    expect(screen.queryByText('Weil sich Anna das wünscht:')).toBeNull()
    expect(screen.getByRole('button', { name: 'Interessen: 5 aktiv' })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [body] = bodies()
    // the interests and ONE taste direction from the list (the hand grinder: specialty coffee) — no wish, no brand
    expect(body).toEqual({ mode: 'for_someone', interests: ['coffee', 'plants', 'film', 'kitchen', 'games'], budget: { min_cents: 1500, max_cents: 4000 }, exclude_ids: [], lang: 'de', styles: ['specialty-coffee'] })
    const sheet = await interestSheet()
    for (const label of ['Kaffee & Tee', 'Pflanzen', 'Film & Kino', 'Küche', 'Spiele']) {
      expect(within(sheet).getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
    }
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }))
    const sent = JSON.stringify(body)
    for (const secret of ['Anna', ANNA, OCC_ANNA, 'Kaffeemühle', 'example.com', 'Holz', 'reserv']) expect(sent).not.toContain(secret)
    expect(screen.getByTestId('pompon').dataset['mood']).toBe('joy')
  })

  it('keyboard: → keeps it for Anna (this device only), ← skips; the buttons do the same; undo brings it back', async () => {
    renderGifts()
    let card = await topCard()
    expect(card.getAttribute('aria-label')).toMatch(/^Idee 1[: ]/)
    card.focus()
    fireEvent.keyDown(card, { key: 'ArrowRight' })
    expect(savedFor(USER, ANNA).map((idea) => idea.id)).toEqual(['demo-grinder'])
    card = await topCard()
    await waitFor(() => expect(document.activeElement).toBe(card))
    expect(card.getAttribute('aria-label')).toMatch(/^Idee 2[: ]/)
    fireEvent.keyDown(card, { key: 'ArrowLeft' })
    card = await topCard()
    expect(card.getAttribute('aria-label')).toMatch(/^Idee 3[: ]/)
    fireEvent.click(screen.getByRole('button', { name: 'Merken für Anna' }))
    expect(savedFor(USER, ANNA)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Nicht für Anna' }))
    expect(savedFor(USER, ANNA)).toHaveLength(2)
    // undo twice: the skip, then the saved one leaves the device memory again
    fireEvent.click(screen.getByRole('button', { name: 'Letzte Idee zurückholen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Letzte Idee zurückholen' }))
    expect(savedFor(USER, ANNA)).toHaveLength(1)
    expect((await topCard()).getAttribute('aria-label')).toMatch(/^Idee 3[: ]/)
    // the shelf shows what is kept, and says that Anna never sees it
    fireEvent.click(screen.getByRole('button', { name: /Für Anna gemerkt: 1 ansehen/ }))
    const shelf = await screen.findByRole('dialog', { name: 'Für Anna gemerkt' })
    expect(within(shelf).getByText(/Anna sieht das nie/)).toBeTruthy()
  })

  it('"Mehr wie das" asks for the card’s own interests, leaves out the deck, and puts the new ones right behind it', async () => {
    renderGifts()
    const card = await topCard()
    fireEvent.click(within(card).getByRole('button', { name: 'Mehr wie das' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const more = bodies()[1]
    expect(more?.interests).toEqual(['coffee', 'kitchen'])
    expect(more?.exclude_ids).toEqual(expect.arrayContaining(['demo-grinder']))
    // the next card is one of the similar ones, marked "Neu"
    fireEvent.click(screen.getByRole('button', { name: 'Nicht für Anna' }))
    const next = await topCard()
    await waitFor(() => expect(within(next).getByText('Neu')).toBeTruthy())
  })

  it('removing a chip asks again without it', async () => {
    renderGifts()
    await topCard()
    const sheet = await interestSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Kaffee & Tee' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(bodies()[1]?.interests).toEqual(['plants', 'film', 'kitchen', 'games'])
    expect(within(sheet).getByRole('button', { name: 'Kaffee & Tee' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('"Nicht personalisieren": the next deck asks without interests, the chips go, the choice stays on this device', async () => {
    renderGifts()
    await topCard()
    fireEvent.click(screen.getAllByRole('switch', { name: /Nicht personalisieren/ })[0] as HTMLElement)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(bodies()[1]?.interests).toEqual([])
    // not personalised: no taste either, and no interests row
    expect(bodies()[1]).not.toHaveProperty('styles')
    expect(screen.queryByRole('button', { name: /^Interessen: / })).toBeNull()
    expect(personalizeEnabled(USER)).toBe(false)
  })

  it('a finite deck: after the last card — "Für heute war’s das"', async () => {
    answer = (body) => {
      const full = answerDemoGiftIdeas(body as never)
      return json({ ...full, items: full.items.slice(0, 2), next_cursor: null })
    }
    renderGifts()
    await topCard()
    fireEvent.click(screen.getByRole('button', { name: 'Merken für Anna' }))
    await topCard()
    fireEvent.click(screen.getByRole('button', { name: 'Nicht für Anna' }))
    expect(await screen.findByRole('heading', { name: 'Für heute war’s das' })).toBeTruthy()
    expect(screen.getByText(/1 Idee für Anna gemerkt\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merken für Anna' })).toBeNull()
    // «Переел» (approved 24.10): variant a or b, picked once per visit, as the illustration of the deck's end
    expect((await screen.findByTestId('move-moment')).dataset['kind']).toBe('overfed')
    expect(screen.getByTestId('move-moment').dataset['variant']).toMatch(/^[ab]$/)
    expect(screen.getByTestId('move-moment').dataset['illustration']).toBe('true')
    // the picture has a slot of its own: full card width, its own height, never over the title
    expect(screen.getByTestId('move-moment').parentElement?.className).toMatch(/h-\[150px\].*self-stretch/)
    expect(screen.queryByTestId('pompon')).toBeNull()
    // the last verdict can still be taken back: the card returns, the deck goes on
    fireEvent.click(screen.getByRole('button', { name: 'Letzte Idee zurückholen' }))
    expect((await topCard()).getAttribute('aria-label')).toMatch(/^Idee 2 von 2: /)
    expect(screen.queryByRole('heading', { name: 'Für heute war’s das' })).toBeNull()
  })

  it('the counter has no total while more ideas may come; the left swipe says "Nicht für Anna" like its button', async () => {
    renderGifts()
    const card = await topCard()
    // the demo's first page has a next one: no "1 von 6" that later jumps to "6 von 12"
    expect(card.getAttribute('aria-label')).toMatch(/^Idee 1: /)
    expect(screen.getByText('Idee 1')).toBeTruthy()
    expect(within(card).getByText('Nicht für Anna')).toBeTruthy()
    expect(within(card).queryByText('Nicht für mich')).toBeNull()
    expect(document.getElementById('gifts-card-hint')?.textContent).toMatch(/Nach links: nicht für Anna/)
  })

  it('an empty deck keeps Pompon with his line', async () => {
    answer = () => json({ items: [], next_cursor: null, as_of: null })
    renderGifts()
    expect(await screen.findByRole('heading', { name: 'Keine Ideen in diesem Budget' })).toBeTruthy()
    expect(screen.getByTestId('pompon').textContent).toBe('Hmm, dazu finde ich gerade nichts.')
  })

  it('removing a kept idea from the shelf can be undone (it returns to its place)', async () => {
    renderGifts()
    await topCard()
    fireEvent.click(screen.getByRole('button', { name: 'Merken für Anna' }))
    await topCard()
    fireEvent.click(screen.getByRole('button', { name: 'Merken für Anna' }))
    await topCard()
    const kept = savedFor(USER, ANNA).map((idea) => idea.id)
    expect(kept).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /Für Anna gemerkt: 2 ansehen/ }))
    const shelf = await screen.findByRole('dialog', { name: 'Für Anna gemerkt' })
    const older = savedFor(USER, ANNA)[1]!
    fireEvent.click(within(shelf).getByRole('button', { name: `„${older.title}“ entfernen` }))
    expect(savedFor(USER, ANNA).map((idea) => idea.id)).toEqual([kept[0]])
    // the shelf keeps its place with "Rückgängig" (a toast under the open sheet could not be tapped)
    expect(within(shelf).getByText(`„${older.title}“ entfernt`)).toBeTruthy()
    fireEvent.click(within(shelf).getByRole('button', { name: 'Rückgängig' }))
    expect(savedFor(USER, ANNA).map((idea) => idea.id)).toEqual(kept)
    await waitFor(() => expect(within(shelf).queryByText(`„${older.title}“ entfernt`)).toBeNull())
  })

  it('offline the deck says so, and asks again by itself once the network is back', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderGifts()
    expect(await screen.findByText('Du bist offline. Ideen gibt’s, sobald du wieder Netz hast.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await topCard()).toBeTruthy()
    expect(screen.queryByText(/Du bist offline/)).toBeNull()
  })
})

describe('"Wo erhältlich": honest offers', () => {
  it('invented shops are no links; a real shop opens safely; a paid one says „Anzeige“ — in its row and the reserved slot', async () => {
    answer = () =>
      json({
        items: [
          {
            id: 'mixed',
            title: 'Kaffeemühle',
            image_url: null,
            price_min_cents: 1900,
            price_max_cents: 4900,
            offers: [
              { shop: 'Markt', price_cents: 2900, url: 'https://markt.example/p/1', sponsored: false },
              { shop: 'Echter Laden', price_cents: 4900, url: 'https://laden.de/p/1', sponsored: false },
              { shop: 'Partner', price_cents: 1900, url: 'https://partner.de/p/1?ref=x', sponsored: true },
            ],
            interests: ['coffee'],
          },
        ],
        next_cursor: null,
        as_of: new Date().toISOString(),
      })
    renderGifts()
    const card = await topCard()
    // the card's partner slot is filled because one offer is paid
    expect(within(card).getByText('Anzeige')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: /^Wo erhältlich: 3 Shops/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wo erhältlich' })
    const links = within(sheet).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://partner.de/p/1?ref=x', 'https://laden.de/p/1'])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toMatch(/noopener noreferrer/)
      expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
    }
    expect(links[0]?.getAttribute('rel')).toMatch(/^sponsored /)
    expect(within(sheet).getByText(/markt\.example · Demo-Shop/)).toBeTruthy()
    expect(within(sheet).getAllByText('Anzeige').length).toBe(2)
    expect(within(sheet).getByText(/„Anzeige“ = bezahlte Platzierung oder Partnerlink/)).toBeTruthy()
    expect(within(sheet).getByText(/^Ungefähre Preise, Stand heute/)).toBeTruthy()
  })

  it('the demo deck: no link at all, the reserved slot stays empty, „Demo“ on the picture', async () => {
    renderGifts()
    const card = await topCard()
    expect(within(card).queryByText('Anzeige')).toBeNull()
    expect(card.querySelector('[data-slot="partner-label"]')).not.toBeNull()
    expect(within(card).getByText('Demo')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: /^Wo erhältlich:/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wo erhältlich' })
    expect(within(sheet).queryAllByRole('link')).toEqual([])
    expect(within(sheet).getByText(/Demo: Produkte und Shops sind erfunden/)).toBeTruthy()
  })
})

describe('"Für mich": ideas from my own lists', () => {
  it('reads my wishes, asks in "for_me" mode and offers "Auf meine Liste"', async () => {
    renderGifts()
    await topCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    expect(await screen.findByText('Aus deinen Wünschen in „Milas Geburtstag“')).toBeTruthy()
    await waitFor(() => expect(bodies().some((body) => body.mode === 'for_me')).toBe(true))
    const mine = bodies().find((body) => body.mode === 'for_me')
    expect(mine?.interests).toEqual(['audio', 'music'])
    const card = await topCard()
    expect(within(card).getByRole('button', { name: 'Zu meiner Wunschliste' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gefällt mir' })).toBeTruthy()
    expect(JSON.stringify(mine)).not.toMatch(/Kopfhörer|Ukulele|Mila/)
  })

  it('starts with what I put into the welcome wish box (this device only); taking one away here forgets it', async () => {
    resetStartInterestsForTests()
    saveStartInterests(USER, ['books', 'plants'])
    renderGifts()
    await topCard()
    // for someone else the wish box never counts
    expect(bodies()[0]?.mode).toBe('for_someone')
    expect(bodies()[0]?.interests).not.toContain('books')
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    await waitFor(() => expect(bodies().some((body) => body.mode === 'for_me')).toBe(true))
    expect(bodies().find((body) => body.mode === 'for_me')?.interests).toEqual(['audio', 'music', 'books', 'plants'])
    fireEvent.click(within(await interestSheet()).getByRole('button', { name: 'Bücher' }))
    await waitFor(() => expect(readStartInterests(USER)).toEqual(['plants']))
    resetStartInterestsForTests()
  })

  it('"Zu meiner Wunschliste" opens the existing wish form, filled with title, price and link, and saves into my list', async () => {
    answer = () =>
      json({
        items: [
          { id: 'real-1', title: 'Kopfhörer mit Etui', image_url: null, price_min_cents: 1900, price_max_cents: 2900, offers: [{ shop: 'Laden', price_cents: 1900, url: 'https://laden.de/p/42', sponsored: false }, { shop: 'Markt', price_cents: 2900, url: 'https://markt.de/p/7', sponsored: false }], interests: ['audio'] },
          { id: 'real-2', title: 'Ukulele-Saiten', image_url: null, price_min_cents: 900, price_max_cents: 900, offers: [{ shop: 'Laden', price_cents: 900, url: 'https://laden.de/p/43', sponsored: false }], interests: ['music'] },
        ],
        next_cursor: null,
        as_of: null,
      })
    wishes.createWish.mockImplementation(async (_listId: string, input: { title: string }) => ({ id: 'new-wish', wishlist_id: 'list-mine', ...input }))
    renderGifts()
    await topCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zu meiner Wunschliste' }))
    const sheet = await screen.findByRole('dialog', { name: 'Zu deiner Wunschliste' })
    expect((within(sheet).getByLabelText('Titel') as HTMLTextAreaElement).value).toBe('Kopfhörer mit Etui')
    expect((within(sheet).getByLabelText('Link zu deinem Wunsch') as HTMLInputElement).value).toBe('https://laden.de/p/42')
    // the form's price field shows whole euros without decimals
    expect((within(sheet).getByLabelText('Preis') as HTMLInputElement).value).toMatch(/^19(,00)?(\s?€)?$/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Wunsch hinzufügen' }))
    await waitFor(() => expect(wishes.createWish).toHaveBeenCalledTimes(1))
    expect(wishes.createWish).toHaveBeenCalledWith('list-mine', { title: 'Kopfhörer mit Etui', price_cents: 1900, currency: 'EUR', url: 'https://laden.de/p/42', note: null, priority: 2 }, USER)
    // the occasion's list will play its "wish added" moment; the card flies on, liked
    expect(JSON.parse(window.sessionStorage.getItem('bunprise.wishAdded') ?? '{}')).toMatchObject({ occasionId: OCC_MINE, wishId: 'new-wish' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zu deiner Wunschliste' })).toBeNull())
    expect((await topCard()).getAttribute('aria-label')).toMatch(/Ukulele-Saiten/)
  })

  it('without an own list: "Wunschliste anlegen" right in the sheet (for me alone), then the same sheet shows the filled form', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    const NEW_LIST = { id: 'list-new', title: 'Meine Wünsche', kind: 'standalone', visibility: 'private', cover_tone: null, cover_icon: 'star', due_on: null, wish_count: 0, occasion: null, created_at: '2026-10-22T10:00:00Z' }
    let created = false
    listsApi.createList.mockImplementation(async () => {
      created = true
      return { id: 'list-new', created_at: '2026-10-22T10:00:00Z' }
    })
    listsApi.getListsOverview.mockImplementation(async () => ({ my_lists: created ? [NEW_LIST] : [], following: [] }))
    listsApi.getListScreen.mockImplementation(async (id: string) => ({
      list: { ...NEW_LIST, id, owner: { id: USER, display_name: 'Mila Sommer', banner: null } },
      viewer: { role: 'owner' },
      wishes: [],
    }))
    wishes.createWish.mockImplementation(async (_listId: string, input: { title: string }) => ({ id: 'new-wish', wishlist_id: 'list-new', ...input }))
    // only Anna's occasion: no list of my own
    renderGifts(undefined, { ...FEED, upcoming: FEED.upcoming.filter((occasion) => occasion.role !== 'host') })
    await topCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    const add = await screen.findByRole('button', { name: 'Zu meiner Wunschliste' })
    const idea = (await topCard()).querySelector('h3')?.textContent
    fireEvent.click(add)
    const sheet = await screen.findByRole('dialog', { name: 'Zu deiner Wunschliste' })
    expect(within(sheet).getByRole('heading', { name: 'Noch keine eigene Wunschliste' })).toBeTruthy()
    expect((within(sheet).getByLabelText('Name der Liste') as HTMLInputElement).value).toBe('Meine Wünsche')
    expect(within(sheet).getByRole('link', { name: 'Lieber für einen Anlass' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Wunschliste anlegen' }))
    await waitFor(() => expect(listsApi.createList).toHaveBeenCalledTimes(1))
    expect(listsApi.createList).toHaveBeenCalledWith({ id: 'list-new', title: 'Meine Wünsche', visibility: 'private', cover_tone: null, cover_icon: 'star', due_on: null }, USER)
    // the idea is not lost: the form for the new list, filled with it
    const title = await within(sheet).findByLabelText('Titel')
    expect((title as HTMLTextAreaElement).value).toBe(idea)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Wunsch hinzufügen' }))
    await waitFor(() => expect(wishes.createWish).toHaveBeenCalledTimes(1))
    expect(wishes.createWish.mock.calls[0]?.[0]).toBe('list-new')
    // "Ansehen" goes to the new list
    expect(getToasts().some((item) => item.actionLabel === 'Ansehen')).toBe(true)
  })

  it('an invented demo shop’s link and price are never put into a real wish (only the title)', async () => {
    renderGifts()
    await topCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zu meiner Wunschliste' }))
    const sheet = await screen.findByRole('dialog', { name: 'Zu deiner Wunschliste' })
    expect((within(sheet).getByLabelText('Titel') as HTMLTextAreaElement).value).toBe('Kabellose Over-Ear-Kopfhörer')
    expect((within(sheet).getByLabelText('Link zu deinem Wunsch') as HTMLInputElement).value).toBe('')
    expect((within(sheet).getByLabelText('Preis') as HTMLInputElement).value).toBe('')
  })
})

describe('without a provider, offline and on errors', () => {
  it('our Worker has no provider yet (404): the device answers from the demo catalogue — and says so — without asking again', async () => {
    // The device answer deliberately waits 600 ms. Drive that clock after the held Worker answer,
    // rather than spending most of findByRole's deadline on an intentional presentation pause.
    vi.useFakeTimers()
    let respond!: (response: Response) => void
    const response = new Promise<Response>((resolve) => { respond = resolve })
    answer = () => response
    renderGifts()
    await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)) })
    await act(async () => { respond(new Response('not found', { status: 404 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(599) })
    expect(screen.getByTestId('pompon').dataset['mood']).toBe('sniff')
    expect(screen.queryByRole('article', { name: /^Idee \d+( von \d+)?: / })).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await vi.dynamicImportSettled()
    })
    const card = screen.getByRole('article', { name: /^Idee \d+( von \d+)?: / })
    expect(within(card).getByRole('heading', { name: 'Handmühle aus Walnussholz' })).toBeTruthy()
    expect(screen.getByText('Beispiel-Ideen mit erfundenen Shops – echte Angebote kommen später.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Interessen: / }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Interessen anpassen' })).getByRole('button', { name: 'Kaffee & Tee' }))
    expect(screen.getByTestId('pompon').dataset['mood']).toBe('sniff')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(screen.getByTestId('pompon').dataset['mood']).toBe('joy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed answer shows the error with "Nochmal versuchen", which asks again', async () => {
    let fail = true
    answer = (body) => (fail ? new Response('boom', { status: 500 }) : json(answerDemoGiftIdeas(body as never)))
    renderGifts()
    expect(await screen.findByRole('heading', { name: 'Gerade keine Ideen' })).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }))
    expect(await topCard()).toBeTruthy()
  })

  it('nothing ever goes to a third party: one origin, own pictures only', async () => {
    renderGifts()
    await topCard()
    fireEvent.click(screen.getByRole('button', { name: 'Merken für Anna' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Für mich' }))
    await screen.findByRole('button', { name: 'Zu meiner Wunschliste' })
    for (const [target] of fetchMock.mock.calls) {
      const url = new URL(String(target))
      expect(url.origin).toBe(window.location.origin)
      expect(url.pathname).toBe('/api/gift-ideas')
    }
    for (const img of Array.from(document.querySelectorAll('img'))) expect(new URL(img.src).origin).toBe(window.location.origin)
    // the demo pictures are drawn inline
    expect(document.querySelector('.gift-card svg[data-art]')).not.toBeNull()
  })
})

describe('the calmer Ideen tab (Felix 26.10) and "Stöbern nach Thema"', () => {
  it('no round ✕ / ♥ under the deck: one tap in the card\'s "Wo erhältlich" decides, like a swipe (WCAG 2.5.1)', async () => {
    renderGifts()
    const card = await topCard()
    expect(document.querySelector('.gift-action[data-kind="like"], .gift-action[data-kind="skip"]')).toBeNull()
    // what it matches is said once, in "Warum diese Ideen?" — not on every card
    expect(within(card).queryByText(/passt zu/)).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /^Wo erhältlich:/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wo erhältlich' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Merken für Anna' }))
    expect(savedFor(USER, ANNA).map((idea) => idea.id)).toEqual(['demo-grinder'])
    expect((await topCard()).getAttribute('aria-label')).toMatch(/^Idee 2[: ]/)
    const next = await topCard()
    fireEvent.click(within(next).getByRole('button', { name: /^Wo erhältlich:/ }))
    const again = await screen.findByRole('dialog', { name: 'Wo erhältlich' })
    fireEvent.click(within(again).getByRole('button', { name: 'Nicht für Anna' }))
    expect((await topCard()).getAttribute('aria-label')).toMatch(/^Idee 3[: ]/)
    expect(savedFor(USER, ANNA)).toHaveLength(1)
  })

  it('the row under the deck shows the shelves from 8 ideas on, as links to their screen; nothing is asked for it', async () => {
    answer = (body) => json({ ...answerDemoGiftIdeas(body as never), topics: [{ id: 'brettspiele', count: 31 }, { id: 'kreativ', count: 7 }, { id: 'raumschiffe', count: 40 }] })
    renderGifts()
    await topCard()
    const row = await screen.findByRole('region', { name: 'Stöbern nach Thema' })
    const tiles = within(row).getAllByRole('link')
    expect(tiles).toHaveLength(1)
    expect(tiles[0]?.getAttribute('href')).toBe('/gifts/topic/brettspiele')
    expect(tiles[0]?.textContent).toContain('31 Spiele')
    expect(within(row).getByText('Neu')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('v3 (27.10): the first-time swipe hint, the taste of a list', () => {
  it('the first time only: the top card nudges, a quiet line says what the sides mean; a swipe ends it; never again here', async () => {
    // the deck is in view (the test shim's IntersectionObserver never reports)
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    })
    const first = renderGifts()
    await topCard()
    await waitFor(() => expect(document.querySelector('.gift-swipe-hint[data-shown]')).not.toBeNull())
    const line = document.querySelector('.gift-swipe-hint') as HTMLElement
    expect(line.textContent).toBe('← Nicht für Anna · Merken für Anna →')
    // screen readers have the card's own hint and the decision buttons: the line is for the eyes
    expect(line.getAttribute('aria-hidden')).toBe('true')
    const card = await topCard()
    card.focus()
    fireEvent.keyDown(card, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.querySelector('.gift-swipe-hint[data-shown]')).toBeNull())
    first.unmount()
    act(() => {
      resetGiftDecksForTests()
      resetGiftSessionForTests()
    })
    renderGifts()
    await topCard()
    expect(document.querySelector('.gift-swipe-hint')).toBeNull()
  })

  it('a sporty list sends its taste directions (athleisure first) — never a brand, a title or a link', async () => {
    const sporty = {
      ...SCREENS[OCC_ANNA]!,
      wishlist: {
        ...SCREENS[OCC_ANNA]!.wishlist!,
        wishes: [
          wish('w1', 'Gymshark Vital Seamless Leggings', 3, 4500, 'https://de.gymshark.com/products/vital', false),
          wish('w2', 'Laufschuhe Pegasus 41', 2, 13000, 'https://www.nike.com/de/t/pegasus-41', false),
          wish('w3', 'Proteinshaker', 1, 1500, null, false),
        ],
      },
    }
    const original = SCREENS[OCC_ANNA]
    SCREENS[OCC_ANNA] = sporty
    try {
      renderGifts()
      await topCard()
      const [body] = bodies()
      expect(body?.styles).toEqual(['athleisure', 'streetwear'])
      const sent = JSON.stringify(body)
      for (const secret of ['Gymshark', 'gymshark', 'Nike', 'nike', 'Pegasus', 'Leggings']) expect(sent).not.toContain(secret)
    } finally {
      if (original) SCREENS[OCC_ANNA] = original
    }
  })
})
