import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { mapTileQuery } from '../../../lib/api/mapTile'
import type { PlaceKind, PlacePoint } from '../../../lib/api/places'
import { useObjectUrl } from '../../../lib/objectUrl'
import { MINI_MAP_STRIP_HEIGHT, miniMapTiles, miniMapZoom, type PlacedTile } from './miniMapTiles'
import './mini-map.css'

// The small map next to a chosen place in the occasion form (Felix 26.10: "a mini map about the size of a list's
// icon, so you see whether the right place was found"). Lazy: PlaceField loads this chunk only once a suggestion with
// a point was picked. The tiles are OpenStreetMap's, but every byte comes from OUR Worker (lib/api/mapTile.ts) and is
// shown as a blob: URL — the device never contacts OpenStreetMap. Decorative (aria-hidden): the place's text right
// next to it says the same. The licence credit ("© OpenStreetMap") is the row's line under the place (PlaceField).
// A skeleton until every tile has loaded, then the map and its pin fade in (no fade under calm motion); any missing
// tile (offline, switched off, an error) → 'failed', and the form shows its plain pin tile instead.
// variant 'strip' (20261027190000, Felix 27.10 «мини-карта в событии, просто где точка»): the occasion screen's
// wide, short map under the place — as wide as its box (measured: only the tiles it really shows), the credit
// (© OpenStreetMap) in its corner; on any failure it renders nothing at all.

export type MiniMapState = 'loading' | 'ready' | 'failed'

export interface MiniMapProps {
  point: PlacePoint
  kind: PlaceKind
  /** loading → ready, or failed (then the caller shows its own tile) */
  onState?: (state: MiniMapState) => void
  /** 'thumb' (default): the form's 44 px square; 'strip': the occasion screen's full-width strip */
  variant?: 'thumb' | 'strip'
  /** the licence credit drawn in the strip's corner (the form puts it under the place instead) */
  credit?: string
  className?: string
}

/** Width when the box cannot be measured (jsdom); a real browser always measures. */
const STRIP_FALLBACK_WIDTH = 288

/** The strip's width in px (0 until measured), following its box (rotation, a wider window). */
function useBoxWidth(enabled: boolean): [(node: HTMLSpanElement | null) => void, number] {
  const [node, setNode] = useState<HTMLSpanElement | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!enabled || !node) return
    const measure = () => setWidth(Math.round(node.clientWidth) || STRIP_FALLBACK_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, node])
  return [setNode, width]
}

const keyOf = (tile: PlacedTile) => `${tile.x}/${tile.y}`

function TileImage({ blob, tile, onLoad, onError }: { blob: Blob | null | undefined; tile: PlacedTile; onLoad: () => void; onError: () => void }) {
  const url = useObjectUrl(blob)
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      decoding="async"
      className="of-minimap-tile"
      style={{ left: tile.left, top: tile.top }}
      onLoad={onLoad}
      onError={onError}
    />
  )
}

export default function MiniMap({ point, kind, onState, variant = 'thumb', credit, className }: MiniMapProps) {
  const strip = variant === 'strip'
  const [boxRef, boxWidth] = useBoxWidth(strip)
  const measuring = strip && boxWidth === 0
  const zoom = miniMapZoom(kind)
  const tiles = measuring ? [] : miniMapTiles(point, zoom, strip ? { width: boxWidth, height: MINI_MAP_STRIP_HEIGHT } : undefined)
  const results = useQueries({ queries: tiles.map((tile) => mapTileQuery(zoom, tile.x, tile.y)) })
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  // a tile the browser could not decode counts as missing
  const [broken, setBroken] = useState(false)
  const failed = broken || (!measuring && tiles.length === 0) || results.some((result) => result.isError || (result.isSuccess && !result.data))
  const ready = !failed && !measuring && tiles.every((tile) => loaded.has(keyOf(tile)))
  const state: MiniMapState = failed ? 'failed' : ready ? 'ready' : 'loading'

  const stateListener = useRef(onState)
  useEffect(() => {
    stateListener.current = onState
  })
  useEffect(() => {
    stateListener.current?.(state)
  }, [state])

  if (failed) return null
  return (
    <span
      ref={boxRef}
      aria-hidden="true"
      className={className ? `of-minimap ${className}` : 'of-minimap'}
      data-minimap=""
      data-variant={strip ? 'strip' : undefined}
      data-ready={ready ? '' : undefined}
    >
      {ready ? null : <span className="of-minimap-skeleton skeleton" />}
      <span className="of-minimap-tiles">
        {tiles.map((tile, index) => (
          <TileImage
            key={keyOf(tile)}
            blob={results[index]?.data}
            tile={tile}
            onLoad={() => setLoaded((done) => (done.has(keyOf(tile)) ? done : new Set(done).add(keyOf(tile))))}
            onError={() => setBroken(true)}
          />
        ))}
      </span>
      <span className="of-minimap-dim" />
      <svg className="of-minimap-pin" viewBox="0 0 14 18" aria-hidden="true" focusable="false">
        <path d="M7 17.2S1.2 11.9 1.2 7.4a5.8 5.8 0 1 1 11.6 0c0 4.5-5.8 9.8-5.8 9.8z" />
        <circle cx="7" cy="7.3" r="2.1" />
      </svg>
      {credit ? <span className="of-minimap-credit" data-map-credit="">{credit}</span> : null}
    </span>
  )
}
