import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OccasionScreen, Rsvp } from '../../lib/api/types'
import { IconCheck, IconQuestion, IconX, Segmented, cn } from '../../ui'
import { useOnline } from '../auth/shared'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { useRsvp } from './actions'
import { useDisplayName } from './parts'
import '../../styles/occasion.css'
import { captureEpoch } from '../../lib/accountBoundary'
import { hasRsvpPrompt, markRsvpPrompt, takeRsvpArrival } from './rsvpMoments'

// GUEST ONLY — "Kommst du?" (S7 guest view, F7). Optimistic: the control switches at once, a
// failed request rolls back with a toast. Before the first answer the card asks with a warm light and
// nothing looks selected. Wave 1: the chosen answer colours the thumb (Zusage green, Vielleicht apricot)
// and its icon pops; a small bunny peeks over the card's top right edge and ducks back.
// The response uses the same real edge, not a runner clipped in the middle of the card.

/** The bunny's host reaches this far below the card's top edge (its paws rest on the card). */
const CARD_OVERLAP_PX = 16
const BUNNY_HOST_PX = 140

export function RsvpSection({ screen, userId }: { screen: OccasionScreen; userId: string }) {
  const { t } = useTranslation('occasion')
  const online = useOnline()
  const displayName = useDisplayName()
  const titleId = useId()
  const rsvp = useRsvp(screen.occasion.id, userId)
  const value = screen.viewer.rsvp
  const unanswered = value === 'none'
  const card = useRef<HTMLElement>(null)
  const momentKey = `${userId}:${screen.occasion.id}`
  const [prompt] = useState(() => unanswered && !hasRsvpPrompt(momentKey))
  const [arrival, setArrival] = useState(false)
  const arrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(false)
  const answerVersion = useRef(0)
  useEffect(() => {
    alive.current = true
    if (prompt) markRsvpPrompt(momentKey)
    return () => { alive.current = false; if (arrivalTimer.current) clearTimeout(arrivalTimer.current) }
  }, [momentKey, prompt])
  function answer(next: Rsvp) {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const version = ++answerVersion.current
    if (next !== 'going') {
      if (arrivalTimer.current) clearTimeout(arrivalTimer.current)
      setArrival(false)
    }
    const started = Date.now()
    rsvp.mutate(next, { onSuccess: () => {
      if (next !== 'going' || version !== answerVersion.current || !alive.current || !epoch.isCurrent() || !takeRsvpArrival(momentKey)) return
      arrivalTimer.current = setTimeout(() => {
        if (version === answerVersion.current && alive.current && epoch.isCurrent()) setArrival(true)
      }, Math.max(0, 280 - (Date.now() - started)))
    } })
  }
  const answerLabel = (full: string, short: string) => <>
    <span className="sr-only">{full}</span><span aria-hidden="true" className="rsvp-full">{full}</span><span aria-hidden="true" className="rsvp-short">{short}</span>
  </>

  return (
    <div className="relative">
      {prompt && unanswered ? <BunnyMoment
        kind="pop-up"
        cardRef={card}
        edgeInset={CARD_OVERLAP_PX}
        minSize={52}
        maxSize={60}
        className="pointer-events-none absolute inset-x-0 z-2"
        style={{ top: CARD_OVERLAP_PX - BUNNY_HOST_PX, height: BUNNY_HOST_PX }}
      /> : null}
      {arrival ? <BunnyMoment kind="pop-up" pick={{ preset: 'pop-up', coat: 'broken', edge: 'bottom' }} once="always" momentClass="response" calm="hide" onEnd={() => setArrival(false)}
        minSize={52} maxSize={60} cardRef={card} edgeInset={16} className="pointer-events-none absolute inset-x-0 z-2"
        style={{ top: -104, height: 120 }} /> : null}
      <section ref={card} aria-labelledby={titleId} className={cn('glass-panel relative z-1 rounded-card p-5 tr-colors', unanswered && 'rsvp-ask')}>
        <h2 id={titleId} className="t-title-3 font-bold text-text">
          {t('rsvp.title')}
        </h2>
        {unanswered ? (
          <p className="mt-1 t-subhead text-text-2">{t('rsvp.prompt', { host: displayName(screen.occasion.host.display_name) })}</p>
        ) : null}
        <div className="mt-4">
          {/* 'none' is not an option: the kit's Segmented then shows no selection (indicator faded out,
              the first option reachable with Tab) until the first answer. */}
          <Segmented<Rsvp>
            className="rsvp-options"
            label={t('rsvp.label')}
            value={value}
            disabled={!online}
            options={[
              { value: 'going', label: answerLabel(t('rsvp.segment_going'), t('rsvp.short_going')), icon: <IconCheck />, tone: 'ok' },
              { value: 'maybe', label: t('rsvp.segment_maybe'), icon: <IconQuestion />, tone: 'accent' },
              { value: 'declined', label: answerLabel(t('rsvp.segment_declined'), t('rsvp.short_declined')), icon: <IconX />, tone: 'neutral' },
            ]}
            onChange={answer}
          />
        </div>
        {value === 'declined' ? <p className="mt-3 t-footnote text-text-2">{t('rsvp.no_keeps_reservations')}</p> : null}
        {!online ? (
          <p role="status" className="mt-3 t-footnote text-text-2">
            {t('errors.offline_action')}
          </p>
        ) : null}
      </section>
    </div>
  )
}
