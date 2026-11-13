import type { PlaceKind, PlacePoint } from '../../../lib/api/places'

// Which map tiles the place thumbnail needs and where they go (Web Mercator, the "slippy map" tile grid of
// OpenStreetMap): the place's point lands exactly in the middle of the square, and only the tiles that the square
// actually covers are asked for — one to four (OSMF tile policy: nothing "around just in case").

/** The thumbnail: the size of a list's cover tile on "Listen" (features/lists/covers.tsx, 40–44 px). */
export const MINI_MAP_SIZE = 44
/** The occasion screen's strip (OccasionHero, 20261027190000): as wide as the place block, this tall. */
export const MINI_MAP_STRIP_HEIGHT = 112
/** 256-px tiles drawn at half size: sharp on 2× screens, and the square shows a little more around the place. */
export const MINI_MAP_TILE_PX = 128

const MAX_LATITUDE = 85.0511

/** A town as a whole, a park with its surroundings, everything else at street level. */
export function miniMapZoom(kind: PlaceKind): number {
  if (kind === 'city') return 11
  if (kind === 'park') return 14
  return 15
}

export interface PlacedTile {
  x: number
  y: number
  /** px from the square's left / top edge */
  left: number
  top: number
}

/** `size`: a square's side, or a rectangle (the screen's strip); the point lands in its middle either way. */
export function miniMapTiles(point: PlacePoint, zoom: number, size: number | { width: number; height: number } = MINI_MAP_SIZE, tilePx = MINI_MAP_TILE_PX): PlacedTile[] {
  const { width, height } = typeof size === 'number' ? { width: size, height: size } : size
  if (!(width > 0 && height > 0)) return []
  const n = 2 ** zoom
  const lat = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat)) * Math.PI) / 180
  const worldX = ((point.lon + 180) / 360) * n * tilePx
  const worldY = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * tilePx
  const left = worldX - width / 2
  const top = worldY - height / 2
  const tiles: PlacedTile[] = []
  for (let row = Math.floor(top / tilePx); row * tilePx < top + height; row++) {
    if (row < 0 || row >= n) continue
    for (let column = Math.floor(left / tilePx); column * tilePx < left + width; column++) {
      tiles.push({
        // across the date line the grid wraps around
        x: ((column % n) + n) % n,
        y: row,
        left: Math.round(column * tilePx - left),
        top: Math.round(row * tilePx - top),
      })
    }
  }
  return tiles
}
