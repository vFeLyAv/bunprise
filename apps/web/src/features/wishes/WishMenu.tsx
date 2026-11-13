import { Suspense, lazy, useEffect, useId, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { OwnerWish, WishPriority } from '../../lib/api/types'
import { wishTogetherEnabled } from '../../lib/api/wishExtras'
import { Button, List, ListRow, ListRowContent, listItemClass, listRowClass } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { PriorityHeart } from './HeartGlyph'
import { SheetTitle } from './WishGrid'
import { WishOMeter } from './WishOMeter'
import './wishes.css'

// The "⋯" of one of MY wishes (Felix 22.10) — on its tile and in its sheet. OWNER module: every row is about the
// owner's own wish; nothing here reads, says or depends on anything a guest did (OwnerWish has no such fields).
//   In andere Liste verschieben  → a picker of my OTHER lists without an occasion (features/lists/MoveWishSheet)
//   Als erhalten markieren / Doch nicht erhalten
//   Bearbeiten                   → the existing edit screen
//   Wie sehr wünschst du es dir? → the form's own wish-o-meter (Felix 26.10: "the same scale as when creating")
//   Wunsch löschen               → the existing 5 s "Rückgängig"
// A wish that lives in more than one list (also_in, 20261027200000 — design §5.7): no "Verschieben" (the database
// refuses it), instead "Aus „…“ entfernen" (only this list) and "Überall löschen" (after a confirmation naming the lists).
// The actions themselves (optimistic, with the calm "Das geht bald" for a server without today's migration) live in
// OwnerWishlist; this file only asks.

const loadMoveWishSheet = () => import('../lists/MoveWishSheet')
const MoveWishSheet = lazy(loadMoveWishSheet)
// "Passt gut zu …" (Felix 30.10, 20261030120000): its own lazy chunk, loaded on first use
const TogetherPickerSheet = lazy(() => import('./TogetherPickerSheet'))

export type WishMenuStage = 'menu' | 'priority' | 'move' | 'everywhere' | 'together' | null

export interface MoveTarget {
  id: string
  title: string
}

export interface WishMenuProps {
  /** the last chosen wish (it stays rendered while its sheet slides out) */
  wish: OwnerWish | null
  stage: WishMenuStage
  onStage: (stage: WishMenuStage) => void
  /** the list the wish is on now (the picker leaves it out) */
  listId: string
  onMove: (wish: OwnerWish, target: MoveTarget) => void
  onReceived: (wish: OwnerWish, received: boolean) => void
  onPriority: (wish: OwnerWish, priority: WishPriority) => void
  onDelete: (wish: OwnerWish) => void
  /** shared wishes: the title of the list the menu was opened in ("Aus „…“ entfernen"); empty = "dieser Liste" */
  listTitle?: string
  onRemoveHere?: (wish: OwnerWish) => void
  onDeleteEverywhere?: (wish: OwnerWish) => void
  /** Selection mode (Felix 30.10): "Mehrere auswählen" — the long press's twin for keyboards and screen readers. */
  onSelectMany?: (wish: OwnerWish) => void
  /** "Passt gut zu …" (behind VITE_WISH_TOGETHER): the other open wishes of this list, and saving the partners */
  togetherCandidates?: readonly OwnerWish[]
  onTogether?: (wish: OwnerWish, linkedIds: readonly string[]) => void
}

export function WishMenu({ wish, stage, onStage, listId, onMove, onReceived, onPriority, onDelete, listTitle = '', onRemoveHere, onDeleteEverywhere, onSelectMany, togetherCandidates = [], onTogether }: WishMenuProps) {
  const { t } = useTranslation('wishes')
  const online = useOnline()
  const [moveMounted, setMoveMounted] = useState(false)
  if (stage === 'move' && !moveMounted) setMoveMounted(true)
  const [togetherMounted, setTogetherMounted] = useState(false)
  if (stage === 'together' && !togetherMounted) setTogetherMounted(true)
  // the picker is a lazy chunk: it starts loading when the menu opens, so "Verschieben" shows it at once
  useEffect(() => {
    if (stage === 'menu') void loadMoveWishSheet()
  }, [stage])
  if (!wish) return null
  const received = Boolean(wish.received_at)
  const close = () => onStage(null)
  const together = onTogether && wishTogetherEnabled() && !received ? onTogether : undefined
  const togetherCount = wish.together?.length ?? 0
  // shared: the wish lives in other lists too (owner data: every other list by name)
  const others = (wish.also_in ?? []).filter((place) => place.kind !== 'hidden')
  const removeHere = others.length > 0 ? onRemoveHere : undefined
  const deleteEverywhere = others.length > 0 ? onDeleteEverywhere : undefined
  const here = listTitle.trim()
  const allLists = [here || t('wish.places_this_list'), ...others.map((place) => place.title?.trim() || t('wish.places_untitled'))]
  return (
    <>
      <Sheet open={stage === 'menu'} onClose={close} title={<SheetTitle>{wish.title}</SheetTitle>} closeLabel={t('common.close')}>
        {/* plain text rows like every ⋯ of the app: destructive last and in red */}
        <List className="pb-2" data-wish-menu={wish.id}>
          {removeHere ? (
            <ListRow
              title={here ? t('wish.menu_remove_here', { list: here }) : t('wish.menu_remove_here_untitled')}
              disabled={!online}
              onPress={() => {
                close()
                removeHere(wish)
              }}
            />
          ) : (
            <ListRow title={t('wish.menu_move')} disabled={!online} onPress={() => onStage('move')} />
          )}
          <ListRow
            title={received ? t('wish.menu_unreceive') : t('wish.menu_receive')}
            disabled={!online}
            onPress={() => {
              close()
              onReceived(wish, !received)
            }}
          />
          <li className={listItemClass}>
            <Link to="/wishes/$wishId/edit" params={{ wishId: wish.id }} className={listRowClass({ pressable: true })} onClick={close}>
              <ListRowContent title={t('wish.edit')} />
            </Link>
          </li>
          {received ? null : (
            <ListRow title={t('wish.menu_priority')} trailing={<PriorityHeart priority={wish.priority} />} disabled={!online} onPress={() => onStage('priority')} />
          )}
          {together ? (
            <ListRow
              title={t('wish.together_menu')}
              trailing={togetherCount > 0 ? <span className="t-subhead tabular-nums text-text-2">{togetherCount}</span> : undefined}
              disabled={!online}
              onPress={() => onStage('together')}
            />
          ) : null}
          {onSelectMany && !received ? (
            <ListRow
              title={t('select.menu_row')}
              onPress={() => {
                close()
                onSelectMany(wish)
              }}
            />
          ) : null}
          {deleteEverywhere ? (
            <ListRow title={<span className="text-danger">{t('wish.menu_delete_everywhere')}</span>} disabled={!online} onPress={() => onStage('everywhere')} />
          ) : (
            <ListRow
              title={<span className="text-danger">{t('wish.delete')}</span>}
              onPress={() => {
                close()
                onDelete(wish)
              }}
            />
          )}
        </List>
      </Sheet>

      {deleteEverywhere ? (
        <Confirm
          open={stage === 'everywhere'}
          title={t('wish.everywhere_title')}
          message={t('wish.everywhere_text', { title: wish.title, lists: allLists.map((name) => `„${name}“`).join(', ') })}
          confirmLabel={t('wish.menu_delete_everywhere')}
          cancelLabel={t('wish.everywhere_cancel')}
          destructive
          onConfirm={() => {
            close()
            deleteEverywhere(wish)
          }}
          onCancel={close}
        />
      ) : null}

      <PrioritySheet
        open={stage === 'priority'}
        current={wish.priority}
        onPick={(priority) => {
          close()
          if (priority !== wish.priority) onPriority(wish, priority)
        }}
      />

      {togetherMounted && together ? (
        <Suspense fallback={null}>
          <TogetherPickerSheet
            open={stage === 'together'}
            onClose={close}
            wish={wish}
            candidates={togetherCandidates.filter((other) => !other.received_at)}
            onSave={(target, ids) => {
              close()
              together(target, ids)
            }}
          />
        </Suspense>
      ) : null}

      {moveMounted ? (
        <Suspense fallback={null}>
          <MoveWishSheet
            open={stage === 'move'}
            onClose={close}
            wishTitle={wish.title}
            currentListId={listId}
            onPick={(target) => {
              close()
              onMove(wish, target)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}

/**
 * "Wie sehr wünschst du es dir?" — the same wish-o-meter as when the wish was created (Felix 26.10: "the same scale
 * as in the form"). Each opening starts at the wish's level; the level is kept when the sheet goes — by "Fertig",
 * the ✕ or a swipe — one request at most, none when it did not change.
 */
function PrioritySheet({ open, current, onPick }: { open: boolean; current: WishPriority; onPick: (priority: WishPriority) => void }) {
  const { t } = useTranslation('wishes')
  const headingId = useId()
  const [value, setValue] = useState(current)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setValue(current)
  }
  const done = () => onPick(value)
  return (
    <Sheet open={open} onClose={done} title={t('wish.priority_title')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-5 pb-2">
        <h3 id={headingId} className="sr-only">{t('wish.priority_label')}</h3>
        <WishOMeter value={value} onChange={setValue} labelledBy={headingId} />
        <Button size="lg" fullWidth onClick={done}>{t('wish.priority_done')}</Button>
      </div>
    </Sheet>
  )
}
