import { onAccountEnded } from '../../lib/accountBoundary'
import type { GiftBudget, GiftIdea, GiftIdeasMode, GiftInterest } from '../../lib/api/giftIdeas'

// Memory of "Geschenk finden" for THIS visit of the tab (never stored, never sent): the chosen mode,
// person and list, and what the person changed per recipient (an interest removed or added, the budget).
// Leaving the tab for Start or Profil and coming back keeps it; a reload forgets it; so does the end of
// the account in this tab (accountBoundary.onAccountEnded — contract.md §5.5).

export interface RecipientChoices {
  /** interests the person took away (the guess stays visible as "removed" until the list changes) */
  removed: readonly GiftInterest[]
  /** interests the person added by hand */
  added: readonly GiftInterest[]
  /** a budget the person chose (null = the one suggested from the list's prices) */
  budget: GiftBudget | null
}

const EMPTY: RecipientChoices = { removed: [], added: [], budget: null }

let mode: GiftIdeasMode | null = null
let person: string | null = null
const lists = new Map<string, string>()
const choices = new Map<string, RecipientChoices>()
/** "Für mich": the ideas I liked in this visit (newest first) */
let liked: GiftIdea[] = []
/** ideas already put on one of my lists in this visit (the card says "Auf deiner Liste") */
const added = new Set<string>()

function forget(): void {
  mode = null
  person = null
  lists.clear()
  choices.clear()
  liked = []
  added.clear()
}

onAccountEnded(forget)

export function lastMode(): GiftIdeasMode | null {
  return mode
}

export function rememberMode(next: GiftIdeasMode): void {
  mode = next
}

export function lastPerson(): string | null {
  return person
}

export function rememberPerson(key: string): void {
  person = key
}

/** The list chosen for a person (when the person has several). */
export function lastListOf(personKey: string): string | null {
  return lists.get(personKey) ?? null
}

export function rememberListOf(personKey: string, listKey: string): void {
  lists.set(personKey, listKey)
}

export function choicesFor(recipientKey: string): RecipientChoices {
  return choices.get(recipientKey) ?? EMPTY
}

export function rememberChoices(recipientKey: string, next: RecipientChoices): void {
  choices.set(recipientKey, next)
}

/** The interests the deck asks for: the guess minus the removed ones, plus the added ones (≤ 8). */
export function effectiveInterests(guessed: readonly GiftInterest[], chosen: RecipientChoices): GiftInterest[] {
  const out = guessed.filter((id) => !chosen.removed.includes(id))
  for (const id of chosen.added) if (!out.includes(id)) out.push(id)
  return out.slice(0, 8)
}

export function likedForMe(): readonly GiftIdea[] {
  return liked
}

/** Liked in this visit (newest first); `at` puts it back where it was ("Rückgängig" after removing it). */
export function rememberLiked(idea: GiftIdea, at = 0): void {
  const rest = liked.filter((known) => known.id !== idea.id)
  liked = [...rest.slice(0, at), idea, ...rest.slice(at)].slice(0, 30)
}

export function forgetLiked(ideaId: string): void {
  liked = liked.filter((known) => known.id !== ideaId)
}

export function wasAddedToList(ideaId: string): boolean {
  return added.has(ideaId)
}

export function rememberAddedToList(ideaId: string): void {
  added.add(ideaId)
}

/** Tests only. */
export function resetGiftSessionForTests(): void {
  forget()
}
