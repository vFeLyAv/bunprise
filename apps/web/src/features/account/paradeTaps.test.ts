import { describe, expect, it } from 'vitest'
import { PARADE_COOLDOWN_MS, PARADE_WINDOW_MS, createParadeTaps } from './paradeTaps'

// «Парад» (Felix 26.10): 5 taps on the version line within 2.5 s, not more often than once per 30 s.
describe('the Profil easter egg: tap counter', () => {
  function clock() {
    let t = 1_000_000
    return { now: () => t, wait: (ms: number) => { t += ms } }
  }

  it('the 5th quick tap starts it; 4 taps do not', () => {
    const c = clock()
    const taps = createParadeTaps(c.now)
    for (let i = 0; i < 4; i++) {
      expect(taps.tap()).toBe(false)
      c.wait(300)
    }
    expect(taps.tap()).toBe(true)
  })

  it('slow taps (5 spread over more than 2.5 s) do not', () => {
    const c = clock()
    const taps = createParadeTaps(c.now)
    for (let i = 0; i < 8; i++) {
      expect(taps.tap()).toBe(false)
      c.wait(PARADE_WINDOW_MS / 4 + 10)
    }
  })

  it('at most once per 30 s, then again', () => {
    const c = clock()
    const taps = createParadeTaps(c.now)
    const five = () => { let started = false; for (let i = 0; i < 5; i++) { started = taps.tap() || started; c.wait(100) } return started }
    expect(five()).toBe(true)
    c.wait(5000)
    expect(five()).toBe(false)
    c.wait(PARADE_COOLDOWN_MS)
    expect(five()).toBe(true)
  })
})
