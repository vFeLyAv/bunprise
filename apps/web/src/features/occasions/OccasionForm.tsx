import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { LIMITS } from '../../lib/app'
import { contentLocale, currentLanguage } from '../../lib/i18n'
import { browserTimeZone, dayKey } from '../../lib/time'
import { Button, fade, type TileTone } from '../../ui'
import { useOnline } from '../auth/shared'
import {
  DEFAULT_TIME,
  charCount,
  earliestDate,
  hasErrors,
  validateOccasion,
  type OccasionField,
  type OccasionFieldError,
  type OccasionFormValues,
} from './form'
import { AllDayRow, NotesField, TitleInput } from './form/controls'
import { DateField } from './form/DateField'
import { EndTimeField } from './form/EndTimeField'
import { endsOnNextDay } from '../../lib/occasionTime'
import { hourCycleOf, intlLocale } from './form/dateFormat'
import { IconInfo } from './form/icons'
import { useCalmMotion } from './form/motion'
import { FieldMessage, FormBlock, FormLayoutKey, FrostGroup } from './form/parts'
import { PlaceField } from './form/PlaceField'
import { PhotoField, photoLayoutKey, type PhotoChoice } from './form/PhotoField'
import { AUTO_PICK, coverLayoutKey, coverView, pickFor, type CoverPick } from './covers/choice'
import { useCoverDetect } from './covers/useCoverDetect'
import { SectionsField } from './form/SectionsField'
import { TimeField } from './form/TimeField'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import type { OccasionPhotoMeta, OccasionSections } from '../../lib/api/types'

// S6 form, shared by "new" and "edit" (wave 1 redesign, K1/K3/K4): a big borderless title, then
// frosted groups — when (Datum · Ganztägig · Uhrzeit), where (Ort), what (Beschreibung) — and the save
// button. Our own date and time pickers unfold inside their group (transform-based layout animation);
// the place opens a sheet with suggestions. The VALUES are exactly the old ones ({ title, date "YYYY-MM-DD",
// time "HH:mm", allDay, place, description }) and go through the same validateOccasion / toOccasionInput,
// so starts_at + tz + all_day are produced exactly as before; + end (Felix 26.10): the optional "Ende" row under
// "Uhrzeit" (form/EndTimeField.tsx) — ends_at, an earlier time meaning the next day.
// Errors appear inline after the first save attempt and then update while typing; the first invalid
// field gets the focus (a date or time error also unfolds its picker). No silent truncation: counters
// show the database limits.

export interface OccasionFormProps {
  initial: OccasionFormValues
  /** IANA zone the wall time is entered in (browser zone when new, the occasion's own when editing) */
  timeZone: string
  /** edit: the stored date — it may stay in the past */
  originalDate?: string
  onSubmit: (values: OccasionFormValues) => void
  /** Saving: the button shows its loading state and further submits are ignored (fields stay as they are). */
  busy?: boolean
  /** Shown above the fields (e.g. "not saved" after a failed attempt). */
  notice?: ReactNode
  /** Under the save button (edit: delete). */
  children?: ReactNode
  /** The signed-in account: place suggestions are asked for it, recent places are its own. */
  userId: string
  /** The occasion's colour (tileTone of its id): the date page and the wash of the 'when' group. */
  tone: TileTone
  /** The cover photo row (wave 2): the page keeps the choice and sends it once the occasion is saved. */
  photo?: OccasionFormPhoto
  /** Every change of the values (the page asks "Änderungen verwerfen?" before leaving with unsaved input). */
  onValuesChange?: (values: OccasionFormValues) => void
  /** "Was gibt's?" (the bring-along list, features/potluck): only while it is released; the page keeps the choice. */
  sections?: OccasionFormSections
  /**
   * New occasions only (Felix 26.10, extras/QuickExtras.tsx): wishes and bring-along entries added right here,
   * shown under "Was gibt's?"; `layoutKey` changes whenever its rows come or go (the blocks below glide along).
   */
  extras?: { node: ReactNode; layoutKey: string }
}

export interface OccasionFormSections {
  value: OccasionSections
  onChange: (next: OccasionSections) => void
  /** the occasion's list holds wishes: "Mitbringen" alone is not offered */
  bringLocked?: boolean
}

