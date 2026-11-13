import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markDecoded, useObjectUrl, wasDecoded } from '../../lib/objectUrl'
import { captureTab, clearTabCopies, hasTabCopy, tabLayer } from './tabCopies'
import {
  CALM_DIM,
  COMMIT_RATIO,
  EDGE_GUARD_PX,
  OWN_MARGIN_PX,
  SLOP_PX,
  SWIPE_MAX_ANGLE,
  calmDim,
  inEdgeGuard,
  inOwnZone,
  lockAxis,
  modalOpen,
  moveAngle,
  neighbours,
  ownBoxes,
  ownsHorizontal,
  pageOffset,
  pillPoses,
  progressOf,
  rawFromOffset,
  releaseStep,
  rubberBand,
  towards,
  unrubberBand,
} from './tabSwipeRules'

const W = 400

/** A move of `length` px at `degrees` from the horizontal (to the left / up when the signs say so). */
function at(degrees: number, length = 12, sx = 1, sy = 1): [number, number] {
  const rad = (degrees * Math.PI) / 180
  return [sx * length * Math.cos(rad), sy * length * Math.sin(rad)]
}

describe('tab swipe: axis lock (decided once, after the slop, by the angle)', () => {
  it('stays undecided inside the slop, whatever the direction', () => {
    expect(lockAxis(0, 0)).toBe('pending')
    expect(lockAxis(SLOP_PX - 1, 0)).toBe('pending')
    expect(lockAxis(6, 6)).toBe('pending')
    expect(lockAxis(...at(10, SLOP_PX - 0.1))).toBe('pending')
    expect(lockAxis(...at(80, SLOP_PX - 0.1))).toBe('pending')
  })

  it('measures the angle from the horizontal in every direction', () => {
    expect(moveAngle(10, 0)).toBe(0)
    expect(moveAngle(-10, 0)).toBe(0)
    expect(moveAngle(0, -10)).toBe(90)
    expect(moveAngle(10, 10)).toBeCloseTo(45, 6)
    expect(moveAngle(-10, -10)).toBeCloseTo(45, 6)
    expect(moveAngle(...at(35, 20, -1, -1))).toBeCloseTo(35, 6)
  })

  it('20° and 35° are swipes, 50° is a scroll — left and right, up and down', () => {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      expect(lockAxis(...at(0, 12, sx, sy))).toBe('swipe')
      expect(lockAxis(...at(20, 12, sx, sy))).toBe('swipe')
      expect(lockAxis(...at(35, 12, sx, sy))).toBe('swipe')
      expect(lockAxis(...at(50, 12, sx, sy))).toBe('scroll')
      expect(lockAxis(...at(90, 12, sx, sy))).toBe('scroll')
    }
  })

  it('the line is SWIPE_MAX_ANGLE (40°), inside the browser’s own 45° for pan-y', () => {
    expect(SWIPE_MAX_ANGLE).toBe(40)
    expect(lockAxis(...at(SWIPE_MAX_ANGLE - 0.5))).toBe('swipe')
    expect(lockAxis(...at(SWIPE_MAX_ANGLE + 0.5))).toBe('scroll')
    // a diagonal is never a swipe (the browser scrolls a touch steeper than 45°)
    expect(lockAxis(12, 12)).toBe('scroll')
  })

  it('a straight move gets the same answer however far past the slop it is measured', () => {
    for (const degrees of [20, 35, 50]) {
      const near = lockAxis(...at(degrees, SLOP_PX))
      expect(lockAxis(...at(degrees, 60))).toBe(near)
      expect(lockAxis(...at(degrees, 300))).toBe(near)
    }
  })
})

describe('tab swipe: the system strips along the edges', () => {
  it('leaves the left and right 20 px to the system back gestures', () => {
    expect(inEdgeGuard(0, 0, W)).toBe(true)
    expect(inEdgeGuard(EDGE_GUARD_PX - 1, 0, W)).toBe(true)
    expect(inEdgeGuard(EDGE_GUARD_PX, 0, W)).toBe(false)
    expect(inEdgeGuard(W / 2, 0, W)).toBe(false)
    expect(inEdgeGuard(W - EDGE_GUARD_PX, 0, W)).toBe(false)
    expect(inEdgeGuard(W - 5, 0, W)).toBe(true)
  })

  it('measures from the app root (the dev phone frame sits elsewhere on the page)', () => {
    expect(inEdgeGuard(510, 500, W)).toBe(true)
    expect(inEdgeGuard(560, 500, W)).toBe(false)
  })
})

