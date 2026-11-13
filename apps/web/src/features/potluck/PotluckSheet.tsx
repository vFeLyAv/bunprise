import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, TextField } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { POTLUCK_TITLE_MAX, titleProblem } from './cache'

// The bottom sheet of the bring-along list (design §1.4): ONE field (up to 80 characters) and — when adding —
// "Ich bringe das selbst mit" (on for a guest, off for the host). Under the field, always: gifts belong into the
// wish list, where they stay secret. Renaming uses the same sheet without the checkbox.

export interface PotluckSheetProps {
  open: boolean
  mode: 'add' | 'rename'
  /** the current title when renaming */
  initialTitle?: string
  /** the checkbox's start value when adding */
  bringByDefault?: boolean
  onClose: () => void
  onSubmit: (title: string, bring: boolean) => void
}

export function PotluckSheet({ open, mode, initialTitle = '', bringByDefault = false, onClose, onSubmit }: PotluckSheetProps) {
  const { t } = useTranslation('occasion')
  const fieldId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(initialTitle)
  const [bring, setBring] = useState(bringByDefault)
  const [tried, setTried] = useState(false)
  // every opening starts fresh (the sheet stays mounted while it slides out): adjusted while rendering, the way
  // React recommends for "reset state when a prop changes" — no effect, no extra render pass
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTitle(initialTitle)
      setBring(bringByDefault)
      setTried(false)
    }
  }

  const problem = titleProblem(title)
  const error = tried && problem
    ? problem === 'too_long' ? t('potluck.error_too_long', { max: POTLUCK_TITLE_MAX }) : problem === 'one_line' ? t('potluck.error_one_line') : t('potluck.error_empty')
    : undefined

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTried(true)
    if (problem) {
      inputRef.current?.focus()
      return
    }
    onSubmit(title, mode === 'add' && bring)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'add' ? t('potluck.add_title') : t('potluck.rename_title')}
      closeLabel={t('potluck.close')}
      initialFocusRef={inputRef}
    >
      {/* TextField takes no ref: the sheet focuses its input through the form */}
      <form ref={(form) => { inputRef.current = form?.querySelector('input') ?? null }} className="flex flex-col gap-4 pb-2" onSubmit={submit} noValidate>
        <TextField
          id={fieldId}
          label={t('potluck.field_label')}
          placeholder={t('potluck.field_placeholder')}
          value={title}
          maxLength={POTLUCK_TITLE_MAX}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setTitle(event.target.value)}
          error={error}
          hint={t('potluck.gift_hint')}
        />
        {mode === 'add' ? (
          <Checkbox checked={bring} onChange={setBring}>
            {t('potluck.bring_myself')}
          </Checkbox>
        ) : null}
        <Button type="submit" size="lg" fullWidth>
          {mode === 'add' ? t('potluck.save_add') : t('potluck.save_rename')}
        </Button>
      </form>
    </Sheet>
  )
}
