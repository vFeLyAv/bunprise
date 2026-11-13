import { useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { LinkPreviewErrorCode } from '../../lib/api/linkPreview'
import { LIMITS } from '../../lib/app'
import { currentLanguage } from '../../lib/i18n'
import { Button, IconButton, cn, fade, tileTone, useReducedMotionPref, useSpring } from '../../ui'
import { IconPencil, IconRefresh, IconSparkle } from './icons'
import { formatPriceInput, parsePriceText } from './priceText'
import { GiftTile, ShopTile } from './ShopTile'
import { isRetryable } from './useLinkPreview'
import './wishes.css'

// The wish card of the new / edit screen (K6): what the wish IS — the shop (letter tile; a product photo only
// ever comes in through the `photo` slot, as bytes our own Worker fetched), the title and the price, both editable
// right in the card. Its states follow the link:
//   plain    no link: the gift tile, "Ohne Link"
//   link     a saved link that was not read again (edit screen): the shop, fields as saved
//   loading  the link is being read: the shop already, shimmering placeholders, "Pompon schnuppert …"
//   filled   read: title / price from the link (still editable), "Aus dem Link"
//   partial  read, but no title: the title field waits (focused) with one line why
//   failed   not read: the same card with empty fields and one calm line (+ "Nochmal" when it may work)

export type WishCardState =
  | { kind: 'plain' }
  | { kind: 'link'; site: string }
  | { kind: 'loading'; site: string }
  | { kind: 'filled'; site: string }
  | { kind: 'partial'; site: string }
  | { kind: 'failed'; site: string; code: LinkPreviewErrorCode }

const FAILURE_KEY: Record<LinkPreviewErrorCode, string> = {
  invalid_request: 'wish.preview_invalid',
  unauthorized: 'wish.preview_unauthorized',
  too_large: 'wish.preview_unsupported',
  unsupported_content: 'wish.preview_unsupported',
  blocked_target: 'wish.preview_blocked',
  rate_limited: 'wish.preview_rate_limited',
  fetch_failed: 'wish.preview_failed',
  timeout: 'wish.preview_timeout',
  offline: 'wish.preview_offline',
  unavailable: 'wish.preview_unavailable',
}

export interface WishCardProps {
  idPrefix: string
  state: WishCardState
  title: string
  onTitle: (text: string) => void
  priceCents: number | null
  onPrice: (cents: number | null, meta: { invalid: boolean }) => void
  titleError?: string
  titleHint?: string
  priceError?: string
  titleRef?: Ref<HTMLTextAreaElement>
  priceRef?: Ref<HTMLInputElement>
  /** read the link again (edit screen, after a failure that may work now) */
  onReread?: () => void
  /** loading: stop waiting and type it in */
  onSkip?: () => void
  /** the product photo (WishPhoto.tsx CardPhotoView: shimmer / photo + "Foto entfernen" / nothing) under the header */
  photo?: ReactNode
  /** the link's host name: the header tile shows the shop's real icon through our Worker (ShopTile) */
  host?: string | null
  className?: string
}

export function WishCard({
  idPrefix,
  state,
  host = null,
  title,
  onTitle,
  priceCents,
  onPrice,
  titleError,
  titleHint,
  priceError,
  titleRef,
  priceRef,
  onReread,
  onSkip,
  photo,
  className,
}: WishCardProps) {
  const { t } = useTranslation('wishes')
  const loading = state.kind === 'loading'
  // the card glows softly in the shop's tint (Apple Invites' per-event backdrop, in our tile colours)
  const tone = tileTone(state.kind === 'plain' ? 'own-wish' : state.site.trim().toLowerCase())
  return (
    <section
      aria-labelledby={`${idPrefix}-card`}
      aria-busy={loading || undefined}
      data-card-state={state.kind}
      data-tone={tone}
      className={cn('glass-panel wish-card relative flex flex-col rounded-[28px] px-5 pb-3 pt-5', loading && 'wish-shimmer', className)}
    >
      <h2 id={`${idPrefix}-card`} className="sr-only">
        {t('wish.card_heading')}
      </h2>
      <CardHeader state={state} host={host} onReread={onReread} />
      {loading ? (
        <LoadingBody onSkip={onSkip} />
      ) : (
        <>
          {photo}
          {state.kind === 'failed' ? (
            <FailureLine id={`${idPrefix}-why`} code={state.code} onRetry={isRetryable(state.code) ? onReread : undefined} />
          ) : null}
          <TitleInput
            id={`${idPrefix}-title`}
            value={title}
            onChange={onTitle}
            error={titleError}
            hint={state.kind === 'partial' && !titleError ? t('wish.preview_partial') : titleHint}
            describedByExtra={state.kind === 'failed' ? `${idPrefix}-why` : undefined}
            inputRef={titleRef}
            onEnter={() => document.getElementById(`${idPrefix}-price`)?.focus()}
          />
          <PriceInput id={`${idPrefix}-price`} cents={priceCents} onChange={onPrice} error={priceError} inputRef={priceRef} />
        </>
      )}
    </section>
  )
}

function CardHeader({ state, host, onReread }: { state: WishCardState; host: string | null; onReread?: () => void }) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const site = state.kind === 'plain' ? null : state.site
  const caption =
    state.kind === 'plain'
      ? t('wish.card_own')
      : state.kind === 'loading'
        ? t('wish.preview_loading')
        : state.kind === 'filled'
          ? t('wish.preview_from_link')
          : state.kind === 'partial'
            ? t('wish.preview_from_link_partial')
            : state.kind === 'failed'
              ? t('wish.preview_not_read')
              : t('wish.card_link')
  const canReread = onReread && (state.kind === 'link' || state.kind === 'filled' || state.kind === 'partial')
  return (
    <div className="flex min-h-12 items-center gap-3">
      {/* the tile pops in when the shop changes (a new link), not on every keystroke */}
      <m.span
        key={site ?? 'plain'}
        className="grid"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -8 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={reduced ? fade : { ...bouncy, opacity: fade }}
      >
        {site !== null ? <ShopTile site={site} host={host} size="lg" /> : <GiftTile seed="own-wish" size="lg" />}
      </m.span>
      <div className="min-w-0 flex-1">
        <p className="truncate t-headline text-text">{site ?? t('wish.card_no_link')}</p>
        {/* one live region for the whole read: "schnuppert …" → "Aus dem Link gelesen" / "Nicht gelesen" */}
        {/* the status may take two lines on a narrow phone (320 px: the shop tile and "neu einlesen" share the row) */}
        <p
          role="status"
          className={cn('flex items-start gap-1 t-footnote', state.kind === 'filled' ? 'text-accent-text' : 'text-text-2')}
        >
          {state.kind === 'filled' ? <IconSparkle size={14} className="mt-[0.15em] shrink-0" /> : null}
          <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{caption}</span>
        </p>
      </div>
      {canReread ? (
        <IconButton label={t('wish.link_reread')} variant="plain" hapticKind="select" onClick={onReread} className="-mr-2 text-accent-text">
          <IconRefresh size={20} />
        </IconButton>
      ) : null}
    </div>
  )
}