describe('tab swipe: neighbours in the bar order Start · Listen · Ideen · Profil', () => {
  it('knows left and right of every tab', () => {
    expect(neighbours('start')).toEqual({ prev: null, next: 'lists' })
    expect(neighbours('lists')).toEqual({ prev: 'start', next: 'gifts' })
    expect(neighbours('gifts')).toEqual({ prev: 'lists', next: 'profile' })
    expect(neighbours('profile')).toEqual({ prev: 'gifts', next: null })
  })

  it('a page moved left leads to the next tab, moved right to the previous one', () => {
    const n = neighbours('lists')
    expect(towards(-10, n)).toBe('gifts')
    expect(towards(10, n)).toBe('start')
    expect(towards(0, n)).toBeNull()
    expect(towards(10, neighbours('start'))).toBeNull()
  })
})

describe('tab swipe: following the finger', () => {
  it('moves 1:1 toward a neighbour, never further than one width', () => {
    const n = neighbours('lists')
    expect(pageOffset(-120, W, n)).toBe(-120)
    expect(pageOffset(150, W, n)).toBe(150)
    expect(pageOffset(-900, W, n)).toBe(-W)
  })

  it('pulls with a rubber band past the first and the last tab', () => {
    const first = neighbours('start')
    const shown = pageOffset(200, W, first)
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(200 * 0.5)
    // more pull, more offset — but less and less, never a whole width
    expect(pageOffset(400, W, first)).toBeGreaterThan(shown)
    expect(pageOffset(100_000, W, first)).toBeLessThan(W)
    expect(pageOffset(-200, W, neighbours('profile'))).toBe(-shown)
    // the other direction of the first tab is free
    expect(pageOffset(-200, W, first)).toBe(-200)
  })

  it('a catch mid-spring continues from where the page is (rubber band inverted)', () => {
    expect(unrubberBand(rubberBand(180, W), W)).toBeCloseTo(180, 6)
    const first = neighbours('start')
    expect(pageOffset(rawFromOffset(pageOffset(260, W, first), W, first), W, first)).toBeCloseTo(pageOffset(260, W, first), 6)
    expect(rawFromOffset(-150, W, first)).toBe(-150)
    expect(rubberBand(-5, W)).toBe(0)
    expect(unrubberBand(0, W)).toBe(0)
  })

  it('reports the progress 0 … 1', () => {
    expect(progressOf(0, W)).toBe(0)
    expect(progressOf(-100, W)).toBe(0.25)
    expect(progressOf(W * 2, W)).toBe(1)
    expect(progressOf(10, 0)).toBe(0)
  })
})

describe('tab swipe: release', () => {
  const n = neighbours('lists')

  it('switches past 30 % of the width, else springs back', () => {
    expect(releaseStep(-W * COMMIT_RATIO, 0, W, n)).toBe(1)
    expect(releaseStep(-W * COMMIT_RATIO + 1, 0, W, n)).toBe(0)
    expect(releaseStep(W * 0.5, 0, W, n)).toBe(-1)
    expect(releaseStep(0, 900, W, n)).toBe(0)
  })

  it('a flick toward the neighbour switches from a short distance', () => {
    expect(releaseStep(-40, -700, W, n)).toBe(1)
    expect(releaseStep(40, 700, W, n)).toBe(-1)
  })

  it('a flick back stays, even past the distance', () => {
    expect(releaseStep(-W * 0.6, 400, W, n)).toBe(0)
    expect(releaseStep(W * 0.6, -400, W, n)).toBe(0)
  })

  it('past the first and the last tab there is nothing to switch to', () => {
    expect(releaseStep(150, 2000, W, neighbours('start'))).toBe(0)
    expect(releaseStep(-150, -2000, W, neighbours('profile'))).toBe(0)
  })
})

describe('tab swipe: reduced motion', () => {
  it('dims the page a little instead of moving it, at most CALM_DIM', () => {
    expect(calmDim(0, W)).toBe(0)
    expect(calmDim(-W * COMMIT_RATIO * 0.5, W)).toBeCloseTo(CALM_DIM / 2, 6)
    expect(calmDim(W, W)).toBe(CALM_DIM)
  })
})

