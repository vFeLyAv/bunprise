import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The topic screen "/gifts/topic/$topic" (design 26.10 §2–3) against the Worker's real catalogue answer: one request
// with the shelf only, filters on the device, a game's sheet (animation → photo with "Bild: <Shop>", facts,
// "So wird gespielt"), and the deck's action for the recipient ("Merken für Anna" on this device only).
// Each test renders the whole shelf (31 drawings in jsdom): 20 s, so a loaded machine does not time it out.

const account = vi.hoisted(() => ({ session: { user: { id: 'account-me' }, access_token: 'fixture-token' } }))
vi.mock('../../../lib/supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))
vi.mock('../../../motion/MotionScope', () => ({ MotionScope: ({ children }: { children: React.ReactNode }) => children }))

import { answerCatalog } from '../../../../../../workers/edge/src/giftIdeas/catalog'
import { resetAccountBoundaryForTests } from '../../../lib/accountBoundary'
import { toast } from '../../../lib/toast'
import { resetGiftStorageForTests, savedFor } from '../storage'
import { TopicPage } from './TopicPage'
import { rememberTopicRecipient } from './topicContext'

const USER = 'account-me'
const ANNA = '0b7c8a1e-4444-4a5b-9c3d-0000000000a1'
const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

function renderTopic(topic = 'brettspiele') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({ component: () => <Outlet /> })
  const gifts = createRoute({ getParentRoute: () => root, path: '/gifts', component: () => <main>gifts</main> })
  const page = createRoute({ getParentRoute: () => root, path: '/gifts/topic/$topic', component: () => <TopicPage userId={USER} topic={topic} /> })
  const router = createRouter({ routeTree: root.addChildren([gifts, page]), history: createMemoryHistory({ initialEntries: [`/gifts/topic/${topic}`] }) })
  return render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterAll(() => {
  MotionGlobalConfig.instantAnimations = false
})

beforeEach(() => {
  window.localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.origin !== window.location.origin || url.pathname !== '/api/gift-ideas') throw new Error(`unexpected request ${url.href}`)
    const body = JSON.parse(String(init?.body)) as { topic?: string; lang: 'de' | 'en' }
    return json(answerCatalog({ interests: [], budget: { min_cents: 0, max_cents: 100_000_000 }, exclude_ids: [], lang: body.lang, ...(body.topic ? { topic: body.topic } : {}) }))
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  act(() => {
    resetGiftStorageForTests()
    toast.clear()
  })
  resetAccountBoundaryForTests()
  rememberTopicRecipient({ kind: 'me' })
})

async function card(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector(`[data-idea="${id}"]`)).not.toBeNull())
  return document.querySelector(`[data-idea="${id}"]`) as HTMLElement
}

