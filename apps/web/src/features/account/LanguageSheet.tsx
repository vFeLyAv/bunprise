import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type Language } from '../../lib/i18n'
import { IconCheck, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'

// Profil › Darstellung › Sprache (Felix 27.10: «сделай выбор языка списком — с множеством языков сетка чипов не
// подойдёт»): one row shows the current language by its own name; this sheet lists every language of the app, each
// by its own name (Deutsch · English · Русский · Українська, `lang` set for screen readers), a check mark on the
// current one. A tap picks it and closes the sheet; the profile page does the rest (its language() handler — the
// server profile keeps 'de' for RU / UK). Arrow keys only move the focus here (picking is a deliberate tap / Enter).
// A lazy chunk of the profile (like the banner and avatar sheets).

export interface LanguageSheetProps {
  open: boolean
  onClose: () => void
  current: Language
  /** a language change is running, or the account changed: nothing can be picked */
  disabled?: boolean
  /** offline: the note that a new language applies to this device only (settings.language_offline) */
  offline?: boolean
  onPick: (language: Language) => void
}

export default function LanguageSheet({ open, onClose, current, disabled = false, offline = false, onPick }: LanguageSheetProps) {
  const { t } = useTranslation('settings')
  const group = useRef<HTMLDivElement>(null)
  const selected = useRef<HTMLButtonElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (!step || !group.current) return
    const radios = Array.from(group.current.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    const index = radios.findIndex((radio) => radio === document.activeElement)
    const next = radios[(index + step + radios.length) % radios.length]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('settings.language')} closeLabel={t('common.close')} initialFocusRef={selected}>
      <div className="flex flex-col gap-3 pb-2">
        <div ref={group} role="radiogroup" aria-label={t('settings.language')} className="set-choices" onKeyDown={onKeyDown}>
          {LANGUAGES.map((lng) => {
            const on = lng === current
            return (
              <button key={lng} ref={on ? selected : undefined} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                lang={lng} disabled={disabled} className="set-choice" data-language={lng}
                onPointerDown={() => haptic('select')}
                onClick={() => {
                  if (!on) onPick(lng)
                  onClose()
                }}>
                <span className="min-w-0 flex-1 t-body">{t(`settings.lang_${lng}`)}</span>
                {on ? <IconCheck size={20} className="shrink-0 text-accent-text" /> : null}
              </button>
            )
          })}
        </div>
        {offline ? <p role="status" className="px-1 t-footnote text-text-2">{t('settings.language_offline')}</p> : null}
      </div>
    </Sheet>
  )
}
