import type { GiftAward, GiftGameFacts } from '../../../lib/api/giftTopics'
import type { GiftsT } from '../labels'
import { span } from './filters'

// The words of a board game's facts (i18n keys `topics.*` of the `gifts` namespace). The prizes are proper names
// ("Spiel des Jahres", "Kennerspiel des Jahres") in every language, written as text — never the jury's logo.

/** "Spiel des Jahres 2023" / "Nominiert: Kennerspiel des Jahres 2018" */
export function awardLabel(t: GiftsT, award: GiftAward): string {
  const prize = t(award.prize === 'sdj' ? 'topics.award_sdj' : 'topics.award_kdj', { year: award.year })
  return award.nominated ? t('topics.award_nominated', { award: prize }) : prize
}

/** The card's short form: "Spiel des Jahres 2023" / "Kennerspiel 2019" / "Nominiert 2018" (the sheet says it in full). */
export function awardShort(t: GiftsT, award: GiftAward): string {
  if (award.nominated) return t('topics.award_short_nominated', { year: award.year })
  return t(award.prize === 'sdj' ? 'topics.award_short_sdj' : 'topics.award_short_kdj', { year: award.year })
}

/** "2–5"; an open-ended box (no maximum, Jenga): "ab 1" / "1+" / "от 1" / "від 1" */
export function playersLabel(t: GiftsT, game: Pick<GiftGameFacts, 'players_min' | 'players_max'>): string {
  return game.players_max === null ? t('topics.players_open', { min: game.players_min }) : span(game.players_min, game.players_max)
}

/** "30–60 Min" */
export function minutesLabel(t: GiftsT, game: Pick<GiftGameFacts, 'minutes_min' | 'minutes_max'>): string {
  return t('topics.minutes_value', { range: span(game.minutes_min, game.minutes_max) })
}

/** "2–5 Spieler · 35 Min · ab 7" — the card's line (and its spoken form, `long`) */
export function factsLine(t: GiftsT, game: GiftGameFacts, long = false): string {
  return long
    ? t('topics.facts_spoken', { players: playersLabel(t, game), minutes: span(game.minutes_min, game.minutes_max), age: game.age_min })
    : `${playersLabel(t, game)} · ${minutesLabel(t, game)} · ${t('topics.age_value', { age: game.age_min })}`
}
