import { describe, expect, it } from 'vitest'
import {
  ME,
  PERSON_TONE_COUNT,
  UNKNOWN,
  assignTones,
  chipLabel,
  firstName,
  initialsOf,
  normalizeSelection,
  occasionKind,
  peopleOf,
  personKey,
  preferredTone,
  toggleSelection,
  type HostedOccasion,
} from './people'

// Invented names only.
const mine: HostedOccasion = { role: 'host', host_name: 'Mila Sommer' }
const by = (name: string | null): HostedOccasion => ({ role: 'member', host_name: name })

/** keys whose preferred tone is the same (a clash), found by search so the test does not hard-code hashes */
function clashingKeys(count: number): string[] {
  const byTone = new Map<number, string[]>()
  for (let i = 0; i < 500; i += 1) {
    const key = `name:freund ${i}`
    const list = byTone.get(preferredTone(key)) ?? []
    list.push(key)
    byTone.set(preferredTone(key), list)
    if (list.length === count) return list
  }
  throw new Error('no clash found')
}

describe('who an occasion belongs to', () => {
  it('your own occasions are "you"; a friend is keyed by the display name the feed sends (normalised)', () => {
    expect(personKey(mine)).toBe(ME)
    expect(personKey(by('Anna Beispiel'))).toBe('name:anna beispiel')
    // the same person however the name is spaced or cased
    expect(personKey(by('  anna   BEISPIEL '))).toBe(personKey(by('Anna Beispiel')))
    expect(personKey(by(null))).toBe(UNKNOWN)
    expect(personKey(by('   '))).toBe(UNKNOWN)
    // a host id in the feed (future get_feed) wins over the name
    expect(personKey({ role: 'member', host_name: 'Anna Beispiel', host_id: 'd1e0a000-0000-4000-8000-000000000001' })).toBe('id:d1e0a000-0000-4000-8000-000000000001')
  })

  it('initials and first names for the filter pills', () => {
    expect(initialsOf('Anna Beispiel')).toBe('AB')
    expect(initialsOf('Ömer')).toBe('Ö')
    expect(initialsOf('  ben   mustermann  extra ')).toBe('BM')
    expect(firstName('Clara Test')).toBe('Clara')
  })
})

describe('person colours: stable, and told apart', () => {
  it('a preferred tone is a stable hash in 1…8', () => {
    for (const key of ['name:anna beispiel', 'name:ben mustermann', 'id:x', 'unknown']) {
      const tone = preferredTone(key)
      expect(tone).toBeGreaterThanOrEqual(1)
      expect(tone).toBeLessThanOrEqual(PERSON_TONE_COUNT)
      expect(preferredTone(key)).toBe(tone)
    }
  })

  it('you are always the accent; the same people get the same colours in any order', () => {
    const keys = ['name:anna beispiel', ME, 'name:ben mustermann', 'name:clara test', 'name:dana probe']
    const once = assignTones(keys)
    expect(once.get(ME)).toBe('me')
    const shuffled = assignTones([...keys].reverse().concat(keys))
    for (const key of keys) expect(shuffled.get(key)).toBe(once.get(key))
  })

  it('up to eight friends never share a colour — a clash takes the next free tone, the smaller key keeps its own', () => {
    const [a, b, c] = clashingKeys(3) as [string, string, string]
    const tones = assignTones([c, b, a])
    expect(new Set([tones.get(a), tones.get(b), tones.get(c)]).size).toBe(3)
    const sorted = [a, b, c].sort()
    expect(tones.get(sorted[0]!)).toBe(preferredTone(sorted[0]!))
    // eight friends: eight different colours
    const eight = Array.from({ length: 8 }, (_, i) => `name:person ${i}`)
    expect(new Set(assignTones(eight).values()).size).toBe(8)
  })

  it('a newcomer only moves someone whose colour it shares', () => {
    const circle = ['name:anna beispiel', 'name:ben mustermann', 'name:clara test']
    const before = assignTones(circle)
    const taken = new Set(before.values())
    // a newcomer whose preferred tone is free changes nobody
    let newcomer = ''
    for (let i = 0; i < 200 && !newcomer; i += 1) {
      const key = `name:neu ${i}`
      if (!taken.has(preferredTone(key))) newcomer = key
    }
    const after = assignTones([...circle, newcomer])
    for (const key of circle) expect(after.get(key)).toBe(before.get(key))
    expect(after.get(newcomer)).toBe(preferredTone(newcomer))
  })

  it('peopleOf: you first, then friends by first name — with counts, initials and their colours', () => {
    const people = peopleOf([by('Clara Test'), mine, by('Anna Beispiel'), by('clara test'), by('Ben Mustermann')])
    expect(people.map((person) => [person.key, person.short, person.initials, person.count])).toEqual([
      [ME, '', '', 1],
      ['name:anna beispiel', 'Anna', 'AB', 1],
      ['name:ben mustermann', 'Ben', 'BM', 1],
      ['name:clara test', 'Clara', 'CT', 2],
    ])
    const tones = assignTones(people.map((person) => person.key))
    for (const person of people) expect(person.tone).toBe(tones.get(person.key))
    // "Du" can be listed without own occasions (the filter always offers it)
    expect(peopleOf([by('Anna Beispiel')], { withMe: true }).map((person) => [person.key, person.count])).toEqual([
      [ME, 0],
      ['name:anna beispiel', 1],
    ])
  })
})

