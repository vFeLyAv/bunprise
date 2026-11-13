import '../mascot-ui/test-shims'
import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The puppet itself is the package's (tested in packages/mascot); here a fake one with the parts Pompon's extras
// use: the breathing group, his own paws (.tp), the face (.tf) with the blush.
const fake = vi.hoisted(() => ({
  puppet: null as null | { root: ShadowRoot; isDestroyed: boolean; setEyes: (mode: string) => void; setPuff: (p: number) => void },
  hop: (): Promise<void> => Promise.resolve(),
  play: (_scene: string): Promise<void> => Promise.resolve(),
}))
const haptics = vi.hoisted(() => ({ log: [] as string[] }))

vi.mock('../../lib/haptics', () => ({ haptic: (kind: string) => haptics.log.push(kind) }))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useEffect, useImperativeHandle, useRef } = await import('react')
  function Mascot({ onReady, ref }: { onReady?: () => void; ref?: import('react').Ref<unknown> }) {
    const host = useRef<HTMLDivElement>(null)
    useImperativeHandle(ref, () => ({ get instance() { return fake.puppet }, hop: () => fake.hop(), play: (scene: string) => fake.play(scene), tap: () => undefined }))
    useEffect(() => {
      const el = host.current
      if (!el || el.shadowRoot) return
      const root = el.attachShadow({ mode: 'open' })
      root.innerHTML = '<svg><g class="breathe"><g class="tf"><ellipse></ellipse><ellipse></ellipse></g><g class="tp"><ellipse></ellipse></g></g></svg>'
      fake.puppet = { root, isDestroyed: false, setEyes: vi.fn(), setPuff: vi.fn() }
      // once, like the real wrapper (its ready flag flips once per mount; later renders return above)
      onReady?.()
    }, [onReady])
    return <div ref={host} data-testid="puppet" />
  }
  return { Mascot }
})

import WelcomePompon, { type PomponHandle } from './WelcomePompon'
import type { Outfit } from './pompon'

function mount(outfit: Outfit) {
  const ref = createRef<PomponHandle>()
  const onPet = vi.fn()
  const view = render(<WelcomePompon ref={ref} outfit={outfit} size={200} label="Pompon streicheln" onPet={onPet} />)
  return { ref, onPet, rerender: (next: Outfit) => view.rerender(<WelcomePompon ref={ref} outfit={next} size={200} label="Pompon streicheln" onPet={onPet} />) }
}

const root = () => fake.puppet?.root ?? null
const worn = () => Array.from(root()?.querySelectorAll('.pp-extra') ?? []).map((g) => g.getAttribute('data-outfit'))
const ownPawsShown = () => (root()?.querySelector<SVGGElement>('.tp')?.style.visibility ?? '') !== 'hidden'
/** the click-through effects layer on <body> (hearts, confetti, a flying bubble) */
const fxLayer = () => document.body.querySelector<HTMLElement>('.wl-fx')

beforeEach(() => {
  vi.useFakeTimers()
  fake.puppet = null
  fake.hop = vi.fn(() => Promise.resolve())
  fake.play = vi.fn(() => Promise.resolve())
  haptics.log.length = 0
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  delete document.documentElement.dataset.motion
  delete document.documentElement.dataset.bunnies
})

describe('Pompon on the welcome screens (Felix 25.10)', () => {
  it('is a button "Pompon streicheln" and waves once per visit on the greeting', () => {
    mount('none')
    expect(screen.getByRole('button', { name: 'Pompon streicheln' })).toBeTruthy()
    expect(fake.play).toHaveBeenCalledWith('greet')
    mount('none')
    expect(fake.play).toHaveBeenCalledTimes(1) // the same visit: no second wave
  })

  it('holds the box with its own holding paws — his own paws hide, never four paws', async () => {
    const pompon = mount('none')
    expect(ownPawsShown()).toBe(true)
    pompon.rerender('box')
    expect(worn()).toEqual(['box'])
    expect(root()?.querySelector('.pp-lid')).toBeTruthy()
    expect(ownPawsShown()).toBe(false)
    // a hat: the box leaves (snappy), then his own paws come back
    pompon.rerender('birthday')
    expect(ownPawsShown()).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(worn()).toEqual(['birthday'])
    expect(ownPawsShown()).toBe(true)
    // the envelope is held again: his own paws hide at once
    pompon.rerender('invite')
    expect(ownPawsShown()).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(worn()).toEqual(['invite'])
    expect(ownPawsShown()).toBe(false)
  })

  it('a wish bubble flies into the box: a copy flies, the bubble stays; on landing the lid bounces and he hops', async () => {
    const { ref } = mount('box')
    const bubble = document.createElement('button')
    bubble.textContent = 'Bücher'
    document.body.append(bubble)
    let landed = false
    void ref.current?.catchWish(bubble).then(() => {
      landed = true
    })
    expect(fxLayer()?.textContent).toContain('Bücher') // the flying copy
    expect(bubble.isConnected).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(landed).toBe(true)
    expect(fxLayer()?.textContent).not.toContain('Bücher')
    expect(fake.hop).toHaveBeenCalled()
    expect(haptics.log).toContain('select')
    bubble.remove()
  })

  it('petting: one reaction per 0.65 s, at most three hearts', async () => {
    const { ref, onPet } = mount('none')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Pompon streicheln' })))
    act(() => ref.current?.pet())
    expect(onPet).toHaveBeenCalledTimes(1)
    expect(fxLayer()?.querySelectorAll('svg').length).toBe(3)
    expect(fake.puppet?.setEyes).toHaveBeenCalledWith('happy')
    await act(async () => vi.advanceTimersByTimeAsync(700))
    act(() => fireEvent.keyDown(screen.getByRole('button', { name: 'Pompon streicheln' }), { key: 'Enter' }))
    expect(onPet).toHaveBeenCalledTimes(2)
    expect(fxLayer()?.querySelectorAll('svg').length).toBeLessThanOrEqual(3)
  })

  it('reduced motion: nothing flies, no confetti, no wave — one heart fades in place', async () => {
    document.documentElement.dataset.motion = 'reduce'
    const { ref } = mount('box')
    expect(fake.play).not.toHaveBeenCalled()
    const bubble = document.createElement('button')
    bubble.textContent = 'Pflanzen'
    document.body.append(bubble)
    await act(async () => ref.current?.catchWish(bubble))
    expect(fxLayer()?.childElementCount).toBe(0) // no copy, no confetti
    expect(fake.hop).not.toHaveBeenCalled()
    act(() => ref.current?.celebrate())
    expect(fxLayer()?.childElementCount).toBe(0)
    act(() => ref.current?.pet())
    expect(fxLayer()?.querySelectorAll('svg').length).toBe(1)
    bubble.remove()
  })

  it('"Kaninchen zeigen" off: no Pompon at all, and the steps still work', async () => {
    document.documentElement.dataset.bunnies = 'off'
    const { ref } = mount('box')
    expect(screen.queryByRole('button', { name: 'Pompon streicheln' })).toBeNull()
    expect(fxLayer()).toBeNull()
    // the wish step still gets its answer at once (nothing to fly to)
    await act(async () => ref.current?.catchWish(document.createElement('button')))
    expect(haptics.log).toEqual(['select'])
  })
})
