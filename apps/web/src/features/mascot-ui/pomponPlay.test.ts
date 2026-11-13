// «Потянуть за ушко» and «Встряхнуть телефон» on every Pompon of the app (31.10, ./pomponPlay.ts with the real
// @bunprise/mascot/listplay and the WAAPI fake of ./test-shims.ts): a press on an ear tip is the ear's (the place's own
// tap / drag never sees it, nor the click after it), anywhere else it stays the place's; one 'tap' haptic; still poses
// and a Pompon that cannot be lent (asleep, mid-scene) = nothing; one mascot at a time; the shake picks the newest
// Pompon on screen that gets the stage — only one; nothing stays behind.
import './test-shims'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const haptics = vi.hoisted(() => ({ haptic: vi.fn() }))
vi.mock('../../lib/haptics', () => haptics)

import { Bunny } from '@bunprise/mascot'
import { attachPompon, onShake, resetShakeTargets, shaken, type PomponHost } from './pomponPlay'
import { activeMascot, registerMascot, requestStage, resetStage } from './stage'

const boxes = new Map<Element, DOMRect>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this) ?? new DOMRect(0, 0, 0, 0)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  boxes.clear()
  haptics.haptic.mockClear()
  resetStage()
  resetShakeTargets()
  document.body.replaceChildren()
})

/** A place's Pompon: 104 px at (100, 100) — his feet at (152, 100 + 104 × 246 / 400). */
function place(o: Partial<PomponHost> = {}, at = { x: 100, y: 100 }) {
  const parent = document.createElement('div')
  const host = document.createElement('div')
  parent.append(host)
  document.body.append(parent)
  boxes.set(host, new DOMRect(at.x, at.y, 104, 67.6))
  const puppet = new Bunny(host, { size: 104, idle: false, interactive: false, reducedMotion: 'off' })
  const placeDown = vi.fn()
  const placeClick = vi.fn()
  parent.addEventListener('pointerdown', placeDown)
  parent.addEventListener('click', placeClick)
  const detach = attachPompon({ box: () => host, target: host, borrow: () => ({ puppet }), still: () => false, ...o })
  const feet = { x: at.x + 52, y: at.y + (246 * 104) / 400 }
  const k = 104 / 96
  return { host, puppet, detach, placeDown, placeClick, ear: { x: feet.x + 19 * k, y: feet.y - 36 * k }, face: { x: feet.x, y: feet.y - 30 * k } }
}

const down = (el: Element, p: { x: number; y: number }, id = 1) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerId: id, button: 0 }))
const up = (p: { x: number; y: number }, id = 1) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: p.x, clientY: p.y, pointerId: id }))

describe('the ear pull on a Pompon of any place', () => {
  it('a press on an ear tip is the ear’s: "ай" (one tap), it springs back when let go; the place sees neither the press nor the click', async () => {
    const s = place()
    down(s.host, s.ear)
    expect(s.placeDown).not.toHaveBeenCalled()
    expect(activeMascot()).not.toBeNull()
    expect(s.puppet.root.querySelector('.hm')?.classList.contains('lp')).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(haptics.haptic.mock.calls).toEqual([['tap']])
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: s.ear.x + 12, clientY: s.ear.y + 4, pointerId: 1 }))
    up(s.ear)
    s.host.click()
    expect(s.placeClick).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    // over: the puppet is the place's own again, the stage free
    expect(activeMascot()).toBeNull()
    expect(s.puppet.root.querySelector('.hm')?.classList.contains('lp')).toBe(false)
    expect(haptics.haptic.mock.calls).toEqual([['tap']])
    s.detach()
    expect(s.puppet.root.querySelectorAll('.lp-dstar')).toHaveLength(0)
  })

  it('a press anywhere else on him stays the place’s own (a tap, a drag) — no moment', () => {
    const s = place()
    down(s.host, s.face)
    up(s.face)
    expect(s.placeDown).toHaveBeenCalledTimes(1)
    expect(activeMascot()).toBeNull()
    expect(s.puppet.root.querySelector('.lp-dstar')).toBeNull()
  })

  it('still poses, a Pompon that cannot be lent (asleep, mid-scene), another mascot playing: the press stays the place’s', () => {
    const still = place({ still: () => true })
    down(still.host, still.ear)
    expect(still.placeDown).toHaveBeenCalledTimes(1)
    const asleep = place({ borrow: () => null }, { x: 300, y: 100 })
    down(asleep.host, asleep.ear)
    expect(asleep.placeDown).toHaveBeenCalledTimes(1)
    expect(activeMascot()).toBeNull()
    const other = Symbol('other')
    registerMascot(other, { busy: true, isDestroyed: false, stopIdle: () => undefined, startIdle: () => undefined }, false)
    expect(requestStage(other, 'response')).toBe(true)
    const third = place({}, { x: 500, y: 100 })
    down(third.host, third.ear)
    expect(third.placeDown).toHaveBeenCalledTimes(1)
    expect(activeMascot()).toBe(other)
  })
})

