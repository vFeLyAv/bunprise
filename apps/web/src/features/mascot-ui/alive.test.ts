// «Живые анимации» in the app (./alive.ts with the real @bunprise/mascot/alive and the WAAPI fake of ./test-shims.ts):
// the mix (the first after 12 s, then 30–60 s, never the same twice in a row, the calm ones only after 40 s without a
// touch), nothing while asleep / under still poses / with «Kaninchen zeigen» or «Animationen» off / the system's reduced
// motion, one mascot at a time (the stage), not while typing, a press ends a moment at once — and nothing stays behind.
import './test-shims'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Bunny } from '@bunprise/mascot'
import { aliveRng, ALIVE_IDS, type AliveId } from '@bunprise/mascot/alive'
import { ALIVE_DEV_KEY, attachAlive, buddyAlive, createAliveLife, devAlive, motionAllowsAlive, resetAliveLives, type AliveLifeOptions } from './alive'
import { createMomentBudget, momentBudget } from './budget'
import { ALIVE_DEV_KEY as DEV_KEY, captureAliveOverride } from '../../dev/aliveOverride'
import { activeMascot, registerMascot, releaseStage, requestStage, resetStage, type StageMember } from './stage'

beforeEach(() => {
  vi.useFakeTimers()
  momentBudget.reset()
})

afterEach(() => {
  resetAliveLives()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetStage()
  momentBudget.reset()
  delete document.documentElement.dataset.motion
  delete document.documentElement.dataset.bunnies
  try {
    window.sessionStorage.removeItem(ALIVE_DEV_KEY)
  } catch {
    /* none */
  }
  document.body.replaceChildren()
})

const now = () => Date.now()

function pompon() {
  const host = document.createElement('div')
  document.body.append(host)
  const puppet = new Bunny(host, { size: 96, idle: true, interactive: false, reducedMotion: 'off' })
  return { host, puppet }
}

function life(o: Partial<AliveLifeOptions> & { host: HTMLElement }) {
  return createAliveLife({ kind: 'bunny', seen: o.host, touch: o.host, quiet: () => false, realNow: now, rng: aliveRng(9), ...o })
}

/** Lets `ms` of time pass (the moment's own animations and timers run on). */
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms)

describe('the mix in the app', () => {
  it('nothing in the first 12 s; then one plays, on the stage, as a decoration of the budget', async () => {
    const { host, puppet } = pompon()
    const l = life({ host })
    await pass(11_900)
    expect(l.due()).toBe(false)
    expect(l.play({ puppet })).toBeNull()
    await pass(200)
    expect(l.due()).toBe(true)
    const run = l.play({ puppet })
    expect(run).not.toBeNull()
    expect(activeMascot()).not.toBeNull()
    expect(puppet.root.querySelector('.hm')?.classList.contains('al')).toBe(true)
    await pass(5000)
    expect(run?.over).toBe(true)
    expect(activeMascot()).toBeNull()
    expect(puppet.root.querySelector('.hm')?.classList.contains('al')).toBe(false)
    expect(l.running).toBeNull()
    // the next one 30–60 s after its end
    expect(l.nextAt - l.clock()).toBeGreaterThanOrEqual(30_000 - 5000)
    expect(l.due()).toBe(false)
  })

  it('never the same one twice in a row; the calm ones (loaf, stretch) only after 40 s without a touch', async () => {
    const { host, puppet } = pompon()
    const l = life({ host })
    const played: AliveId[] = []
    let calmTooEarly = 0
    let lastTouchAt = now()
    for (let i = 0; i < 24; i++) {
      // a touch now and then
      if (i % 5 === 0) {
        l.touched()
        lastTouchAt = now()
      }
      await pass(Math.max(0, l.nextAt - l.clock()) + 10)
      momentBudget.reset()
      const run = l.play({ puppet })
      if (!run) continue
      if ((run.id === 'loaf' || run.id === 'stretch') && now() - lastTouchAt < 40_000) calmTooEarly += 1
      played.push(run.id as AliveId)
      await pass(run.shot.duration * 1000 + 100)
      expect(run.over).toBe(true)
    }
    expect(played.length).toBeGreaterThan(15)
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1])
    expect(calmTooEarly).toBe(0)
    expect(new Set(played).size).toBeGreaterThanOrEqual(4)
  })

  it('a quietMs from the place (the buddy’s own touch time) decides the calm ones', async () => {
    const { host, puppet } = pompon()
    const l = life({ host, moves: ['loaf', 'stretch'] })
    await pass(12_100)
    expect(l.play({ puppet }, 10_000)).toBeNull()
    await pass(4100)
    const run = l.play({ puppet }, 45_000)
    expect(['loaf', 'stretch']).toContain(run?.id)
  })

  it('a place’s own moments only; only Pompon’s for Pompon', async () => {
    const { host, puppet } = pompon()
    const l = life({ host, moves: ['dig'] })
    await pass(12_100)
    expect(l.play({ puppet })?.id).toBe('dig')
  })
})

