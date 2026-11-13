import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOST_ID, renderWithClient } from '../test-utils'

// The place row's small map (Felix 26.10): a picked suggestion WITH a point shows the map (our Worker's tiles as
// blob: URLs) and "Karte © OpenStreetMap" under the place; without a point, after clearing, or when a tile is missing
// the row keeps its plain pin tile. Invented places only.

const places = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('../../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/places')>()),
  searchPlaces: places.search,
}))
const tiles = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../../lib/api/mapTile', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/api/mapTile')>()
  return {
    ...original,
    mapTileQuery: (z: number, x: number, y: number) => ({ ...original.mapTileQuery(z, x, y), queryFn: () => tiles.get(z, x, y) }),
  }
})

import type { PlaceSuggestion } from '../../../lib/api/places'
import { PlaceField } from './PlaceField'

const MORGENROT: PlaceSuggestion = {
  id: 'p1',
  name: 'Café Morgenrot',
  line: 'Lindenweg 4, 12345 Beispielstadt',
  kind: 'cafe',
  text: 'Café Morgenrot, Lindenweg 4, 12345 Beispielstadt',
  point: { lat: 51.16212, lon: 10.45231 },
}
const WITHOUT_POINT: PlaceSuggestion = { id: 'p2', name: 'Café Wolke sieben', line: 'Mühlengasse 9, 12345 Beispielstadt', kind: 'cafe', text: 'Café Wolke sieben, Mühlengasse 9, 12345 Beispielstadt' }

function Field() {
  const [value, setValue] = useState('')
  return <PlaceField id="place" value={value} onChange={setValue} userId={HOST_ID} lang="de" />
}

async function pick(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Ort hinzufügen' }))
  fireEvent.change(await screen.findByRole('combobox', { name: 'Ort suchen' }), { target: { value: 'Caf' } })
  fireEvent.click(await screen.findByRole('option', { name }))
}

const miniMap = () => document.querySelector('[data-minimap]')
const credit = () => screen.queryByText('Karte © OpenStreetMap')

beforeEach(() => {
  places.search.mockReset()
  tiles.get.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  // jsdom has no object URLs
  let next = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:fixture/${next++}`, revokeObjectURL: () => {} }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('place row: the small map', () => {
  it('a suggestion with a point → the map with its pin and the OpenStreetMap credit; clearing brings the pin tile back', async () => {
    places.search.mockResolvedValue([MORGENROT, WITHOUT_POINT])
    tiles.get.mockResolvedValue(new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
    renderWithClient(<Field />)
    await pick(/Café Morgenrot/)

    await waitFor(() => expect(miniMap()).not.toBeNull())
    expect(miniMap()?.getAttribute('aria-hidden')).toBe('true')
    expect(credit()).not.toBeNull()
    // only the tiles under the 44 px square (z 15 for a café), as blob: URLs
    const images = await waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLImageElement>('[data-minimap] img'))
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    expect(images.length).toBeLessThanOrEqual(4)
    for (const image of images) expect(image.getAttribute('src')).toMatch(/^blob:/)
    expect(tiles.get.mock.calls.every(([z]) => z === 15)).toBe(true)
    expect(miniMap()?.hasAttribute('data-ready')).toBe(false)
    act(() => images.forEach((image) => fireEvent.load(image)))
    expect(miniMap()?.hasAttribute('data-ready')).toBe(true)
    // the button still says the place itself
    expect(screen.getByRole('button', { name: /Café Morgenrot, Lindenweg 4/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ort entfernen' }))
    expect(miniMap()).toBeNull()
    expect(credit()).toBeNull()
  })

  it('a suggestion without a point (the Worker’s switch is off) → no map, no tile requests', async () => {
    places.search.mockResolvedValue([MORGENROT, WITHOUT_POINT])
    renderWithClient(<Field />)
    await pick(/Café Wolke sieben/)
    await screen.findByRole('button', { name: /Café Wolke sieben, Mühlengasse 9/ })
    expect(miniMap()).toBeNull()
    expect(credit()).toBeNull()
    expect(tiles.get).not.toHaveBeenCalled()
  })

  it('a missing tile (offline, switched off, an error) → the plain pin tile, nothing breaks', async () => {
    places.search.mockResolvedValue([MORGENROT])
    tiles.get.mockResolvedValue(null)
    renderWithClient(<Field />)
    await pick(/Café Morgenrot/)
    await waitFor(() => expect(tiles.get).toHaveBeenCalled())
    await waitFor(() => expect(miniMap()).toBeNull())
    expect(credit()).toBeNull()
    expect(screen.getByRole('button', { name: /Café Morgenrot, Lindenweg 4/ })).toBeTruthy()
  })
})