/** Shimmering placeholders in the shape of the fields (no spinner; the card keeps its height). */
function LoadingBody({ onSkip }: { onSkip?: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    <>
      <div aria-hidden="true" className="mt-4 flex flex-col gap-2.5 py-1">
        <span className="wish-bone block h-6 w-[84%]" />
        <span className="wish-bone block h-6 w-[52%]" />
      </div>
      <div aria-hidden="true" className="mt-3 flex h-12 items-center justify-between border-t border-separator">
        <span className="wish-bone block h-4 w-12" />
        <span className="wish-bone block h-6 w-24" />
      </div>
      {onSkip ? (
        <div className="relative z-[2] flex border-t border-separator pt-1">
          <Button variant="ghost" size="sm" icon={<IconPencil />} onClick={onSkip} className="-ml-3">
            {t('wish.preview_skip')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

function FailureLine({ id, code, onRetry }: { id: string; code: LinkPreviewErrorCode; onRetry?: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    // not a live region of its own (the card status says "Nicht gelesen"): the title field, which takes the
    // focus now, is described by this line
    <div className="mt-4 flex items-start gap-2 rounded-2xl bg-fill px-3.5 py-2.5">
      <p id={id} className="min-w-0 flex-1 py-1 t-subhead text-text-2">
        {t(FAILURE_KEY[code])}
      </p>
      {onRetry ? (
        <Button variant="ghost" size="sm" icon={<IconRefresh />} onClick={onRetry} className="-mr-2 shrink-0">
          {t('wish.preview_retry')}
        </Button>
      ) : null}
    </div>
  )
}

const codePoints = (text: string) => [...text].length

function TitleInput({
  id,
  value,
  onChange,
  error,
  hint,
  inputRef,
  onEnter,
  describedByExtra,
}: {
  id: string
  value: string
  onChange: (text: string) => void
  error?: string
  hint?: string
  inputRef?: Ref<HTMLTextAreaElement>
  onEnter: () => void
  /** another element that explains the field (the failure line of the card) */
  describedByExtra?: string
}) {
  const { t } = useTranslation('wishes')
  const length = codePoints(value)
  const count = length >= LIMITS.wishTitle - 20 ? t('wish.char_count', { count: length, max: LIMITS.wishTitle }) : null
  const own = error ? `${id}-error` : hint ? `${id}-hint` : count ? `${id}-count` : undefined
  const describedBy = [describedByExtra, own].filter(Boolean).join(' ') || undefined
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault() // a title is one line: Enter moves on to the price
      onEnter()
    }
  }
  return (
    <div className="mt-3 flex flex-col gap-1">
      {/* the product name reads like a headline; the label is for screen readers (the placeholder asks) */}
      <label htmlFor={id} className="sr-only">
        {t('wish.title_label')}
      </label>
      <div className="wish-inline -mx-2 flex cursor-text items-start gap-1 px-1" data-invalid={error ? '' : undefined}>
        <textarea
          ref={inputRef}
          id={id}
          rows={1}
          value={value}
          maxLength={LIMITS.wishTitle}
          autoComplete="off"
          enterKeyHint="next"
          placeholder={t('wish.title_placeholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="wish-title-input block min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 t-title-2 text-text outline-none placeholder:text-text-3"
          onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, ' '))}
          onKeyDown={onKeyDown}
        />
        <IconPencil size={16} className="mr-1 mt-3 shrink-0 text-text-3" />
      </div>
      <FieldNote id={id} error={error} hint={hint} count={count} />
    </div>
  )
}

function PriceInput({
  id,
  cents,
  onChange,
  error,
  inputRef,
}: {
  id: string
  cents: number | null
  onChange: (cents: number | null, meta: { invalid: boolean }) => void
  error?: string
  inputRef?: Ref<HTMLInputElement>
}) {
  const { t } = useTranslation('wishes')
  const locale = currentLanguage()
  // while editing the field shows its own text; otherwise the formatted value (or the rejected text)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  const shown = focused ? text : (rejected ?? formatPriceInput(cents, locale))

  function commit() {
    const parsed = parsePriceText(text)
    if (parsed === 'invalid') {
      setRejected(text)
      onChange(cents, { invalid: true })
      return
    }
    setRejected(null)
    onChange(parsed, { invalid: false })
  }

  return (
    // a receipt line under a hairline: "Preis ……… 79,99 €"; the whole line focuses the field
    <div className="mt-2 flex flex-col gap-1 border-t border-separator pt-1.5">
      <div
        className="wish-inline -mx-2 flex h-12 cursor-text items-center gap-2 px-2"
        data-invalid={error ? '' : undefined}
        onClick={() => document.getElementById(id)?.focus()}
      >
        <label htmlFor={id} className="shrink-0 cursor-text t-callout text-text-2">
          {t('wish.price_label')}
        </label>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={shown}
          placeholder={t('wish.price_placeholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-right t-title-3 tabular-nums text-text outline-none placeholder:font-normal placeholder:text-text-3"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => {
            setText(rejected ?? formatPriceInput(cents, locale))
            setFocused(true)
          }}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
        />
        <span aria-hidden="true" className={cn('t-title-3', shown === '' ? 'text-text-3' : 'text-text')}>
          €
        </span>
        <IconPencil size={16} className="shrink-0 text-text-3" />
      </div>
      <FieldNote id={id} error={error} />
    </div>
  )
}

function FieldNote({ id, error, hint, count }: { id: string; error?: string; hint?: ReactNode; count?: string | null }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="px-1 t-footnote text-danger">
        {error}
      </p>
    )
  }
  if (hint) {
    return (
      <p id={`${id}-hint`} className="px-1 t-footnote text-text-2">
        {hint}
      </p>
    )
  }
  if (count) {
    return (
      <p id={`${id}-count`} className="px-1 text-right t-footnote tabular-nums text-text-2">
        {count}
      </p>
    )
  }
  return null
}
