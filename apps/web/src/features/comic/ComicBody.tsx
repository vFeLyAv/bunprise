import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ComicView, EPISODES, type EpisodeNumber } from '@bunprise/mascot/comic'
import { markHintSeen } from '../../lib/hints'
import { currentLanguage } from '../../lib/i18n'
import { Button, Segmented, useReducedMotionPref } from '../../ui'
import { registerMascot, releaseStage, requestStage, unregisterMascot } from '../mascot-ui/stage'
// Pompon's look in the app (the fluffy cheeks, 31.10) — set before the comic builds its puppets, like every other
// mascot entry of the app; without it the cheeks would depend on whether some other mascot chunk ran first
import '../mascot-ui/pompon'
import { writeComicProgress, type ComicProgress } from './progress'

// The reader's inside (a lazy chunk of its own with @bunprise/mascot/comic — vite.config.ts group 'comic', never
// precached): the episode switch, the ribbon (the package's ComicView, scaled to the sheet's width), the way on at
// the end. The ribbon follows the sheet's own scroll: the roll down the slope IS the scroll, every panel comes alive
// once (transform / opacity only); under "Weniger" / "Aus" / a low battery (<html data-motion>) or the system's
// reduced motion it is one still picture. A hidden page pauses a running moment (the package does that).
// "Weiterlesen": the panel at the reading line is remembered (./progress.ts) — episode 1 read to its end leads on to
// episode 2, episode 2 read to its end forgets it. While the reader is open, the mascots under it stand still.

export interface ComicBodyProps {
  start: ComicProgress | null
  onClose: () => void
  /** the reader is there (the Start card goes away) */
  onLoaded: () => void
}

/** The sheet's scrolling content (ui/Sheet), or the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

export default function ComicBody({ start, onClose, onLoaded }: ComicBodyProps) {
  const { t } = useTranslation(['comic', 'common'])
  const lang = currentLanguage()
  const motion = !useReducedMotionPref()
  const [episode, setEpisode] = useState<EpisodeNumber>(start?.episode ?? 1)
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  /** the panel to begin at: "Weiterlesen", 0 after a switch, the current one when the ribbon is rebuilt */
  const resumeAt = useRef(start?.panel ?? 0)
  /** move the focus to the ribbon once it is built (an episode switch) */
  const focusRibbon = useRef(false)
  const firstBuild = useRef(true)
  const frameLabel = t('comic.frame', { episode: EPISODES[episode].folge[lang] })

  // the reader is there: the Start card is done for good on this device; the mascots under it stand still
  useEffect(() => {
    markHintSeen('story-1')
    onLoaded()
    const id = Symbol('comic-reader')
    const member = { busy: true, isDestroyed: false, stopIdle() {}, startIdle() {} }
    registerMascot(id, member, false)
    requestStage(id, 'work')
    return () => {
      member.busy = false
      member.isDestroyed = true
      releaseStage(id)
      unregisterMascot(id)
    }
  }, [onLoaded])

  useEffect(() => {
    const root = rootRef.current
    const host = hostRef.current
    if (!root || !host) return
    const scroller = scrollParent(root)
    let view: ComicView | null = null
    let resize: ResizeObserver | null = null
    let lastPanel = -1
    let ended = false
    const build = (): void => {
      const comic = new ComicView(host, { episode, lang, motion, label: frameLabel })
      view = comic
      const fit = (): void => comic.fit(host.clientWidth || root.clientWidth)
      fit()
      if (typeof ResizeObserver === 'function') {
        resize = new ResizeObserver(fit)
        resize.observe(host)
      }
      if (scroller) {
        const panel = resumeAt.current
        scroller.scrollTop = panel > 0 ? host.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + comic.panelTop(panel) : 0
      }
      if (focusRibbon.current) {
        focusRibbon.current = false
        host.focus({ preventScroll: true })
      }
      comic.drive(scroller ?? window, ({ share, panel, end }) => {
        if (barRef.current) barRef.current.style.transform = `scaleX(${share.toFixed(4)})`
        if (panel !== lastPanel) {
          lastPanel = panel
          resumeAt.current = panel
          if (!ended) writeComicProgress({ episode, panel })
        }
        if (end && !ended) {
          ended = true
          // episode 1 read: "Weiterlesen" leads on to episode 2; episode 2 read: nothing left to go on with
          writeComicProgress(episode === 1 ? { episode: 2, panel: 0 } : null)
          // an episode read to its end: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
          void import('../sammlung/note').then((m) => m.noteMilestone('comic'), () => undefined)
        }
      })
    }
    // the first ribbon waits until the sheet has slid in (building ~15 puppets would cost the slide its frames)
    const timer = window.setTimeout(build, firstBuild.current && motion ? 340 : 0)
    firstBuild.current = false
    return () => {
      window.clearTimeout(timer)
      resize?.disconnect()
      view?.destroy()
    }
  }, [episode, lang, motion, frameLabel])

  const go = (next: EpisodeNumber): void => {
    resumeAt.current = 0
    focusRibbon.current = true
    if (next !== episode) {
      setEpisode(next)
      return
    }
    focusRibbon.current = false
    const scroller = rootRef.current ? scrollParent(rootRef.current) : null
    scroller?.scrollTo({ top: 0 })
    hostRef.current?.focus({ preventScroll: true })
  }

  return (
    <div ref={rootRef} className="-mx-5 flex flex-col">
      {/* how far the episode is read: decoration (the switch and the ribbon say where you are) */}
      <div aria-hidden="true" className="sticky top-0 z-2 overflow-hidden bg-fill" style={{ height: 3 }}>
        <div ref={barRef} className="h-full bg-accent-500" style={{ transform: 'scaleX(0)', transformOrigin: '0 50%' }} />
      </div>
      <div className="px-5 pb-3 pt-2">
        <Segmented
          label={t('comic.episodes')}
          value={String(episode)}
          options={(Object.keys(EPISODES) as Array<`${EpisodeNumber}`>).map((n) => ({ value: n, label: t('comic.episode', { n }) }))}
          onChange={(value) => go(value === '2' ? 2 : 1)}
        />
      </div>
      {/* the ribbon (built by the package); it takes the focus after an episode switch */}
      <div ref={hostRef} tabIndex={-1} className="outline-none" style={{ minHeight: '70dvh', background: '#FFFFFF' }} />
      <footer className="flex flex-col items-center gap-3 px-5 pb-2 pt-6 text-center">
        {episode === 1 ? (
          <Button variant="primary" size="lg" fullWidth onClick={() => go(2)}>
            {t('comic.next')} <span aria-hidden="true">→</span>
          </Button>
        ) : (
          <>
            <p className="t-callout text-text-2">{t('comic.soon')}</p>
            <Button variant="primary" size="lg" fullWidth onClick={onClose}>{t('comic.done')}</Button>
          </>
        )}
        <Button variant="secondary" size="lg" fullWidth onClick={() => go(1)}>{t('comic.again')}</Button>
        <p className="t-footnote text-text-2 [text-wrap:balance]">{t('comic.find_again')}</p>
      </footer>
    </div>
  )
}
