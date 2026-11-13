import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRenderedAccount } from '../../lib/accountBoundary'
import { ACTIVE_STORAGE_PREFIX, AUTH_STORAGE_KEY, KEEP_ON_SIGN_OUT, STORAGE_PREFIX } from '../../lib/app'
import { clearLocalState } from '../../lib/query'
import { forgetSammlung, SAMMLUNG_PREFIX, sammlungKey } from './key'
import { noteMascotScene, noteMoveScene } from './note'
import { SCENE_IDS } from './scenes'
import { countedScenes, currentSammlung, markSeen, noteScene, readSammlung, setWear } from './store'
import { outfitToday } from './wear'
import noteSource from './note.ts?raw'
import mascotSource from '../mascot-ui/Mascot.tsx?raw'
import moveSource from '../mascot-ui/MoveMoment.tsx?raw'
import towerSource from '../mascot-ui/TowerMoment.tsx?raw'
import homeIconSource from '../onboarding/HomeIconScene.tsx?raw'
import buddySource from '../lists/ListsBuddy.tsx?raw'

const callers = { Mascot: mascotSource, MoveMoment: moveSource, TowerMoment: towerSource, HomeIconScene: homeIconSource, ListsBuddy: buddySource }

// «Pompons Sammlung» in the app (design docs/design/2026-10-27-pompons-sammlung.md §4–§6, Felix's decisions 28.10):
// one record per account on this device, finds only when a scene really played, kept on sign-out, gone with the account.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  window.localStorage.clear()
  setRenderedAccount(A)
})
afterEach(() => {
  setRenderedAccount(undefined)
  window.localStorage.clear()
  vi.useRealTimers()
})

describe('the record (store.ts)', () => {
  it('a find is stored for the shown account only: no times, the fixed scene order, once', () => {
    noteScene('overfed-b')
    noteScene('tower')
    noteScene('tower')
    const raw = JSON.parse(window.localStorage.getItem(sammlungKey(A)) ?? 'null') as Record<string, unknown>
    expect(raw).toEqual({ v: 1, owner: A, found: ['tower', 'overfed-b'], wear: 'auto', seen: 0 })
    // exactly these fields (toEqual): no time, no date, no order of the finds
    expect(readSammlung(B).found).toEqual([])
  })

  it('without an account nothing is recorded (and nothing is read)', () => {
    setRenderedAccount(null)
    noteScene('tower')
    expect(Object.keys(window.localStorage)).toEqual([])
    expect(currentSammlung().found).toEqual([])
  })

  it('another owner inside the record, unknown scenes, a broken wear or seen: never trusted', () => {
    window.localStorage.setItem(sammlungKey(A), JSON.stringify({ v: 1, owner: B, found: ['tower'], wear: 'scarf', seen: 1 }))
    expect(readSammlung(A).found).toEqual([])
    window.localStorage.setItem(sammlungKey(A), JSON.stringify({ v: 1, owner: A, found: ['tower', 'nope', 'tower'], wear: 'witch', seen: 9 }))
    expect(readSammlung(A)).toEqual({ found: ['tower'], wear: 'auto', seen: 1 })
  })

  it('the dot: new finds until the collection was looked at; the wardrobe choice', () => {
    noteScene('speck')
    noteScene('psst')
    expect(readSammlung(A).seen).toBe(0)
    markSeen(A)
    expect(readSammlung(A).seen).toBe(2)
    setWear(A, 'none')
    expect(readSammlung(A).wear).toBe('none')
    setWear(A, 'scarf')
    expect(readSammlung(A).wear).toBe('scarf')
  })

  it('«Hier wohne ich» counts only on an iPhone (or once it was found): 8 of 8 elsewhere', () => {
    expect(countedScenes([], false)).toHaveLength(8)
    expect(countedScenes([], false)).not.toContain('homeicon')
    expect(countedScenes([], true)).toEqual(SCENE_IDS)
    expect(countedScenes(['homeicon'], false)).toEqual(SCENE_IDS)
  })
})

