/**
 * Settings → "Bewegung" (Felix's K9, 2026-10-20): a self-contained group of three rows in the grouped
 * settings look (a coloured rounded-square icon tile + label + control, like Telegram):
 *   - Animationen: Voll · Weniger · Aus (Segmented),
 *   - Kaninchen zeigen (Switch; all mascots — the bunnies and the hamster),
 *   - Nachts schlafen (Switch, default on; 23:00 – 07:00 the mascots sleep, a tap wakes them — 31.10;
 *     features/mascot-ui/nightSetting.ts, localStorage bunprise.nightSleep),
 *   - Schütteln · Erlauben (iPhone only, 31.10: the shake that makes Pompon dizzy needs the motion permission),
 *   - Bei wenig Akku sparen (Switch; with an honest hint where the browser has no Battery API).
 * It reads and writes the device's motion setting (src/motion/level.ts, localStorage bunprise.reduceMotion)
 * — the whole app follows at once. No props needed: the settings screen mounts it in its slot.
 * Strings: the lazy `motion` namespace (the settings route loads it; else on first render, until then the rows keep
 * their height). Mounted in the Profil tab it wears the settings groups' look (.set-caption / .set-group of
 * features/account/settings.css; the utility classes keep it right anywhere else).
 */
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconBattery, IconBunny, IconSparkle, IconTile, Segmented, Skeleton, Switch, cn } from '../ui'
import { setMotionPrefs, type MotionLevel } from './level'
import { useMotionState } from './useMotionLevel'
import { canVibrate, feedbackSettings } from '../lib/haptics'
import { GlyphMoon } from '../features/account/glyphs'

/**
 * «Nachts schlafen» (31.10) — owned by features/mascot-ui/nightSetting.ts; written here inline with the same key and
 * event (an import of that module from this route would add a chunk to the route's preload list in the first-screen
 * shell, bundle budget of /soon; nightSetting.test.ts checks both spellings).
 */
const NIGHT_SLEEP_KEY = 'bunprise.nightSleep'
const NIGHT_SLEEP_EVENT = 'bunprise-night-sleep'
function readNightSleep(): boolean {
  try {
    return window.localStorage.getItem(NIGHT_SLEEP_KEY) !== '0'
  } catch {
    return true
  }
}
function writeNightSleep(on: boolean): void {
  try {
    window.localStorage.setItem(NIGHT_SLEEP_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(NIGHT_SLEEP_EVENT))
}

/**
 * «Bewegung erlauben» (31.10, the shake of «Помпон в открытом списке»: the phone is shaken → Pompon gets dizzy): an
 * iPhone sends the phone's motion only after the person allowed it, asked from a tap (DeviceMotionEvent
 * .requestPermission). The row shows only where that API exists; the answer is the browser's (nothing stored here).
 * Inline, like the night switch above: no new module on this route (the first-screen preload list, see there).
 */
type MotionPermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> }
function motionPermissionApi(): MotionPermissionApi | null {
  const api = typeof DeviceMotionEvent === 'function' ? (DeviceMotionEvent as unknown as MotionPermissionApi) : null
  return api && typeof api.requestPermission === 'function' ? api : null
}

/** A hairline between the rows, inset past the icon tile (16 + 30 + 12 px). */
const ROW_RULE = "relative before:absolute before:left-14.5 before:right-0 before:top-0 before:h-px before:bg-separator before:content-['']"

export interface MotionSettingsSectionProps {
  className?: string
}

