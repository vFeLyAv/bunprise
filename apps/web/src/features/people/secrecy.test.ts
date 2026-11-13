import { describe, expect, it } from 'vitest'
import peoplePage from './PeoplePage.tsx?raw'
import personPage from './PersonPage.tsx?raw'
import acceptSheet from './AcceptSheet.tsx?raw'
import blockSheet from './BlockSheet.tsx?raw'
import followLinkSheet from './FollowLinkSheet.tsx?raw'
import linkSheetHost from './linkSheetHost.tsx?raw'
import followPage from './FollowPage.tsx?raw'
import followGate from './FollowGate.tsx?raw'
import parts from './parts.tsx?raw'
import queries from './queries.ts?raw'
import actions from './actions.ts?raw'
import pendingDeclines from './pendingDeclines.ts?raw'
import pendingFollow from './pendingFollow.ts?raw'
import followLinkMemory from './followLinkMemory.ts?raw'
import glyphs from './glyphs.tsx?raw'
import followsApi from '../../lib/api/follows.ts?raw'
import followsTypes from '../../lib/api/follows.types.ts?raw'
import privacySettings from '../account/PrivacySettings.tsx?raw'
import peopleDe from '../../locales/de/people.json'
import peopleEn from '../../locales/en/people.json'
import peopleRu from '../../locales/ru/people.json'
import peopleUk from '../../locales/uk/people.json'

// Static guard of the people feature (CLAUDE.md "Secrecy of reservations", follows-design W01): the modules of MY
// people (the people screen, the person card, the accept / block / link sheets, the gate, Privatsphäre, the data
// layer) never import the reservation API or lib/queries' myReservationsQuery and never say a word about
// reservations. The one exception is the GIVER's side — "Nicht mehr folgen" may tell the giver that THEIR OWN
// reservations end (§2.10) — and the actions module may refresh the giver's own plans after an unfollow or a block
// (a cache key, no data). Comments may explain the rule. Sentinel sentences stay static (no counts, no data).

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const OWNER_SIDE = {
  peoplePage, personPage, acceptSheet, blockSheet, followLinkSheet, linkSheetHost, followPage, followGate, parts, queries,
  pendingDeclines, pendingFollow, followLinkMemory, glyphs, followsApi, followsTypes, privacySettings,
}

type Tree = { [key: string]: string | Tree }

function strings(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) => (typeof value === 'string' ? [value] : strings(value)))
}

describe('people: owner-side modules', () => {
  for (const [name, source] of Object.entries(OWNER_SIDE)) {
    it(`${name}: no reservation API, query, strings or fields`, () => {
      const body = code(source)
      expect(body).not.toMatch(/api\/reservations|lib\/queries'|myReservations|listGuest\./)
      expect(body).not.toMatch(/reserv/i)
    })
  }

  it('get_me comes through the people data layer, never through lib/queries (it brings the reservation module along)', () => {
    for (const source of [followGate, privacySettings, queries]) expect(code(source)).not.toMatch(/lib\/queries/)
    expect(code(queries)).toMatch(/export function ownMeQuery/)
  })

  it('actions: no reservation API, no reservation data — only the cache key of the giver\'s own plans', () => {
    const body = code(actions)
    expect(body).not.toMatch(/api\/reservations|lib\/queries'/)
    // the only mentions: invalidating ['myReservations'] after "Nicht mehr folgen" and after a block
    expect(body.match(/qk\.myReservations\(\)/g)).toHaveLength(2)
    expect(body.replace(/qk\.myReservations\(\)/g, '')).not.toMatch(/reserv/i)
  })

  it('the person card and the people screen never show anybody else\'s followers or their numbers', () => {
    for (const source of [peoplePage, personPage]) expect(code(source)).not.toMatch(/follower_count|followers_count|following_count|stats\./)
  })
})

/** "reserv…" (DE / EN) and "брон…" (RU: бронь, забронировать; UK: бронь, забронювати) */
const RESERVATION_WORD = /reserv|брон/i

describe('people: locale keys (DE, EN, RU and UK)', () => {
  it('only the giver group and the static "Wer sieht was?" sentence mention reservations', () => {
    for (const locale of [peopleDe, peopleEn, peopleRu, peopleUk] as unknown as Tree[]) {
      const groups = locale.people as Tree
      for (const [group, tree] of Object.entries(groups)) {
        const texts = typeof tree === 'string' ? [tree] : Object.entries(tree).flatMap(([key, value]) => {
          if (group === 'privacy' && key === 'who_secret') return []
          return typeof value === 'string' ? [value] : strings(value)
        })
        if (group === 'giver') expect(texts.some((text) => RESERVATION_WORD.test(text))).toBe(true)
        else for (const text of texts) expect(text, `${group}: ${text}`).not.toMatch(RESERVATION_WORD)
      }
    }
  })

  it('the sentences before narrowing are static: the same for everybody, no counts', () => {
    type Sentences = { people: { remove: { message: string }; block: { point_plans: string }; privacy: { who_secret: string } } }
    const de = peopleDe as unknown as Sentences
    const ru = peopleRu as unknown as Sentences
    const uk = peopleUk as unknown as Sentences
    expect(de.people.remove.message).toContain('Was {{name}} für dich heimlich geplant hat, wird dabei aufgehoben – ob es so etwas gibt, erfährst du nie.')
    expect(de.people.block.point_plans).toBe('Was {{name}} für dich heimlich geplant hat, wird aufgehoben – ob es so etwas gibt, erfährst du nie.')
    expect(de.people.privacy.who_secret).toBe('Reservierungen zu deinen Wünschen siehst du nie.')
    expect(ru.people.block.point_plans).toBe('Если {{name}} что-то тайно для тебя планирует, это отменится — есть ли такое, ты никогда не узнаешь.')
    expect(ru.people.privacy.who_secret).toBe('Брони на твои желания ты никогда не видишь.')
    expect(uk.people.block.point_plans).toBe('Якщо {{name}} щось таємно для тебе планує, це скасується — чи є таке, ти ніколи не дізнаєшся.')
    expect(uk.people.privacy.who_secret).toBe('Броні на твої бажання ти ніколи не бачиш.')
    for (const text of [de, ru, uk].flatMap((locale) => [locale.people.remove.message, locale.people.block.point_plans, locale.people.privacy.who_secret])) {
      expect(text.replace(/\{\{name\}\}/g, '')).not.toMatch(/\{\{|\d/)
    }
  })
})
