import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceSuggestion } from '../../lib/api/places'
import type { OccasionScreen } from '../../lib/api/types'
import { qk } from '../../lib/queryKeys'
import { guestScreen, HOST_ID, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from './test-utils'

// The mini map on the occasion screen (Felix 27.10: «мини-карта в событии, просто где точка»; migration
// 20261027190000): a stored point → a static strip under the place (our Worker's tiles as blob: URLs, the pin, the
// "© OpenStreetMap" credit), for host and guests alike; no point, offline or a missing tile → the block exactly as
// before. The form saves the point of a picked suggestion and sends none for typed text. Invented places only.

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn() }))
const api = vi.hoisted(() => ({
  getOccasionScreen: vi.fn(),
  getFeed: vi.fn(),
  updateOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  createOccasion: vi.fn(),
  leaveOccasion: vi.fn(),
  removeMember: vi.fn(),
  setRsvp: vi.fn(),
  newOccasionId: vi.fn(),
}))
const places = vi.hoisted(() => ({ search: vi.fn() }))
const tiles = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useRouter: () => ({ navigate: nav.navigate, history: { back: nav.back }, state: { location: { pathname: `/occasions/${OCCASION_ID}/edit` } } }),
    useCanGoBack: () => true,
    Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
  }
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../../lib/api/occasions', () => api)
vi.mock('../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/places')>()),
  searchPlaces: places.search,
}))
vi.mock('../../lib/api/mapTile', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api/mapTile')>()
  return {
    ...original,
    mapTileQuery: (z: number, x: number, y: number) => ({ ...original.mapTileQuery(z, x, y), queryFn: () => tiles.get(z, x, y) }),
  }
})
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))

import { EditOccasionPage } from './EditOccasionPage'
import { OccasionHero } from './OccasionHero'
import { resetSavingForTests } from './saving'

const POINT = { place_lat: 51.16094, place_lon: 10.45108 }
const MORGENROT: PlaceSuggestion = {
  id: 'p1',
  name: 'Café Morgenrot',
  line: 'Lindenweg 4, 12345 Beispielstadt',
  kind: 'cafe',
  text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt',
  point: { lat: 51.16212, lon: 10.45231 },
}
const PNG = () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

const withPoint = (base: OccasionScreen, point: Partial<OccasionScreen['occasion']> = POINT): OccasionScreen =>
  ({ ...base, occasion: { ...base.occasion, ...point } })
const strip = () => document.querySelector('[data-minimap][data-variant="strip"]')
const credit = () => screen.queryByText('Karte © OpenStreetMap')

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  api.getFeed.mockReturnValue(new Promise(() => {}))
  api.updateOccasion.mockResolvedValue(undefined)
  places.search.mockResolvedValue([MORGENROT])
  tiles.get.mockResolvedValue(PNG())
  nav.navigate.mockResolvedValue(undefined)
  // jsdom has no object URLs
  let next = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:fixture/${next++}`, revokeObjectURL: () => {} }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the occasion screen: the mini map under the place', () => {
  it('a stored point → the strip with the pin and the credit, for the host and for a guest; the map buttons stay', async () => {
    for (const data of [withPoint(hostScreen()), withPoint(guestScreen())]) {
      const { unmount } = renderWithClient(<OccasionHero screen={data} userId={HOST_ID} />)
      await waitFor(() => expect(strip()).not.toBeNull())
      expect(strip()?.getAttribute('aria-hidden')).toBe('true')
      expect(credit()).not.toBeNull()
      const images = await waitFor(() => {
        const found = Array.from(document.querySelectorAll<HTMLImageElement>('[data-minimap] img'))
        expect(found.length).toBeGreaterThan(0)
        return found
      })
      // only the tiles under the strip (street level), as blob: URLs
      expect(images.length).toBeLessThanOrEqual(8)
      for (const image of images) expect(image.getAttribute('src')).toMatch(/^blob:/)
      expect(tiles.get.mock.calls.every(([z]) => z === 15)).toBe(true)
      expect(strip()?.hasAttribute('data-ready')).toBe(false)
      act(() => images.forEach((image) => fireEvent.load(image)))
      expect(strip()?.hasAttribute('data-ready')).toBe(true)
      expect(screen.getByRole('link', { name: 'In Google Maps öffnen' })).toBeTruthy()
      expect(screen.getByRole('link', { name: 'In Apple Karten öffnen' })).toBeTruthy()
      unmount()
    }
  })

  it('no point (or a server without the columns) → no map and no tile request, the block as before', async () => {
    for (const data of [hostScreen(), withPoint(hostScreen(), { place_lat: null, place_lon: null })]) {
      const { unmount } = renderWithClient(<OccasionHero screen={data} userId={HOST_ID} />)
      expect(screen.getByText('Café am Markt')).toBeTruthy()
      expect(document.querySelector('[data-place-map]')).toBeNull()
      expect(credit()).toBeNull()
      unmount()
    }
    expect(tiles.get).not.toHaveBeenCalled()
  })

  it('offline → nothing (no skeleton, no request)', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderWithClient(<OccasionHero screen={withPoint(guestScreen())} userId={HOST_ID} />)
    expect(document.querySelector('[data-place-map]')).toBeNull()
    expect(tiles.get).not.toHaveBeenCalled()
  })

  it('a missing tile (the Worker\'s map switch off, an error) → the strip goes away completely', async () => {
    tiles.get.mockResolvedValue(null)
    renderWithClient(<OccasionHero screen={withPoint(guestScreen())} userId={HOST_ID} />)
    await waitFor(() => expect(tiles.get).toHaveBeenCalled())
    await waitFor(() => expect(strip()).toBeNull())
    expect(credit()).toBeNull()
    // the wrapper is empty (CSS :empty hides it), the place and its buttons are there
    expect(document.querySelector('[data-place-map]')?.children.length ?? 0).toBe(0)
    expect(screen.getByText('Café am Markt')).toBeTruthy()
  })
})

describe('the form saves the point', () => {
  function renderEdit(data: OccasionScreen) {
    const client = makeQueryClient()
    client.setQueryData(qk.occasion(OCCASION_ID), data)
    return renderWithClient(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_ID} />, client)
  }
  const save = () => fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
  const sent = () => api.updateOccasion.mock.calls[0]?.[1] as Record<string, unknown>

  it('a picked suggestion with a point → place_lat / place_lon go out with the place text', async () => {
    const base = hostScreen()
    renderEdit({ ...base, occasion: { ...base.occasion, place_text: null } })
    fireEvent.click(screen.getByRole('button', { name: 'Ort hinzufügen' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Ort suchen' }), { target: { value: 'Caf' } })
    fireEvent.click(await screen.findByRole('option', { name: /Café Morgenrot/ }))
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalled())
    expect(sent()).toMatchObject({ place_text: MORGENROT.text, place_lat: 51.16212, place_lon: 10.45231 })
  })

  it('an opened occasion keeps its stored point (the form shows its map); removing the place sends no point', async () => {
    renderEdit(withPoint(hostScreen()))
    await waitFor(() => expect(document.querySelector('[data-minimap]')).not.toBeNull())
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(sent()).toMatchObject({ place_text: 'Café am Markt', ...POINT })
  })

  it('"Ort entfernen" → no point is sent (the database drops the stored one with the text)', async () => {
    renderEdit(withPoint(hostScreen()))
    fireEvent.click(screen.getByRole('button', { name: 'Ort entfernen' }))
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalled())
    expect(sent()).toMatchObject({ place_text: null })
    expect(sent()).not.toHaveProperty('place_lat')
    expect(sent()).not.toHaveProperty('place_lon')
  })
})
