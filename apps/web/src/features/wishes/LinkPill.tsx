import type { ClipboardEvent, KeyboardEvent, ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { LIMITS } from '../../lib/app'
import { Button, IconButton, IconLink, IconX, cn } from '../../ui'
import { IconPaste } from './icons'
import { extractLink } from './linkInput'
import './wishes.css'

// The big frosted link capsule of the wish screen (K6, reference "Paste link"): one field, a leading link
// glyph and — while it is empty — the accent "Einfügen" button (clipboard); with text, a clear "×".
// A pasted text is searched for its link ("Schau mal: https://… 😍" → the link) and read at once; typed text
// is the form's business (WishForm decides when to read it).

export interface LinkPillProps {
  id: string
  value: string
  inputRef?: Ref<HTMLInputElement>
  /** text typed (or pasted without a link in it) */
  onType: (text: string) => void
  /** a link was pasted into the field: the field now holds exactly that link */
  onPasteLink: (link: string) => void
  /** Enter or leaving the field: read what is there now */
  onCommit: () => void
  onClear: () => void
  /** the "Einfügen" button */
  onPasteButton: () => void
  pasting?: boolean
  error?: string
  /** one line under the capsule (e.g. "no link on the clipboard"), polite live region */
  note?: ReactNode
  hint?: ReactNode
  className?: string
}

export function LinkPill({
  id,
  value,
  inputRef,
  onType,
  onPasteLink,
  onCommit,
  onClear,
  onPasteButton,
  pasting = false,
  error,
  note,
  hint,
  className,
}: LinkPillProps) {
  const { t } = useTranslation('wishes')
  const errorId = `${id}-error`
  const noteId = `${id}-note`
  const hasValue = value.trim() !== ''

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text')
    const link = extractLink(text)
    if (!link) return // nothing link-like: the normal paste
    event.preventDefault()
    onPasteLink(link)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault() // Enter reads the link; it never submits the wish half-filled
    onCommit()
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="sr-only">
        {t('wish.url_label')}
      </label>
      <div
        className="glass-panel wish-pill flex h-16 items-center gap-2 rounded-full pl-5 pr-2"
        data-invalid={error ? '' : undefined}
      >
        <IconLink size={20} className="shrink-0 text-accent-text" />
        <input
          ref={inputRef}
          id={id}
          type="url"
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={LIMITS.wishUrl}
          placeholder={t('wish.url_placeholder')}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : note ? noteId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-3 focus-visible:shadow-none"
          onChange={(event) => onType(event.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onBlur={onCommit}
        />
        {hasValue ? (
          <IconButton
            label={t('wish.link_clear')}
            variant="plain"
            hapticKind="select"
            // keep the focus in the field: leaving it would first read the link that is being cleared
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClear}
            className="text-text-2"
          >
            <IconX size={20} />
          </IconButton>
        ) : (
          <Button
            size="md"
            icon={<IconPaste />}
            loading={pasting}
            loadingLabel={t('wish.link_pasting')}
            onClick={onPasteButton}
            className="shrink-0 px-4"
          >
            {t('wish.link_paste')}
          </Button>
        )}
      </div>
      {error ? (
        <p id={errorId} className="px-5 t-footnote text-danger">
          {error}
        </p>
      ) : null}
      {/* the live region exists before its text arrives, so the note is announced */}
      <p id={noteId} role="status" className={cn('px-5 t-footnote text-text-2', (!note || error) && 'sr-only')}>
        {error ? null : note}
      </p>
      {!error && !note && hint ? <p className="px-5 t-footnote text-text-2">{hint}</p> : null}
    </div>
  )
}