describe('tab swipe: the pill in the tab bar follows the finger', () => {
  it('slides inside one capsule (Start ↔ Listen, Ideen ↔ Profil); the other capsule takes no part', () => {
    expect(pillPoses('start', 'lists', 0.5)).toEqual({ left: { slot: 0.5, opacity: 1, scale: 1 } })
    expect(pillPoses('profile', 'gifts', 0.25)).toEqual({ right: { slot: 0.75, opacity: 1, scale: 1 } })
    expect(pillPoses('start', 'lists', 7)).toEqual({ left: { slot: 1, opacity: 1, scale: 1 } })
  })

  it('across the "+" (Listen ↔ Ideen) one pill shrinks away while the other grows in', () => {
    const { left: leaving, right: arriving } = pillPoses('lists', 'gifts', 0.4)
    expect(leaving?.slot).toBe(1)
    expect(leaving?.opacity).toBeCloseTo(0.6, 6)
    expect(arriving?.slot).toBe(0)
    expect(arriving?.opacity).toBeCloseTo(0.4, 6)
    expect(arriving?.scale).toBeLessThan(1)
    // arrived: exactly the tap's end state (the hidden pill is invisible, the shown one full size)
    expect(pillPoses('lists', 'gifts', 1).left?.opacity).toBe(0)
    expect(pillPoses('lists', 'gifts', 1).right).toEqual({ slot: 0, opacity: 1, scale: 1 })
    expect(pillPoses('gifts', 'lists', 1).left).toEqual({ slot: 1, opacity: 1, scale: 1 })
  })
})