export function MotionSettingsSection({ className }: MotionSettingsSectionProps) {
  const { t, ready } = useTranslation('motion')
  const state = useMotionState()
  const titleId = useId()
  const { prefs, level, systemReduced, battery } = state
  const [feedbackOn, setFeedbackOn] = useState(() => feedbackSettings.haptics.get() && feedbackSettings.sounds.get())
  // «Nachts schlafen» (31.10): the mascots sleep 23:00 – 07:00; without mascots there is nothing to put to bed
  const [nightOn, setNightOn] = useState(readNightSleep)
  const bunniesOn = prefs.bunnies && prefs.level !== 'off'
  // «Bewegung erlauben» (31.10): only where the browser asks for it (the iPhone)
  const [motionApi] = useState(motionPermissionApi)
  const [motionAnswer, setMotionAnswer] = useState<'granted' | 'denied' | null>(null)
  function allowMotion() {
    void motionApi?.requestPermission?.().then((answer) => setMotionAnswer(answer === 'granted' ? 'granted' : 'denied'), () => setMotionAnswer('denied'))
  }

  if (!ready) {
    return (
      <section aria-busy="true" className={cn('flex flex-col gap-2', className)}>
        <span className="flex h-(--lh-footnote) items-center px-4">
          <Skeleton width={84} height={11} />
        </span>
        <div aria-hidden="true" className="glass-panel h-54 rounded-lg" />
      </section>
    )
  }

  const hint =
    prefs.level === 'off'
      ? t('motion.hint_off')
      : systemReduced && prefs.level === 'full'
        ? t('motion.system_reduced')
        : level === 'reduced' && prefs.level === 'full'
          ? t('motion.battery_active')
          : prefs.level === 'reduced'
            ? t('motion.hint_reduced')
            : t('motion.hint_full')

  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-2', className)}>
      <h2 id={titleId} className="set-caption px-4 t-footnote font-semibold uppercase tracking-wide text-text-2">
        {t('motion.title')}
      </h2>
      <div className="set-group glass-panel rounded-[22px]">
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="pt-0.5">
              <IconTile tone="lilac">
                <IconSparkle />
              </IconTile>
            </span>
            <div className="min-w-0 flex-1">
              <p className="t-body text-text">{t('motion.animations')}</p>
              <p role="status" className="t-footnote text-text-2">
                {hint}
              </p>
            </div>
          </div>
          <Segmented<MotionLevel>
            label={t('motion.level_label')}
            value={prefs.level}
            options={[
              { value: 'full', label: t('motion.level_full') },
              { value: 'reduced', label: t('motion.level_reduced') },
              { value: 'off', label: t('motion.level_off') },
            ]}
            onChange={(next) => setMotionPrefs({ level: next })}
          />
        </div>
        <div className={ROW_RULE}>
          <Switch
            className="px-4 py-3"
            leading={
              <IconTile tone="apricot">
                <IconBunny />
              </IconTile>
            }
            label={t('motion.bunnies')}
            description={prefs.level === 'off' ? t('motion.bunnies_off_hint') : t('motion.bunnies_hint')}
            checked={prefs.bunnies && prefs.level !== 'off'}
            disabled={prefs.level === 'off'}
            onChange={(next) => setMotionPrefs({ bunnies: next })}
          />
        </div>
        <div className={ROW_RULE}>
          <Switch
            className="px-4 py-3"
            leading={
              <IconTile tone="sky">
                <GlyphMoon />
              </IconTile>
            }
            label={t('motion.night')}
            description={t('motion.night_hint')}
            checked={nightOn && bunniesOn}
            disabled={!bunniesOn}
            onChange={(next) => {
              writeNightSleep(next)
              setNightOn(next)
            }}
          />
        </div>
        {motionApi ? (
          <div className={ROW_RULE} data-motion-permission="">
            <div className="flex items-center gap-3 px-4 py-3">
              <IconTile tone="apricot">
                <IconSparkle />
              </IconTile>
              <div className="min-w-0 flex-1">
                <p className="t-body text-text">{t('motion.shake')}</p>
                <p role="status" className="t-footnote text-text-2">
                  {motionAnswer === 'denied' ? t('motion.shake_denied') : t('motion.shake_hint')}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={!bunniesOn || motionAnswer === 'granted'} onClick={allowMotion}>
                {motionAnswer === 'granted' ? t('motion.shake_allowed') : t('motion.shake_allow')}
              </Button>
            </div>
          </div>
        ) : null}
        <div className={ROW_RULE}>
          <Switch
            className="px-4 py-3"
            leading={
              <IconTile tone="sage">
                <IconBattery />
              </IconTile>
            }
            label={t('motion.battery')}
            description={battery.supported ? t('motion.battery_hint') : t('motion.battery_unsupported')}
            checked={prefs.batterySaver}
            onChange={(next) => setMotionPrefs({ batterySaver: next })}
          />
        </div>
        <div className={ROW_RULE}>
          <Switch
            className="px-4 py-3"
            leading={<IconTile tone="lilac"><IconSparkle /></IconTile>}
            label={t('motion.feedback')}
            description={canVibrate() ? t('motion.feedback_hint') : t('motion.feedback_no_vibration')}
            checked={feedbackOn}
            onChange={(next) => {
              feedbackSettings.haptics.set(next)
              feedbackSettings.sounds.set(next)
              setFeedbackOn(next)
            }}
          />
        </div>
      </div>
      <p className="px-4 t-footnote text-text-2">{t('motion.device_only')}</p>
    </section>
  )
}
