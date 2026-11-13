import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MOTION_PREFS,
  MOTION_STORAGE_KEY,
  getMotionState,
  parseMotionPrefs,
  resetMotionLevelForTests,
  resolveMotionLevel,
  setMotionPrefs,
  startMotionLevel,
  subscribeMotionState,
  type BatteryState,
  type MotionLevel,
  type MotionPrefs,
} from './level'

// The one motion level of the app (Felix's K9): the person's setting × the system's prefers-reduced-motion
// × the battery saver. The system and a low battery only ever make it calmer; 'off' stays 'off'.

const NO_BATTERY: BatteryState = { supported: false, low: false }
const LOW: BatteryState = { supported: true, low: true }
const FINE: BatteryState = { supported: true, low: false }
const prefs = (level: MotionLevel, batterySaver = true): MotionPrefs => ({ level, bunnies: true, batterySaver })

describe('resolveMotionLevel (setting × system × battery)', () => {
  const cases: Array<[MotionLevel, boolean, BatteryState, boolean, MotionLevel]> = [
    // setting, system reduce, battery, saver on, expected
    ['full', false, NO_BATTERY, true, 'full'],
    ['full', true, NO_BATTERY, true, 'reduced'],
    ['full', false, LOW, true, 'reduced'],
    ['full', false, LOW, false, 'full'],
    ['full', false, FINE, true, 'full'],
    ['full', true, LOW, true, 'reduced'],
    ['reduced', false, NO_BATTERY, true, 'reduced'],
    ['reduced', true, NO_BATTERY, true, 'reduced'],
    ['reduced', false, LOW, true, 'reduced'],
    ['off', false, NO_BATTERY, true, 'off'],
    ['off', true, NO_BATTERY, true, 'off'],
    ['off', false, LOW, true, 'off'],
    ['off', true, LOW, false, 'off'],
  ]
  for (const [setting, system, battery, saver, expected] of cases) {
    it(`${setting} · system ${system ? 'reduce' : 'normal'} · battery ${battery.supported ? (battery.low ? 'low' : 'fine') : 'unsupported'} · saver ${saver ? 'on' : 'off'} → ${expected}`, () => {
      expect(resolveMotionLevel(prefs(setting, saver), system, battery)).toBe(expected)
    })
  }

  it('an unsupported Battery API never lowers the level, even if it reported low', () => {
    expect(resolveMotionLevel(prefs('full'), false, { supported: false, low: true })).toBe('full')
  })
})

describe('parseMotionPrefs', () => {
  it('defaults: full motion, bunnies on, battery saver on', () => {
    expect(parseMotionPrefs(null)).toEqual({ level: 'full', bunnies: true, batterySaver: true })
    expect(DEFAULT_MOTION_PREFS).toEqual({ level: 'full', bunnies: true, batterySaver: true })
  })

  it('reads the earlier reserved values of the key', () => {
    expect(parseMotionPrefs('reduce').level).toBe('reduced')
    expect(parseMotionPrefs('auto').level).toBe('full')
    expect(parseMotionPrefs('full').level).toBe('full')
  })

  it('reads the JSON setting and ignores broken or unknown values', () => {
    expect(parseMotionPrefs('{"level":"off","bunnies":false,"batterySaver":false}')).toEqual({ level: 'off', bunnies: false, batterySaver: false })
    expect(parseMotionPrefs('{"level":"loud","bunnies":"yes"}')).toEqual(DEFAULT_MOTION_PREFS)
    expect(parseMotionPrefs('{not json')).toEqual(DEFAULT_MOTION_PREFS)
  })
})

