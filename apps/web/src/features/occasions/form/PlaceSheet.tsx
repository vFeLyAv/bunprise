import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LIMITS } from '../../../lib/app'
import type { PlaceKind, PlacePoint, PlaceSuggestion } from '../../../lib/api/places'
import { haptic, IconButton, Skeleton } from '../../../ui'
import { Sheet } from '../../../ui/Sheet'
import { useOnline } from '../../auth/shared'
import {
  IconAddress,
  IconBar,
  IconCafe,
  IconCity,
  IconClose,
  IconCloudOff,
  IconInfo,
  IconPark,
  IconPin,
  IconQuote,
  IconRecent,
  IconRestaurant,
  IconSearch,
  IconVenue,
} from './icons'
import { recentPlaces } from './recentPlaces'
import { normaliseQuery, usePlaceSearch, type PlaceSearchState } from './usePlaceSearch'

// The place picker (K4): a glass sheet with a search field (focused on open), suggestions from our
// Worker (GET /api/places → OpenStreetMap, credited under the list as the ODbL requires), the person's
// own recent places from the query cache, and "„…“ übernehmen" for free text. Offline or on any error
// only the free text is offered, with a calm note. The L12 hint (a public place, not someone's private
// address) stays visible the whole time. No location access. A suggestion with a point hands it on with the text
// (onPick): the form then shows the small map (PlaceField → MiniMap); the point is never stored.

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

const KIND_ICON: Record<PlaceKind, (props: { size?: number }) => ReactNode> = {
  cafe: IconCafe,
  restaurant: IconRestaurant,
  bar: IconBar,
  park: IconPark,
  venue: IconVenue,
  address: IconAddress,
  city: IconCity,
  other: IconPin,
}

/** Where a picked suggestion is (only while the Worker sends points): for the form's small map, never stored. */
export interface PickedPlace {
  point: PlacePoint
  kind: PlaceKind
}

export interface PlaceSheetProps {
  open: boolean
  onClose: () => void
  /** the current place (the search starts from it) */
  initialQuery: string
  onPick: (text: string, place?: PickedPlace) => void
  userId: string
  lang: 'de' | 'en'
}

export function PlaceSheet({ open, onClose, initialQuery, onPick, userId, lang }: PlaceSheetProps) {
  const { t } = useTranslation(['occasionForm', 'common'])
  const inputRef = useRef<HTMLInputElement>(null)
  // every opening starts fresh (the sheet keeps its content while it slides away)
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSession((n) => n + 1)
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('occasionForm.place_sheet_title')} closeLabel={t('common.close')} detent="full" initialFocusRef={inputRef}>
      <PlaceSearch key={session} initialQuery={initialQuery} onPick={onPick} userId={userId} lang={lang} inputRef={inputRef} />
    </Sheet>
  )
}

type Option =
  | { kind: 'free'; id: string; text: string; disabled: boolean }
  | { kind: 'suggestion'; id: string; text: string; suggestion: PlaceSuggestion }
  | { kind: 'recent'; id: string; text: string }

interface PlaceSearchProps {
  initialQuery: string
  onPick: (text: string, place?: PickedPlace) => void
  userId: string
  lang: 'de' | 'en'
  inputRef: RefObject<HTMLInputElement | null>
}

function suggestionsOf(state: PlaceSearchState): { list: PlaceSuggestion[]; stale: boolean } {
  if (state.status === 'done') return { list: state.results, stale: false }
  if (state.status === 'loading' && state.results) return { list: state.results, stale: true }
  return { list: [], stale: false }
}

