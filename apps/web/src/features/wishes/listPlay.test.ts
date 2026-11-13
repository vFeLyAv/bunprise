// «Помпон в открытом списке» in the app (31.10): the triggers of the list Pompon (./listPlay.ts, the real
// @bunprise/mascot/listplay with the WAAPI fake of mascot-ui/test-shims.ts): which action plays which moment, only when
// he may (still poses, the stage, on screen, paused by a sheet), the design's haptics and no others, the empty list's
// box (the first peek after ≈ 1 s, then 7 – 12 s; a tap; "+" then the new-wish screen), selection mode, the shake,
// the ear, and that he leaves nothing behind.
import '../mascot-ui/test-shims'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const haptics = vi.hoisted(() => ({ haptic: vi.fn(), feedback: vi.fn() }))
vi.mock('../../lib/haptics', () => haptics)

import { resetShakeTargets, shaken } from '../mascot-ui/pomponPlay'
import { activeMascot, registerMascot, requestStage, resetStage, type StageMember } from '../mascot-ui/stage'
import { createListPompon, FIRST_PEEK_MS, PEEK_MIN_MS, POP_NAVIGATE_S, type ListPompon, type ListPomponOptions } from './listPlay'

type Box = { x: number; y: number; w: number; h: number }
const boxes = new Map<Element, Box>()
const DEFAULT: Box = { x: 300, y: 120, w: 52, h: 58 }
const rectOf = (b: Box) => ({ x: b.x, y: b.y, left: b.x, top: b.y, width: b.w, height: b.h, right: b.x + b.w, bottom: b.y + b.h, toJSON: () => ({}) }) as DOMRect

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(boxes.get(this) ?? DEFAULT)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  boxes.clear()
  haptics.haptic.mockClear()
  haptics.feedback.mockClear()
  resetStage()
  resetShakeTargets()
  document.body.replaceChildren()
})

/** The owner's list screen: the content (his layer), the header's icon row (his seat), two tiles. */
function screenOf() {
  const layer = document.createElement('div')
  const block = document.createElement('div')
  const row = document.createElement('div')
  block.append(row)
  layer.append(block)
  const tiles = ['a', 'b'].map((id, i) => {
    const li = document.createElement('li')
    li.dataset.wishId = id
    const media = document.createElement('span')
    media.className = 'wt-media'
    li.append(media)
    layer.append(li)
    boxes.set(li, { x: 16 + i * 187, y: 300, w: 171, h: 230 })
    boxes.set(media, { x: 22 + i * 187, y: 306, w: 159, h: 159 })
    return li
  })
  document.body.append(layer)
  boxes.set(layer, { x: 0, y: 0, w: 390, h: 1400 })
  boxes.set(block, { x: 16, y: 70, w: 358, h: 160 })
  boxes.set(row, { x: 16, y: 70, w: 200, h: 56 })
  return { layer, row, tiles }
}

function make(o: Partial<ListPomponOptions> = {}): { p: ListPompon; played: string[]; layer: HTMLElement; tiles: HTMLElement[] } {
  const s = screenOf()
  const played: string[] = []
  const p = createListPompon({
    mode: 'list',
    layer: s.layer,
    seatRow: () => s.row,
    scroller: window,
    still: false,
    endText: 'Das war’s!',
    insets: () => ({ top: 60, bottom: 80 }),
    onMoment: (name) => played.push(name),
    ...o,
  })
  return { p, played, layer: s.layer, tiles: s.tiles }
}

const hapticKinds = () => [...haptics.haptic.mock.calls.map((c) => String(c[0])), ...haptics.feedback.mock.calls.map((c) => `feedback:${String(c[0])}`)]

