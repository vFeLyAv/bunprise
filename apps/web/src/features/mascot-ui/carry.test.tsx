import '../../ui/test-shims-dom'
import { useEffect, useRef } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const stages = vi.hoisted(() => [] as Array<{ destroy: () => void; skip: () => void }>)
vi.mock('./Mascot', () => ({ loadMascotModule: async () => ({ CarryStage: class {
  isDestroyed = false
  busy = true
  land!: () => void
  finish!: () => void
  landed = new Promise<void>((resolve) => { this.land = resolve })
  done = new Promise<void>((resolve) => { this.finish = resolve })
  constructor() { stages.push(this) }
  play() {}
  destroy() { this.isDestroyed = true; this.busy = false; this.land(); this.finish() }
  skip() { this.busy = false; this.land(); this.finish() }
} }) }))
const feedback = vi.hoisted(() => vi.fn())
vi.mock('../../lib/haptics', () => ({ feedback }))
import { playCarry, useCarry } from './carry'
import { activeMascot, registerMascot, requestStage, resetStage } from './stage'

const box = { left: 10, top: 10, width: 40, height: 40 }
beforeEach(() => { stages.length = 0; feedback.mockClear(); document.documentElement.dataset.motion = 'full' })
afterEach(() => { stages.forEach((s) => s.destroy()); resetStage(); document.documentElement.removeAttribute('data-motion') })

it('navigation cancels a running carry and resolves without a late confirmation', async () => {
  function CarryScreen() {
    const target = useRef<HTMLDivElement>(null)
    const carry = useCarry()
    useEffect(() => { if (target.current) void carry({ from: box, to: target.current, item: 'gift' }) }, [carry])
    return <div ref={target}>Own wish</div>
  }
  const root = createRootRoute({ component: () => <Outlet /> })
  const first = createRoute({ getParentRoute: () => root, path: '/carry', component: CarryScreen })
  const next = createRoute({ getParentRoute: () => root, path: '/next', component: () => <div>Next</div> })
  const router = createRouter({ routeTree: root.addChildren([first, next]), history: createMemoryHistory({ initialEntries: ['/carry'] }) })
  render(<RouterProvider router={router} />)
  await waitFor(() => expect(document.querySelector('[data-carry]')).not.toBeNull())
  await act(() => router.navigate({ href: '/next' }))
  await waitFor(() => expect(document.querySelector('[data-carry]')).toBeNull())
  expect(feedback).not.toHaveBeenCalled()
})

it('a removed target or motion-off resolves immediately, and a letter never emits a second success', async () => {
  const removedDone = vi.fn(); const letterDone = vi.fn(); const motionDone = vi.fn()
  const target = document.createElement('div'); document.body.append(target)
  const first = playCarry({ from: box, to: target, item: 'card', onDone: removedDone })
  await waitFor(() => expect(stages).toHaveLength(1))
  target.remove();await first
  await waitFor(() => expect(document.querySelector('[data-carry]')).toBeNull())
  expect(removedDone).toHaveBeenCalledOnce()
  const second = playCarry({ from: box, to: box, item: 'letter', away: 'right', onDone: letterDone })
  await waitFor(() => expect(stages).toHaveLength(2))
  stages[1]?.skip();await second
  expect(letterDone).toHaveBeenCalledOnce()
  expect(feedback).not.toHaveBeenCalled()
  const third = playCarry({ from: box, to: box, item: 'gift', onDone: motionDone })
  await waitFor(() => expect(stages).toHaveLength(3))
  document.documentElement.dataset.motion = 'off';await third
  await waitFor(() => expect(document.querySelector('[data-carry]')).toBeNull())
  expect(motionDone).toHaveBeenCalledOnce()
  expect(feedback).not.toHaveBeenCalled()
})

it('abort settles both before import and after mount, calls completion once, and releases the stage', async () => {
  for (const beforeMount of [true, false]) {
    const controller = new AbortController()
    const onDone = vi.fn()
    if (beforeMount) controller.abort()
    const carry = playCarry({ from: box, to: box, signal: controller.signal, onDone })
    if (!beforeMount) {
      await waitFor(() => expect(document.querySelector('[data-carry]')).not.toBeNull())
      controller.abort()
    }
    await carry
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(document.querySelector('[data-carry]')).toBeNull()
    expect(activeMascot()).toBeNull()
  }
  expect(feedback).not.toHaveBeenCalled()
})

it('a carry skipped behind other work completes without releasing the actual stage owner', async () => {
  const owner = Symbol('other work')
  registerMascot(owner, { busy: true, isDestroyed: false, startIdle: vi.fn(), stopIdle: vi.fn() }, false)
  requestStage(owner, 'work')
  const onDone = vi.fn()
  const carry = playCarry({ from: box, to: box, item: 'none', onDone })
  await waitFor(() => expect(stages).toHaveLength(1))
  stages[0]?.skip()
  await carry
  expect(onDone).toHaveBeenCalledOnce()
  expect(activeMascot()).toBe(owner)
  expect(document.querySelector('[data-carry]')).toBeNull()
})

it('hideBehind: the stage plays over the screen but is cut out where the panel is (the "+" jump never covers its cards)', async () => {
  const panel = document.createElement('div')
  panel.style.borderTopLeftRadius = '34px'
  panel.getBoundingClientRect = () => ({ left: 8, top: 400, width: 374, height: 300, right: 382, bottom: 700, x: 8, y: 400, toJSON: () => ({}) })
  document.body.append(panel)
  const done = playCarry({ from: box, to: { left: 8, top: 528, width: 374, height: 80 }, item: 'none', hideBehind: panel })
  await waitFor(() => expect(stages).toHaveLength(1))
  const host = document.querySelector<HTMLElement>('[data-carry="none"]')!
  // over everything (the tab bar's "+" included), with a hole the shape of the panel: its box and corner radius
  expect(host.style.zIndex).toBe('var(--z-overlay)')
  expect(host.style.clipPath).toContain('evenodd')
  expect(host.style.clipPath).toContain('M42 400H348A34 34 0 0 1 382 434V666')
  stages[0]?.skip();await done
  panel.remove()
})
