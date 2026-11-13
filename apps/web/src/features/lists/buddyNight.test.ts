// The Lists buddy at night (buddyNight.ts, «Ночью маскоты спят» 31.10): opened at night he sleeps on the stats row (the
// buddy's own home spot) and is not built; a tap wakes him and the buddy takes over on that very spot; 10 min after the
// last touch he falls asleep where he stands — once he stands still, facing you; unseen at once. The night puppet is
// the real @bunprise/mascot/night (still poses: jsdom has no Web Animations); the buddy is a fake.
import '../../ui/test-shims-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListsBuddy as Buddy } from '@bunprise/mascot/buddy'

vi.mock('../../lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('../mascot-ui/pompon', () => ({ POMPON_FUR: 'cheeks' }))
vi.mock('../sammlung/wear', () => ({ wearToday: () => () => undefined }))

import { loadNight } from '../mascot-ui/nightMount'
import { resetStage } from '../mascot-ui/stage'
import { createBuddyNight, type BuddyNight, type BuddyNightContext } from './buddyNight'

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 31, h, m, s).getTime()

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

interface FakeBuddy {
  position: { x: number; y: number; floor: string; mode: string }
  info: { action: string; mode: string; floor: string; grumpy: number }
  destroy: () => void
}

function world() {
  const stage = document.createElement('div')
  stage.getBoundingClientRect = () => rect(0, 100, 390, 900)
  const stats = document.createElement('div')
  stats.dataset.buddyFloor = 'stats'
  stats.getBoundingClientRect = () => rect(16, 300, 358, 80)
  const card = document.createElement('div')
  card.dataset.buddyFloor = 'list-1'
  card.getBoundingClientRect = () => rect(16, 500, 170, 200)
  stage.append(stats, card)
  document.body.append(stage)
  let buddy: FakeBuddy | null = null
  const settings = { reducedMotion: 'force' as const, hidden: false, sheetOpen: false }
  const built: Array<{ floor: string; x: number } | undefined> = []
  let dropped = 0
  const ctx: BuddyNightContext = {
    stage,
    scroller: window,
    buddy: () => buddy as unknown as Buddy | null,
    buildBuddy: (start) => {
      built.push(start)
      buddy = { position: { x: start ? start.x : 238, y: 200, floor: start?.floor ?? 'stats', mode: 'stand' }, info: { action: 'idle', mode: 'stand', floor: 'stats', grumpy: 0 }, destroy: () => undefined }
      return Promise.resolve(buddy as unknown as Buddy)
    },
    dropBuddy: () => {
      dropped += 1
      buddy = null
    },
    settings: () => settings,
  }
  return { stage, ctx, settings, built, dropped: () => dropped, buddy: () => buddy, setBuddy: (b: FakeBuddy | null) => { buddy = b } }
}

let night: BuddyNight | null = null
beforeEach(async () => {
  await loadNight()
  vi.useFakeTimers()
})
afterEach(() => {
  night?.destroy()
  night = null
  vi.useRealTimers()
  resetStage()
  document.body.replaceChildren()
})

describe('the Lists buddy at night', () => {
  it('opened at night: asleep on the stats row at the buddy’s home spot — no buddy built', async () => {
    vi.setSystemTime(at(23, 30))
    globalThis.__bunpriseNightClock = () => Date.now()
    const w = world()
    night = createBuddyNight(w.ctx)
    await vi.advanceTimersByTimeAsync(0)
    const sleeper = night.sleeper
    expect(sleeper?.state).toBe('asleep')
    expect(w.built).toHaveLength(0)
    // feet on the stats row (stage px: y 200), 62 % along it (x 16 + 0.62 × 358)
    const box = sleeper?.rig.box as HTMLElement
    expect(parseFloat(box.style.left) + 48).toBeCloseTo(16 + 0.62 * 358, 1)
    expect(parseFloat(box.style.top) + (sleeper?.rig.feet ?? 0)).toBeCloseTo(200, 1)
    expect(night.night).toBe(true)
  })

  it('a tap wakes him: the buddy takes over on that very spot; the sleeper goes', async () => {
    vi.setSystemTime(at(1, 0))
    globalThis.__bunpriseNightClock = () => Date.now()
    const w = world()
    night = createBuddyNight(w.ctx)
    await vi.advanceTimersByTimeAsync(0)
    night.sleeper?.tap()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.built).toEqual([{ floor: 'stats', x: 16 + 0.62 * 358 }])
    expect(night.sleeper).toBeNull()
    expect(w.buddy()).not.toBeNull()
  })

  it('awake 10 min after the last touch, then asleep where he stands — once he stands still facing you', async () => {
    vi.setSystemTime(at(1, 0))
    globalThis.__bunpriseNightClock = () => Date.now()
    const w = world()
    night = createBuddyNight(w.ctx)
    await vi.advanceTimersByTimeAsync(0)
    night.sleeper?.tap()
    await vi.advanceTimersByTimeAsync(0)
    const buddy = w.buddy() as FakeBuddy
    const dropped = w.dropped()
    // a touch of the buddy at 8 min: awake until 18 min
    await vi.advanceTimersByTimeAsync(8 * 60_000)
    const hit = document.createElement('div')
    hit.className = 'bd-hit'
    w.stage.append(hit)
    hit.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    // he walks on a card at 18 min: not now
    buddy.position = { x: 100, y: 400, floor: 'list-1', mode: 'walk' }
    buddy.info = { ...buddy.info, action: 'wander', mode: 'walk' }
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000)
    expect(night.sleeper).toBeNull()
    expect(w.dropped()).toBe(dropped)
    // he stops on the card and faces you: he dozes off right there
    buddy.position = { x: 100, y: 400, floor: 'list-1', mode: 'stand' }
    buddy.info = { ...buddy.info, action: 'idle', mode: 'stand' }
    await vi.advanceTimersByTimeAsync(1_600)
    const sleeper = night.sleeper
    expect(sleeper).not.toBeNull()
    expect(w.dropped()).toBe(dropped + 1)
    const box = sleeper?.rig.box as HTMLElement
    expect(parseFloat(box.style.left) + 48).toBeCloseTo(100, 1)
    expect(parseFloat(box.style.top) + (sleeper?.rig.feet ?? 0)).toBeCloseTo(400, 1)
    // (he came on screen awake and fell asleep there)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sleeper?.state).toBe('asleep')
  })

  it('the night begins while the buddy lives and another mascot hides him: asleep at once, hidden and paused', async () => {
    vi.setSystemTime(at(22, 59, 59))
    globalThis.__bunpriseNightClock = () => Date.now()
    const w = world()
    w.setBuddy({ position: { x: 238, y: 200, floor: 'stats', mode: 'walk' }, info: { action: 'wander', mode: 'walk', floor: 'stats', grumpy: 0 }, destroy: () => undefined })
    w.settings.hidden = true
    night = createBuddyNight(w.ctx)
    expect(night.sleeper).toBeNull()
    await vi.advanceTimersByTimeAsync(1_500)
    const sleeper = night.sleeper
    expect(sleeper?.state).toBe('asleep')
    expect(sleeper?.rig.box.style.visibility).toBe('hidden')
    expect(w.dropped()).toBe(1)
  })

  it('07:00: he wakes up by himself and the buddy lives on by day', async () => {
    vi.setSystemTime(at(6, 59, 30))
    globalThis.__bunpriseNightClock = () => Date.now()
    const w = world()
    night = createBuddyNight(w.ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(night.sleeper?.state).toBe('asleep')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(w.built).toHaveLength(1)
    expect(night.sleeper).toBeNull()
    expect(night.night).toBe(false)
  })
})
