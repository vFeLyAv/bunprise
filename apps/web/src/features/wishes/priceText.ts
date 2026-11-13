// The price of a wish as people type it (pure, unit-tested in priceText.test.ts). Stored as whole cents
// in EUR; the database allows 0 … 100 000 000 cents (1 000 000,00 €) — the same limit here.
// Understands German and English writing: "12,50" · "12.50" · "12" · "12,5 €" · "1.299" (thousands) ·
// "1.299,00" · "1,299.00" · "1 299". A separator followed by exactly three digits is a thousands separator
// (nobody writes a price with three decimals).

/** = wishes.price_cents check in the database */
export const WISH_PRICE_MAX_CENTS = 100_000_000

export function parsePriceText(raw: string): number | null | 'invalid' {
  const text = raw.replace(/[\s  €]/g, '').replace(/eur(o)?$/i, '')
  if (text === '') return null
  let whole: string
  let fraction = ''
  const comma = text.lastIndexOf(',')
  const dot = text.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    // both: the last one separates the cents, the other one groups thousands
    const at = Math.max(comma, dot)
    const grouping = at === comma ? '.' : ','
    const head = text.slice(0, at)
    if (!/^\d{1,3}(?:[.,]\d{3})*$/.test(head) || head.includes(at === comma ? ',' : '.')) return 'invalid'
    whole = head.split(grouping).join('')
    fraction = text.slice(at + 1)
  } else if (comma >= 0 || dot >= 0) {
    const parts = text.split(comma >= 0 ? ',' : '.')
    const [head = '', tail = ''] = parts
    if (parts.length === 2 && tail.length !== 3) {
      whole = head === '' ? '0' : head
      fraction = tail
    } else if (parts.every((part, index) => (index === 0 ? /^\d{1,3}$/ : /^\d{3}$/).test(part))) {
      whole = parts.join('')
    } else {
      return 'invalid'
    }
  } else {
    whole = text
  }
  if (!/^\d{1,9}$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return 'invalid'
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= WISH_PRICE_MAX_CENTS ? cents : 'invalid'
}

/** For the price input: 7999 → "79,99" (de) / "79.99" (en); whole euros without cents ("25"); null → "". */
export function formatPriceInput(cents: number | null, locale: string): string {
  if (cents === null || !Number.isFinite(cents)) return ''
  const whole = cents % 100 === 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(cents / 100)
}