describe('the people filter', () => {
  const people = [{ key: ME }, { key: 'name:anna' }, { key: 'name:ben' }]

  it('from "Alle" a tap shows only that person; more people join; the last one out is "Alle" again', () => {
    const anna = toggleSelection(null, 'name:anna', people)
    expect([...(anna ?? [])]).toEqual(['name:anna'])
    const two = toggleSelection(anna, ME, people)
    expect([...(two ?? [])].sort()).toEqual([ME, 'name:anna'].sort())
    expect(toggleSelection(toggleSelection(two, ME, people), 'name:anna', people)).toBeNull()
    // everybody chosen is the same as everyone
    expect(toggleSelection(two, 'name:ben', people)).toBeNull()
  })

  it('people who left the feed drop out; an unchanged selection keeps its identity', () => {
    const selection = new Set(['name:anna', 'name:gone'])
    expect([...(normalizeSelection(selection, people) ?? [])]).toEqual(['name:anna'])
    expect(normalizeSelection(new Set(['name:gone']), people)).toBeNull()
    const kept = new Set(['name:anna'])
    expect(normalizeSelection(kept, people)).toBe(kept)
    expect(normalizeSelection(null, people)).toBeNull()
  })
})

describe('what a day chip says', () => {
  it('finds birthdays in German and English titles', () => {
    for (const title of ['Milas Geburtstag', 'Kindergeburtstag Emma', 'Geburtstagsbrunch bei Mila', 'Annas Geb.', 'Birthday party for Sam', "Mom's birthday", 'B-Day Lena', 'bday!', 'Burzeltag']) {
      expect(occasionKind(title), title).toBe('birthday')
    }
    for (const title of ['Annas Einweihung', 'Spieleabend', 'Holiday party', 'Geben und Nehmen', 'Gebäck backen', 'Weihnachtsmarkt']) {
      expect(occasionKind(title), title).toBe('other')
    }
  })

  it('a birthday names whose; anything else names what', () => {
    expect(chipLabel('Milas Geburtstag')).toBe('Milas')
    expect(chipLabel('Geburtstag von Ben')).toBe('Ben')
    expect(chipLabel('Bens 30. Geburtstag')).toBe('Bens')
    expect(chipLabel('Kindergeburtstag Emma')).toBe('Emma')
    expect(chipLabel('Birthday party for Sam')).toBe('Sam')
    expect(chipLabel("Mom's Birthday")).toBe("Mom's")
    expect(chipLabel('Geburtstag')).toBe('Geburtstag')
    expect(chipLabel('Annas Einweihung')).toBe('Einweihung')
    expect(chipLabel('Bens Grillabend!')).toBe('Grillabend')
    expect(chipLabel('Spieleabend bei Mila')).toBe('Spieleabend')
    expect(chipLabel('Picknick im Park')).toBe('Picknick')
    expect(chipLabel("Anna's housewarming")).toBe('housewarming')
    expect(chipLabel('Die Party des Jahres')).toBe('Jahres')
    expect(chipLabel('🎉 Party')).toBe('Party')
    expect(chipLabel('Weihnachtsmarkt')).toBe('Weihnachtsmarkt')
  })

  it('reads Russian titles too', () => {
    for (const title of ['День рождения Ани', 'ДР Миши', 'Днюха у Саши', 'Мой день рождения']) expect(occasionKind(title), title).toBe('birthday')
    for (const title of ['Рождество у бабушки', 'Вечер настолок', 'День города']) expect(occasionKind(title), title).toBe('other')
    expect(chipLabel('День рождения Ани')).toBe('Ани')
    expect(chipLabel('ДР Миши')).toBe('Миши')
    expect(chipLabel('Днюха у Саши')).toBe('Саши')
    expect(chipLabel('Рождество у бабушки')).toBe('Рождество')
    expect(chipLabel('Вечеринка у Миши')).toBe('Миши')
    expect(chipLabel('День города')).toBe('День')
  })

  it('reads Ukrainian titles too', () => {
    for (const title of ['День народження Олі', 'ДН Тараса', 'Уродини Марії', 'Мій день народження', 'Днюха в Остапа']) expect(occasionKind(title), title).toBe('birthday')
    for (const title of ['Різдво в бабусі', 'Вечір настолок', 'День міста']) expect(occasionKind(title), title).toBe('other')
    expect(chipLabel('День народження Олі')).toBe('Олі')
    expect(chipLabel('ДН Тараса')).toBe('Тараса')
    expect(chipLabel('Уродини Марії')).toBe('Марії')
    expect(chipLabel('Різдво в бабусі')).toBe('Різдво')
    expect(chipLabel('Вечірка в Остапа')).toBe('Остапа')
  })
})
