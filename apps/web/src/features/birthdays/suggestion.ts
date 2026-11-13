import type { AnniversarySuggestion } from '../../lib/api/calendarFeed'
import type { FeedScreen } from '../../lib/api/types'
import { dayKey } from '../../lib/time'

// Which birthday suggestion Start shows (Felix 27.10: «Ежегодный день рождения … события не создавать … просто как
// предложение»). The database (get_anniversary_suggestions) brings my past occasions whose anniversary is 14–28 days
// ahead and that MAY be a birthday; here, on the device:
//   1. a birthday: the stored motif is 'birthday', or there is none (null / 'none') and the title reads as one
//      (features/occasions/covers/detect.ts — the same words as the cover motifs: Geburtstag, birthday, день рождения …);
//   2. not planned yet: no upcoming occasion of the same host within ±14 days of the anniversary that is a birthday
//      too (it is in my feed: as its host, or as a guest the host invited again);
//   3. not dismissed for this anniversary (./dismissed.ts);
//   4. the nearest one wins — one calm card at a time.

export type DetectTheme = (title: string) => string | null

export function looksLikeBirthday(item: { title: string; cover_theme?: string | null }, detect: DetectTheme): boolean {
  if (item.cover_theme === 'birthday') return true
  if (item.cover_theme !== null && item.cover_theme !== undefined && item.cover_theme !== 'none') return false
  return detect(item.title) === 'birthday'
}

function dayNumber(day: string): number {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

export function alreadyPlanned(item: AnniversarySuggestion, feed: FeedScreen | undefined, detect: DetectTheme): boolean {
  if (!feed) return false
  const target = dayNumber(item.anniversary)
  return feed.upcoming.some((occasion) => {
    const host = occasion.host_id ?? (occasion.role === 'host' && item.role === 'host' ? item.host_id : undefined)
    if (host !== item.host_id) return false
    const day = dayNumber(dayKey(occasion.starts_at, occasion.tz))
    return Math.abs(day - target) <= 14 && looksLikeBirthday(occasion, detect)
  })
}

export function dismissKey(item: Pick<AnniversarySuggestion, 'occasion_id' | 'anniversary'>): string {
  return `${item.occasion_id}:${item.anniversary.slice(0, 4)}`
}

export function pickSuggestion(
  items: readonly AnniversarySuggestion[],
  options: { feed: FeedScreen | undefined; detect: DetectTheme; dismissed: ReadonlySet<string> },
): AnniversarySuggestion | null {
  const fitting = items
    .filter((item) => item.days_ahead >= 14 && item.days_ahead <= 28)
    .filter((item) => looksLikeBirthday(item, options.detect))
    .filter((item) => !options.dismissed.has(dismissKey(item)))
    .filter((item) => !alreadyPlanned(item, options.feed, options.detect))
    .sort((a, b) => a.days_ahead - b.days_ahead || a.occasion_id.localeCompare(b.occasion_id))
  return fitting[0] ?? null
}