describe('the store and the <html> attributes', () => {
  let mqListeners: Array<(e: MediaQueryListEvent) => void> = []
  let systemReduce = false

  beforeEach(() => {
    resetMotionLevelForTests()
    window.localStorage.clear()
    mqListeners = []
    systemReduce = false
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query.includes('reduced-motion') ? systemReduce : false
      },
      media: query,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => mqListeners.push(fn),
      removeEventListener: () => undefined,
    }))
  })

  afterEach(() => {
    resetMotionLevelForTests()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  const html = () => document.documentElement.dataset

  it('starts at full motion with bunnies when nothing is stored', () => {
    startMotionLevel()
    expect(getMotionState().level).toBe('full')
    expect(html()['motion']).toBe('full')
    expect(html()['bunnies']).toBe('on')
  })

  it('stores the setting per device (bunprise.reduceMotion) and applies it at once', () => {
    startMotionLevel()
    const seen: string[] = []
    const stop = subscribeMotionState(() => seen.push(getMotionState().level))
    setMotionPrefs({ level: 'reduced' })
    expect(html()['motion']).toBe('reduce')
    expect(JSON.parse(window.localStorage.getItem(MOTION_STORAGE_KEY) ?? '{}')).toEqual({ level: 'reduced', bunnies: true, batterySaver: true })
    setMotionPrefs({ level: 'off' })
    expect(html()['motion']).toBe('off')
    // no animation at all also means no mascots
    expect(html()['bunnies']).toBe('off')
    expect(getMotionState().bunnies).toBe(false)
    stop()
    expect(seen).toEqual(['reduced', 'off'])
  })

  it('"Kaninchen zeigen" off hides the mascots but keeps the animations', () => {
    startMotionLevel()
    setMotionPrefs({ bunnies: false })
    expect(html()['motion']).toBe('full')
    expect(html()['bunnies']).toBe('off')
  })

  it('reads a stored setting on start', () => {
    window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify({ level: 'reduced', bunnies: false, batterySaver: true }))
    startMotionLevel()
    expect(getMotionState().level).toBe('reduced')
    expect(html()['bunnies']).toBe('off')
  })

  it('the system setting makes it at least "reduced", live', () => {
    systemReduce = true
    startMotionLevel()
    expect(getMotionState().level).toBe('reduced')
    expect(getMotionState().systemReduced).toBe(true)
    systemReduce = false
    for (const fn of mqListeners) fn({ matches: false } as MediaQueryListEvent)
    expect(getMotionState().level).toBe('full')
  })

  it('the battery saver: not charging and ≤ 20 % → reduced; charging again → full', async () => {
    const battery = Object.assign(new EventTarget(), { charging: false, level: 0.15 })
    vi.stubGlobal('navigator', { ...navigator, getBattery: () => Promise.resolve(battery) })
    startMotionLevel()
    await vi.waitFor(() => expect(getMotionState().battery).toEqual({ supported: true, low: true }))
    expect(getMotionState().level).toBe('reduced')
    battery.charging = true
    battery.dispatchEvent(new Event('chargingchange'))
    expect(getMotionState().level).toBe('full')
    // switched off: a low battery no longer matters
    battery.charging = false
    battery.dispatchEvent(new Event('chargingchange'))
    expect(getMotionState().level).toBe('reduced')
    setMotionPrefs({ batterySaver: false })
    expect(getMotionState().level).toBe('full')
  })

  it('privacy: with "Bei wenig Akku sparen" off the battery is never read, but the settings know the API exists', async () => {
    const getBattery = vi.fn(() => Promise.resolve(Object.assign(new EventTarget(), { charging: false, level: 0.1 })))
    vi.stubGlobal('navigator', { ...navigator, getBattery })
    window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify({ level: 'full', bunnies: true, batterySaver: false }))
    startMotionLevel()
    await vi.waitFor(() => expect(getMotionState().battery.supported).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    expect(getBattery).not.toHaveBeenCalled()
    expect(getMotionState().battery).toEqual({ supported: true, low: false })
    expect(getMotionState().level).toBe('full')
    // switched on: read now (and the low battery calms the motion)
    setMotionPrefs({ batterySaver: true })
    expect(getBattery).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(getMotionState().battery).toEqual({ supported: true, low: true }))
    expect(getMotionState().level).toBe('reduced')
  })

  it('privacy: switching the setting off stops listening and forgets the reading; on again reads afresh', async () => {
    const battery = Object.assign(new EventTarget(), { charging: false, level: 0.15 })
    const removed: string[] = []
    const remove = battery.removeEventListener.bind(battery)
    battery.removeEventListener = (type: string, fn: EventListenerOrEventListenerObject | null) => {
      removed.push(type)
      remove(type, fn)
    }
    const getBattery = vi.fn(() => Promise.resolve(battery))
    vi.stubGlobal('navigator', { ...navigator, getBattery })
    startMotionLevel()
    await vi.waitFor(() => expect(getMotionState().battery).toEqual({ supported: true, low: true }))
    expect(getBattery).toHaveBeenCalledTimes(1)
    setMotionPrefs({ batterySaver: false })
    expect(removed.sort()).toEqual(['chargingchange', 'levelchange'])
    expect(getMotionState().battery).toEqual({ supported: true, low: false })
    // a change of the battery is no longer seen
    const seen: string[] = []
    const stop = subscribeMotionState(() => seen.push(JSON.stringify(getMotionState().battery)))
    battery.level = 0.9
    battery.dispatchEvent(new Event('levelchange'))
    expect(seen).toEqual([])
    stop()
    // on again (here: through another tab): one fresh read
    battery.level = 0.1
    window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify({ level: 'full', bunnies: true, batterySaver: true }))
    window.dispatchEvent(new StorageEvent('storage', { key: MOTION_STORAGE_KEY }))
    expect(getBattery).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(getMotionState().battery).toEqual({ supported: true, low: true }))
  })

  it('without a Battery API the state says so (the settings row explains it)', () => {
    vi.stubGlobal('navigator', { ...navigator, getBattery: undefined })
    startMotionLevel()
    expect(getMotionState().battery.supported).toBe(false)
    expect(getMotionState().level).toBe('full')
  })

  it('another tab changed the setting: the storage event applies it here', async () => {
    startMotionLevel()
    // the watchers arrive in their own small chunk right after boot
    await import('./levelWatch')
    await new Promise((r) => setTimeout(r, 0))
    window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify({ level: 'off', bunnies: true, batterySaver: true }))
    window.dispatchEvent(new StorageEvent('storage', { key: MOTION_STORAGE_KEY }))
    expect(getMotionState().level).toBe('off')
  })
})
