import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconTile, cn } from '../../../ui'
import { IconChevron, IconSparkle, IconUndo } from '../form/icons'
import { RowButton } from '../form/parts'
import { COVER_ASPECT_RATIO } from '../photo/coverGeometry'
import { pickerOrder, type CoverView } from './choice'
import { CoverArt } from './CoverArt'
import { THEME_IDS, type ThemeId } from './themes'
import './picker.css'

// The motif part of the form's "Titelfoto" group (form/PhotoField.tsx; docs/design/2026-10-26-occasion-covers.md,
// "Выбор в форме"), shown while the occasion has no photo — a photo always wins:
//   - a motif (automatic or picked): the preview as the hero will cut it, a chip "Automatisch" / "Motiv",
//     "Eigenes Foto" and "Entfernen" on it, the line "Motiv: Geburtstag — Passt zum Titel – du kannst es ändern."
//     and the strip of motifs ("Kein Motiv", the title's motif first, then the rest);
//   - nothing found: the photo row as before + "Motiv wählen — Ein Bild von uns statt Foto" (opens the strip);
//   - switched off: "Kein Titelbild — Das automatische Motiv ist aus." + "Rückgängig", the photo row, the strip.
// The host sees exactly what guests will see — before saving.

const FRAME_STYLE = { '--of-photo-ratio': COVER_ASPECT_RATIO } as CSSProperties

export interface CoverMotifProps {
  view: CoverView
  /** "Motiv wählen" opened the strip (nothing found, nothing chosen yet) */
  browsing: boolean
  onBrowse: () => void
  /** a tap in the strip or "Entfernen" (null = "Kein Motiv") */
  onPick: (choice: ThemeId | null) => void
  /** "Rückgängig" after "Kein Motiv": automatic again */
  onAuto: () => void
  /** "Eigenes Foto" / the photo row: opens the system picker */
  onPhoto: () => void
  /** the photo row ("Foto hinzufügen") of PhotoField */
  photoRow: ReactNode
}

function MotifTile() {
  return (
    <IconTile tone="apricot">
      <IconSparkle size={18} />
    </IconTile>
  )
}

export function CoverMotif({ view, browsing, onBrowse, onPick, onAuto, onPhoto, photoRow }: CoverMotifProps) {
  const { t } = useTranslation('occasionForm')
  let top: ReactNode
  if (view.theme !== null) {
    const auto = view.mode === 'auto'
    top = (
      <>
        <div className="of-photo-frame of-cover-frame" style={FRAME_STYLE}>
          <CoverArt theme={view.theme} className="cv-fill" />
          <span className="of-cover-chip">
            <IconSparkle size={14} />
            {auto ? t('occasionForm.cover_auto') : t('occasionForm.cover_manual')}
          </span>
          <div className="of-photo-actions">
            <Button size="sm" variant="glass" onClick={onPhoto}>
              {t('occasionForm.cover_own_photo')}
            </Button>
            <Button size="sm" variant="glass" onClick={() => onPick(null)}>
              {t('occasionForm.photo_remove')}
            </Button>
          </div>
        </div>
        <div className="of-photo-caption" aria-live="polite">
          <MotifTile />
          <span className="of-row-text">
            <span className="of-row-label">{t('occasionForm.cover_label', { name: t(`occasionForm.cover_${view.theme}`) })}</span>{' '}
            <span className="of-row-sub">{auto ? t('occasionForm.cover_auto_hint') : t('occasionForm.cover_manual_hint')}</span>
          </span>
        </div>
      </>
    )
  } else if (view.mode === 'off') {
    top = (
      <>
        {view.suggestion ? (
          <div className="of-row of-row-static of-cover-off" aria-live="polite">
            <MotifTile />
            <span className="of-row-text">
              <span className="of-row-label">{t('occasionForm.cover_off')}</span>{' '}
              <span className="of-row-sub">{t('occasionForm.cover_off_hint')}</span>
            </span>
            <Button size="sm" variant="ghost" icon={<IconUndo size={16} />} onClick={onAuto}>
              {t('occasionForm.photo_undo')}
            </Button>
          </div>
        ) : null}
        <div className={cn(view.suggestion && 'of-cover-sep')}>{photoRow}</div>
      </>
    )
  } else {
    top = photoRow
  }
  // the strip stays the same element across the states (a keyboard choice keeps its focus)
  const strip = view.theme !== null || view.mode === 'off' || browsing
  return (
    <div className="of-cover" data-mode={view.mode} data-theme={view.theme ?? undefined}>
      {top}
      {strip ? (
        <CoverStrip selected={view.mode === 'off' ? null : view.theme} suggestion={view.suggestion} onPick={onPick} focusOnMount={browsing && view.theme === null && view.mode !== 'off'} />
      ) : (
        <div className="of-cover-sep">
          <RowButton
            className="of-row-cta"
            tile={<MotifTile />}
            label={t('occasionForm.cover_choose')}
            sub={t('occasionForm.cover_choose_hint')}
            trailing={<IconChevron size={18} className="of-row-chevron" />}
            onClick={onBrowse}
          />
        </div>
      )}
    </div>
  )
}

/** The strip of motifs: a radio group, "Kein Motiv" first, the title's motif next. Arrow keys move the choice. */
export function CoverStrip({ selected, suggestion, onPick, focusOnMount = false }: {
  selected: ThemeId | null
  suggestion: ThemeId | null
  onPick: (choice: ThemeId | null) => void
  /** opened by "Motiv wählen": the focus moves into the strip (the row that opened it is gone) */
  focusOnMount?: boolean
}) {
  const { t } = useTranslation('occasionForm')
  const options: (ThemeId | null)[] = [null, ...pickerOrder(THEME_IDS, suggestion)]
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(0, options.indexOf(selected))
  const focusFirst = useRef(focusOnMount)

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    if (next < 0) return
    event.preventDefault()
    refs.current[next]?.focus()
    onPick(options[next] ?? null)
  }

  return (
    <div className="of-cover-strip-wrap">
      <div className="of-cover-strip-head">
        <span className="of-cover-strip-title">{t('occasionForm.cover_strip')}</span>
        <span>{suggestion ? t('occasionForm.cover_strip_first') : t('occasionForm.cover_strip_instead')}</span>
      </div>
      <div role="radiogroup" aria-label={t('occasionForm.cover_strip')} className="of-cover-strip">
        {options.map((option, index) => {
          const checked = option === selected
          const label = option === null ? t('occasionForm.cover_none') : t(`occasionForm.cover_${option}`)
          return (
            <button
              key={option ?? 'none'}
              ref={(element) => {
                refs.current[index] = element
                if (element && focusFirst.current && index === current) {
                  focusFirst.current = false
                  element.focus()
                }
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === current ? 0 : -1}
              className="of-cover-opt"
              data-cover={option ?? 'none'}
              onClick={() => {
                if (!checked) onPick(option)
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className={cn('of-cover-sq', option === null && 'of-cover-sq-none')}>
                {option === null ? <NoneGlyph /> : <CoverArt theme={option} crop="thumb" className="cv-fill" />}
                {checked ? (
                  <span className="of-cover-tick" aria-hidden="true">
                    <TickGlyph />
                  </span>
                ) : null}
              </span>
              <span className="of-cover-opt-label">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NoneGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 17.5l11-11" />
    </svg>
  )
}

function TickGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}