describe('tab swipe: who owns a sideways touch', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function page(html: string): { root: HTMLElement; find: (selector: string) => HTMLElement } {
    const root = document.createElement('div')
    root.id = 'root'
    root.innerHTML = html
    document.body.append(root)
    return { root, find: (selector) => root.querySelector<HTMLElement>(selector)! }
  }

  it('the marked deck and month grid, fields and sliders keep their own gesture', () => {
    const { root, find } = page(`<main>
      <div data-swipe-own><article class="card"><p class="inner">card</p></article></div>
      <input class="field" /><textarea class="area"></textarea>
      <div role="slider" class="slider"></div>
      <div contenteditable="true" class="editor">x</div>
      <p class="plain">text</p>
    </main>`)
    expect(ownsHorizontal(find('.inner'), root)).toBe(true)
    expect(ownsHorizontal(find('.field'), root)).toBe(true)
    expect(ownsHorizontal(find('.area'), root)).toBe(true)
    expect(ownsHorizontal(find('.slider'), root)).toBe(true)
    expect(ownsHorizontal(find('.editor'), root)).toBe(true)
    expect(ownsHorizontal(find('.plain'), root)).toBe(false)
  })

  it('a rail that really scrolls sideways keeps the touch; one that fits does not', () => {
    const { root, find } = page(`<main><ul class="rail" style="overflow-x:auto"><li class="item">a</li></ul></main>`)
    const rail = find('.rail')
    // jsdom has no layout: give the rail its sizes
    Object.defineProperty(rail, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(rail, 'scrollWidth', { value: 300, configurable: true })
    expect(ownsHorizontal(find('.item'), root)).toBe(false)
    Object.defineProperty(rail, 'scrollWidth', { value: 900, configurable: true })
    expect(ownsHorizontal(find('.item'), root)).toBe(true)
    // wider content that is clipped, not scrolled, does not count
    rail.style.overflowX = 'hidden'
    expect(ownsHorizontal(find('.item'), root)).toBe(false)
  })

  it('the deck zone: the deck, its controls row and a margin around them own the touch (geometry)', () => {
    const deck = { left: 16, top: 400, right: 374, bottom: 760 }
    expect(inOwnZone(200, 600, [deck])).toBe(true)
    // just beside / above / below the card
    expect(inOwnZone(16 - OWN_MARGIN_PX + 1, 600, [deck])).toBe(true)
    expect(inOwnZone(200, 400 - OWN_MARGIN_PX, [deck])).toBe(true)
    expect(inOwnZone(200, 760 + OWN_MARGIN_PX, [deck])).toBe(true)
    // further away: the page's again
    expect(inOwnZone(200, 400 - OWN_MARGIN_PX - 1, [deck])).toBe(false)
    expect(inOwnZone(200, 300, [deck])).toBe(false)
    expect(inOwnZone(200, 300, [])).toBe(false)
    // a box without a size (not laid out, display: none) owns nothing
    expect(inOwnZone(5, 5, [{ left: 0, top: 0, right: 0, bottom: 0 }])).toBe(false)
    expect(inOwnZone(200, 300, [deck], 0)).toBe(false)
  })

  it('finds the zones inside the given scopes only (the moving page, the neighbour sliding in)', () => {
    const { find } = page(`<main><div class="deck" data-swipe-own></div><div class="controls" data-deck-controls></div><p class="plain">x</p></main><div class="copy"><div class="grid" data-swipe-own></div></div>`)
    const box = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 50, x: left, y: top, width: 100, height: 50, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(find('.deck'), 'getBoundingClientRect').mockReturnValue(box(10, 100))
    vi.spyOn(find('.controls'), 'getBoundingClientRect').mockReturnValue(box(10, 200))
    vi.spyOn(find('.grid'), 'getBoundingClientRect').mockReturnValue(box(500, 100))
    const main = find('main')
    expect(ownBoxes([main])).toHaveLength(2)
    expect(ownBoxes([main, find('.copy'), null])).toHaveLength(3)
    expect(inOwnZone(50, 220, ownBoxes([main]))).toBe(true)
    expect(inOwnZone(550, 120, ownBoxes([main]))).toBe(false)
    expect(inOwnZone(550, 120, ownBoxes([find('.copy')]))).toBe(true)
  })

  it('the Lists buddy keeps a touch that starts on him (his body, the retargeted shadow host); no zone around him', () => {
    // the package's DOM: .bd-layer › .bd-actor[data-drag-own] › .bd-pose › .bd-host (puppet, shadow root) + .bd-hit
    const { root, find } = page(`<main><p class="plain">x</p><div class="bd-layer"><div class="bd-actor" data-drag-own><div class="bd-pose">
      <div class="bd-host"></div><div class="bd-hit"></div></div></div></div></main>`)
    const host = find('.bd-host')
    const inside = host.attachShadow({ mode: 'open' })
    inside.innerHTML = '<svg><g class="ear"></g></svg>'
    expect(ownsHorizontal(find('.bd-hit'), root)).toBe(true)
    expect(ownsHorizontal(host, root)).toBe(true)
    expect(ownsHorizontal(find('.plain'), root)).toBe(false)
    // a touch inside his shadow root reaches the document's listener retargeted to the host
    let seen: EventTarget | null = null
    const listen = (event: Event) => { seen = event.target }
    document.addEventListener('pointerdown', listen, { capture: true })
    inside.querySelector('.ear')?.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    document.removeEventListener('pointerdown', listen, { capture: true })
    expect(seen).toBe(host)
    // he walks about: he is no zone with a margin (a swipe beside him is the page's)
    vi.spyOn(find('.bd-actor'), 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 196, bottom: 196, x: 100, y: 100, width: 96, height: 96, toJSON: () => ({}) } as DOMRect)
    expect(ownBoxes([find('main')])).toHaveLength(0)
  })

  it('an open sheet, dialog or create menu stops the page from swiping', () => {
    expect(modalOpen(document)).toBe(false)
    page(`<div role="dialog" aria-modal="true"></div>`)
    expect(modalOpen(document)).toBe(true)
    document.body.innerHTML = '<nav data-tabbar data-menu-layer></nav>'
    expect(modalOpen(document)).toBe(true)
  })
})