describe('the list Pompon: the owner’s own actions → his moments', () => {
  it('a new wish: he pats it into place (one light tick on the second pat), the stage is his meanwhile', async () => {
    const { p, played, tiles } = make()
    expect(p.wish(tiles[0] as HTMLElement)).toBe(true)
    expect(played).toEqual(['wish'])
    expect(activeMascot()).not.toBeNull()
    expect(p.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(4000)
    expect(p.busy).toBe(false)
    expect(activeMascot()).toBeNull()
    expect(hapticKinds()).toEqual(['select'])
    // the tile's picture is plain again
    expect(((tiles[0] as HTMLElement).querySelector('.wt-media') as HTMLElement).style.transform).toBe('')
  })

  it('«Erhalten»: the stamp tells the list (with the app’s one success), back on his seat the tile may leave', async () => {
    const { p, played, tiles } = make()
    const order: string[] = []
    expect(p.received(tiles[1] as HTMLElement, { onStamp: () => order.push('stamp'), onBack: () => order.push('back') })).toBe(true)
    expect(played).toEqual(['received'])
    await vi.advanceTimersByTimeAsync(1200)
    await vi.advanceTimersByTimeAsync(3000)
    expect(order).toEqual(['stamp', 'back'])
    expect(hapticKinds()).toEqual(['feedback:success'])
    expect(p.busy).toBe(false)
  })

  it('Löschen: he waves "bye" from his seat (no haptics of his own)', async () => {
    const { p, played } = make()
    expect(p.remove(rectOf({ x: 20, y: 300, w: 171, h: 230 }))).toBe(true)
    expect(played).toEqual(['delete'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(hapticKinds()).toEqual([])
  })

  it('selection mode: he holds his ears (and keeps holding them); «Verschieben» = he hops after the tiles; «Fertig» = he lets go', async () => {
    const { p, played } = make()
    p.selection(true)
    expect(played).toEqual(['select'])
    await vi.advanceTimersByTimeAsync(1600)
    // still holding his ears after the moment (the brows stay)
    expect(p.busy).toBe(false)
    p.selection(false, { kind: 'move', rects: [rectOf({ x: 20, y: 300, w: 171, h: 230 })] })
    expect(played).toEqual(['select', 'move'])
    await vi.advanceTimersByTimeAsync(3000)
    p.selection(true)
    await vi.advanceTimersByTimeAsync(1600)
    p.selection(false)
    expect(played).toEqual(['select', 'move', 'select', 'relax'])
    p.selection(true)
    await vi.advanceTimersByTimeAsync(1600)
    p.selection(false, { kind: 'bulk', rects: [] })
    expect(played.at(-1)).toBe('bulk')
  })

  it('a tap on him = a boop (tap haptic); he is a 52 × 58 px target, decorative', async () => {
    const { p, played, layer } = make()
    const hit = layer.querySelector<HTMLElement>('.lp-hit')
    expect(hit).not.toBeNull()
    expect(hit?.style.width).toBe('52px')
    expect(hit?.style.height).toBe('58px')
    expect(layer.querySelector('.lp-actor')?.getAttribute('aria-hidden')).toBe('true')
    // his seat: the right end of the header's row (feet on its baseline), not on the tiles
    boxes.set(hit as HTMLElement, { x: 318, y: 70, w: 52, h: 58 })
    hit?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 344, clientY: 100, pointerId: 1, button: 0 }))
    hit?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 344, clientY: 100, pointerId: 1, button: 0 }))
    expect(played).toEqual(['boop'])
    await vi.advanceTimersByTimeAsync(80)
    expect(hapticKinds()).toEqual(['tap'])
    p.destroy()
  })

  it('a press on an ear tip and a pull: "ай" (one tap haptic), the ear springs back when let go', async () => {
    const { played, layer } = make()
    const hit = layer.querySelector<HTMLElement>('.lp-hit') as HTMLElement
    // his feet at the seat: x 374 − 30 = 344, y 70 + 56 − 2 = 124 (layer px = client px here); the right ear tip ≈ 19 px right, 25 px up
    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 344 + 19, clientY: 124 - 36, pointerId: 2, button: 0 }))
    expect(played).toEqual(['grab'])
    await vi.advanceTimersByTimeAsync(100)
    hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 344 + 30, clientY: 124 - 30, pointerId: 2 }))
    hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 344 + 30, clientY: 124 - 30, pointerId: 2 }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(hapticKinds()).toEqual(['tap'])
  })

  it('the phone shaken: the Pompon on screen gets dizzy (no haptics); not while still', async () => {
    const { played } = make()
    expect(shaken()).toBe(true)
    expect(played).toEqual(['dizzy'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(hapticKinds()).toEqual([])
    resetStage()
    resetShakeTargets()
    document.body.replaceChildren()
    const calm = make({ still: true })
    expect(shaken()).toBe(false)
    expect(calm.played).toEqual([])
  })
})

