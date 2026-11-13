import { otherHintOnScreen, otherHintShown, resetHintSession, showHint, subscribeHints } from '../../lib/hints'
import { afterEach, describe, expect, it } from 'vitest'
import { comicCardAllowed, localDay, type ComicCardInput } from './rules'
import { readComicProgress, writeComicProgress } from './progress'

// The comic card's rules (docs/design/2026-10-26-manga-episode-1.md «Главный вход — решение», decided with Codex).

const day = (iso: string) => new Date(iso).getTime()
/** onboarded on 30.10 at noon, this session started on 31.10: the card's ordinary case */
const base: ComicCardInput = {
  sessionStart: day('2026-10-31T09:00:00'),
  onboardingDoneAt: new Date(day('2026-10-30T12:00:00')).toISOString(),
  firstStepsVisible: false,
  seen: false,
  otherHintThisSession: false,
  otherHintOnScreen: false,
  online: true,
  bunnies: true,
}

afterEach(() => {
  resetHintSession()
  localStorage.clear()
})

describe('the Start card «Pompon & Tapsi»: when', () => {
  it('first in a new session on a later calendar day than the onboarding', () => {
    expect(comicCardAllowed(base)).toBe(true)
    expect(localDay(day('2026-10-31T00:05:00'))).toBeGreaterThan(localDay(day('2026-10-30T23:55:00')))
  })

  it('never on the first day — not even when that session runs past midnight', () => {
    expect(comicCardAllowed({ ...base, sessionStart: day('2026-10-30T18:00:00') })).toBe(false)
    expect(comicCardAllowed({ ...base, onboardingDoneAt: new Date(day('2026-10-31T08:00:00')).toISOString() })).toBe(false)
    // a session that began on the onboarding day keeps its day, whatever the clock says now
    expect(comicCardAllowed({ ...base, sessionStart: day('2026-10-30T23:50:00') })).toBe(false)
  })

  it('not while «Erste Schritte» shows, nor in a session with another hint (it was shown or closed there)', () => {
    expect(comicCardAllowed({ ...base, firstStepsVisible: true })).toBe(false)
    expect(comicCardAllowed({ ...base, otherHintThisSession: true })).toBe(false)
    expect(comicCardAllowed({ ...base, otherHintOnScreen: true })).toBe(false)
  })

  it('closed or opened once: never again; offline, without the mascots, without an onboarding: no card', () => {
    expect(comicCardAllowed({ ...base, seen: true })).toBe(false)
    expect(comicCardAllowed({ ...base, online: false })).toBe(false)
    expect(comicCardAllowed({ ...base, bunnies: false })).toBe(false)
    expect(comicCardAllowed({ ...base, onboardingDoneAt: null })).toBe(false)
    expect(comicCardAllowed({ ...base, onboardingDoneAt: 'not a date' })).toBe(false)
  })

  it('the demo switch stands in for "a later day, a new session" — every other rule still holds', () => {
    const sameDay = { ...base, sessionStart: day('2026-10-30T18:00:00'), otherHintThisSession: true, demoLaterDay: true }
    expect(comicCardAllowed(sameDay)).toBe(true)
    expect(comicCardAllowed({ ...sameDay, firstStepsVisible: true })).toBe(false)
    expect(comicCardAllowed({ ...sameDay, seen: true })).toBe(false)
    expect(comicCardAllowed({ ...sameDay, online: false })).toBe(false)
    // a hint on screen right now (the birthday suggestion) still comes first in the demo
    expect(comicCardAllowed({ ...sameDay, otherHintOnScreen: true })).toBe(false)
  })
})

describe('one optional hint per session (lib/hints.ts)', () => {
  it('remembers what was shown and what is on screen, in memory only; the comic card ignores itself', () => {
    const seen: number[] = []
    const stop = subscribeHints(() => seen.push(1))
    expect(otherHintShown('story-1')).toBe(false)
    const comic = showHint('story-1')
    expect(otherHintShown('story-1')).toBe(false)
    const steps = showHint('first-steps')
    expect(otherHintShown('story-1')).toBe(true)
    expect(otherHintOnScreen('story-1')).toBe(true)
    steps()
    steps()
    // gone from the screen, still shown in this session
    expect(otherHintOnScreen('story-1')).toBe(false)
    expect(otherHintShown('story-1')).toBe(true)
    comic()
    expect(seen.length).toBe(4)
    expect(Object.keys(localStorage)).toHaveLength(0)
    resetHintSession()
    expect(otherHintShown('story-1')).toBe(false)
    stop()
  })
})

describe('"Weiterlesen" (one key, two numbers)', () => {
  it('stores "<episode> <panel>" under the active prefix and nothing else; null forgets it', () => {
    expect(readComicProgress()).toBeNull()
    writeComicProgress({ episode: 1, panel: 7 })
    expect(Object.entries(localStorage)).toEqual([['bunprise.comicProgress', '1 7']])
    expect(readComicProgress()).toEqual({ episode: 1, panel: 7 })
    writeComicProgress({ episode: 2, panel: 3.6 })
    expect(localStorage.getItem('bunprise.comicProgress')).toBe('2 4')
    writeComicProgress(null)
    expect(localStorage.getItem('bunprise.comicProgress')).toBeNull()
    expect(readComicProgress()).toBeNull()
  })

  it('anything else in the key is ignored', () => {
    for (const raw of ['3 1', '1', 'x 2', '1 2 3', '{"episode":1}']) {
      localStorage.setItem('bunprise.comicProgress', raw)
      expect(readComicProgress(), raw).toBeNull()
    }
  })
})
