import { createRef } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// «Парад» (the Profil easter egg): the wrapper around @bunprise/mascot/tower. The scene itself is tested in the
// package (packages/mascot/test/parade.test.ts); here: when it plays, how calm it is, the one-mascot stage.
const tower = vi.hoisted(() => ({
  made: [] as Array<{ host: HTMLElement; options: { reduced: boolean; inset?: number; card?: { left: number; width: number; radius: number } }; played: number; stopped: number; finish: () => void }>,
}))
vi.mock('@bunprise/mascot/tower', () => {
  class TowerStage {
    busy = false
    isDestroyed = false
    suspended = false
    readonly done: Promise<void>
    private resolve!: () => void
    private readonly rec: (typeof tower.made)[number]
    constructor(host: HTMLElement, options: (typeof tower.made)[number]['options']) {
      this.done = new Promise((r) => { this.resolve = r })
      this.rec = { host, options, played: 0, stopped: 0, finish: () => { this.busy = false; this.resolve() } }
      tower.made.push(this.rec)
    }
    play() { this.busy = true; this.rec.played += 1 }
    stop() { this.rec.stopped += 1; this.busy = false; this.resolve() }
    destroy() { this.isDestroyed = true; this.busy = false; this.resolve() }
  }
  return { TowerStage }
})

import TowerMoment from './TowerMoment'
import { activeMascot, registerMascot, requestStage, resetStage } from './stage'

afterEach(() => {
  // unmount first: dropping the attributes below would otherwise let a mounted one start late
  cleanup()
  tower.made.length = 0
  resetStage()
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.removeAttribute('data-bunnies')
})

function mount() {
  const card = createRef<HTMLDivElement>()
  const onEnd = vi.fn()
  const view = render(
    <div style={{ position: 'relative' }}>
      <TowerMoment cardRef={card} onEnd={onEnd} />
      <div ref={card} />
    </div>,
  )
  return { onEnd, view }
}

describe('TowerMoment', () => {
  it('builds the tower over the card (pointer-events none, aria-hidden), plays it, and ends once', async () => {
    document.documentElement.dataset['motion'] = 'full'
    const { onEnd, view } = mount()
    await waitFor(() => expect(tower.made).toHaveLength(1))
    const made = tower.made[0]!
    expect(made.options.reduced).toBe(false)
    expect(made.options.inset).toBe(16)
    expect(made.options.card?.radius).toBe(22)
    expect(made.played).toBe(1)
    const host = view.container.querySelector<HTMLElement>('[data-tower]')!
    expect(host.getAttribute('aria-hidden')).toBe('true')
    expect(host.style.pointerEvents).toBe('none')
    expect(host.style.height).toBe('390px')
    expect(host.style.top).toBe('-374px')
    // it holds the one-mascot stage while it plays
    expect(activeMascot()).not.toBeNull()
    await act(async () => { made.finish(); await Promise.resolve() })
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(activeMascot()).toBeNull()
  })

  it('"Weniger": the still heads (the stage is built reduced)', async () => {
    document.documentElement.dataset['motion'] = 'reduce'
    mount()
    await waitFor(() => expect(tower.made).toHaveLength(1))
    expect(tower.made[0]!.options.reduced).toBe(true)
  })

  it.each([
    ['"Kaninchen zeigen" off', { motion: 'full', bunnies: 'off' }],
    ['Animationen "Aus"', { motion: 'off', bunnies: 'on' }],
  ])('%s: nothing is loaded or shown, it ends at once', async (_, attrs) => {
    document.documentElement.dataset['motion'] = attrs.motion
    document.documentElement.dataset['bunnies'] = attrs.bunnies
    const { onEnd, view } = mount()
    expect(view.container.querySelector('[data-tower]')).toBeNull()
    expect(onEnd).toHaveBeenCalledTimes(1)
    await new Promise((r) => setTimeout(r, 20))
    expect(tower.made).toHaveLength(0)
  })

  it('another mascot mid-work holds the stage: no tower (scenes are never queued)', async () => {
    document.documentElement.dataset['motion'] = 'full'
    const busy = Symbol('work')
    registerMascot(busy, { busy: true, isDestroyed: false, stopIdle: () => undefined, startIdle: () => undefined }, false)
    expect(requestStage(busy, 'work')).toBe(true)
    const { onEnd } = mount()
    await waitFor(() => expect(tower.made).toHaveLength(1))
    expect(tower.made[0]!.played).toBe(0)
    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1))
    expect(activeMascot()).toBe(busy)
  })

  it('leaving the screen mid-show destroys it and frees the stage', async () => {
    document.documentElement.dataset['motion'] = 'full'
    const { view } = mount()
    await waitFor(() => expect(tower.made[0]?.played).toBe(1))
    view.unmount()
    expect(activeMascot()).toBeNull()
  })
})
