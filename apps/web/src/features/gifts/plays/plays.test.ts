import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Sampled } from '@bunprise/mascot/timeline'
import { CATALOG } from '../../../../../../workers/edge/src/giftIdeas/catalog'
import { GIFT_TOPICS } from '../../../lib/api/giftIdeas'
import { categoryArt, headerScene } from './art'
import { LOOKS } from './looks'
import { BEATS, FACES, openTracks } from './motion'
import { freezeAt, playOnce } from './run'
import { gameSceneFor, NEW_VARIANTS, newSceneFor } from './newscenes'
import { VIEW } from './scenes'

// The game animations and the die moment, ported from the approved gallery (packages/mascot/demo/ideas): every
// board game of the catalogue has one, each ≤ 2 s, finite, only transform / opacity, the same frame for the same
// time (reduced motion = the end pose, written without animate()), our own drawings only — nothing is fetched.

const GAMES = CATALOG.filter((item) => item.game)

function mount(svg: string, w = VIEW.w, h = VIEW.h): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}">${svg}</svg>`
  document.body.append(host)
  return host
}

function inlineStyles(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<SVGElement>('[data-k]')).map((el) => `${el.getAttribute('data-k')}:${el.style.transform}|${el.style.opacity}`)
}

/** Every keyframe of every Web Animation only touches transform / opacity (+ offset / easing). */
function onlyCheapProperties(tracks: readonly Sampled[]): void {
  for (const track of tracks) {
    for (const compiled of track.compile()) {
      expect(compiled.timing.iterations ?? 1, track.name).toBe(1)
      for (const frame of compiled.frames) {
        for (const key of Object.keys(frame)) expect(['offset', 'easing', 'transform', 'opacity'], `${track.name}.${key}`).toContain(key)
      }
    }
  }
}