export interface OccasionFormPhoto {
  value: PhotoChoice
  onChange: (next: PhotoChoice) => void
  /** the occasion (edit) or the client id of the new one */
  occasionId: string
  /** the stored cover's meta (edit), null without one */
  stored: OccasionPhotoMeta | null
  /**
   * The motif shown without a photo (Felix 26.10, features/occasions/covers; behind VITE_COVERS and only when the
   * server knows occasions.cover_theme): the page keeps the pick and stores it with the occasion.
   */
  cover?: { pick: CoverPick; onChange: (next: CoverPick) => void }
}

type Panel = 'date' | 'time' | 'end' | null

/** px by which the bunny's host reaches below the date group's top edge (its paws rest there). */
const BUNNY_EDGE_PX = 14
/** A picked day can trigger the response at most this often. */
const BUNNY_AGAIN_MS = 10_000

const LIMIT_OF: Partial<Record<OccasionField, number>> = {
  title: LIMITS.occasionTitle,
  place: LIMITS.placeText,
  description: LIMITS.occasionDescription,
}

export function OccasionForm({ initial, timeZone, originalDate, onSubmit, busy = false, notice, children, userId, tone, photo, onValuesChange, sections, extras }: OccasionFormProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  // dates and times in the UI language; place suggestions exist in DE + EN only (a Russian or Ukrainian UI gets German names)
  const language = currentLanguage()
  const lang = contentLocale(language)
  const locale = useMemo(() => intlLocale(language), [language])
  const cycle = useMemo(() => hourCycleOf(locale), [locale])
  const calm = useCalmMotion()
  const online = useOnline()
  const base = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const whenRef = useRef<HTMLDivElement>(null)
  // A date selection can bring the bunny out once the picker has closed, never on form entry.
  const [bunnyShow, setBunnyShow] = useState(0)
  const lastBunnyShow = useRef(-Infinity)
  const bunnyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (originalDate === undefined) formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    return () => { if (bunnyTimer.current) clearTimeout(bunnyTimer.current) }
  }, [originalDate])
  const [values, setValues] = useState(initial)
  const valuesListener = useRef(onValuesChange)
  useEffect(() => {
    valuesListener.current = onValuesChange
  })
  useEffect(() => {
    valuesListener.current?.(values)
  }, [values])
  const [submitted, setSubmitted] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [panel, setPanel] = useState<Panel>(null)
  const [earliest] = useState(() => earliestDate(timeZone))
  const [today] = useState(() => dayKey(new Date(), timeZone))
  // a picked photo is being prepared on the device: saving waits for it
  const [photoBusy, setPhotoBusy] = useState(false)
  const onPhotoBusy = useCallback((next: boolean) => setPhotoBusy(next), [])
  // the motif (covers/): the title's motif is detected on the device (a lazy chunk), shown before saving
  const coverChoice = photo?.cover
  const detectCover = useCoverDetect(coverChoice !== undefined)
  const cover = coverChoice ? coverView(coverChoice.pick, detectCover, values.title, values.date) : null
  const [coverBrowsing, setCoverBrowsing] = useState(false)
  const errors = submitted ? validateOccasion(values, { timeZone, originalDate }) : {}
  const minDate = originalDate !== undefined && originalDate < earliest ? originalDate : earliest
  const id = (field: string) => `${base}-${field}`

  // Focus the first invalid field after a failed attempt (screen readers hear its error).
  useEffect(() => {
    if (attempts === 0) return
    formRef.current?.querySelector<HTMLElement>('[data-invalid="true"]')?.focus()
  }, [attempts])

  function update<K extends keyof OccasionFormValues>(key: K, value: OccasionFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function message(field: OccasionField, error: OccasionFieldError | undefined): string | undefined {
    if (!error) return undefined
    return t(`occasion.${error}`, { max: LIMIT_OF[field] })
  }

  /** "29/80" once the field has content (red above the limit). */
  function counter(field: 'title' | 'description'): ReactNode {
    const limit = LIMIT_OF[field] as number
    const count = charCount((field === 'title' ? values.title : values.description).trim())
    if (count === 0) return undefined
    return (
      <span className="of-counter" data-over={count > limit ? '' : undefined}>
        {t('occasion.char_count', { count, max: limit })}
      </span>
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !online || photoBusy) return
    setSubmitted(true)
    const found = validateOccasion(values, { timeZone, originalDate })
    if (hasErrors(found)) {
      // the first invalid field opens its picker, so the fix is one tap away
      if (!found.title && found.date) setPanel('date')
      else if (!found.title && !found.date && found.time) setPanel('time')
      else if (!found.title && !found.date && !found.time && found.end) setPanel('end')
      setAttempts((n) => n + 1)
      return
    }
    onSubmit(values)
  }

  const togglePanel = (which: Exclude<Panel, null>) => (open: boolean) => setPanel(open ? which : null)
  const tzHint = timeZone !== browserTimeZone() ? t('occasion.tz_hint', { tz: timeZone }) : undefined
  const titleError = message('title', errors.title)
  const dateError = message('date', errors.date)
  const timeError = message('time', errors.time)
  const endError = message('end', errors.end)
  const placeError = message('place', errors.place)
  const descriptionError = message('description', errors.description)
  // the layout animations follow only these changes (form/parts.tsx FormLayoutKey)
  const layoutKey = [
    panel ?? '-',
    values.allDay ? 'all-day' : 'timed',
    // the end row's second line ("am nächsten Tag") comes and goes with the end time
    values.end ? (endsOnNextDay(values.time, values.end) ? 'end-next-day' : 'end') : '',
    Object.keys(errors).join(','),
    values.title.trim() ? 'title' : '',
    values.place.trim() ? 'place' : '',
    values.description.trim() ? 'notes' : '',
    online ? 'online' : 'offline',
    notice ? 'notice' : '',
    photo ? photoLayoutKey(photo.value, photo.stored, photoBusy) : '',
    coverChoice ? coverLayoutKey(cover, coverBrowsing) : '',
    sections ? sections.value : '',
    extras ? extras.layoutKey : '',
  ].join('|')

  return (
    <form ref={formRef} noValidate className="of-form" onSubmit={submit}>
      <FormLayoutKey.Provider value={layoutKey}>
        <LayoutGroup id={base}>
          {notice ? <FormBlock>{notice}</FormBlock> : null}

          <FormBlock className="of-title-block">
            <TitleInput
              id={id('title')}
              label={t('occasion.title_label')}
              placeholder={t('occasionForm.title_placeholder')}
              value={values.title}
              onChange={(title) => update('title', title)}
              onEnter={() => document.getElementById(id('date'))?.focus()}
              invalid={Boolean(titleError)}
              describedBy={titleError || values.title.trim() ? id('title-msg') : undefined}
            />
            <FieldMessage id={id('title-msg')} error={titleError} hint={counter('title')} />
          </FormBlock>

          <div className="of-when">
            {/* This is a response to choosing a date; the timer also checks that typing has not resumed. */}
            {calm || !bunnyShow ? null : <BunnyMoment key={bunnyShow} kind="pop-up" once="always" momentClass="response" calm="hide" onEnd={() => setBunnyShow(0)} cardRef={whenRef} edgeInset={BUNNY_EDGE_PX} minSize={92} maxSize={108} className="of-when-bunny" style={{ right: 80 }} />}
            <FrostGroup ref={whenRef} role="group" aria-label={t('occasionForm.group_when')} className="of-group-when" data-tone={tone}>
              <FormBlock className="of-item">
                <DateField
                  id={id('date')}
                  value={values.date}
                  onChange={(date) => {
                    update('date', date)
                    setPanel(null)
                    if (bunnyTimer.current) clearTimeout(bunnyTimer.current)
                    bunnyTimer.current = setTimeout(() => {
                      const typing = document.activeElement?.matches('input,textarea,[contenteditable="true"]')
                      const now = Date.now()
                      if (!calm && !typing && now - lastBunnyShow.current >= BUNNY_AGAIN_MS) {
                        lastBunnyShow.current = now
                        setBunnyShow(now)
                      }
                    }, 280)
                  }}
                  today={today}
                  min={minDate}
                  locale={locale}
                  tone={tone}
                  open={panel === 'date'}
                  onOpenChange={togglePanel('date')}
                  error={dateError}
                  errorId={id('when-msg')}
                />
              </FormBlock>
              <FormBlock className="of-item">
                <AllDayRow
                  label={t('occasion.all_day')}
                  checked={values.allDay}
                  onChange={(allDay) => {
                    setValues((current) => ({ ...current, allDay, time: current.time || DEFAULT_TIME }))
                    // switching the time on shows the wheel at once (19:00 is only a suggestion)
                    setPanel((current) => (allDay ? (current === 'time' ? null : current) : 'time'))
                  }}
                />
              </FormBlock>
              <AnimatePresence initial={false} mode="popLayout">
                {values.allDay ? null : (
                  <m.div
                    key="time"
                    className="of-item"
                    layout={calm ? false : 'position'}
                    layoutDependency={layoutKey}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={fade}
                  >
                    <TimeField
                      id={id('time')}
                      value={values.time}
                      onChange={(time) => update('time', time)}
                      locale={locale}
                      cycle={cycle}
                      open={panel === 'time'}
                      onOpenChange={togglePanel('time')}
                      error={timeError}
                      errorId={id('when-msg')}
                    />
                  </m.div>
                )}
                {/* the end time (20261026180000): not for all-day, and not when the server did not tell us the stored end */}
                {values.allDay || values.end === null ? null : (
                  <m.div
                    key="end"
                    className="of-item"
                    layout={calm ? false : 'position'}
                    layoutDependency={layoutKey}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={fade}
                  >
                    <EndTimeField
                      id={id('end')}
                      start={values.time}
                      value={values.end}
                      onChange={(end) => update('end', end)}
                      locale={locale}
                      cycle={cycle}
                      open={panel === 'end'}
                      onOpenChange={togglePanel('end')}
                      error={endError}
                      errorId={id('when-msg')}
                    />
                  </m.div>
                )}
              </AnimatePresence>
            </FrostGroup>
          </div>
          <FormBlock>
            <FieldMessage id={id('when-msg')} error={dateError ?? timeError ?? endError} hint={values.allDay ? undefined : tzHint} />
          </FormBlock>

          <FrostGroup>
            <PlaceField
              id={id('place')}
              value={values.place}
              onChange={(place) => update('place', place)}
              point={values.point ?? null}
              onPoint={(point) => update('point', point)}
              userId={userId}
              lang={lang}
              invalid={Boolean(placeError)}
              describedBy={id('place-msg')}
            />
          </FrostGroup>
          <FormBlock>
            <FieldMessage id={id('place-msg')} error={placeError} hint={t('occasion.place_hint')} icon={<IconInfo size={16} />} />
          </FormBlock>

          <FrostGroup>
            <NotesField
              id={id('description')}
              label={t('occasion.description_label')}
              placeholder={t('occasion.description_placeholder')}
              value={values.description}
              onChange={(description) => update('description', description)}
              invalid={Boolean(descriptionError)}
              describedBy={descriptionError ? id('description-msg') : undefined}
              footer={
                // the counter's line is always there (empty before the first letter), so the group does not grow
                // — and its focus ring does not lag behind a layout animation — when typing starts (Felix 20.10)
                <div className="of-notes-footer" aria-hidden={counter('description') ? undefined : true}>
                  {counter('description') ?? ' '}
                </div>
              }
            />
          </FrostGroup>
          {descriptionError ? (
            <FormBlock>
              <FieldMessage id={id('description-msg')} error={descriptionError} />
            </FormBlock>
          ) : null}

          {sections ? (
            <SectionsField id={id('sections')} value={sections.value} onChange={sections.onChange} bringLocked={sections.bringLocked} />
          ) : null}

          {extras ? extras.node : null}

          {photo ? (
            <PhotoField
              id={id('photo')}
              value={photo.value}
              onChange={photo.onChange}
              occasionId={photo.occasionId}
              userId={userId}
              stored={photo.stored}
              onBusyChange={onPhotoBusy}
              cover={
                coverChoice
                  ? {
                      view: cover,
                      browsing: coverBrowsing,
                      onBrowse: () => setCoverBrowsing(true),
                      onPick: (choice) => {
                        if (cover) coverChoice.onChange(pickFor(choice, cover))
                      },
                      onAuto: () => coverChoice.onChange(AUTO_PICK),
                    }
                  : undefined
              }
            />
          ) : null}

          <FormBlock className="of-actions">
            {!online ? (
              <p role="status" className="of-offline">
                {t('errors.offline_action')}
              </p>
            ) : null}
            <Button type="submit" size="lg" fullWidth loading={busy} loadingLabel={t('occasion.saving')} disabled={!online || photoBusy}>
              {t('common.save')}
            </Button>
            {children}
          </FormBlock>
        </LayoutGroup>
      </FormLayoutKey.Provider>
    </form>
  )
}
