import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedOccasion, FeedScreen } from '../../../lib/api/types'
import { qk } from '../../../lib/queryKeys'
import { hostScreen, HOST_ID, makeQueryClient, renderWithClient } from '../test-utils'

// The place sheet (K4): suggestions from our Worker after a pause in typing, the OpenStreetMap credit,
// recent places of the person's OWN occasions from the cache, free text, and calm fallbacks (offline,
// errors, no results). Invented places only.

const places = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/places')>()),
  searchPlaces: places.search,
}))

import { PlacesError, type PlaceSuggestion } from '../../../lib/api/places'
import { PlaceSheet } from './PlaceSheet'

const MORGENROT: PlaceSuggestion = {
  id: 'p1',
  name: 'Café Morgenrot',
  line: 'Lindenweg 4, 12345 Beispielstadt',
  kind: 'cafe',
  text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt',
}
const WOLKE: PlaceSuggestion = { id: 'p2', name: 'Café Wolke sieben', line: 'Mühlengasse 9, 12345 Beispielstadt', kind: 'cafe', text: 'Café Wolke sieben, Mühlengasse 9, 12345 Beispielstadt' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function feedOccasion(patch: Partial<FeedOccasion>): FeedOccasion {
  return {
    id: crypto.randomUUID(),
    title: 'Fest',
    starts_at: '2026-11-01T18:00:00.000Z',
    tz: 'Europe/Berlin',
    all_day: false,
    place_text: null,
    role: 'host',
    rsvp: 'going',
    host_name: 'Mila',
    member_count: 1,
    wish_count: 0,
    my_reservation_count: null,
    ...patch,
  }
}

function open(client = makeQueryClient(), initialQuery = '') {
  const onPick = vi.fn()
  const onClose = vi.fn()
  renderWithClient(<PlaceSheet open onClose={onClose} initialQuery={initialQuery} onPick={onPick} userId={HOST_ID} lang="de" />, client)
  return { onPick, onClose, client }
}

const input = () => screen.getByRole('combobox', { name: 'Ort suchen' })
const type = (value: string) => fireEvent.change(input(), { target: { value } })
const sleep = (ms: number) => act(() => new Promise((done) => setTimeout(done, ms)))

beforeEach(() => {
  places.search.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('place sheet', () => {
  it('opens with the search focused, the hint about public places and a short intro', async () => {
    open()
    expect(screen.getByRole('dialog', { name: 'Wo feiert ihr?' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(input()))
    expect(screen.getByText('Nenne einen öffentlichen Treffpunkt, keine fremde Privatadresse')).toBeTruthy()
    expect(screen.getByText('Tipp ein Café, einen Park oder eine Adresse ein.')).toBeTruthy()
    expect(places.search).not.toHaveBeenCalled()
  })

  it('suggests places after a pause in typing and credits OpenStreetMap', async () => {
    places.search.mockResolvedValue([MORGENROT, WOLKE])
    open()
    type('Caf')
    expect(await screen.findByRole('option', { name: /Café Morgenrot/ })).toBeTruthy()
    expect(places.search).toHaveBeenCalledTimes(1)
    expect(places.search).toHaveBeenCalledWith('Caf', expect.objectContaining({ lang: 'de', expectedUserId: HOST_ID, signal: expect.any(AbortSignal) }))
    const options = screen.getAllByRole('option')
    expect(options[0]?.textContent).toContain('„Caf“ übernehmen')
    expect(within(options[1] as HTMLElement).getByText('Lindenweg 4, 12345 Beispielstadt')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Vorschläge' })).getAllByRole('option')).toHaveLength(2)
    const credit = screen.getByRole('link', { name: '© OpenStreetMap-Mitwirkende' })
    expect(credit.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright')
    expect(credit.getAttribute('rel')).toContain('noopener')
  })

  it('picks a suggestion, or the typed text with Enter', async () => {
    places.search.mockResolvedValue([MORGENROT])
    const { onPick } = open()
    type('Caf')
    fireEvent.click(await screen.findByRole('option', { name: /Café Morgenrot/ }))
    expect(onPick).toHaveBeenLastCalledWith(MORGENROT.text)
    type('  Garten   bei Oma ')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('Garten bei Oma')
  })

  it('hands on the point and kind of a suggestion that has one (for the form’s small map), nothing else', async () => {
    const withPoint: PlaceSuggestion = { ...MORGENROT, point: { lat: 51.16212, lon: 10.45231 } }
    places.search.mockResolvedValue([withPoint, WOLKE])
    const { onPick } = open()
    type('Caf')
    fireEvent.click(await screen.findByRole('option', { name: /Café Morgenrot/ }))
    expect(onPick).toHaveBeenLastCalledWith(MORGENROT.text, { point: { lat: 51.16212, lon: 10.45231 }, kind: 'cafe' })
    fireEvent.click(screen.getByRole('option', { name: /Café Wolke/ }))
    expect(onPick).toHaveBeenLastCalledWith(WOLKE.text)
    expect(onPick.mock.lastCall).toHaveLength(1)
  })

  it('moves through the options with the arrow keys (aria-activedescendant)', async () => {
    places.search.mockResolvedValue([MORGENROT, WOLKE])
    const { onPick } = open()
    type('Caf')
    await screen.findByRole('option', { name: /Café Wolke/ })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    const active = document.getElementById(input().getAttribute('aria-activedescendant') ?? '')
    expect(active?.textContent).toContain('Café Morgenrot')
    expect(active?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith(MORGENROT.text)
  })

  it('waits for two characters and aborts the request a newer keystroke replaced', async () => {
    const first = deferred<PlaceSuggestion[]>()
    places.search.mockReturnValueOnce(first.promise).mockResolvedValueOnce([MORGENROT])
    open()
    type('C')
    await sleep(400)
    expect(places.search).not.toHaveBeenCalled()
    type('Ca')
    await waitFor(() => expect(places.search).toHaveBeenCalledTimes(1))
    const [, firstOptions] = places.search.mock.calls[0] as [string, { signal: AbortSignal }]
    const firstSignal = firstOptions.signal
    type('Caf')
    expect(firstSignal.aborted).toBe(true)
    expect(await screen.findByRole('option', { name: /Café Morgenrot/ })).toBeTruthy()
    expect(places.search).toHaveBeenLastCalledWith('Caf', expect.anything())
    first.resolve([WOLKE]) // the stale answer arrives late: it is ignored
    await sleep(20)
    expect(screen.queryByRole('option', { name: /Café Wolke/ })).toBeNull()
  })

  it('offline: no request, the typed text and a calm note', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { onPick } = open()
    type('Café')
    await sleep(350)
    expect(places.search).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Du bist offline')
    fireEvent.click(screen.getByRole('option', { name: /„Café“ übernehmen/ }))
    expect(onPick).toHaveBeenCalledWith('Café')
  })

  it('stays calm on errors and rate limits — the typed text always works', async () => {
    places.search.mockRejectedValueOnce(new PlacesError('upstream_unavailable'))
    open()
    type('Park')
    expect(await screen.findByText('Vorschläge sind gerade nicht erreichbar – übernimm einfach deinen Text.')).toBeTruthy()
    expect(screen.getByRole('option', { name: /„Park“ übernehmen/ })).toBeTruthy()
    places.search.mockRejectedValueOnce(new PlacesError('rate_limited', 30))
    type('Parks')
    expect(await screen.findByText(/Kurz durchatmen/)).toBeTruthy()
    // no new request while the Worker asked to wait: the same calm note
    type('Parkhaus')
    await sleep(350)
    expect(places.search).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Kurz durchatmen/)).toBeTruthy()
  })

  it('says so when nothing was found', async () => {
    places.search.mockResolvedValue([])
    open()
    type('Xyzzy')
    expect(await screen.findByText('Nichts gefunden für „Xyzzy“ – übernimm einfach deinen Text.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '© OpenStreetMap-Mitwirkende' })).toBeNull()
  })

  it('offers the places of my own hosted occasions from the cache — never a guest\'s view', () => {
    const client = makeQueryClient()
    const feed: FeedScreen = {
      upcoming: [
        feedOccasion({ place_text: 'Café Morgenrot', starts_at: '2026-12-01T18:00:00.000Z' }),
        feedOccasion({ place_text: 'café morgenrot', starts_at: '2026-11-01T18:00:00.000Z' }), // the same place
        feedOccasion({ place_text: 'Fremdes Wohnzimmer', role: 'member', starts_at: '2026-12-24T18:00:00.000Z' }),
        feedOccasion({ place_text: 'Rosengarten am Fluss', starts_at: '2026-11-20T18:00:00.000Z' }),
        feedOccasion({ place_text: 'Kulturhaus Lichtblick', starts_at: '2026-11-10T18:00:00.000Z' }),
        feedOccasion({ place_text: 'Bar Abendstern', starts_at: '2026-11-05T18:00:00.000Z' }),
        feedOccasion({ place_text: null }),
      ],
      past: [feedOccasion({ place_text: 'Marktplatz', starts_at: '2026-10-01T18:00:00.000Z' })],
    }
    client.setQueryData(qk.feed(), feed)
    client.setQueryData(qk.occasion('11111111-1111-4111-8111-111111111111'), hostScreen()) // "Café am Markt", 2030
    open(client)
    const recent = within(screen.getByRole('group', { name: 'Zuletzt verwendet' })).getAllByRole('option').map((option) => option.textContent)
    expect(recent).toEqual(['Café am Markt', 'Café Morgenrot', 'Rosengarten am Fluss', 'Kulturhaus Lichtblick', 'Bar Abendstern'])
    expect(screen.queryByText('Fremdes Wohnzimmer')).toBeNull()
  })

  it('opens with the place already set: selected for retyping, kept with one tap, not searched', async () => {
    places.search.mockResolvedValue([MORGENROT])
    const { onPick } = open(makeQueryClient(), 'Café am Markt')
    await waitFor(() => expect(document.activeElement).toBe(input()))
    expect((input() as HTMLInputElement).value).toBe('Café am Markt')
    await sleep(350)
    expect(places.search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /„Café am Markt“ übernehmen/ }))
    expect(onPick).toHaveBeenCalledWith('Café am Markt')
    type('Café M')
    expect(await screen.findByRole('option', { name: /Café Morgenrot/ })).toBeTruthy()
  })

  it('refuses a free text over 200 characters instead of cutting it', () => {
    const { onPick } = open()
    type('x'.repeat(201))
    const free = screen.getByRole('option', { name: /übernehmen/ })
    expect(free.getAttribute('aria-disabled')).toBe('true')
    expect(within(free).getByText('Höchstens 200 Zeichen')).toBeTruthy()
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.click(free)
    expect(onPick).not.toHaveBeenCalled()
  })
})