describe('when nothing plays', () => {
  it('asleep / still poses (the place says quiet): never', async () => {
    const { host, puppet } = pompon()
    let asleep = true
    const l = life({ host, quiet: () => asleep })
    await pass(120_000)
    expect(l.due()).toBe(false)
    expect(l.play({ puppet })).toBeNull()
    asleep = false
    expect(l.play({ puppet })).not.toBeNull()
  })

  it('«Weniger» / battery saver (data-motion=reduce), «Aus», «Kaninchen zeigen» off, the system’s reduced motion: never', async () => {
    const { host, puppet } = pompon()
    const l = life({ host })
    await pass(12_100)
    document.documentElement.dataset.motion = 'reduce'
    expect(motionAllowsAlive()).toBe(false)
    expect(l.play({ puppet })).toBeNull()
    document.documentElement.dataset.motion = 'off'
    expect(l.play({ puppet })).toBeNull()
    document.documentElement.dataset.motion = 'full'
    document.documentElement.dataset.bunnies = 'off'
    expect(l.play({ puppet })).toBeNull()
    delete document.documentElement.dataset.bunnies
    delete document.documentElement.dataset.motion
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList)
    expect(motionAllowsAlive()).toBe(false)
    expect(l.play({ puppet })).toBeNull()
    mm.mockRestore()
    expect(motionAllowsAlive()).toBe(true)
    expect(l.play({ puppet })).not.toBeNull()
  })

  it('while the person types (the decoration budget): not now, asked again later', async () => {
    const { host, puppet } = pompon()
    const l = life({ host })
    await pass(12_100)
    momentBudget.typing()
    expect(l.play({ puppet })).toBeNull()
    expect(activeMascot()).toBeNull()
    expect(l.due()).toBe(false)
    // (the budget runs on the real clock: the typing is over)
    momentBudget.reset()
    await pass(4100)
    expect(l.play({ puppet })).not.toBeNull()
  })

  it('the tab hidden: the gap waits (the clock counts only the time he can be seen)', async () => {
    const { host } = pompon()
    const l = life({ host })
    await pass(6000)
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await pass(60_000)
    expect(l.seen).toBe(false)
    expect(l.due()).toBe(false)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await pass(5000)
    expect(l.due()).toBe(false)
    await pass(1100)
    expect(l.due()).toBe(true)
  })
})

describe('one mascot at a time, a touch ends it', () => {
  it('another mascot mid-scene: refused; a response of another mascot interrupts it (the rest pose at once)', async () => {
    const { host, puppet } = pompon()
    const l = life({ host })
    await pass(12_100)
    const other: StageMember = { busy: true, isDestroyed: false, stopIdle: () => undefined, startIdle: () => undefined }
    const id = Symbol('other')
    registerMascot(id, other, false)
    expect(requestStage(id, 'response')).toBe(true)
    expect(l.play({ puppet })).toBeNull()
    ;(other as { busy: boolean }).busy = false
    releaseStage(id)
    await pass(4100)
    const run = l.play({ puppet })
    expect(run).not.toBeNull()
    ;(other as { busy: boolean }).busy = true
    expect(requestStage(id, 'response')).toBe(true)
    expect(run?.over).toBe(true)
    expect(puppet.root.querySelector('.hm')?.classList.contains('al')).toBe(false)
  })

  it('a press on him during a moment: it ends at once, the press goes on to the place; nothing stays behind', async () => {
    const { host, puppet } = pompon()
    const placeDown = vi.fn()
    host.addEventListener('pointerdown', placeDown)
    const l = life({ host })
    await pass(12_100)
    const run = l.play({ puppet })
    await pass(800)
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(run?.over).toBe(true)
    expect(placeDown).toHaveBeenCalledTimes(1)
    for (const el of puppet.root.querySelectorAll('*')) {
      expect((el as HTMLElement).style?.transform ?? '').toBe('')
      expect(el.getAnimations()).toHaveLength(0)
    }
    expect(activeMascot()).toBeNull()
    // a touch: the next one 30–60 s later
    expect(l.due()).toBe(false)
  })

  it('a costume of the Sammlung on Pompon: only the paw-free sneeze', async () => {
    const { host, puppet } = pompon()
    const s = document.createElement('style')
    s.dataset['costume'] = 'knight'
    puppet.root.append(s)
    const l = life({ host })
    await pass(12_100)
    expect(l.play({ puppet })?.id).toBe('sneeze')
  })
})

