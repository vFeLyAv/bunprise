import type { GiftTopicIdea } from '../../../lib/api/giftTopics'

// Searching inside a topic (Felix 27.10: "поиск по названию … чтобы … побыстрее найти"): on the device only, as
// you type — the name (and title), the publisher, a book's author. Case- and accent-insensitive both ways a German
// keyboard allows: "Flügel", "Fluegel" and "Flugel" all find "Flügelschlag"; "ß" = "ss". Every word of the query
// must be there (in any order). Pure.

/** "Flügelschlag" → ["fluegelschlag", "flugelschlag"]: umlauts written out, and plain without their dots. */
export function searchForms(text: string): [string, string] {
  const lower = text.toLowerCase().replace(/ß/g, 'ss')
  const spelled = lower.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  const plain = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9а-яёіїєґ]+/g, ' ').trim()
  return [plain(spelled), plain(lower)]
}

/** What a search looks at: the game's name, the title, the publisher, the author. */
export function haystack(idea: Pick<GiftTopicIdea, 'title' | 'game' | 'book'>): [string, string] {
  const parts = [idea.title, idea.game?.name, idea.game?.publisher, idea.book?.author, idea.book?.publisher].filter(Boolean).join(' ')
  return searchForms(parts)
}

/** Does the idea match the query? An empty query matches everything. */
export function matchesSearch(hay: readonly [string, string], query: string): boolean {
  const [spelledQuery, plainQuery] = searchForms(query)
  if (!plainQuery) return true
  const all = (needle: string, text: string) => needle.split(' ').every((word) => text.includes(word))
  return all(spelledQuery, hay[0]) || all(plainQuery, hay[1]) || all(plainQuery, hay[0])
}