describe('a place that lets no touch through (the new-wish peek over the link capsule)', () => {
  it('two 44 px ear targets over his ear tips (decorative) catch the ear; the rest of him lets every touch through', async () => {
    const parent = document.createElement('div')
    parent.style.position = 'relative'
    parent.style.pointerEvents = 'none'
    const host = document.createElement('div')
    parent.append(host)
    document.body.append(parent)
    boxes.set(parent, new DOMRect(100, 100, 104, 68))
    boxes.set(host, new DOMRect(100, 103, 104, 67.6))
    const puppet = new Bunny(host, { size: 104, idle: false, interactive: false, reducedMotion: 'off' })
    const detach = attachPompon({ box: () => host, target: host, borrow: () => ({ puppet }), still: () => false, earTargets: true })
    const ears = [...parent.querySelectorAll<HTMLElement>('.pp-ear')]
    expect(ears).toHaveLength(2)
    for (const ear of ears) {
      expect(ear.style.width).toBe('44px')
      expect(ear.style.height).toBe('44px')
      expect(ear.getAttribute('aria-hidden')).toBe('true')
      expect(ear.style.pointerEvents).toBe('auto')
    }
    // above his feet (the capsule's edge): the targets end before it
    const feetY = 3 + (246 * 104) / 400
    for (const ear of ears) expect(parseFloat(ear.style.top) + 44).toBeLessThan(feetY)
    // the right one: a press there on the tip is the ear
    const k = 104 / 96
    down(ears[1] as HTMLElement, { x: 152 + 19 * k, y: 103 + (246 * 104) / 400 - 36 * k })
    expect(activeMascot()).not.toBeNull()
    await vi.advanceTimersByTimeAsync(100)
    up({ x: 170, y: 140 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(activeMascot()).toBeNull()
    detach()
    expect(parent.querySelectorAll('.pp-ear')).toHaveLength(0)
  })
})

describe('the shake: one listener, only one Pompon answers', () => {
  it('the newest Pompon on screen gets dizzy (no haptics); off screen → the next one; none → nothing', async () => {
    const older = place({}, { x: 100, y: 100 })
    const newer = place({}, { x: 100, y: 2000 }) // below the screen
    expect(shaken()).toBe(true)
    // the older one (on screen) plays, the newer one (off screen) does not
    expect(older.puppet.root.querySelector('.hm')?.classList.contains('lp')).toBe(true)
    expect(newer.puppet.root.querySelector('.hm.lp')).toBeNull()
    // busy: the next shake finds nobody free on screen
    expect(shaken()).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(activeMascot()).toBeNull()
    expect(haptics.haptic).not.toHaveBeenCalled()
    older.detach()
    newer.detach()
    expect(shaken()).toBe(false)
  })

  it('a target that cannot take the stage lets the next one answer', () => {
    const calls: string[] = []
    const offA = onShake({ visible: () => true, shake: () => (calls.push('a'), true) })
    const offB = onShake({ visible: () => true, shake: () => (calls.push('b'), false) })
    expect(shaken()).toBe(true)
    expect(calls).toEqual(['b', 'a'])
    offA()
    offB()
    expect(shaken()).toBe(false)
  })

  it('a hidden tab: nobody is shaken', () => {
    const calls: string[] = []
    const off = onShake({ visible: () => true, shake: () => (calls.push('x'), true) })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      expect(shaken()).toBe(false)
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
      off()
    }
    expect(calls).toEqual([])
  })
})
