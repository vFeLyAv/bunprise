import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { OwnerWish } from '../../../lib/api/types'
import { sharedWishesEnabled } from '../../../lib/api/wishPlaces'
import { Button, IconCheck, IconForward, IconPlus, IconTrash, fade, useLayerRoot, useReducedMotionPref, useSpring, useTapScale } from '../../../ui'
import { Confirm } from '../../../ui/Confirm'
import { useOnline } from '../../auth/shared'
import { bulkAdd, bulkDelete, bulkDeleteConfirmed, bulkMove, bulkReceived, deleteNeedsConfirm, isShared, type BulkTarget } from './bulk'
import type { RunMany } from './types'
import './selectionChrome.css'

// Selection mode's chrome (Felix 30.10, request #4) — a lazy chunk of the owner's wish grid, loaded with the first
// long press. OWNER module (only OwnerWishlist mounts it; the friends' view has no selection at all).
//   top     a glass bar over the screen's own: "Alle" / "Keine" · "3 ausgewählt" · "Fertig"
//   bottom  a glass capsule with Felix's four actions: Verschieben · Zu anderer Liste hinzufügen (only with the
//           shared-wishes flag, and only on a list without an occasion — add_wishes_to_list puts wishes from such a
//           list into an occasion's list) · Als erhalten markieren · Löschen
//   leave   "Fertig", Escape, the system's back (Android, browser) or the screen's "Zurück" — the first back only
//           ends selection mode; the edge swipe-back of the installed app still leaves the screen (it already moved)
// Bars slide in and out with the smooth spring (reduced motion: fade only); glass becomes solid under reduced
// transparency (glass.css).

const loadMoveWishSheet = () => import('../../lists/MoveWishSheet')
const MoveWishSheet = lazy(loadMoveWishSheet)

type Stage = 'move' | 'add' | 'delete' | null

export interface SelectionChromeProps {
  open: boolean
  /** the selected open wishes, in grid order */
  chosen: readonly OwnerWish[]
  /** how many open wishes there are (for "Alle" / "Keine") */
  total: number
  onAll: () => void
  onNone: () => void
  onDone: () => void
  /** the list on screen (the move picker leaves it out) */
  listId: string
  /** an occasion's list: "Zu anderer Liste hinzufügen" is not offered there */
  occasionList: boolean
  cacheOccasion: string | null
  runMany: RunMany
  /**
   * An action ends selection mode (31.10, the list Pompon: he hops after moved tiles, lets go of his ears otherwise):
   * called right before onDone with the wishes that leave the grid now. Owner data only.
   */
  onEnded?: (kind: 'move' | 'received' | 'delete', leaving: readonly OwnerWish[]) => void
}

