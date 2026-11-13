import { currentLanguage } from './i18n'

// Number/URL formatting via Intl (design-system-motion.md section 3: PriceField, WishRow).

/** cents → "12,50 €" (de) / "€12.50" (en) / "12,50 €" (uk: narrowSymbol — Ukrainian's own symbol would be "EUR"); null when there is no price. */
export function formatPrice(
  cents: number | null | undefined,
  options: { currency?: string; locale?: string } = {},
): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null
  const { currency = 'EUR', locale = currentLanguage() } = options
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100)
}

/** "≈ 25 €" — wishes show an approximate price. */
export function formatApproxPrice(cents: number | null | undefined, options?: { currency?: string; locale?: string }): string | null {
  const price = formatPrice(cents, options)
  return price === null ? null : `≈ ${price}`
}

/**
 * Parses what a person typed into the price field ("12,50", "12.50", "12 €") into cents.
 * Returns null for an empty field and 'invalid' for garbage.
 */
export function parsePriceToCents(raw: string): number | null | 'invalid' {
  const cleaned = raw.replace(/[€\s]/g, '').replace(',', '.')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return 'invalid'
  const value = Math.round(Number(cleaned) * 100)
  return value > 99_999_999 ? 'invalid' : value
}

/** "https://www.amazon.de/dp/123" → "amazon.de" (what a wish row shows instead of the full URL). */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
