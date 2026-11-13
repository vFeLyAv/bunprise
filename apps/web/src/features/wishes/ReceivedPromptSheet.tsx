import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import type { OwnerWish } from '../../lib/api/types'
import { dismissReceivedPrompt } from '../../lib/api/wishPlaces'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { Button, Checkbox } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { WishThumb } from './WishPhoto'

// "Was hast du bekommen?" (shared wishes, design §4.3 / Q19 default) — OWNER module, a lazy chunk of the occasion's own
// wishlist. Shown from day 1 to day 7 after the occasion's end (the server decides: wishlist.received_prompt): the open
// wishes with an "Erhalten" tick each (the existing set_wish_received, through the owner list's own optimistic action).
// A week after the end the wishes that also live in other lists leave this occasion — ticking what arrived keeps them
// from being given twice later. "Fertig" closes the reminder for good (dismiss_received_prompt). Nothing here reads,
// says or depends on reservations.

export interface ReceivedPromptSheetProps {
  open: boolean
  occasionId: string
  /** the open wishes of the list right now (a snapshot is taken when the sheet opens) */
  wishes: readonly OwnerWish[]
  onReceived: (wish: OwnerWish, received: boolean) => void
  onClose: () => void
  /** the server closed the reminder */
  onDismissed: () => void
}

export default function ReceivedPromptSheet({ open, occasionId, wishes, onReceived, onClose, onDismissed }: ReceivedPromptSheetProps) {
  const { t } = useTranslation('wishes')
  const online = useOnline()
  // the wishes as they were when the sheet opened: a ticked wish stays in the list (it moves to "Erhalten" behind it)
  const [snapshot, setSnapshot] = useState<readonly OwnerWish[]>(wishes)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSnapshot(wishes)
      setTicked(new Set())
    }
  }

  function toggle(wish: OwnerWish, on: boolean) {
    setTicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(wish.id)
      else next.delete(wish.id)
      return next
    })
    onReceived(wish, on)
  }

  async function done() {
    if (busy) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    setBusy(true)
    try {
      await dismissReceivedPrompt(occasionId, epoch.userId)
      if (!epoch.isCurrent()) return
      feedback('success')
      onDismissed()
      onClose()
    } catch (err) {
      if (!epoch.isCurrent()) return
      feedback('error')
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('wish.prompt_title')}
      closeLabel={t('common.close')}
      footer={
        <Button size="lg" fullWidth loading={busy} disabled={!online} onClick={() => void done()}>
          {t('wish.prompt_done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-2" data-received-prompt-sheet="">
        <p className="t-subhead text-text-2">{t('wish.prompt_sheet_text')}</p>
        <div className="glass-panel flex flex-col rounded-lg px-4 py-1" role="group" aria-label={t('wish.prompt_title')}>
          {snapshot.map((wish) => (
            <Checkbox key={wish.id} checked={ticked.has(wish.id)} disabled={!online} onChange={(on) => toggle(wish, on)} className="items-center">
              <span className="flex min-w-0 items-center gap-3">
                <WishThumb wish={wish} className="size-11 overflow-hidden rounded-md bg-fill">
                  <span aria-hidden="true" className="grid size-11 place-items-center t-headline text-text-2">
                    {wish.title.trim().charAt(0).toUpperCase()}
                  </span>
                </WishThumb>
                <span className="line-clamp-2 min-w-0 t-subhead text-text [overflow-wrap:anywhere]">{wish.title}</span>
              </span>
            </Checkbox>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