describe('device storage: kept on sign-out, gone with the account (key.ts)', () => {
  it('the key is outside the cleared prefix (like the app icon) — no first-screen bytes for an exception', () => {
    expect(sammlungKey(A).startsWith(STORAGE_PREFIX)).toBe(false)
    expect(sammlungKey(A).startsWith(ACTIVE_STORAGE_PREFIX)).toBe(false)
    expect(sammlungKey(A).startsWith(SAMMLUNG_PREFIX)).toBe(true)
    expect(KEEP_ON_SIGN_OUT.some((k) => k.includes('sammlung'))).toBe(false)
  })

  it('sign-out (clearLocalState, also an account switch) keeps it but removes the account keys', () => {
    noteScene('tower')
    window.localStorage.setItem(`${ACTIVE_STORAGE_PREFIX}birthdayHints`, '{}')
    window.localStorage.setItem(`${ACTIVE_STORAGE_PREFIX}gifts.saved`, '{}')
    window.localStorage.setItem(AUTH_STORAGE_KEY, '{}')
    clearLocalState()
    expect(window.localStorage.getItem(`${ACTIVE_STORAGE_PREFIX}birthdayHints`)).toBeNull()
    expect(window.localStorage.getItem(`${ACTIVE_STORAGE_PREFIX}gifts.saved`)).toBeNull()
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(readSammlung(A).found).toEqual(['tower'])
  })

  it('account deletion removes exactly this account\'s record', () => {
    noteScene('tower')
    setRenderedAccount(B)
    noteScene('chase')
    forgetSammlung(A)
    expect(window.localStorage.getItem(sammlungKey(A))).toBeNull()
    expect(readSammlung(B).found).toEqual(['chase'])
  })
})

describe('the recorder (note.ts): one hook, no imports of its own', () => {
  it('maps the playing scenes to the collection', async () => {
    noteMascotScene('hamster', 'secret')
    noteMascotScene('hamster', 'speck')
    noteMascotScene('bunny', 'secret')
    noteMascotScene('hamster', 'eat')
    noteMoveScene('chase', '')
    noteMoveScene('overfed', 'c')
    noteMoveScene('nibble', '')
    noteMoveScene('hamster', '')
    await vi.waitFor(() => expect(readSammlung(A).found).toEqual(['speck', 'psst', 'chase', 'overfed-c']))
    await settle()
    expect(readSammlung(A).found).toHaveLength(4)
  })

  it('every place that starts a collection scene loads the recorder lazily (the mascot chunks stay split as they were)', () => {
    expect(noteSource).toContain("from './store'")
    for (const [name, source] of Object.entries(callers)) {
      expect(source, name).toContain("import('../sammlung/note')")
      expect(source, name).not.toMatch(/^import[^;]*sammlung\/note/m)
    }
  })
})

describe('what Pompon wears (wear.ts, variant B)', () => {
  it('the season for everyone — also without an account; Felix\'s dates', () => {
    setRenderedAccount(null)
    expect(outfitToday(new Date(2026, 9, 31))).toBe('leaf')
    expect(outfitToday(new Date(2026, 10, 15))).toBe('scarf')
    expect(outfitToday(new Date(2026, 11, 6))).toBe('nikolaus')
    expect(outfitToday(new Date(2027, 0, 15))).toBe('winterhat')
    expect(outfitToday(new Date(2027, 3, 15))).toBe('daisy')
    expect(outfitToday(new Date(2027, 6, 15))).toBeNull()
  })

  it('a chosen outfit only once unlocked by finds; «Nichts anziehen» = nothing', () => {
    setWear(A, 'daisy')
    expect(outfitToday(new Date(2027, 0, 15))).toBeNull()
    for (const id of ['tower', 'speck', 'psst', 'footing', 'chase'] as const) noteScene(id)
    expect(outfitToday(new Date(2027, 0, 15))).toBe('daisy')
    setWear(A, 'none')
    expect(outfitToday(new Date(2026, 11, 6))).toBeNull()
  })
})
