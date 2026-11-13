import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import * as m from 'motion/react-m'
import { haptic, springs } from '../../../ui'
import { IconNotes, IconSun } from './icons'
import { useCalmMotion } from './motion'
import { RowIcon } from './parts'

// The plain controls of the occasion form: the big title, the all-day switch row, the description.

const supportsFieldSizing =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content')

/** Grows with its content where `field-sizing: content` is missing (Firefox, older Safari). */
function useAutoGrow(ref: { current: HTMLTextAreaElement | null }, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || supportsFieldSizing) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

export interface TitleInputProps {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  /** Enter (the title has one line of meaning, never a line break) */
  onEnter?: () => void
  invalid?: boolean
  describedBy?: string
}

/** The occasion's name in large type, borderless, wrapping instead of scrolling sideways. */
export function TitleInput({ id, label, placeholder, value, onChange, onEnter, invalid, describedBy }: TitleInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)
  return (
    <div className="of-title">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        rows={1}
        className="of-title-input"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="next"
        // titles are mostly names ("Milas Geburtstag"): no red squiggles under them
        spellCheck={false}
        aria-required="true"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        data-invalid={invalid ? 'true' : undefined}
        onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, ' '))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          onEnter?.()
        }}
      />
    </div>
  )
}

export interface AllDayRowProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** "Ganztägig" with a switch in the accent colour (its darker rim keeps the 3:1 of a control). */
export function AllDayRow({ label, checked, onChange }: AllDayRowProps) {
  const id = useId()
  const calm = useCalmMotion()
  return (
    <label className="of-row" htmlFor={id}>
      <RowIcon kind="allday">
        <IconSun size={18} />
      </RowIcon>
      <span className="of-row-text">
        <span id={`${id}-label`} className="of-row-label">
          {label}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        data-on={checked ? '' : undefined}
        className="of-switch"
        onClick={() => {
          haptic('select')
          onChange(!checked)
        }}
      >
        <m.span
          aria-hidden="true"
          className="of-switch-knob"
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={calm ? { duration: 0 } : springs.snappy}
        />
      </button>
    </label>
  )
}

export interface NotesFieldProps {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  footer?: ReactNode
}

/** "Beschreibung": label row with its icon, the text below over the whole width of the group. */
export function NotesField({ id, label, placeholder, value, onChange, invalid, describedBy, footer }: NotesFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)
  return (
    <div className="of-notes">
      <div className="of-row of-row-static">
        <RowIcon kind="notes">
          <IconNotes size={18} />
        </RowIcon>
        <label htmlFor={id} className="of-row-label">
          {label}
        </label>
      </div>
      <textarea
        ref={ref}
        id={id}
        rows={2}
        className="of-notes-input"
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        data-invalid={invalid ? 'true' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {footer}
    </div>
  )
}
