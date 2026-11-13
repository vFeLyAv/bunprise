import { useEffect, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '../../lib/app'
import { BrandMark, Button, LargeTitle, Page, Segmented, TopBar, fade, useReducedMotionPref, useSpring } from '../../ui'
import { GlyphCalendar, GlyphListView } from '../nav/glyphs'
import type { StartView } from './session'

/**
 * The brand mark in the bar (the app icon + the name), the same sign as on the start screen. The name never
 * truncates (TopBar: the sides keep their width, the title gives way) — on a 320 px phone the room kept for the
 * Russian bar title "Главная" would otherwise cut it to "Bunpr…".
 */
function Brand() {
  const { t } = useTranslation()
  return <BrandMark name={t('common.app_name')} className="pl-2 [&>span:last-child]:min-w-max" />
}

/** Loads the month view's chunk early (idle, or a finger / pointer on the switch): the first "Monat" is instant. */
export function preloadMonthView(): void {
  void import('../calendar/MonthView').catch(() => undefined)
}

/** "Liste | Monat" (wave 2): the kit's segmented control, an icon and a word in each half. */
function ViewSwitch({ view, onChange }: { view: StartView; onChange?: (view: StartView) => void }) {
  const { t } = useTranslation('feed')
  return (
    <div className="shrink-0" onPointerEnter={preloadMonthView} onPointerDown={preloadMonthView} onFocus={preloadMonthView}>
      <Segmented<StartView>
        label={t('feed.view_label')}
        value={view}
        disabled={!onChange}
        // below 352 px the icons step aside: the title ("Home" in English) keeps its room next to the switch
        // 12.5rem: Russian "Список" next to its icon needs 55 px of a half
        className="w-[12.5rem] max-[22rem]:w-[9.5rem] max-[22rem]:[&_[role=radio]>span:first-child]:hidden"
        options={[
          { value: 'list', label: t('feed.view_list'), icon: <GlyphListView /> },
          { value: 'month', label: t('feed.view_month'), icon: <GlyphCalendar /> },
        ]}
        onChange={(next) => onChange?.(next)}
      />
    </div>
  )
}

/** "Heute" in the bar (month view): a glass pill that appears once the view left today's month or a day is chosen. */
export function TodayPill({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const { t } = useTranslation('nav')
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <m.div
          key="today"
          // the pill is the only glass here: calendar.css clears the top bar's capsule around it (no double edge)
          data-today-pill=""
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7, transition: fade }}
          transition={{ ...bouncy, opacity: fade }}
        >
          <Button variant="glass" size="sm" onClick={onPress}>
            {t('cal.today')}
          </Button>
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

export interface FeedFrameProps {
  children: ReactNode
  /** Start's view and its switch in the header (wave 2); without `onViewChange` the switch waits (disabled) */
  view?: StartView
  onViewChange?: (view: StartView) => void
  /** the top bar's right side ("Heute" in the month view) */
  right?: ReactNode
}

/**
 * Screen frame of Start /soon (pilot-decisions §6; wave 1, §00.1; wave 2): glass top bar with the app mark + name
 * on the left, the large title "Bald" with the "Liste | Monat" switch on its right. The floating tab bar of
 * features/nav sits below — its centre "+" creates, its Profil tab is the way to the settings.
 * Also used by the route's pending skeleton, which can render before the `feed` namespace arrived — then only
 * language-independent parts show.
 */
export function FeedFrame({ children, view, onViewChange, right }: FeedFrameProps) {
  const { t, ready } = useTranslation('feed')
  const title = ready ? t('feed.title') : ''
  useEffect(() => {
    if (title) document.title = `${title} · ${APP_NAME}`
  }, [title])
  return (
    <Page className="flex flex-col" topBar={<TopBar large title={title} left={<Brand />} right={right} />}>
      {/* flex-auto: the column fills the screen */}
      <div className="flex flex-auto flex-col pt-4">
        {/* the title and the switch share one row (the same 8 px above both, so they centre on each other);
            the row keeps the switch's height while the strings load (no shift) */}
        <div className="mb-7 flex min-h-[3.25rem] items-center justify-between gap-3">
          <LargeTitle className="mb-0 min-w-0">
            {ready ? title : <span aria-hidden="true" className="skeleton inline-block h-8 w-28 align-middle" />}
          </LargeTitle>
          {view && ready ? (
            <div className="mt-2 shrink-0">
              <ViewSwitch view={view} onChange={onViewChange} />
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </Page>
  )
}