describe('attachAlive (a resting place: the Start corner)', () => {
  it('plays by itself after ≈ 12 s and then 30–60 s apart; not while the place does not lend him; stop() leaves nothing', async () => {
    const { host, puppet } = pompon()
    let awake = false
    const att = attachAlive({ kind: 'bunny', seen: host, touch: host, quiet: () => !awake, realNow: now, rng: aliveRng(4), borrow: () => (awake ? { puppet } : null) })
    await pass(60_000)
    expect(att.running).toBeNull()
    // he woke up (a tap): the first ≈ 12 s later
    awake = true
    att.restart()
    await pass(11_000)
    expect(att.running).toBeNull()
    await pass(1500)
    expect(att.running).not.toBeNull()
    const first = att.running?.id
    await pass(5000)
    expect(att.running).toBeNull()
    await pass(25_000)
    expect(att.running).toBeNull()
    // (the decoration budget runs on the real clock: its 8 s of quiet after a moment are over)
    momentBudget.reset()
    let second: string | undefined
    for (let t = 0; t < 36_000 && !second; t += 250) {
      await pass(250)
      second = att.running?.id
    }
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    att.stop()
    expect(puppet.root.querySelector('.hm')?.classList.contains('al')).toBe(false)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(puppet.idleRunning ? 8 : 0)
    att.stop()
  })

  it('asleep: asked again only every 15 s (no busy loop), and never plays', async () => {
    const { host, puppet } = pompon()
    const borrow = vi.fn(() => null)
    const att = attachAlive({ kind: 'bunny', seen: host, quiet: () => true, realNow: now, borrow })
    await pass(120_000)
    expect(att.running).toBeNull()
    expect(borrow).not.toHaveBeenCalled()
    expect(puppet.root.querySelector('style[data-alive]')).toBeNull()
    att.stop()
  })
})

describe('the Lists buddy hook', () => {
  it('due → the buddy plays it on his puppet; destroy ends it', async () => {
    const { host, puppet } = pompon()
    const b = buddyAlive({ kind: 'bunny', seen: host, touch: host, quiet: () => false, realNow: now })
    await pass(12_100)
    expect(b.alive.due()).toBe(true)
    const run = b.alive.play(puppet, { quietMs: 0 })
    expect(run).not.toBeNull()
    expect(['groom', 'periscope', 'sneeze', 'dig']).toContain(run?.id)
    b.destroy()
    expect(run?.over).toBe(true)
    expect(b.alive.due()).toBe(false)
  })
})

describe('dev / demo check', () => {
  it('?alive=fast / ?alive=dig at boot → this tab; ?alive=auto → the app’s own mix', () => {
    expect(DEV_KEY).toBe(ALIVE_DEV_KEY)
    captureAliveOverride('?alive=fast')
    expect(devAlive()?.rules.firstAfterMs).toBe(3000)
    expect(devAlive()?.only).toBeNull()
    captureAliveOverride('?alive=dig')
    expect(devAlive()?.only).toBe('dig')
    captureAliveOverride('?alive=nonsense')
    expect(devAlive()).toBeNull()
    captureAliveOverride('?alive=auto')
    expect(devAlive()).toBeNull()
    captureAliveOverride('?other=1')
    expect(devAlive()).toBeNull()
  })

  it('__bunpriseAlive(id) plays that one now on the newest place he can be seen', async () => {
    const { host, puppet } = pompon()
    const att = attachAlive({ kind: 'bunny', seen: host, quiet: () => false, realNow: now, borrow: () => ({ puppet }) })
    expect(globalThis.__bunpriseAlive?.('loaf')).toBe(true)
    expect(att.running?.id).toBe('loaf')
    att.stop()
    expect(ALIVE_IDS).toContain('loaf')
  })

  it('the budget of the app is the shared one (≤ 3 decorations a minute)', () => {
    const b = createMomentBudget(() => 0)
    expect(b.claim('decoration')).toBe(true)
  })
})
