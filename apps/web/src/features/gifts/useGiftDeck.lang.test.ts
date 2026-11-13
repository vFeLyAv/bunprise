import i18next from 'i18next'
import { afterAll, describe, expect, it } from 'vitest'
import { deckKey } from './useGiftDeck'

// 30.10: the deck asks in the UI language (titles come in it), so a deck kept in one language must not be shown in
// another — the language is part of the deck's key.

afterAll(async () => {
  await i18next.changeLanguage('de')
})

describe('the deck key', () => {
  it('holds the UI language', async () => {
    const params = { userId: 'u1', mode: 'for_me' as const, recipientKey: 'me', interests: [], budget: { min_cents: 0, max_cents: 5000 } }
    const keys: string[] = []
    for (const lang of ['de', 'en', 'ru', 'uk']) {
      // a language counts as resolved once it has texts (the test setup bundles German only)
      i18next.addResourceBundle(lang, 'common', { probe: lang }, true, false)
      await i18next.changeLanguage(lang)
      keys.push(deckKey(params))
      expect(deckKey(params)).toBe(keys[keys.length - 1])
    }
    expect(new Set(keys).size).toBe(4)
  })
})
