import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconCheck, IconX } from '../../../ui'
import { IconSearch } from '../icons'
import { Sheet } from '../../../ui/Sheet'
import { FILTER_CHOICES, type FilterKind, type TopicFilters } from './filters'

// The filter pills of a topic screen and the small sheet behind each (design 26.10 §2: "в приложении — маленький
// лист с вариантами"): Spieler · Dauer · Preis for board games, Preis for any other shelf. A pill shows its choice
// ("Zu zweit") and is tinted while it filters. Choosing closes the sheet; nothing leaves the device.

const KINDS_GAMES: readonly FilterKind[] = ['players', 'time', 'price']
const KINDS_OTHER: readonly FilterKind[] = ['price']

export function FilterPills({ filters, games, onOpen }: { filters: TopicFilters; games: boolean; onOpen: (kind: FilterKind) => void }) {
  const { t } = useTranslation('gifts')
  return (
    <div className="topic-filters" role="group" aria-label={t('topics.filters_label')}>
      {(games ? KINDS_GAMES : KINDS_OTHER).map((kind) => {
        const value = filters[kind]
        const on = value !== 'all'
        const kindLabel = t(`topics.filter.${kind}`)
        const label = on ? t(`topics.choice.${kind}.${value}`) : kindLabel
        return (
          <button
            key={kind}
            type="button"
            className="topic-filter"
            data-on={on ? '' : undefined}
            data-filter={kind}
            aria-haspopup="dialog"
            aria-label={on ? `${kindLabel}: ${label}` : kindLabel}
            onClick={() => onOpen(kind)}
          >
            {label}
            <span className="topic-filter-chev" aria-hidden="true">
              ▾
            </span>
          </button>
        )
      })}
    </div>
  )
}

export interface FilterSheetProps {
  kind: FilterKind | null
  filters: TopicFilters
  onChoose: (next: TopicFilters) => void
  /** null while nothing filters */
  onReset: (() => void) | null
  onClose: () => void
}

export function FilterSheet({ kind, filters, onChoose, onReset, onClose }: FilterSheetProps) {
  const { t } = useTranslation('gifts')
  const shown = kind ?? 'players'
  const choices: readonly string[] = FILTER_CHOICES[shown]
  return (
    <Sheet
      open={kind !== null}
      onClose={onClose}
      title={t(`topics.filter_title.${shown}`)}
      closeLabel={t('common.close')}
      footer={
        onReset ? (
          <Button
            variant="ghost"
            size="md"
            fullWidth
            onClick={() => {
              onReset()
              onClose()
            }}
          >
            {t('topics.filter_reset')}
          </Button>
        ) : undefined
      }
    >
      <div role="radiogroup" aria-label={t(`topics.filter.${shown}`)} className="flex flex-col overflow-hidden rounded-lg glass-panel">
        {choices.map((choice) => {
          const on = filters[shown] === choice
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={on}
              className="flex min-h-12 items-center justify-between gap-3 px-4 text-left t-body text-text tr-colors active:bg-fill [&+&]:border-t [&+&]:border-(--separator)"
              onClick={() => onChoose({ ...filters, [shown]: choice })}
            >
              <span className={on ? 'font-semibold text-accent-text' : undefined}>{t(`topics.choice.${shown}.${choice}`)}</span>
              {on ? <IconCheck size={20} className="text-accent-text" /> : null}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

/** The small magnifier right of the pills (≥ 44 px to hit): opens the search row below. */
export function SearchButton({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="topic-search-btn" aria-label={label} aria-expanded={open} aria-controls="topic-search" data-on={open ? '' : undefined} onClick={onToggle}>
      <IconSearch size={20} />
    </button>
  )
}

export interface SearchFieldProps {
  query: string
  onQuery: (query: string) => void
  onClose: () => void
  label: string
  placeholder: string
}

/** The search row: a labelled field (focus on open), "×" clears it, Esc or "Abbrechen" closes it. */
export function SearchField({ query, onQuery, onClose, label, placeholder }: SearchFieldProps) {
  const { t } = useTranslation('gifts')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div id="topic-search" role="search" className="topic-search">
      <label className="topic-search-field">
        <span className="sr-only">{label}</span>
        <IconSearch size={18} className="shrink-0 text-text-3" />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            onClose()
          }}
        />
        {query ? (
          <button
            type="button"
            className="topic-search-clear"
            aria-label={t('topics.search_clear')}
            onClick={() => {
              onQuery('')
              input.current?.focus()
            }}
          >
            <IconX size={14} strokeWidth={2.6} />
          </button>
        ) : null}
      </label>
      <button type="button" className="topic-search-cancel" onClick={onClose}>
        {t('common.cancel')}
      </button>
    </div>
  )
}
