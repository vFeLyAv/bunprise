import { createContext, useContext, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react'
import * as m from 'motion/react-m'
import { cn, haptic, IconTile, springs, type IconTileTone } from '../../../ui'
import { useCalmMotion } from './motion'
// the form's own layout (rows, calendar, wheel, place sheet) ships with this chunk only
import './occasion-form.css'

// Building blocks of the occasion form ("warm glass on paper", wave 1): frosted groups (the kit's
// .glass-panel — no backdrop blur under scrolling content; over the ambient scene they read as glass),
// rows with the kit's small coloured icon tiles, a value pill and inline messages.

export type RowIconKind = 'date' | 'allday' | 'time' | 'end' | 'place' | 'notes' | 'photo' | 'danger'

const ROW_TONE: Record<Exclude<RowIconKind, 'danger'>, IconTileTone> = {
  date: 'apricot',
  allday: 'honey',
  time: 'sky',
  end: 'ink',
  place: 'rose',
  notes: 'sage',
  photo: 'lilac',
}

/** The row's 30 px icon: the kit's IconTile (Telegram-like settings tile), red for the delete row. */
export function RowIcon({ kind, children }: { kind: RowIconKind; children: ReactNode }) {
  if (kind === 'danger') {
    return (
      <span aria-hidden="true" className="of-tile-danger">
        {children}
      </span>
    )
  }
  return <IconTile tone={ROW_TONE[kind]}>{children}</IconTile>
}

const GROUP_RADIUS = 24

/**
 * What the form's layout animations follow: a key that changes only when a picker opens or closes, the
 * time row comes or goes, or a message appears. Everything else (typing, the calendar's month carousel,
 * the rolling day of the date leaf) reflows as usual — otherwise a sliding month that leaves the DOM
 * made the whole group "grow" for a moment.
 */
export const FormLayoutKey = createContext<string>('')

export function useFormLayoutKey(): string {
  return useContext(FormLayoutKey)
}

/**
 * A frosted group (.glass-panel). `layout`: its height change (a picker opens) animates with transforms
 * (FLIP, the radius is corrected); children that change place get `layout="position"` (FormBlock).
 */
export function FrostGroup({
  className,
  children,
  ref,
  ...rest
}: Omit<ComponentPropsWithoutRef<'div'>, 'style' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> & { ref?: Ref<HTMLDivElement> }) {
  const calm = useCalmMotion()
  const layoutKey = useFormLayoutKey()
  return (
    <m.div
      ref={ref}
      layout={!calm}
      layoutDependency={layoutKey}
      className={cn('glass-panel of-group', className)}
      style={{ borderRadius: GROUP_RADIUS }}
      {...rest}
    >
      {children}
    </m.div>
  )
}

/** Anything between or inside the groups that moves when a picker opens above it. */
export function FormBlock({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  const calm = useCalmMotion()
  const layoutKey = useFormLayoutKey()
  return (
    <m.div layout={calm ? false : 'position'} layoutDependency={layoutKey} id={id} className={className}>
      {children}
    </m.div>
  )
}

export interface RowButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style' | 'children'> {
  ref?: Ref<HTMLButtonElement>
  tile: ReactNode
  /** small line above the label (a filled place: "Ort" over the place itself) */
  caption?: ReactNode
  label: ReactNode
  /** small second line under the label */
  sub?: ReactNode
  /** right side: the value pill, a chevron … */
  trailing?: ReactNode
  invalid?: boolean
}

/** A pressable row: the pill on the right answers the finger (scale .95), the row tints. */
export function RowButton({ tile, caption, label, sub, trailing, invalid, className, onPointerDown, type = 'button', ...rest }: RowButtonProps) {
  const calm = useCalmMotion()
  return (
    <m.button
      type={type}
      className={cn('of-row of-row-press', className)}
      data-invalid={invalid ? 'true' : undefined}
      whileTap={calm ? undefined : 'pressed'}
      onPointerDown={(event) => {
        haptic('tap')
        onPointerDown?.(event)
      }}
      {...rest}
    >
      {tile}
      {/* the spaces keep the parts apart in the accessible name ("Ort Café am Markt"); a flex column
          does not render whitespace between its items */}
      <span className="of-row-text">
        {caption ? <span className="of-row-caption">{caption}</span> : null}{' '}
        <span className="of-row-label">{label}</span>{' '}
        {sub ? <span className="of-row-sub">{sub}</span> : null}
      </span>
      {trailing}
    </m.button>
  )
}

/** The value on the right of a row; `active` while its picker is open, `placeholder` while empty. */
export function ValuePill({ active, placeholder, invalid, children }: { active?: boolean; placeholder?: boolean; invalid?: boolean; children: ReactNode }) {
  return (
    <m.span
      className="of-pill"
      data-active={active ? '' : undefined}
      data-placeholder={placeholder ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      variants={{ pressed: { scale: 0.95 } }}
      transition={springs.snappy}
    >
      {children}
    </m.span>
  )
}

/** A hint or an error line under a group (an error replaces the hint). */
export function FieldMessage({ id, error, hint, icon }: { id?: string; error?: string; hint?: ReactNode; icon?: ReactNode }) {
  if (error) {
    return (
      <p id={id} className="of-message" data-error="">
        {error}
      </p>
    )
  }
  if (!hint) return null
  return (
    <p id={id} className="of-message">
      {icon ? <span className="of-message-icon">{icon}</span> : null}
      <span>{hint}</span>
    </p>
  )
}
