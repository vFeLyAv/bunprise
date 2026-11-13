import '../../ui/test-shims-dom'
import { StrictMode, useRef } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch } from '../../lib/accountBoundary'
import { registerOpenSheet } from '../../ui/layers'
import { markWishAdded } from '../wishes/wishAdded'

// Pompon, the Lists buddy (Felix 25.10: the bunny, not the hamster) in the app: loaded only after the tab painted, never with mascots off,
// calm with "Weniger", paused under a sheet, hidden while another mascot of the tab is on screen, one happy
// hop for a confirmed own wish. The package (@bunprise/mascot/buddy) is mocked: its own tests live there.

const fake = vi.hoisted(() => {
  const instance = {
    setHidden: vi.fn(), setPaused: vi.fn(), setRestPuff: vi.fn(), setReducedMotion: vi.fn(), trigger: vi.fn(), destroy: vi.fn(),
  }
  return { instance, createBuddy: vi.fn((_options: Record<string, unknown>) => instance) }
})
vi.mock('@bunprise/mascot/buddy', () => ({ createBuddy: fake.createBuddy }))
// Pompon's look (the fluffy cheeks) is loaded with the package: mocked with it
vi.mock('../mascot-ui/pompon', () => ({ POMPON_FUR: 'cheeks' }))
// «Ночью маскоты спят»: the night's swap (./buddyNight.ts, its own tests) is mocked here — only that it takes over
const nightCtl = vi.hoisted(() => ({ create: vi.fn((_ctx: Record<string, unknown>) => ({ night: true, sleeper: null, sync: vi.fn(), destroy: vi.fn() })) }))
vi.mock('./buddyNight', () => ({ createBuddyNight: nightCtl.create }))

import ListsBuddy from './ListsBuddy'

