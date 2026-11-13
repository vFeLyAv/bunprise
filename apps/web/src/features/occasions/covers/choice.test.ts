import { describe, expect, it } from 'vitest'
import { AUTO_PICK, coverLayoutKey, coverToSave, coverView, initialCoverPick, pickFor, pickerOrder, type DetectCover } from './choice'
import { themeOf } from './detect'
import { coversEnabled } from './flag'
import { COVER_NONE, THEME_IDS, shownCover, storedCover } from './themes'

// The motif choice of the occasion form and the normalisers of the stored value (docs/design/2026-10-26-occasion-covers.md).

const detect: DetectCover = (title, date) => themeOf(title, date ? { date } : {})
const DAY = '2030-06-15'

describe('the stored value (normalisers)', () => {
  it('shownCover: a known key shows; null, "none", an unknown key and a missing key (older server) show nothing', () => {
    expect(shownCover('birthday')).toBe('birthday')
    for (const value of [null, undefined, 'none', 'hiking', 'Birthday', '', 3, {}]) expect(shownCover(value), String(value)).toBeNull()
  })

  it('storedCover: undefined only for a missing key; "none" stays; an unknown key reads as null', () => {
    expect(storedCover(undefined)).toBeUndefined()
    expect(storedCover(null)).toBeNull()
    expect(storedCover('none')).toBe(COVER_NONE)
    expect(storedCover('gamenight')).toBe('gamenight')
    expect(storedCover('hiking')).toBeNull()
  })

  it('the release flag: on in the demo and with VITE_COVERS=1 only', () => {
    expect(coversEnabled({})).toBe(false)
    expect(coversEnabled({ VITE_COVERS: '0' })).toBe(false)
    expect(coversEnabled({ VITE_COVERS: '1' })).toBe(true)
    expect(coversEnabled({ VITE_DEMO: '1' })).toBe(true)
  })
})

describe('a new occasion', () => {
  it('automatic: the motif follows the title; nothing found = no motif (stored null)', () => {
    expect(coverView(AUTO_PICK, detect, 'Geburtstag von Anna', DAY)).toEqual({ theme: 'birthday', mode: 'auto', suggestion: 'birthday' })
    expect(coverView(AUTO_PICK, detect, 'Training im Gym', DAY)?.theme).toBe('sport')
    const nothing = coverView(AUTO_PICK, detect, 'Treffen mit Jo', DAY)
    expect(nothing).toEqual({ theme: null, mode: 'auto', suggestion: null })
    expect(coverToSave(nothing)).toBeNull()
    expect(coverToSave(coverView(AUTO_PICK, detect, 'Spieleabend', DAY))).toBe('gamenight')
  })

  it('the date upgrades a generic title only', () => {
    expect(coverView(AUTO_PICK, detect, 'Party', '2026-12-31')?.theme).toBe('newyear')
    expect(coverView(AUTO_PICK, detect, 'Party', DAY)?.theme).toBe('party')
  })

  it('picked by hand: stays whatever the title says; "Kein Motiv" stores "none"', () => {
    const picked = pickFor('gamenight', coverView(AUTO_PICK, detect, 'Freitag bei mir', DAY)!)
    expect(picked).toEqual({ kind: 'theme', theme: 'gamenight' })
    expect(coverView(picked, detect, 'Geburtstag', DAY)).toEqual({ theme: 'gamenight', mode: 'manual', suggestion: 'birthday' })
    const off = pickFor(null, coverView(AUTO_PICK, detect, 'Geburtstag', DAY)!)
    expect(off).toEqual({ kind: 'off' })
    expect(coverView(off, detect, 'Geburtstag', DAY)).toEqual({ theme: null, mode: 'off', suggestion: 'birthday' })
    expect(coverToSave(coverView(off, detect, 'Geburtstag', DAY))).toBe('none')
  })

  it("tapping the title's own motif means automatic again", () => {
    const view = coverView({ kind: 'off' }, detect, 'Geburtstag', DAY)!
    expect(pickFor('birthday', view)).toBe(AUTO_PICK)
  })

  it('no detection yet: nothing to show and nothing to store (the stored value stays)', () => {
    expect(coverView(AUTO_PICK, null, 'Geburtstag', DAY)).toBeNull()
    expect(coverToSave(null)).toBeUndefined()
  })
})

describe('editing an occasion', () => {
  it('"none" opens switched off, null opens automatic (also an occasion from before the feature)', () => {
    expect(initialCoverPick('none', 'Geburtstag', DAY)).toEqual({ kind: 'off' })
    expect(initialCoverPick(null, 'Geburtstag', DAY)).toBe(AUTO_PICK)
  })

  it("a stored motif that is still its title's motif is automatic: it follows a new title", () => {
    const pick = initialCoverPick('birthday', 'Geburtstag Anna', DAY)
    expect(coverView(pick, detect, 'Geburtstag Anna', DAY)).toEqual({ theme: 'birthday', mode: 'auto', suggestion: 'birthday' })
    expect(coverView(pick, detect, 'Spieleabend bei Anna', DAY)).toEqual({ theme: 'gamenight', mode: 'auto', suggestion: 'gamenight' })
    expect(coverToSave(coverView(pick, detect, 'Treffen', DAY))).toBeNull()
  })

  it("a stored motif the host picked (not the title's) stays when the title changes", () => {
    const pick = initialCoverPick('party', 'Geburtstag Anna', DAY)
    expect(coverView(pick, detect, 'Geburtstag Anna', DAY)).toEqual({ theme: 'party', mode: 'manual', suggestion: 'birthday' })
    expect(coverView(pick, detect, 'Spieleabend', DAY)?.theme).toBe('party')
  })
})

describe('the picker', () => {
  it("lists every motif once, the title's motif first", () => {
    expect(pickerOrder(THEME_IDS, 'sport')[0]).toBe('sport')
    expect(new Set(pickerOrder(THEME_IDS, 'sport')).size).toBe(16)
    expect(pickerOrder(THEME_IDS, null)).toEqual([...THEME_IDS])
  })

  it('its layout key changes exactly when its height does', () => {
    const motif = coverView(AUTO_PICK, detect, 'Geburtstag', DAY)
    const none = coverView(AUTO_PICK, detect, 'Treffen', DAY)
    expect(coverLayoutKey(null, false)).toBe('cover-loading')
    expect(coverLayoutKey(motif, false)).not.toBe(coverLayoutKey(none, false))
    expect(coverLayoutKey(none, true)).not.toBe(coverLayoutKey(none, false))
    // typing another word of the same title does not move anything
    expect(coverLayoutKey(coverView(AUTO_PICK, detect, 'Geburtstag Anna', DAY), false)).toBe(coverLayoutKey(motif, false))
  })
})
