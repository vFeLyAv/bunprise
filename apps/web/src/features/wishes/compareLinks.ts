// "Woanders finden" in the wish sheet (Felix's decision 2026-10-22): plain SEARCH links into four big shops /
// price comparisons, by the wish's GTIN (EAN) when it has one, else by its title. No prices inside the app (we do
// not know them; the honest line says „Preise im Shop vergleichen“), no affiliate tags, no request from the app:
// the browser contacts a shop only when the person taps a link (new tab, no referrer, no opener).

export type CompareShopId = 'idealo' | 'google' | 'amazon' | 'ebay'

export interface CompareLink {
  id: CompareShopId
  /** the shop's name as shown (the letter tile is derived from it) */
  shop: string
  /** the shop's host, shown under the name */
  host: string
  url: string
}

/** Search texts longer than this are cut (shop search boxes do not need a whole sentence). */
const QUERY_MAX = 100

const SHOPS: ReadonlyArray<{ id: CompareShopId; shop: string; host: string; search: (q: string) => string }> = [
  { id: 'idealo', shop: 'idealo', host: 'idealo.de', search: (q) => `https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${q}` },
  { id: 'google', shop: 'Google Shopping', host: 'google.de', search: (q) => `https://www.google.de/search?tbm=shop&q=${q}` },
  { id: 'amazon', shop: 'Amazon', host: 'amazon.de', search: (q) => `https://www.amazon.de/s?k=${q}` },
  { id: 'ebay', shop: 'eBay', host: 'ebay.de', search: (q) => `https://www.ebay.de/sch/i.html?_nkw=${q}` },
]

/** What is searched for: the GTIN (8–14 digits) when there is one, else the title (whitespace collapsed, cut). */
export function compareQuery(wish: { title: string; gtin?: string | null }): string | null {
  const gtin = wish.gtin?.trim() ?? ''
  if (/^[0-9]{8,14}$/.test(gtin)) return gtin
  const title = [...wish.title.replace(/\s+/g, ' ').trim()].slice(0, QUERY_MAX).join('').trim()
  return title === '' ? null : title
}

/** The four search links of a wish (empty when there is nothing to search for). */
export function compareLinks(wish: { title: string; gtin?: string | null }): CompareLink[] {
  const query = compareQuery(wish)
  if (query === null) return []
  const q = encodeURIComponent(query)
  return SHOPS.map(({ id, shop, host, search }) => ({ id, shop, host, url: search(q) }))
}
