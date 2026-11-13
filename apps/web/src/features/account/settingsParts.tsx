import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { cn, haptic } from '../../ui'
import { GlyphChevronRight } from '../nav/glyphs'

// Grouped inset settings (K11, Telegram / iOS Settings): a caption, then one frosted panel (.glass-panel —
// no blur, it scrolls over the ambient scene) whose rows carry a small coloured rounded-square icon tile
// (ui/IconTile) · label · value · chevron, separated by hairlines that start at the label.
// Exported for every settings section, so a section built elsewhere (the motion settings) looks the same.

export function SettingsGroup({ title, footer, children, className }: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('flex flex-col gap-2', className)}>
      {title ? <h2 className="set-caption">{title}</h2> : null}
      <ul className="set-group glass-panel">{children}</ul>
      {footer ? <div className="px-4 t-footnote text-text-2">{footer}</div> : null}
    </section>
  )
}

type RowTarget = '/welcome/profile' | '/settings/export' | '/settings/delete' | '/settings/sammlung' | '/legal/impressum' | '/legal/datenschutz' | '/legal/nutzung'

interface RowBodyProps {
  icon?: ReactNode
  label: ReactNode
  /** secondary line under the label */
  hint?: ReactNode
  /** right side text (one line, truncated) */
  value?: ReactNode
  /** right side control (switch, segmented …) */
  control?: ReactNode
  chevron?: boolean
  danger?: boolean
}

function RowBody({ icon, label, hint, value, control, chevron, danger }: RowBodyProps) {
  return (
    <>
      {icon ? <span className="set-row-icon">{icon}</span> : null}
      <span className={cn('set-row-main', Boolean(control) && 'set-row-main-control')}>
        <span className="set-row-text">
          <span className={cn('block t-body', danger ? 'text-danger' : 'text-text')}>{label}</span>
          {hint ? <span className="mt-0.5 block t-footnote text-text-2">{hint}</span> : null}
        </span>
        {value !== undefined ? <span className="set-row-value">{value}</span> : null}
        {control ?? null}
        {chevron ? <GlyphChevronRight size={18} className="shrink-0 text-text-3" /> : null}
      </span>
    </>
  )
}

/** A row that opens another screen (a router link): the sub-pages open as pushed screens. */
export function SettingsLinkRow({ to, search, ...body }: RowBodyProps & { to: RowTarget; search?: { next?: string; from?: 'profile' } }) {
  return (
    <li className="set-item">
      <Link to={to} search={search} className="set-row set-row-press" onPointerDown={() => haptic('tap')}>
        <RowBody chevron {...body} />
      </Link>
    </li>
  )
}

/** A row that leaves the app (mailto:). */
export function SettingsAnchorRow({ href, ...body }: RowBodyProps & { href: string }) {
  return (
    <li className="set-item">
      <a href={href} className="set-row set-row-press" onPointerDown={() => haptic('tap')}>
        <RowBody chevron {...body} />
      </a>
    </li>
  )
}

/** A row without an action of its own (a value, or a control on the right). */
export function SettingsRow(body: RowBodyProps) {
  return (
    <li className="set-item">
      <div className="set-row">
        <RowBody {...body} />
      </div>
    </li>
  )
}

export function SettingsButtonRow({ onClick, disabled, ...body }: RowBodyProps & { onClick: () => void; disabled?: boolean }) {
  return <li className="set-item"><button type="button" className="set-row set-row-press w-full text-left" disabled={disabled} onClick={onClick}>
    <RowBody chevron {...body} />
  </button></li>
}

/** A whole-row control (a <label> around a switch): the row is the hit area. */
export function SettingsControlRow({ children }: { children: ReactNode }) {
  return <li className="set-item">{children}</li>
}