function Host({ count = 4, hidden = false }: { count?: number; hidden?: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  return <div ref={stage} data-testid="stage"><ListsBuddy stage={stage} count={count} hidden={hidden} /></div>
}

async function settle(ms = 400): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

// whether it is night is loaded with import() (./nightLatch.ts): loaded once here, so the first test does not wait
// for the module while the timers are fake
beforeAll(async () => {
  await import('../mascot-ui/night')
})

beforeEach(() => {
  endAccountEpoch()
  vi.useFakeTimers()
  document.documentElement.dataset.motion = 'full'
  document.documentElement.dataset.bunnies = 'on'
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.removeAttribute('data-bunnies')
  sessionStorage.clear()
})

describe('the Lists buddy in the app', () => {
  it('is built only after the tab painted: the bunny, 96 px, the document scrolls, full motion = no reduction', async () => {
    const view = render(<Host count={4} />)
    await settle(100)
    expect(fake.createBuddy).not.toHaveBeenCalled()
    await settle()
    expect(fake.createBuddy).toHaveBeenCalledTimes(1)
    const options = fake.createBuddy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(options).toMatchObject({ kind: 'bunny', width: 96, reducedMotion: 'off', scroller: window })
    expect(options).not.toHaveProperty('restPuff') // the hamster's cheek rule is gone with the hamster
    // «Твёрдая почва» (Felix 26.10 «нравится»): near a card's end he tests the edge with a paw (package option)
    expect(options.footing).toBe(true)
    expect(options.stage).toBe(view.getByTestId('stage'))
    expect(typeof options.haptics).toBe('function')
    view.unmount()
    expect(fake.instance.destroy).toHaveBeenCalledTimes(1)
  })

  it.each([['off', 'motion'], ['off', 'bunnies']])('nothing is loaded with %s %s', async (value, key) => {
    document.documentElement.dataset[key] = value
    render(<Host />)
    await settle(2000)
    expect(fake.createBuddy).not.toHaveBeenCalled()
  })

  it('"Weniger" makes him calm, live; the wish count never puffs the bunny\'s cheeks', async () => {
    document.documentElement.dataset.motion = 'reduce'
    const view = render(<Host count={1} />)
    await settle()
    expect(fake.createBuddy.mock.calls[0]?.[0]).toMatchObject({ reducedMotion: 'force' })
    await act(async () => { document.documentElement.dataset.motion = 'full' })
    expect(fake.instance.setReducedMotion).toHaveBeenLastCalledWith('off')
    view.rerender(<Host count={12} />)
    expect(fake.instance.setRestPuff).not.toHaveBeenCalled()
  })

  it('steps aside while another mascot of the tab shows, and pauses under a sheet', async () => {
    const view = render(<Host hidden />)
    await settle()
    expect(fake.instance.setHidden).toHaveBeenLastCalledWith(true)
    expect(fake.instance.setPaused).toHaveBeenLastCalledWith(true)
    view.rerender(<Host hidden={false} />)
    expect(fake.instance.setHidden).toHaveBeenLastCalledWith(false)
    expect(fake.instance.setPaused).toHaveBeenLastCalledWith(false)
    let release = () => {}
    await act(async () => { release = registerOpenSheet() })
    expect(fake.instance.setPaused).toHaveBeenLastCalledWith(true)
    await act(async () => { release() })
    expect(fake.instance.setPaused).toHaveBeenLastCalledWith(false)
  })

  it('a confirmed own wish gets one happy hop, at most every 10 s, never on a mere revisit or when calm', async () => {
    const view = render(<Host count={2} />)
    await settle()
    expect(fake.instance.trigger).not.toHaveBeenCalled()
    markWishAdded('own-list', 'wish-3'); view.rerender(<Host count={3} />)
    expect(fake.instance.trigger).toHaveBeenCalledTimes(1)
    expect(fake.instance.trigger).toHaveBeenLastCalledWith('wish')
    markWishAdded('own-list', 'wish-4'); view.rerender(<Host count={4} />)
    expect(fake.instance.trigger).toHaveBeenCalledTimes(1)
    view.unmount(); render(<Host count={4} />)
    await settle()
    expect(fake.instance.trigger).toHaveBeenCalledTimes(1)
    document.documentElement.dataset.motion = 'reduce'
    await settle(10001)
    markWishAdded('own-list', 'wish-5'); render(<Host count={5} />)
    await settle()
    expect(fake.instance.trigger).toHaveBeenCalledTimes(1)
  })

  it('at night (23:00 – 07:00, «Nachts schlafen» on) he is not built: the night (./buddyNight.ts) takes over, once', async () => {
    globalThis.__bunpriseNightClock = () => new Date().setHours(23, 30, 0, 0)
    const view = render(<StrictMode><Host /></StrictMode>)
    await settle(100)
    expect(nightCtl.create).not.toHaveBeenCalled()
    await settle()
    expect(nightCtl.create).toHaveBeenCalledTimes(1)
    expect(fake.createBuddy).not.toHaveBeenCalled()
    const ctx = nightCtl.create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(ctx.stage).toBe(view.getByTestId('stage'))
    expect(typeof ctx.buildBuddy).toBe('function')
    // a sheet / another mascot: the night follows
    const made = nightCtl.create.mock.results[0]?.value as { sync: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    view.rerender(<StrictMode><Host hidden /></StrictMode>)
    expect(made.sync).toHaveBeenCalled()
    view.unmount()
    expect(made.destroy).toHaveBeenCalledTimes(1)
  })

  it('the switch «Nachts schlafen» off: at night he lives as by day', async () => {
    globalThis.__bunpriseNightClock = () => new Date().setHours(23, 30, 0, 0)
    localStorage.setItem('bunprise.nightSleep', '0')
    try {
      render(<Host />)
      await settle()
      expect(nightCtl.create).not.toHaveBeenCalled()
      expect(fake.createBuddy).toHaveBeenCalledTimes(1)
    } finally {
      localStorage.removeItem('bunprise.nightSleep')
    }
  })

  it('StrictMode builds exactly one living buddy', async () => {
    render(<StrictMode><Host /></StrictMode>)
    await settle()
    expect(fake.createBuddy).toHaveBeenCalledTimes(1)
    expect(fake.instance.destroy).not.toHaveBeenCalled()
  })
})