export default function SelectionChrome({ open, chosen, total, onAll, onNone, onDone, listId, occasionList, cacheOccasion, runMany, onEnded }: SelectionChromeProps) {
  const { t } = useTranslation('wishes')
  const queryClient = useQueryClient()
  const router = useRouter()
  const root = useLayerRoot()
  const online = useOnline()
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const [stage, setStage] = useState<Stage>(null)
  const [moveMounted, setMoveMounted] = useState(false)
  if ((stage === 'move' || stage === 'add') && !moveMounted) setMoveMounted(true)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  const count = chosen.length
  const canAdd = sharedWishesEnabled() && !occasionList
  const ctx = { t, queryClient, cacheOccasion, runMany }

  // the pickers are a lazy chunk: warm it while the person is still choosing
  useEffect(() => {
    if (open) void loadMoveWishSheet()
  }, [open])

  // Escape leaves selection mode (an open sheet closes itself first)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      done.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // back (system / browser / the screen's "Zurück") ends selection mode instead of leaving the screen. The edge
  // swipe-back has already slid the screen away when it asks (it turns the view transition off right before) — that
  // one leaves, and selection mode ends with the screen.
  useBlocker({
    shouldBlockFn: ({ action }) => {
      if (action !== 'BACK' || router.shouldViewTransition === false) return false
      setStage(null)
      done.current()
      return true
    },
    disabled: !open,
    enableBeforeUnload: false,
  })

  // the screen's own top bar ("Zurück", ⋯) fades out under ours (selectionChrome.css), so nothing shows through
  useEffect(() => {
    if (!open) return
    const html = document.documentElement
    html.setAttribute('data-wish-selecting', '')
    return () => html.removeAttribute('data-wish-selecting')
  }, [open])

  // the toast (a result, "Rückgängig") floats above the action bar while it is there
  useEffect(() => {
    if (!open || !root) return
    const before = root.style.getPropertyValue('--toast-tabbar-clearance')
    root.style.setProperty('--toast-tabbar-clearance', 'calc(var(--sa-bottom) + var(--ws-bar-h) + 24px)')
    return () => {
      if (before) root.style.setProperty('--toast-tabbar-clearance', before)
      else root.style.removeProperty('--toast-tabbar-clearance')
    }
  }, [open, root])

  /** An action was sent: selection mode ends at once (the tiles already show the result). */
  function finish(action: () => void | Promise<void>, ended?: { kind: 'move' | 'received' | 'delete'; leaving: readonly OwnerWish[] }) {
    setStage(null)
    if (ended) onEnded?.(ended.kind, ended.leaving)
    onDone()
    void action()
  }

  function pick(target: BulkTarget) {
    const wishes = [...chosen]
    const add = stage === 'add'
    // (shared wishes are not moved: they stay)
    finish(() => (add ? bulkAdd(ctx, wishes, target) : bulkMove(ctx, wishes, target)), add ? undefined : { kind: 'move', leaving: wishes.filter((wish) => !isShared(wish)) })
  }

  function received() {
    const wishes = [...chosen]
    finish(() => bulkReceived(ctx, wishes), { kind: 'received', leaving: wishes })
  }

  function remove() {
    const wishes = [...chosen]
    if (deleteNeedsConfirm(wishes)) {
      setStage('delete')
      return
    }
    finish(() => bulkDelete(ctx, wishes), { kind: 'delete', leaving: wishes })
  }

  const all = count === total && total > 0
  const slide = (from: number) => (reduced ? { opacity: 0 } : { opacity: 0, y: from })
  const transition = reduced ? fade : { ...smooth, opacity: fade }
  const sharedCount = chosen.filter(isShared).length

  const bars = (
    <AnimatePresence>
      {open ? (
        <m.header
          key="ws-top"
          className="ws-top glass-bar pt-safe"
          data-scrolled=""
          data-wish-selection-top=""
          initial={slide(-16)}
          animate={{ opacity: 1, y: 0 }}
          exit={slide(-16)}
          transition={transition}
        >
          <div className="ws-top-row">
            <div className="flex items-center justify-start">
              <Button variant="glass" size="md" onClick={all ? onNone : onAll} aria-label={all ? t('select.clear_label') : t('select.all_label')} disabled={total === 0}>
                {all ? t('select.clear') : t('select.all')}
              </Button>
            </div>
            <p className="ws-count t-headline" aria-live="polite" data-wish-selection-count="">
              {count > 0 ? t('select.count', { count }) : t('select.none')}
            </p>
            <div className="flex items-center justify-end">
              <Button variant="glass" size="md" onClick={onDone} aria-label={t('select.done_label')} data-wish-selection-done="">
                {t('select.done')}
              </Button>
            </div>
          </div>
        </m.header>
      ) : null}
      {open ? (
        <m.div
          key="ws-bar"
          className="ws-bar"
          initial={slide(24)}
          animate={{ opacity: 1, y: 0 }}
          exit={slide(24)}
          transition={transition}
        >
          <div className="ws-bar-inner glass-float" role="toolbar" aria-label={t('select.bar_label')} data-wish-selection-bar="">
            <Action icon={<IconForward size={22} />} label={t('select.move')} a11y={t('select.move_label')} disabled={count === 0 || !online} onPress={() => setStage('move')} name="move" />
            {canAdd ? (
              <Action icon={<IconPlus size={22} />} label={t('select.add')} a11y={t('select.add_label')} disabled={count === 0 || !online} onPress={() => setStage('add')} name="add" />
            ) : null}
            <Action icon={<IconCheck size={22} />} label={t('select.received')} a11y={t('select.received_label')} disabled={count === 0 || !online} onPress={received} name="received" />
            <Action icon={<IconTrash size={22} />} label={t('select.delete')} a11y={t('select.delete_label')} disabled={count === 0} onPress={remove} name="delete" danger />
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  )

  return (
    <>
      {/* room under the last tiles, so the action bar never covers them */}
      {open ? <div aria-hidden="true" className="ws-spacer" /> : null}
      {root ? createPortal(bars, root) : null}

      {moveMounted ? (
        <Suspense fallback={null}>
          <MoveWishSheet
            open={stage === 'move' || stage === 'add'}
            onClose={() => setStage(null)}
            wishTitle=""
            currentListId={listId}
            title={stage === 'add' ? t('select.add_title') : undefined}
            lead={stage === 'add' ? t('select.add_lead', { count }) : t('select.move_lead', { count })}
            eventsOnly={stage === 'add'}
            emptyText={stage === 'add' ? t('select.add_empty') : undefined}
            onPick={pick}
          />
        </Suspense>
      ) : null}

      <Confirm
        open={stage === 'delete'}
        title={t('select.delete_confirm_title')}
        message={t('select.delete_confirm_text', { count: sharedCount })}
        confirmLabel={t('select.delete_confirm')}
        cancelLabel={t('select.delete_cancel')}
        destructive
        onConfirm={() => {
          const wishes = [...chosen]
          finish(() => bulkDeleteConfirmed(ctx, wishes), { kind: 'delete', leaving: wishes })
        }}
        onCancel={() => setStage(null)}
      />
    </>
  )
}

function Action({ icon, label, a11y, disabled, onPress, name, danger = false }: { icon: ReactNode; label: string; a11y: string; disabled: boolean; onPress: () => void; name: string; danger?: boolean }) {
  const tap = useTapScale(0.92)
  const snappy = useSpring('snappy')
  return (
    <m.button
      type="button"
      className="ws-act"
      data-danger={danger ? '' : undefined}
      data-wish-selection-action={name}
      aria-label={a11y}
      disabled={disabled}
      whileTap={disabled ? undefined : tap}
      transition={snappy}
      onClick={onPress}
    >
      <span aria-hidden="true" className="ws-act-icon">{icon}</span>
      <span aria-hidden="true" className="ws-act-label">{label}</span>
    </m.button>
  )
}