describe('only when he may', () => {
  it('still poses («Weniger», battery saver, the system): no moment at all — selection mode = the still pose', () => {
    const animate = vi.spyOn(Element.prototype, 'animate')
    const { p, played, tiles } = make({ still: true })
    const before = animate.mock.calls.length
    expect(p.wish(tiles[0] as HTMLElement)).toBe(false)
    expect(p.received(tiles[0] as HTMLElement, { onStamp: () => undefined, onBack: () => undefined })).toBe(false)
    p.selection(true)
    p.selection(false)
    expect(played).toEqual([])
    expect(animate.mock.calls.length).toBe(before)
  })

  it('one mascot at a time: while another one plays, he waits (the list changes by itself)', () => {
    const { p, played, tiles } = make()
    const other: StageMember = { busy: true, isDestroyed: false, stopIdle: () => undefined, startIdle: () => undefined }
    const id = Symbol('other')
    registerMascot(id, other, false)
    expect(requestStage(id, 'response')).toBe(true)
    expect(p.wish(tiles[0] as HTMLElement)).toBe(false)
    expect(played).toEqual([])
  })

  it('off screen (his seat scrolled under the top bar): no list moment', () => {
    const { p, played, tiles, layer } = make()
    boxes.set(layer.querySelector('.lp-hit') as HTMLElement, { x: 318, y: -40, w: 52, h: 58 })
    expect(p.wish(tiles[0] as HTMLElement)).toBe(false)
    expect(played).toEqual([])
  })

  it('a sheet is open: the owner’s own action still plays (the sheet is closing); destroy leaves nothing', async () => {
    const { p, played, tiles, layer } = make()
    p.setPaused(true)
    expect(p.wish(tiles[0] as HTMLElement)).toBe(true)
    expect(played).toEqual(['wish'])
    p.destroy()
    expect(layer.querySelector('.lp-actor')).toBeNull()
    expect(activeMascot()).toBeNull()
    expect(shaken()).toBe(false)
  })
})

describe('the empty list: Pompon in a closed gift box', () => {
  function makeEmpty(o: Partial<ListPomponOptions> = {}) {
    const slot = document.createElement('div')
    document.body.append(slot)
    boxes.set(slot, { x: 97, y: 200, w: 196, h: 118 })
    const played: string[] = []
    const p = createListPompon({ mode: 'empty', layer: slot, scroller: window, still: false, endText: '', insets: () => ({ top: 60, bottom: 80 }), onMoment: (n) => played.push(n), ...o })
    for (const l of slot.querySelectorAll<HTMLElement>('.lpp-boxlayer')) boxes.set(l, { x: 100, y: 205, w: 180, h: 110 })
    return { p, played, slot }
  }

  it('the first peek ≈ 1 s after the screen opened, the next one not before 7 s', async () => {
    const { played } = makeEmpty()
    await vi.advanceTimersByTimeAsync(FIRST_PEEK_MS - 50)
    expect(played).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(played).toEqual(['peek'])
    await vi.advanceTimersByTimeAsync(1700 + PEEK_MIN_MS - 200)
    expect(played).toEqual(['peek'])
    await vi.advanceTimersByTimeAsync(5200)
    expect(played).toEqual(['peek', 'peek'])
  })

  it('a tap on the box: he peeks at once (a tap haptic); his box is decorative', async () => {
    const { played, slot } = makeEmpty()
    const front = slot.querySelectorAll<HTMLElement>('.lpp-boxlayer')[1] as HTMLElement
    expect(front.getAttribute('aria-hidden')).toBe('true')
    front.click()
    expect(played).toEqual(['peek'])
    expect(hapticKinds()).toEqual(['tap'])
  })

  it('"+": he knocks the lid off and jumps out, then the new-wish screen opens (≈ 1.4 s)', async () => {
    const { p, played } = makeEmpty()
    const then = vi.fn()
    expect(p.pop(then)).toBe(true)
    expect(played).toEqual(['pop'])
    await vi.advanceTimersByTimeAsync(POP_NAVIGATE_S * 1000 - 100)
    expect(then).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(then).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(then).toHaveBeenCalledTimes(1)
  })

  it('still poses: no peek, no pop (the caller opens the screen at once) — the lid stays lifted a crack', async () => {
    const { p, played, slot } = makeEmpty({ still: true })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(played).toEqual([])
    expect(p.pop(() => undefined)).toBe(false)
    const lid = slot.querySelectorAll<HTMLElement>('.lpp-boxlayer')[2]?.firstElementChild as HTMLElement
    expect(lid.style.transform).toContain('rotate(-7deg)')
  })

  it('at night: no peeks until a tap on the box woke him (then 10 min of peeks)', async () => {
    const { p, played, slot } = makeEmpty()
    p.setNight(true, -Infinity)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(played).toEqual([])
    ;(slot.querySelectorAll<HTMLElement>('.lpp-boxlayer')[1] as HTMLElement).click()
    expect(played).toEqual(['peek'])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(played.length).toBeGreaterThan(1)
  })
})
