import { describe, expect, it } from 'vitest'
import { WISH_PRICE_MAX_CENTS, formatPriceInput, parsePriceText } from './priceText'

describe('parsePriceText (German and English writing → whole cents, the database range)', () => {
  it('reads decimals with a comma or a dot, with or without the euro sign', () => {
    expect(parsePriceText('12,50')).toBe(1250)
    expect(parsePriceText('12.50')).toBe(1250)
    expect(parsePriceText('12,5 €')).toBe(1250)
    expect(parsePriceText('12')).toBe(1200)
    expect(parsePriceText('12,')).toBe(1200)
    expect(parsePriceText(',99')).toBe(99)
    expect(parsePriceText('79,99 EUR')).toBe(7999)
  })

  it('reads thousands separators (three digits after a separator are never cents)', () => {
    expect(parsePriceText('1.299')).toBe(129900)
    expect(parsePriceText('1.299,50')).toBe(129950)
    expect(parsePriceText('1,299.50')).toBe(129950)
    expect(parsePriceText('1 299')).toBe(129900)
    expect(parsePriceText('1.000.000')).toBe(WISH_PRICE_MAX_CENTS)
  })

  it('empty is "no price"; garbage, negatives, three decimals and more than 1 000 000 € are invalid', () => {
    expect(parsePriceText('')).toBeNull()
    expect(parsePriceText('  ')).toBeNull()
    for (const text of ['abc', '-5', '12,345,6', '1.2345', '12.3.4', '1.000.000,01', '9999999', '1e3', '12,5,0']) {
      expect(parsePriceText(text), text).toBe('invalid')
    }
  })
})

describe('formatPriceInput', () => {
  it('shows cents only when there are any, with the language’s separators', () => {
    expect(formatPriceInput(7999, 'de')).toBe('79,99')
    expect(formatPriceInput(7999, 'en')).toBe('79.99')
    expect(formatPriceInput(2500, 'de')).toBe('25')
    expect(formatPriceInput(129950, 'de')).toBe('1.299,50')
    expect(formatPriceInput(null, 'de')).toBe('')
  })

  it('round-trips through the parser', () => {
    for (const cents of [0, 1, 99, 1250, 7999, 129950, WISH_PRICE_MAX_CENTS]) {
      // Russian and Ukrainian group thousands with a no-break space: "1 299,50"
      for (const locale of ['de', 'en', 'ru', 'uk']) expect(parsePriceText(formatPriceInput(cents, locale)), `${cents} ${locale}`).toBe(cents)
    }
  })
})
