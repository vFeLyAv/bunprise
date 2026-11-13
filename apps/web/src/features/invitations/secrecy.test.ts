import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { setOfflineFeedEnabled, shouldPersistQuery } from '../../lib/query'
import { invitationKeys } from './queries'

// Static guard of "Freunde einladen" (CLAUDE.md "Secrecy of reservations", design §5 item 6, §9 "Клиент"): no module
// of the feature, its API wrapper or its demo server imports the reservation API or says a word about reservations;
// nothing of it is ever persisted to disk (the allow-list stays exactly ['feed']). Comments may explain the rule.

const sources = import.meta.glob<string>(['./*.ts', './*.tsx', '!./*.test.ts', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })
const api = import.meta.glob<string>('../../lib/api/invitations.ts', { query: '?raw', import: 'default', eager: true })
const demo = import.meta.glob<string>('../../mocks/invitations.ts', { query: '?raw', import: 'default', eager: true })
const locales = import.meta.glob<string>('../../locales/*/invitations.json', { query: '?raw', import: 'default', eager: true })

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

afterEach(() => setOfflineFeedEnabled(false))

describe('invitations: never about reservations', () => {
  const all = { ...sources, ...api, ...demo }
  it('covers the feature folder, the wrapper and the demo server', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(7)
    expect(Object.keys(api)).toHaveLength(1)
    expect(Object.keys(demo)).toHaveLength(1)
  })
  for (const [name, source] of Object.entries(all)) {
    it(`${name}: no reservation API, query or word`, () => {
      // (the demo's seed call must name the world's empty reservation table, `reservations: []` — no data)
      const body = code(source).replace(/reservations: \[\]/g, '')
      expect(body).not.toMatch(/api\/reservations|myReservations|lib\/queries'/)
      expect(body).not.toMatch(/reserv/i)
    })
  }
  it('the texts (DE, EN, RU) do not mention reservations either', () => {
    for (const [name, text] of Object.entries(locales)) expect(text, name).not.toMatch(/reserv|бронь|брон/i)
  })
})

describe('invitations: memory only', () => {
  it('no invitation query is ever persisted, even with the offline feed switched on', () => {
    setOfflineFeedEnabled(true)
    const client = new QueryClient()
    for (const key of [invitationKeys.inbox('u'), invitationKeys.candidates('o'), invitationKeys.info('o')]) {
      client.setQueryData(key, [])
      const query = client.getQueryCache().find({ queryKey: key })
      expect(query && shouldPersistQuery(query), JSON.stringify(key)).toBe(false)
    }
  })
})
