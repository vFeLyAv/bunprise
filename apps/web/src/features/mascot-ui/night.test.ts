// «Ночью маскоты спят» in the app (31.10): the mascots' clock (23:00 – 07:00, across midnight, the dev / demo
// `?night=` check), the switch «Nachts schlafen» and the watcher every place uses; then one sleeping mascot with the
// app's rules (nightMount.ts, the real @bunprise/mascot/night): already asleep on open, awake 10 min after the LAST
// touch, the morning, the switch, the stage (one mascot animates at a time), the tap's haptics and nothing else.
import '../../ui/test-shims-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const haptics = vi.hoisted(() => ({ haptic: vi.fn() }))
vi.mock('../../lib/haptics', () => ({ haptic: haptics.haptic }))
// Pompon's look and his outfit load with the package in the app: not needed for these rules
vi.mock('./pompon', () => ({ POMPON_FUR: 'cheeks' }))
vi.mock('../sammlung/wear', () => ({ wearToday: () => () => undefined }))

import { captureNightOverride } from '../../dev/nightOverride'
import { isNightNow, nightClock, NIGHT_OVERRIDE_KEY, sleepsNow, watchSleeps } from './night'
import { loadNight, mountNight, type NightHandle, type NightModule } from './nightMount'
import { NIGHT_SLEEP_EVENT, NIGHT_SLEEP_KEY, nightSleep } from './nightSetting'
import { activeMascot, registerMascot, releaseStage, requestStage, resetStage } from './stage'

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 31, h, m, s).getTime()
/** the mascots' clock = the (fake) system clock */
const followSystem = () => {
  globalThis.__bunpriseNightClock = () => Date.now()
}

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem(NIGHT_SLEEP_KEY)
  sessionStorage.removeItem(NIGHT_OVERRIDE_KEY)
  haptics.haptic.mockClear()
  resetStage()
  document.body.replaceChildren()
})

describe('the mascots’ clock and the switch', () => {
  it('22:59 day, 23:00 night, 00:00 night, 06:59 night, 07:00 day (by the device’s clock)', () => {
    const pin = (ms: number) => {
      globalThis.__bunpriseNightClock = () => ms
      return isNightNow()
    }
    expect(pin(at(22, 59, 59))).toBe(false)
    expect(pin(at(23, 0))).toBe(true)
    expect(pin(at(0, 0))).toBe(true)
    expect(pin(at(3, 30))).toBe(true)
    expect(pin(at(6, 59, 59))).toBe(true)
    expect(pin(at(7, 0))).toBe(false)
    expect(pin(at(12, 0))).toBe(false)
  })

  it('«Nachts schlafen» is on by default; off = the mascots never sleep', () => {
    globalThis.__bunpriseNightClock = () => at(23, 30)
    expect(nightSleep.get()).toBe(true)
    expect(sleepsNow()).toBe(true)
    nightSleep.set(false)
    expect(localStorage.getItem(NIGHT_SLEEP_KEY)).toBe('0')
    expect(sleepsNow()).toBe(false)
    nightSleep.set(true)
    expect(sleepsNow()).toBe(true)
  })

  it('the switch notifies this tab (its event) and other tabs (storage); the key is a `bunprise.` device key', () => {
    expect(NIGHT_SLEEP_KEY.startsWith('bunprise.')).toBe(true)
    const fn = vi.fn()
    const off = nightSleep.subscribe(fn)
    nightSleep.set(false)
    window.dispatchEvent(new Event(NIGHT_SLEEP_EVENT))
    window.dispatchEvent(new StorageEvent('storage', { key: NIGHT_SLEEP_KEY }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'bunprise.lang' }))
    expect(fn).toHaveBeenCalledTimes(3)
    off()
    nightSleep.set(true)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('watchSleeps: at once, then exactly at 23:00 and 07:00 — and when the switch changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(22, 59, 30))
    followSystem()
    const seen: boolean[] = []
    const off = watchSleeps((s) => seen.push(s))
    expect(seen).toEqual([false])
    await vi.advanceTimersByTimeAsync(29_000)
    expect(seen).toEqual([false])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(seen).toEqual([false, true])
    nightSleep.set(false)
    expect(seen).toEqual([false, true, false])
    nightSleep.set(true)
    vi.setSystemTime(at(6, 59, 50))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(seen).toEqual([false, true, false, true])
    await vi.advanceTimersByTimeAsync(11_000)
    // (the watcher re-armed at 06:59:50 for 07:00)
    expect(seen.at(-1)).toBe(false)
    off()
  })

  it('dev / demo `?night=`: 1 = 23:30, 0 = 12:00, 22:59 = that time, running on; auto = the real clock again', () => {
    globalThis.__bunpriseNightClock = undefined
    const minute = () => {
      const d = new Date(nightClock())
      return d.getHours() * 60 + d.getMinutes()
    }
    captureNightOverride('?night=1')
    expect(minute()).toBe(23 * 60 + 30)
    expect(isNightNow()).toBe(true)
    captureNightOverride('?night=0')
    expect(minute()).toBe(12 * 60)
    captureNightOverride('?night=22:59')
    expect(minute()).toBe(22 * 60 + 59)
    // other parameters leave it alone
    captureNightOverride('?screens=night')
    expect(minute()).toBe(22 * 60 + 59)
    captureNightOverride('?night=nonsense')
    expect(minute()).toBe(22 * 60 + 59)
    captureNightOverride('?night=auto')
    expect(sessionStorage.getItem(NIGHT_OVERRIDE_KEY)).toBeNull()
    expect(Math.abs(nightClock() - Date.now())).toBeLessThan(1000)
  })
})