function PlaceSearch({ initialQuery, onPick, userId, lang, inputRef }: PlaceSearchProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const base = useId()
  const online = useOnline()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(initialQuery)
  // the place that is already set is not a search: suggestions start with the first keystroke
  const [touched, setTouched] = useState(false)
  const [active, setActive] = useState(-1)
  const search = usePlaceSearch(touched ? query : '', { lang, online, userId })
  const recents = useMemo(() => recentPlaces(queryClient, userId), [queryClient, userId])

  const typed = normaliseQuery(query)
  const lower = typed.toLocaleLowerCase()
  const tooLong = Array.from(typed).length > LIMITS.placeText
  const { list: suggestions, stale } = suggestionsOf(search)
  const shownRecents =
    typed && touched
      ? recents.filter((place) => place.toLocaleLowerCase().includes(lower) && place.toLocaleLowerCase() !== lower)
      : recents.filter((place) => place.toLocaleLowerCase() !== lower)

  const options: Option[] = []
  if (typed) options.push({ kind: 'free', id: `${base}-free`, text: typed, disabled: tooLong })
  suggestions.forEach((suggestion, i) => options.push({ kind: 'suggestion', id: `${base}-s${i}`, text: suggestion.text, suggestion }))
  shownRecents.forEach((place, i) => options.push({ kind: 'recent', id: `${base}-r${i}`, text: place }))
  const listId = `${base}-list`
  const activeOption = active >= 0 ? options[active] : undefined

  const pick = (option: Option | undefined) => {
    if (!option || (option.kind === 'free' && option.disabled)) {
      if (option) haptic('warning')
      return
    }
    haptic('select')
    if (option.kind === 'suggestion' && option.suggestion.point) {
      onPick(option.text, { point: option.suggestion.point, kind: option.suggestion.kind })
    } else {
      onPick(option.text)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (options.length === 0 ? -1 : Math.min(options.length - 1, i + 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (options.length === 0 ? -1 : i <= 0 ? options.length - 1 : i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(activeOption ?? options.find((option) => option.kind === 'free'))
    }
  }

  const renderOption = (option: Option, index: number) => {
    const isActive = index === active
    let tile: ReactNode
    let name: ReactNode
    let line: ReactNode = null
    if (option.kind === 'free') {
      tile = <IconQuote size={18} />
      name = t('occasionForm.place_use_text', { text: option.text })
      line = option.disabled ? t('occasion.too_long', { max: LIMITS.placeText }) : t('occasionForm.place_use_text_hint')
    } else if (option.kind === 'suggestion') {
      const Icon = KIND_ICON[option.suggestion.kind]
      tile = <Icon size={18} />
      name = option.suggestion.name
      line = option.suggestion.line || null
    } else {
      tile = <IconRecent size={18} />
      name = option.text
    }
    return (
      <div
        key={option.id}
        id={option.id}
        role="option"
        aria-selected={isActive}
        aria-disabled={option.kind === 'free' && option.disabled ? true : undefined}
        data-active={isActive ? '' : undefined}
        data-kind={option.kind === 'suggestion' ? option.suggestion.kind : option.kind}
        data-error={option.kind === 'free' && option.disabled ? '' : undefined}
        className="of-option"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => pick(option)}
      >
        <span aria-hidden="true" className="of-option-tile">
          {tile}
        </span>
        <span className="of-option-text">
          <span className="of-option-name">{name}</span>
          {line ? <span className="of-option-line">{line}</span> : null}
        </span>
      </div>
    )
  }

  const freeCount = typed ? 1 : 0
  const loadingFresh = search.status === 'loading' && !search.results
  const note = noteFor(search)

  return (
    <div className="of-place">
      <div className="of-search">
        <IconSearch size={20} className="of-search-icon" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption?.id}
          aria-label={t('occasionForm.place_search_label')}
          placeholder={t('occasionForm.place_search_placeholder')}
          className="of-search-input"
          value={query}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          // the current place is selected on opening: typing replaces it
          onFocus={(event) => {
            if (!touched) event.currentTarget.select()
          }}
          onChange={(event) => {
            setTouched(true)
            setQuery(event.target.value)
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <IconButton
            label={t('occasionForm.place_search_clear')}
            className="of-search-clear"
            hapticKind="select"
            onClick={() => {
              setQuery('')
              setActive(-1)
              inputRef.current?.focus()
            }}
          >
            <IconClose size={18} />
          </IconButton>
        ) : null}
      </div>
      <p className="of-place-hint">
        <IconInfo size={16} />
        <span>{t('occasion.place_hint')}</span>
      </p>

      <div id={listId} role="listbox" aria-label={t('occasionForm.place_list_label')} className="of-options">
        {typed ? renderOption(options[0] as Option, 0) : null}
        {suggestions.length > 0 || loadingFresh ? (
          <div role="group" aria-labelledby={`${base}-sg`} className="of-option-group" data-stale={stale ? '' : undefined}>
            <div role="presentation" id={`${base}-sg`} className="of-option-group-label">
              {t('occasionForm.place_suggestions')}
            </div>
            {loadingFresh ? (
              <div aria-hidden="true" className="of-option-skeletons">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="of-option of-option-skeleton">
                    <Skeleton width={32} height={32} rounded="md" />
                    <span className="of-option-text">
                      <Skeleton height={14} width={row === 1 ? '48%' : '62%'} />
                      <Skeleton height={12} width={row === 2 ? '54%' : '78%'} />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              options.slice(freeCount, freeCount + suggestions.length).map((option, i) => renderOption(option, freeCount + i))
            )}
          </div>
        ) : null}
        {shownRecents.length > 0 ? (
          <div role="group" aria-labelledby={`${base}-rg`} className="of-option-group">
            <div role="presentation" id={`${base}-rg`} className="of-option-group-label">
              {t('occasionForm.place_recent')}
            </div>
            {options.slice(freeCount + suggestions.length).map((option, i) => renderOption(option, freeCount + suggestions.length + i))}
          </div>
        ) : null}
      </div>

      {note ? (
        <p role="status" className="of-place-note" data-tone={note.tone}>
          {note.tone === 'offline' ? <IconCloudOff size={18} /> : <IconInfo size={18} />}
          <span>{t(note.key, note.params)}</span>
        </p>
      ) : null}
      {search.status === 'done' && search.results.length > 0 ? (
        <p role="status" className="sr-only">
          {t('occasionForm.place_results', { count: search.results.length })}
        </p>
      ) : null}
      {suggestions.length > 0 ? (
        <p className="of-credit">
          <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
            {t('occasionForm.osm_credit')}
          </a>
        </p>
      ) : null}
      {!typed && recents.length === 0 ? <p className="of-place-intro">{t('occasionForm.place_intro')}</p> : null}
    </div>
  )
}

interface Note {
  tone: 'offline' | 'calm'
  key: string
  params?: Record<string, string>
}

/** The calm line under the list: why there are no suggestions (free text always works). */
function noteFor(state: PlaceSearchState): Note | null {
  switch (state.status) {
    case 'offline':
      return { tone: 'offline', key: 'occasionForm.place_offline' }
    case 'error':
      return { tone: 'calm', key: state.code === 'rate_limited' ? 'occasionForm.place_rate_limited' : 'occasionForm.place_unavailable' }
    case 'done':
      return state.results.length === 0 ? { tone: 'calm', key: 'occasionForm.place_no_results', params: { text: state.query } } : null
    case 'too_long':
      return { tone: 'calm', key: 'occasionForm.place_query_too_long' }
    default:
      return null
  }
}
