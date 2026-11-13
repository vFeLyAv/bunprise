import { describe, expect, it } from 'vitest'
import { MINI_MAP_SIZE, MINI_MAP_TILE_PX, miniMapTiles, miniMapZoom } from './miniMapTiles'

// The place thumbnail's tile maths: the point in the exact middle, only the tiles the 44 px square covers (1–4),
// the standard slippy-map numbering, the grid wrapping at the date line. Invented points.

/** Where the point lands inside the square, from the tiles' placement (px). */
function pointInSquare(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const rad = (lat * Math.PI) / 180
  const worldX = ((lon + 180) / 360) * n * MINI_MAP_TILE_PX
  const worldY = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * MINI_MAP_TILE_PX
  const [first] = miniMapTiles({ lat, lon }, zoom)
  if (!first) throw new Error('no tile')
  return { x: worldX - first.x * MINI_MAP_TILE_PX + first.left, y: worldY - first.y * MINI_MAP_TILE_PX + first.top }
}

describe('mini map tiles', () => {
  it('uses the standard tile numbers (the middle of Germany at z 15)', () => {
    const tiles = miniMapTiles({ lat: 51.16, lon: 10.45 }, 15)
    // x = floor((10.45 + 180) / 360 · 2^15) = 17335, y = 10946 at 51.16° N
    expect(tiles.some((tile) => tile.x === 17335 && tile.y === 10946)).toBe(true)
  })

  it.each([
    [51.16212, 10.45231, 15], [51.16, 10.45, 11], [48.1371, 11.5754, 14], [-33.8688, 151.2093, 15], [0, 0, 16],
  ])('centres %f, %f (z %i) and asks only for the covering tiles', (lat, lon, zoom) => {
    const tiles = miniMapTiles({ lat, lon }, zoom)
    expect(tiles.length).toBeGreaterThanOrEqual(1)
    expect(tiles.length).toBeLessThanOrEqual(4)
    for (const tile of tiles) {
      // every tile overlaps the square
      expect(tile.left).toBeLessThan(MINI_MAP_SIZE)
      expect(tile.top).toBeLessThan(MINI_MAP_SIZE)
      expect(tile.left + MINI_MAP_TILE_PX).toBeGreaterThan(0)
      expect(tile.top + MINI_MAP_TILE_PX).toBeGreaterThan(0)
    }
    const centre = pointInSquare(lat, lon, zoom)
    expect(Math.abs(centre.x - MINI_MAP_SIZE / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(centre.y - MINI_MAP_SIZE / 2)).toBeLessThanOrEqual(0.5)
  })

  it('neighbouring tiles sit exactly one tile apart (no seams)', () => {
    // a point right at a tile corner needs all four
    const tiles = miniMapTiles({ lat: 0, lon: 0 }, 15)
    expect(tiles).toHaveLength(4)
    const lefts = [...new Set(tiles.map((tile) => tile.left))].sort((a, b) => a - b)
    const tops = [...new Set(tiles.map((tile) => tile.top))].sort((a, b) => a - b)
    expect(lefts).toEqual([22 - MINI_MAP_TILE_PX, 22])
    expect(tops).toEqual([22 - MINI_MAP_TILE_PX, 22])
  })

  it('wraps around at the date line', () => {
    const tiles = miniMapTiles({ lat: 10, lon: -179.9999 }, 11)
    expect(new Set(tiles.map((tile) => tile.x))).toEqual(new Set([2047, 0]))
  })

  it('zooms by kind: a town as a whole, a park with its surroundings, the rest at street level', () => {
    expect(miniMapZoom('city')).toBe(11)
    expect(miniMapZoom('park')).toBe(14)
    for (const kind of ['cafe', 'restaurant', 'bar', 'venue', 'address', 'other'] as const) expect(miniMapZoom(kind)).toBe(15)
  })
})