describe('one sleeping mascot with the app’s rules (nightMount.ts)', () => {
  let mod: NightModule
  let handle: NightHandle | null = null
  beforeEach(async () => {
    mod = await loadNight()
  })
  afterEach(() => {
    handle?.destroy()
    handle = null
  })

  function mount(o: { still?: boolean; startAwake?: boolean } = {}): NightHandle {
    const parent = document.createElement('div')
    document.body.append(parent)
    handle = mountNight(mod, parent, { kind: 'bunny', size: 96, still: o.still ?? true, ...(o.startAwake ? { startAwake: true } : {}), place: () => undefined })
    return handle
  }

  it('opened at night: already asleep; by day: awake', () => {
    globalThis.__bunpriseNightClock = () => at(23, 30)
    expect(mount().mascot.state).toBe('asleep')
    handle?.destroy()
    globalThis.__bunpriseNightClock = () => at(12, 0)
    expect(mount().mascot.state).toBe('awake')
  })

  it('a tap wakes him (haptics: one «tap»); awake 10 min after the LAST touch, then asleep again — by itself', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(0, 30))
    followSystem()
    const h = mount()
    const m = h.mascot
    expect(m.state).toBe('asleep')
    m.tap()
    expect(m.state).toBe('awake')
    expect(haptics.haptic).toHaveBeenCalledTimes(1)
    expect(haptics.haptic).toHaveBeenLastCalledWith('tap')
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(m.state).toBe('awake')
    // another touch at 9 min: the 10 minutes start again
    m.tap()
    expect(haptics.haptic).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(m.state).toBe('awake')
    await vi.advanceTimersByTimeAsync(60_000 + 500)
    expect(m.state).toBe('asleep')
    // nothing but the taps vibrated
    expect(haptics.haptic.mock.calls.every(([kind]) => kind === 'tap')).toBe(true)
  })

  it('07:00: he wakes up by himself (no tap, no vibration) and stays awake', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(6, 59, 0))
    followSystem()
    const m = mount().mascot
    expect(m.state).toBe('asleep')
    await vi.advanceTimersByTimeAsync(61_000)
    expect(m.state).toBe('awake')
    expect(haptics.haptic).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(m.state).toBe('awake')
  })

  it('the switch turned off while he sleeps: he wakes up; on again: asleep again', () => {
    globalThis.__bunpriseNightClock = () => at(1, 0)
    const m = mount().mascot
    nightSleep.set(false)
    expect(m.state).toBe('awake')
    nightSleep.set(true)
    expect(m.state).toBe('asleep')
  })

  it('one mascot animates at a time: the night began on screen — he falls asleep only once the stage is free', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(23, 0, 0))
    followSystem()
    // another mascot plays a scene
    const other = Symbol('other')
    let busy = true
    registerMascot(other, { get busy() { return busy }, isDestroyed: false, stopIdle: () => undefined, startIdle: () => undefined }, false)
    expect(requestStage(other, 'work')).toBe(true)
    const h = mount({ still: false, startAwake: true })
    expect(h.mascot.state).toBe('awake')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.mascot.state).toBe('awake')
    expect(activeMascot()).toBe(other)
    busy = false
    releaseStage(other)
    await vi.advanceTimersByTimeAsync(4_500)
    expect(h.mascot.state).toBe('falling')
    expect(activeMascot()).toBe(h.id)
  })

  it('the person scrolls nearby: one sleepy peek (on the stage), at most every 20 s; never under still poses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(2, 0))
    followSystem()
    const m = mount({ still: false }).mascot
    expect(m.state).toBe('asleep')
    document.dispatchEvent(new Event('scroll'))
    expect(m.state).toBe('peek')
    expect(activeMascot()).toBe(handle?.id)
    handle?.destroy()
    const still = mount({ still: true }).mascot
    document.dispatchEvent(new Event('scroll'))
    expect(still.state).toBe('asleep')
  })

  it('his body is the only touch target (down to his feet); decorative without a label, a button with one', () => {
    globalThis.__bunpriseNightClock = () => at(23, 30)
    const h = mount()
    expect(h.mascot.rig.box.getAttribute('aria-hidden')).toBe('true')
    expect(h.mascot.rig.box.style.pointerEvents).toBe('none')
    expect(h.mascot.rig.hit?.style.pointerEvents).toBe('auto')
    h.destroy()
    const parent = document.createElement('div')
    document.body.append(parent)
    handle = mountNight(mod, parent, { kind: 'hamster', size: 160, binoculars: true, still: true, label: 'Tapsi putzt sein Fernglas', place: () => undefined })
    const hit = handle.mascot.rig.hit as HTMLElement
    expect(hit.getAttribute('role')).toBe('button')
    expect(hit.getAttribute('aria-label')).toBe('Tapsi putzt sein Fernglas')
    hit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(handle.mascot.state).toBe('awake')
  })
})