describe('tab swipe: the copy of a tab that was left', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    clearTabCopies()
  })

  it('shows the screen at rest and at its top: no movement, no dim, no bar material; inert and hidden', () => {
    const root = document.body.appendChild(document.createElement('div'))
    root.innerHTML = '<header data-scrolled="" id="bar">bar</header><main style="transform: translate3d(-400px, 0, 0); opacity: 0.6"><p id="x">content</p></main><nav data-tabbar>tabs</nav>'
    captureTab('lists', root)
    expect(hasTabCopy('lists')).toBe(true)
    const layer = tabLayer('lists')
    expect(layer.isConnected).toBe(false)
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.hasAttribute('inert')).toBe(true)
    expect(layer.querySelector('[data-scrolled]')).toBeNull()
    expect(layer.querySelector('[id]')).toBeNull()
    const main = layer.querySelector('main')
    expect(main?.style.transform).toBe('')
    expect(main?.style.opacity).toBe('')
    // the tab bar is shared chrome: it does not slide
    expect(layer.textContent).not.toContain('tabs')
  })

  it('its pictures paint with the copy (sync, never lazy) and their object URLs stay alive while the copy exists', () => {
    let made = 0
    const revoked: string[] = []
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:http://localhost/p-${(made += 1)}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url)
    })
    vi.useFakeTimers()
    try {
      // a screen shows a picture
      const blob = new Blob(['x'])
      const shown = renderHook(() => useObjectUrl(blob))
      const url = shown.result.current ?? ''
      const root = document.body.appendChild(document.createElement('div'))
      root.innerHTML = `<main><img src="${url}" decoding="async" loading="lazy" alt=""><img src="/icons/icon.svg" alt=""></main>`
      captureTab('start', root)
      const copied = Array.from(tabLayer('start').querySelectorAll('img'))
      expect(copied.map((img) => img.getAttribute('decoding'))).toEqual(['sync', 'sync'])
      expect(copied.some((img) => img.hasAttribute('loading'))).toBe(false)
      // the screen goes away: the copy keeps the URL, the screen that comes back gets the very same one
      shown.unmount()
      vi.advanceTimersByTime(5000)
      expect(revoked).toEqual([])
      const again = renderHook(() => useObjectUrl(blob))
      expect(again.result.current).toBe(url)
      again.unmount()
      // a newer copy of the tab (no pictures any more) replaces the old one: the URL is let go
      root.innerHTML = '<main><p>no pictures</p></main>'
      captureTab('start', root)
      vi.advanceTimersByTime(5000)
      expect(revoked).toEqual([url])
    } finally {
      vi.useRealTimers()
      create.mockRestore()
      revoke.mockRestore()
    }
  })

  it('remembers decoded pictures for the session (shown again: at once, no fade)', () => {
    expect(wasDecoded('blob:http://localhost/never')).toBe(false)
    expect(wasDecoded(null)).toBe(false)
    markDecoded('blob:http://localhost/seen')
    expect(wasDecoded('blob:http://localhost/seen')).toBe(true)
  })

  it('a screen left mid-motion is copied at rest: cards in their stack pose, momentary things left out (Felix 28.10)', () => {
    const root = document.body.appendChild(document.createElement('div'))
    // left while the top card nudged (the swipe hint), the next card flew in, a card flew out and Pompon cheered
    root.innerHTML = '<main>'
      + '<p class="bubble" data-copy-hide="">Gefunden!</p>'
      + '<article class="out" data-copy-hide="" data-copy-rest="transform:translateY(0px) scale(1);opacity:1" style="transform: translateX(300px) rotate(18deg); opacity: 0.4"></article>'
      + '<article class="top" data-copy-rest="transform:translateY(0px) scale(1);opacity:1" style="transform: translateX(-26px) rotate(-1.1deg)">'
      + '<span class="stamp" data-copy-rest="opacity:0" style="opacity: 0.3"></span></article>'
      + '<article class="next" data-copy-rest="transform:translateY(10px) scale(0.955);opacity:1" style="transform: translateY(18px) scale(0.93); opacity: 0.5"></article>'
      + '</main>'
    captureTab('gifts', root)
    const layer = tabLayer('gifts')
    const top = layer.querySelector<HTMLElement>('.top')!
    expect(top.style.transform).toBe('translateY(0px) scale(1)')
    expect(top.style.opacity).toBe('1')
    expect(layer.querySelector<HTMLElement>('.stamp')!.style.opacity).toBe('0')
    const next = layer.querySelector<HTMLElement>('.next')!
    expect(next.style.transform).toBe('translateY(10px) scale(0.955)')
    expect(next.style.opacity).toBe('1')
    expect(layer.querySelector<HTMLElement>('.bubble')!.style.display).toBe('none')
    expect(layer.querySelector<HTMLElement>('.out')!.style.display).toBe('none')
    // the live screen is not touched
    expect(root.querySelector<HTMLElement>('.top')!.style.transform).toBe('translateX(-26px) rotate(-1.1deg)')
    expect(root.querySelector<HTMLElement>('.bubble')!.style.display).toBe('')
  })

  it('a tab not seen yet slides in as a skeleton', () => {
    const layer = tabLayer('gifts')
    expect(layer.classList.contains('tab-swipe-skeleton')).toBe(true)
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(hasTabCopy('gifts')).toBe(false)
  })
})
