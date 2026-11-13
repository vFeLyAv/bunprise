import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OwnerWish } from '../../lib/api/types'
import { TOGETHER_MAX } from '../../lib/api/wishExtras'
import { Button, IconCheck, List, ListRowContent, cn, haptic, listItemClass, listRowClass } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { SheetTitle } from './WishGrid'

// "Passt gut zu …" (Felix 30.10, 20261030120000) — OWNER module, a lazy chunk of the wish menu (WishMenu.tsx). The
// owner ticks her OTHER open wishes of this list that are best given together with this one (steering wheel +
// handbrake). Partners that live in another list stay linked untouched (they are not offered here). Saving replaces
// the wish's partners in one call (setWishLinks, server-confirmed — the caller does it). Nothing here knows anything
// about reservations: the friends' "Beides reservieren" is theirs alone.

export interface TogetherPickerSheetProps {
  open: boolean
  onClose: () => void
  wish: OwnerWish
  /** the other open wishes of this list (the wish itself is left out here) */
  candidates: readonly OwnerWish[]
  onSave: (wish: OwnerWish, linkedIds: readonly string[]) => void
}

export default function TogetherPickerSheet({ open, onClose, wish, candidates, onSave }: TogetherPickerSheetProps) {
  const { t } = useTranslation('wishes')
  const offered = candidates.filter((other) => other.id !== wish.id)
  const offeredIds = new Set(offered.map((other) => other.id))
  const current = (wish.together ?? []).map((link) => link.id)
  // partners from other lists: kept as they are
  const kept = current.filter((id) => !offeredIds.has(id))
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(current.filter((id) => offeredIds.has(id))))
  // a new opening starts from the stored partners again
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setChosen(new Set(current.filter((id) => offeredIds.has(id))))
  }
  const total = kept.length + chosen.size
  const changed = chosen.size !== current.length - kept.length || [...chosen].some((id) => !current.includes(id))
  function toggle(id: string) {
    haptic('select')
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (kept.length + next.size < TOGETHER_MAX) next.add(id)
      return next
    })
  }
  return (
    <Sheet open={open} onClose={onClose} title={<SheetTitle>{t('wish.together_title')}</SheetTitle>} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-4 pb-2" data-together-picker={wish.id}>
        <p className="px-1 t-subhead text-text-2">{t('wish.together_lead')}</p>
        {offered.length === 0 ? (
          <p className="px-1 t-body text-text-2">{t('wish.together_none')}</p>
        ) : (
          <List>
            {offered.map((other) => {
              const on = chosen.has(other.id)
              const full = !on && total >= TOGETHER_MAX
              return (
                <li key={other.id} className={listItemClass}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={full}
                    className={listRowClass({ pressable: true, disabled: full })}
                    onClick={() => toggle(other.id)}
                  >
                    <ListRowContent
                      title={other.title}
                      trailing={
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid h-7 w-7 place-items-center rounded-full tr-colors',
                            on ? 'bg-accent-500 text-text-on-accent' : 'border-2 border-separator',
                          )}
                        >
                          {on ? <IconCheck size={16} /> : null}
                        </span>
                      }
                    />
                  </button>
                </li>
              )
            })}
          </List>
        )}
        {total >= TOGETHER_MAX ? <p className="px-1 t-footnote text-text-2">{t('wish.together_limit', { max: TOGETHER_MAX })}</p> : null}
        <Button size="lg" fullWidth disabled={!changed} onClick={() => onSave(wish, [...kept, ...chosen])}>
          {t('wish.together_save')}
        </Button>
      </div>
    </Sheet>
  )
}