function noForeignMarkup(svg: string): void {
  expect(svg).not.toMatch(/https?:|href=|<image|<script|url\(|<foreignObject/i)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('game animations', () => {
  it('every board game with facts has its look (since 30.10 also the 7 Kosmos games and the 8 iconic classics: scenes of newscenes.ts)', () => {
    expect(Object.keys(LOOKS).sort()).toEqual(GAMES.map((item) => item.id).sort())
  })

  it('the groups: the eight archetype builders are all in use; 30.10 added three more for the classics (board, stack, shed)', () => {
    // Why more than eight since 30.10: Monopoly / Mensch ärgere Dich nicht / Cluedo (a pawn on a printed track), Jenga
    // (a tower) and UNO / Rummikub (shedding cards or tiles) fit none of the eight; they got their own group
    // (docs/handoffs/2026-10-30-new-game-scenes.md). The group only picks the slide's tint (ARCH_TONE).
    const used = new Set(Object.values(LOOKS).map((look) => look.archetype))
    for (const archetype of ['tiles', 'route', 'pattern', 'words', 'dice', 'coop', 'luck', 'music'] as const) expect(used.has(archetype), archetype).toBe(true)
    for (const archetype of used) expect(['tiles', 'route', 'pattern', 'words', 'dice', 'coop', 'luck', 'music', 'board', 'stack', 'shed'], archetype).toContain(archetype)
    expect(used.size).toBeLessThanOrEqual(11)
    // the classics in the catalogue use two of the three new groups (stack = Jenga, not in the catalogue: gallery only)
    expect(used.has('board')).toBe(true)
    expect(used.has('shed')).toBe(true)
  })

  it.each(Object.entries(LOOKS))('%s: ≤ 2 s, finite, transform / opacity only, deterministic, our drawing only', (_id, look) => {
    const scene = gameSceneFor(look)
    expect(scene.duration).toBeLessThanOrEqual(2)
    noForeignMarkup(scene.svg)
    const host = mount(scene.svg)
    const tracks = scene.tracks(host)
    expect(tracks.length).toBeGreaterThan(0)
    onlyCheapProperties(tracks)
    for (const track of tracks) expect(track.end, track.name).toBeLessThanOrEqual(2)
    freezeAt(tracks, scene.duration)
    const first = inlineStyles(host)
    freezeAt(tracks, 0.4)
    freezeAt(tracks, scene.duration)
    expect(inlineStyles(host)).toEqual(first)
  })

  // every scene of 30.10 — also those whose game is not (yet) in the catalogue: same rules, and no trademark is drawn
  it.each(NEW_VARIANTS)('the 30.10 scene «%s»: ≤ 2 s, finite, transform / opacity only, the end pose stays, no brand in the drawing', (variant) => {
    const scene = newSceneFor(variant)
    expect(scene.duration).toBeLessThanOrEqual(2)
    noForeignMarkup(scene.svg)
    const words = Array.from(scene.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g), (m) => m[1] ?? '').join(' ')
    expect(words).not.toMatch(/\b(uno|monopoly|scrabble|jenga|kniffel|yahtzee|cluedo|clue|dobble|activity|rummikub|catan|kosmos|hasbro|mattel)\b/i)
    const host = mount(scene.svg)
    const tracks = scene.tracks(host)
    expect(tracks.length).toBeGreaterThanOrEqual(3)
    onlyCheapProperties(tracks)
    for (const track of tracks) expect(track.end, track.name).toBeLessThanOrEqual(scene.duration + 0.001)
    freezeAt(tracks, scene.duration)
    const first = inlineStyles(host)
    freezeAt(tracks, 0.4)
    freezeAt(tracks, scene.duration + 1)
    expect(inlineStyles(host)).toEqual(first)
  })

  it('plays once with Web Animations and ends on the end pose (nothing left running)', async () => {
    const scene = gameSceneFor(LOOKS['cat:hig-carcassonne'] ?? { archetype: 'dice', variant: 'clever' })
    const host = mount(scene.svg)
    const tracks = scene.tracks(host)
    const created: Array<{ cancel: ReturnType<typeof vi.fn> }> = []
    const animate = vi.fn(() => {
      const animation = { finished: Promise.resolve(), cancel: vi.fn() }
      created.push(animation)
      return animation as unknown as Animation
    })
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
    try {
      const done = vi.fn()
      playOnce(tracks, scene.duration, done)
      expect(animate).toHaveBeenCalled()
      await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
      expect(created.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
      const end = inlineStyles(host)
      freezeAt(tracks, scene.duration)
      expect(inlineStyles(host)).toEqual(end)
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate
    }
  })

  it('without Web Animations (old browser, tests): the end pose at once', () => {
    const scene = gameSceneFor(LOOKS['cat:jumbo-hitster'] ?? { archetype: 'music', variant: 'timeline' })
    const host = mount(scene.svg)
    const tracks = scene.tracks(host)
    const done = vi.fn()
    playOnce(tracks, scene.duration, done)
    expect(done).toHaveBeenCalledTimes(1)
    const end = inlineStyles(host)
    freezeAt(tracks, scene.duration)
    expect(inlineStyles(host)).toEqual(end)
  })
})

describe('the topic drawings and the moment «Кубик»', () => {
  it('every topic has its tile drawing (ours, nothing fetched)', () => {
    for (const topic of GIFT_TOPICS) {
      const svg = categoryArt(topic)
      expect(svg, topic).toMatch(/^<svg viewBox="0 0 120 90"/)
      noForeignMarkup(svg)
    }
  })

  it('the die rolls in, lands on a six, ≈ 1.7 s, finite, transform / opacity only; the cards rise with it', () => {
    const svg = headerScene()
    noForeignMarkup(svg)
    const screen = document.createElement('div')
    screen.innerHTML = `${svg}<ul><li><article data-k="card"></article></li><li><article data-k="card"></article></li></ul>`
    document.body.append(screen)
    const tracks = openTracks(screen)
    onlyCheapProperties(tracks)
    expect(Math.max(...tracks.map((track) => track.end))).toBeLessThanOrEqual(BEATS.end)
    expect(FACES[FACES.length - 1]).toBe(6)
    expect(tracks.filter((track) => track.name.startsWith('card'))).toHaveLength(2)
    freezeAt(tracks, BEATS.end)
    // at rest only the six shows, the cards stand in place
    const shown = Array.from(screen.querySelectorAll<SVGElement>('[data-k="die-spin"] [data-face]')).filter((face) => face.style.opacity !== '0')
    expect(shown.map((face) => face.getAttribute('data-face'))).toEqual(['6'])
    for (const card of Array.from(screen.querySelectorAll<HTMLElement>('[data-k="card"]'))) {
      expect(card.style.opacity).toBe('1')
      expect(card.style.transform).toBe('translate(0px, 0px)')
    }
  })
})
