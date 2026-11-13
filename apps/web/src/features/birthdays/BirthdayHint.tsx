import { useLayoutEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import * as m from 'motion/react-m'
import { getAnniversarySuggestions, type AnniversarySuggestion } from '../../lib/api/calendarFeed'
import type { FeedScreen } from '../../lib/api/types'
import { showHint } from '../../lib/hints'
import { currentLanguage } from '../../lib/i18n'
import { Button, IconGift, IconX, buttonClass, fade } from '../../ui'
import type { DetectCover } from '../occasions/covers/choice'
import { useCoverDetect } from '../occasions/covers/useCoverDetect'
import { requestOccasionPrefill } from '../occasions/prefill'
import { dismissHint, dismissedHints } from './dismissed'
import { dismissKey, pickSuggestion } from './suggestion'

// The birthday suggestion on Start (Felix 27.10, brief §7.4: «просто как предложение»): a calm card, a lazy chunk
// mounted by FirstSteps after the first paint (the browser is idle), one RPC (get_anniversary_suggestions, memory only).
//   host:  "„Annas Geburtstag“ ist am 4. Nov. – wieder feiern?"  → "Neuer Anlass" with title + this year's date ONLY
//   guest: "„Annas Geburtstag“ naht (4. Nov.) – schau, ob Anna Wünsche hat." → the host's profile (lists as shared)
// No event is ever created. "×" hides it for this occasion and year (./dismissed.ts).

export const anniversariesKey = (userId: string) => ['anniversaries', userId] as const

const NBSP = String.fromCharCode(0xa0)

function shortDay(day: string): string {
  try {
    const [y = 1970, mo = 1, d = 1] = day.split('-').map(Number)
    // "14. Nov." never breaks between day and month
    return new Intl.DateTimeFormat(currentLanguage(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, d))).replace(/ /g, NBSP)
  } catch {
    return day
  }
}

export default function BirthdayHint({ userId, feed }: { userId: string; feed: FeedScreen | undefined }) {
  const { t } = useTranslation('feed')
  const navigate = useNavigate()
  const detect = useCoverDetect(true)
  const [dismissed, setDismissed] = useState(() => dismissedHints(userId))
  const query = useQuery({
    queryKey: anniversariesKey(userId),
    queryFn: () => getAnniversarySuggestions(userId),
    staleTime: 6 * 3_600_000,
    retry: false,
  })
  const pick = (answer: AnniversarySuggestion[], detector: DetectCover) => pickSuggestion(answer, { feed, detect: (title) => detector(title, ''), dismissed })
  // the card that is there at once (a return to Start: the detector and the answer are in memory) is part of the
  // screen: no fade-in; one that comes later (the first visit, the next after "×") fades in
  const [atOnce] = useState(() => (detect && query.data ? (pick(query.data, detect)?.occasion_id ?? null) : null))
  if (!detect || !query.data) return null
  const item = pick(query.data, detect)
  if (!item) return null
  return <Card key={item.occasion_id} item={item} appear={item.occasion_id !== atOnce} onDismiss={() => {
    dismissHint(userId, dismissKey(item))
    setDismissed(dismissedHints(userId))
  }} onPlan={() => {
    requestOccasionPrefill(userId, { title: item.title, date: item.anniversary })
    void navigate({ to: '/occasions/new' })
  }} t={t} />
}

interface CardProps {
  item: AnniversarySuggestion
  /** fades in (it arrived after the screen); false = shown with the screen */
  appear: boolean
  onDismiss: () => void
  onPlan: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

function Card({ item, appear, onDismiss, onPlan, t }: CardProps) {
  // on screen = this session's optional hint (lib/hints.ts): the comic card waits for another session, and steps aside
  // in this very frame if it was there first (a layout effect: before the paint)
  useLayoutEffect(() => showHint('birthday'), [])
  const host = item.role === 'host'
  const date = shortDay(item.anniversary)
  const name = item.host_name?.trim() || t('feed.birthday.someone')
  return (
    <m.section initial={appear ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={fade} aria-labelledby="birthday-hint-title"
      className="glass-panel relative my-5 flex flex-col gap-3 rounded-card p-4" data-birthday-hint={host ? 'host' : 'guest'}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-accent-text"><IconGift size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="t-footnote font-semibold text-accent-text">{t('feed.birthday.eyebrow')}</p>
          <h2 id="birthday-hint-title" className="mt-0.5 t-callout text-text [overflow-wrap:anywhere]">
            {host ? t('feed.birthday.host_text', { title: item.title, date }) : t('feed.birthday.guest_text', { title: item.title, date, name })}
          </h2>
        </div>
        <button type="button" aria-label={t('feed.birthday.dismiss')} onClick={onDismiss}
          className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full text-text-2 focus-visible:outline-2 focus-visible:outline-accent-500">
          <IconX size={20} />
        </button>
      </div>
      <div className="pl-13">
        {host ? (
          <Button size="sm" className="min-h-11" onClick={onPlan}>{t('feed.birthday.host_action')}</Button>
        ) : (
          <Link to="/people/$profileId" params={{ profileId: item.host_id }} className={`${buttonClass({ variant: 'secondary', size: 'sm' })} min-h-11`}>
            {t('feed.birthday.guest_action')}
          </Link>
        )}
      </div>
    </m.section>
  )
}