describe('the topic screen', () => {
  it('asks once, with the shelf only; shows the whole shelf, filters on the device', async () => {
    renderTopic()
    expect(await screen.findByRole('heading', { level: 1, name: 'Brettspiele' })).toBeTruthy()
    await card('cat:hig-carcassonne')
    expect(screen.getByText('51 von 51')).toBeTruthy()
    expect(screen.getByText('51 Spiele · ca. 6–70 €')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      mode: 'for_me', interests: [], budget: { min_cents: 0, max_cents: 100_000_000 }, exclude_ids: [], lang: 'de', topic: 'brettspiele',
    })
    // the card: our drawing, the prize as text, the facts, the price
    const carcassonne = await card('cat:hig-carcassonne')
    expect(within(carcassonne).getByText('Spiel des Jahres 2001')).toBeTruthy()
    expect(within(carcassonne).getByText('2–5 · 35 Min · ab 7')).toBeTruthy()
    expect(within(carcassonne).getByText('ca. 22–27 €')).toBeTruthy()
    expect(carcassonne.querySelector('[data-archetype="tiles"] svg.gift-play')).not.toBeNull()
    expect(carcassonne.querySelector('img')).toBeNull()
    // an open-ended box (Jenga, Hasbro "1+"): "ab 1" instead of a range
    expect(within(await card('cat:hasbro-jenga')).getByText('ab 1 · 20–30 Min · ab 6')).toBeTruthy()

    // Spieler → zu zweit: only what two can play (since 30.10 every game has its facts; 9 of the 10 iconic classics fit,
    // Activity is 3–16, Jenga "ab 1" has no maximum)
    fireEvent.click(screen.getByRole('button', { name: 'Spieler' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Zu zweit' }))
    await waitFor(() => expect(screen.getByText('41 von 51')).toBeTruthy())
    expect((await card('cat:hasbro-jenga')).closest('li')?.hidden).toBe(false)
    expect((await card('cat:repos-7-wonders-duel')).closest('li')?.hidden).toBe(false)
    expect((await card('cat:kosmos-sky-team')).closest('li')?.hidden).toBe(false)
    expect((await card('cat:cge-codenames')).closest('li')?.hidden).toBe(true)
    expect((await card('cat:kosmos-flip-7')).closest('li')?.hidden).toBe(true)
    // Preis → bis 20 €
    fireEvent.click(screen.getByRole('button', { name: 'Preis' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Bis 20 €' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preis: Bis 20 €' })).toBeTruthy())
    expect((await card('cat:nsv-the-mind')).closest('li')?.hidden).toBe(false)
    expect((await card('cat:hig-carcassonne')).closest('li')?.hidden).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('a game\'s sheet: the animation, then the real photo through our Worker with "Bild: <Shop>"; facts and "So wird gespielt"', async () => {
    renderTopic()
    fireEvent.click(within(await card('cat:hig-carcassonne')).getByRole('button', { name: /^Carcassonne, 2–5 Spieler/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Carcassonne' })
    expect(within(sheet).getByRole('heading', { name: 'Carcassonne' })).toBeTruthy()
    expect(within(sheet).getByText('Hans im Glück · Spiel des Jahres 2001')).toBeTruthy()
    expect(within(sheet).getByRole('heading', { name: 'So wird gespielt' })).toBeTruthy()
    expect(within(sheet).getByText(/^Wer dran ist, zieht ein Landschaftsplättchen/)).toBeTruthy()
    expect(within(sheet).queryByText('Spielregel auf Deutsch')).toBeNull()
    const slides = within(sheet).getAllByRole('tab')
    expect(slides.map((tab) => tab.getAttribute('aria-label'))).toEqual(['So sieht das Spiel aus (Zeichnung)', 'Foto: Carcassonne'])
    const img = sheet.querySelector('.topic-slide[data-kind="photo"] img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/api/gift-ideas/img/boardgame/cat:hig-carcassonne')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(within(sheet).getByText('Bild: MediaMarkt')).toBeTruthy()
    // → / the arrow / a dot switch; a photo that fails leaves only the drawing (no dots, no arrows)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Nächstes Bild' }))
    expect(slides[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.error(img)
    await waitFor(() => expect(within(sheet).queryAllByRole('tab')).toHaveLength(0))
    expect(within(sheet).queryByRole('button', { name: 'Nächstes Bild' })).toBeNull()
    // the shops: real links, no partner, no ad
    const links = within(sheet).getAllByRole('link')
    expect(links.map((link) => new URL(link.getAttribute('href') ?? '').hostname)).toEqual(['www.mediamarkt.de', 'cundco.de'])
    expect(within(sheet).queryByText('Anzeige')).toBeNull()
  }, 20_000)

  it('a game without its photo (Zug um Zug) has only the drawing', async () => {
    renderTopic()
    fireEvent.click(within(await card('cat:dow-zug-um-zug')).getByRole('button', { name: /^Zug um Zug,/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Zug um Zug' })
    expect(within(sheet).queryAllByRole('tab')).toHaveLength(0)
    expect(sheet.querySelector('img')).toBeNull()
  }, 20_000)

  it('"Für jemanden": "Merken für Anna" keeps it on this device (and takes it back); nothing is sent', async () => {
    rememberTopicRecipient({ kind: 'person', profileId: ANNA, name: 'Anna Beispiel' })
    renderTopic()
    const azul = await card('cat:nextmove-azul')
    fireEvent.click(within(azul).getByRole('button', { name: 'Merken für Anna: Azul' }))
    expect(savedFor(USER, ANNA).map((idea) => idea.id)).toEqual(['cat:nextmove-azul'])
    // kept as the deck keeps it: the idea, not the shelf's facts
    expect(savedFor(USER, ANNA)[0]).not.toHaveProperty('game')
    const done = within(azul).getByRole('button', { name: 'Gemerkt: Azul' })
    expect(done.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(done)
    expect(savedFor(USER, ANNA)).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('"Für mich": the card and the sheet offer "Zu meiner Wunschliste"', async () => {
    renderTopic()
    const mind = await card('cat:nsv-the-mind')
    expect(within(mind).getByRole('button', { name: 'Zu meiner Wunschliste: The Mind' })).toBeTruthy()
    fireEvent.click(within(mind).getByRole('button', { name: /^The Mind,/ }))
    const sheet = await screen.findByRole('dialog', { name: 'The Mind' })
    expect(within(sheet).getByRole('button', { name: 'Zu meiner Wunschliste' })).toBeTruthy()
    expect(within(sheet).getByText('Nominiert: Spiel des Jahres 2018', { exact: false })).toBeTruthy()
  }, 20_000)

  it('another shelf: only the price filter; an unknown shelf says so', async () => {
    const first = renderTopic('buecher')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bücher' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/^\d+ von \d+$/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Spieler' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Preis' })).toBeTruthy()
    first.unmount()
    renderTopic('raumschiffe')
    expect(await screen.findByText('Dieses Thema gibt es nicht (mehr).')).toBeTruthy()
  }, 20_000)
})

describe('searching inside a topic (27.10)', () => {
  it('the magnifier opens a labelled field; as you type the grid narrows — umlauts either way, the publisher too; Esc closes', async () => {
    renderTopic()
    await card('cat:feuerland-fluegelschlag')
    const open = screen.getByRole('button', { name: 'Im Thema suchen' })
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    const field = screen.getByRole('searchbox', { name: 'Suche in Brettspiele' })
    expect(document.activeElement).toBe(field)
    const visibleIds = () => Array.from(document.querySelectorAll<HTMLElement>('.topic-grid > li:not([hidden]) [data-idea]')).map((el) => el.dataset['idea'])
    for (const query of ['flugel', 'Fluegel', 'FLÜGEL']) {
      fireEvent.change(field, { target: { value: query } })
      expect(visibleIds(), query).toEqual(['cat:feuerland-fluegelschlag'])
    }
    expect(screen.getByText('1 von 51')).toBeTruthy()
    // the publisher counts: every Pegasus game, and only those
    fireEvent.change(field, { target: { value: 'pegasus' } })
    expect(visibleIds().length).toBeGreaterThanOrEqual(3)
    expect(visibleIds().every((id) => /pegasus/.test(id ?? ''))).toBe(true)
    // with a filter: both must fit
    fireEvent.click(screen.getByRole('button', { name: 'Spieler' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Ab 6' }))
    await waitFor(() => expect(visibleIds()).toEqual(['cat:pegasus-dorfromantik']))
    // nothing: a calm line
    fireEvent.change(field, { target: { value: 'Raumschiff' } })
    expect(screen.getByText('Nichts gefunden für „Raumschiff“.')).toBeTruthy()
    // × clears, Esc closes (and clears)
    fireEvent.click(screen.getByRole('button', { name: 'Suche leeren' }))
    expect((field as HTMLInputElement).value).toBe('')
    fireEvent.change(field, { target: { value: 'azul' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Im Thema suchen' }).getAttribute('aria-expanded')).toBe('false')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, 20_000)
})
