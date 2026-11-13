import { lazy, Suspense, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { OccasionScreen } from '../../lib/api/types'
import { appleMapsUrl, googleMapsUrl, isApplePlatform } from '../../lib/maps'
import { currentLanguage } from '../../lib/i18n'
import { spanText, timeSpan } from '../../lib/occasionTime'
import { browserTimeZone, relativeDayLabel, wallTimeDiffers } from '../../lib/time'
import { Avatar, ButtonLink, DateBadge, IconCalendar, IconMapPin, cn, tileTone } from '../../ui'
import { badgeParts } from '../feed/model'
import { occasionTransitionName, useDisplayName } from './parts'
import { CoverJobNotice, CoverJobPill, HeroCover, useHeroCover } from './photo/HeroCover'
import { shownCover } from './covers/themes'
import '../../styles/occasion.css'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { useOnline } from '../auth/shared'
import type { PlacePoint } from '../../lib/api/places'
import { MINI_MAP_STRIP_HEIGHT } from './form/miniMapTiles'
import { AddToCalendarButton } from '../calendarExport/AddToCalendarButton'

// S7 header, the same for host and guests: when, where, what, who hosts. Times show in the
// viewer's zone with a hint when the occasion's zone differs (F4); all-day occasions keep their
// calendar day in every zone. The title block carries the shared-element name of the feed card.
// Wave 1 (Apple Invites-like): the title big on the occasion's own tint (ui/AmbientTint on the screen), a
// frosted hero card washed with the same colour — a little calendar page, the time, the place with map
// pills, the text, the host (the bunny says hello over the next card: RsvpSection).
// Wave 2: the cover photo (photo/HeroCover.tsx) runs full-bleed behind the top and dissolves into the paper;
// the day pill and the title sit on its fading edge. Without a photo the hero is exactly the wave-1 one —
// unless the occasion has a motif (Felix 26.10, covers/HeroMotif.tsx, a lazy chunk): our own picture in the same box.

const HeroMotif = lazy(() => import('./covers/HeroMotif'))
// the place's mini map (Felix 27.10): the form's lazy MiniMap chunk, as a wide strip
const MiniMap = lazy(() => import('./form/MiniMap'))

export function OccasionHero({ screen, userId }: { screen: OccasionScreen; userId?: string }) {
  const { t } = useTranslation('occasion')
  const displayName = useDisplayName()
  const { occasion, viewer } = screen
  const { cover, job } = useHeroCover(screen, userId)
  // no photo (also while the host's removal is on its way): the stored motif; a photo always wins
  const motif = cover ? null : shownCover(occasion.cover_theme)
  const viewerZone = browserTimeZone()
  const dayZone = occasion.all_day ? occasion.tz : viewerZone
  const tone = tileTone(occasion.id)
  const badge = badgeParts(occasion)
  const dateLine = formatDay(occasion.starts_at, dayZone)
  // the end (20261026180000): "19:00–23:00"; ending on the next day, a second line says until when
  const span = timeSpan(occasion, viewerZone)
  const timeLine = occasion.all_day ? t('occasion.all_day') : span.end === null ? span.start : t('common.time_span', { start: span.start, end: span.end })
  const nextDayLine = !occasion.all_day && span.end !== null && span.nextDay ? t('occasion.ends_next_day', { time: span.end }) : null
  const zoneHint =
    !occasion.all_day && wallTimeDiffers(occasion.starts_at, occasion.tz, viewerZone)
      ? t('occasion.in_occasion_tz', { time: spanText(timeSpan(occasion, occasion.tz), t), tz: occasion.tz })
      : null
  const place = occasion.place_text?.trim() ?? ''
  // 20261027190000: where the place is (both or neither; missing from an older server)
  const point: PlacePoint | null =
    typeof occasion.place_lat === 'number' && typeof occasion.place_lon === 'number' ? { lat: occasion.place_lat, lon: occasion.place_lon } : null
  const description = occasion.description?.trim() ?? ''
  const isHost = viewer.role === 'host'
  const hostName = displayName(occasion.host.display_name)

  return (
    <header className={cn('flex flex-col gap-5', (cover || motif) && 'occ-hero-covered')}>
      {cover ? (
        <HeroCover cover={cover} tone={tone} />
      ) : motif ? (
        // the same box from the first frame (tinted, pulsing) until the motif's chunk is there
        <Suspense fallback={<HeroCover cover={{ state: 'loading', blob: null }} tone={tone} />}>
          <HeroMotif theme={motif} tone={tone} />
        </Suspense>
      ) : null}
      <div className="relative z-1 flex flex-col items-start gap-3" style={{ viewTransitionName: occasionTransitionName(occasion.id) }}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="glass-panel occ-cover-pill inline-flex h-8 items-center gap-1.5 rounded-full px-3 t-footnote font-semibold text-accent-text">
            <IconCalendar size={15} className="shrink-0" />
            {relativeDayLabel(occasion.starts_at, { timeZone: dayZone })}
          </p>
          {job ? <CoverJobPill job={job} /> : null}
        </div>
        <h1 className="t-display text-text hyphens-auto [overflow-wrap:anywhere]">{occasion.title}</h1>
      </div>
      {job && userId ? <CoverJobNotice job={job} userId={userId} occasionId={occasion.id} /> : null}

      <div className="relative">
        <div
          className="glass-panel occasion-hero relative z-1 flex flex-col gap-5 rounded-card p-5"
          style={{ '--hero-tint': `var(--tint-${tone})` } as CSSProperties}
        >
          <div className="flex items-center gap-4">
            {badge ? <DateBadge tone={tone} size="lg" month={badge.month} day={badge.day} weekday={badge.weekday} /> : null}
            <div className="min-w-0 flex-1">
              <p className="t-headline text-text">
                <time dateTime={occasion.starts_at}>{dateLine}</time>
              </p>
              <p className="mt-0.5 t-title-3 font-bold tabular-nums text-text">{timeLine}</p>
              {nextDayLine ? <p className="t-footnote text-text-2">{nextDayLine}</p> : null}
              {zoneHint ? <p className="mt-1 t-footnote text-text-2">{zoneHint}</p> : null}
            </div>
          </div>
          {/* Felix 27.10 (brief §7.4): the occasion into the own calendar — a file made on the device, or Google */}
          <AddToCalendarButton occasion={occasion} />
          {place !== '' ? <PlaceBlock place={place} point={point} /> : null}
          {description !== '' ? (
            <p className="t-body text-text whitespace-pre-line [overflow-wrap:anywhere]">{description}</p>
          ) : null}
          <div className="flex items-center gap-3 border-t border-separator pt-4">
            <Avatar name={hostName} seed={occasion.host.id} size={40}>
              <AvatarPhoto profileId={occasion.host.id} meta={occasion.host.photo} eager />
            </Avatar>
            <p className="t-subhead text-text-2">{isHost ? t('occasion.you_host') : t('occasion.host_label', { name: hostName })}</p>
          </div>
        </div>
      </div>
    </header>
  )
}

/** "Freitag, 23. Oktober" / "Пятница, 23 октября" in the UI language, in the zone the occasion's day is shown in. */
function formatDay(iso: string, timeZone: string): string {
  try {
    const text = new Intl.DateTimeFormat(currentLanguage(), { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
    // Russian starts lower case ("пятница"); the line stands on its own, so it starts with a capital
    return text.charAt(0).toLocaleUpperCase() + text.slice(1)
  } catch {
    return ''
  }
}

/**
 * Free-text place + links to the map apps (Apple first on Apple devices). With a stored point (20261027190000, Felix
 * 27.10: «мини-карта, просто где точка») a small static map strip between them: our Worker's OpenStreetMap tiles as
 * blob: URLs, a pin on the place, the credit in its corner — nothing to pan or zoom (the buttons open a real map).
 * No point, offline, the Worker's map switch off or any tile error → exactly the block without a map.
 */
function PlaceBlock({ place, point }: { place: string; point: PlacePoint | null }) {
  const { t } = useTranslation('occasion')
  const online = useOnline()
  const apple = (
    <ButtonLink
      key="apple"
      variant="secondary"
      size="sm"
        className="min-h-11"
      href={appleMapsUrl(place)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('occasion.open_apple_maps')}
    >
      {t('occasion.maps_apple')}
    </ButtonLink>
  )
  const google = (
    <ButtonLink
      key="google"
      variant="secondary"
      size="sm"
        className="min-h-11"
      href={googleMapsUrl(place)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('occasion.open_google_maps')}
    >
      {t('occasion.maps_google')}
    </ButtonLink>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fill text-accent-text">
          <IconMapPin size={20} />
        </span>
        <p className="min-w-0 pt-0.5 t-body text-text [overflow-wrap:anywhere]">
          <span className="block t-footnote text-text-2">{t('occasion.place_label')}</span>
          {place}
        </p>
      </div>
      {point && online ? (
        // the wrapper disappears with the map when a tile is missing (MiniMap then renders nothing)
        <div className="pl-13 empty:hidden" data-place-map="">
          <Suspense fallback={<span aria-hidden="true" className="skeleton block w-full rounded-[18px]" style={{ height: MINI_MAP_STRIP_HEIGHT }} />}>
            <MiniMap key={`${point.lat},${point.lon}`} point={point} kind="other" variant="strip" credit={t('occasion.map_credit')} />
          </Suspense>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 pl-13">{isApplePlatform() ? [apple, google] : [google, apple]}</div>
    </div>
  )
}
