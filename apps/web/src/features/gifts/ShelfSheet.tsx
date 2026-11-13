import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { GiftIdea } from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import { IconForward, IconPlus, IconX, fade, haptic, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { GiftPicture } from './GiftPicture'
import { priceRangeLabel } from './labels'
import './gifts.css'

// The kept ideas: "Für Anna gemerkt" (on this device, Anna never sees it) or "Gefällt dir" (this visit).
// Tap one → "Wo erhältlich"; "Für mich" also offers "Zu meiner Wunschliste" per idea.
// × removes one at once; its place keeps a quiet "„…“ entfernt · Rückgängig" row while the sheet is open (the
// ideas live only on this device: a slip must be easy to take back — a toast under the sheet could not be tapped).

export interface ShelfSheetProps {
  open: boolean
  onClose: () => void
  title: string
  note: string
  ideas: readonly GiftIdea[]
  onOpen: (idea: GiftIdea) => void
  onRemove: (idea: GiftIdea) => void
  /** the idea removed last (shown at its old place with "Rückgängig") */
  removed?: { idea: GiftIdea; at: number } | null
  onUndoRemove?: () => void
  onAddToList?: (idea: GiftIdea) => void
}

type ShelfEntry = { kind: 'idea'; idea: GiftIdea } | { kind: 'removed'; idea: GiftIdea }

/** The kept ideas with the one removed last back at its old place (as its "Rückgängig" row). */
function withRemoved(ideas: readonly GiftIdea[], removed: { idea: GiftIdea; at: number } | null): ShelfEntry[] {
  const entries: ShelfEntry[] = ideas.map((idea) => ({ kind: 'idea', idea }))
  if (removed && !ideas.some((idea) => idea.id === removed.idea.id)) entries.splice(Math.min(removed.at, entries.length), 0, { kind: 'removed', idea: removed.idea })
  return entries
}

export function ShelfSheet({ open, onClose, title, note, ideas, onOpen, onRemove, removed = null, onUndoRemove, onAddToList }: ShelfSheetProps) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const tap = useTapScale(0.98)
  return (
    <Sheet open={open} onClose={onClose} title={title} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-3 pb-2">
        <p className="px-1 t-footnote text-text-2">{note}</p>
        {ideas.length === 0 && !removed ? <p className="px-1 py-6 text-center t-callout text-text-2">{t('gifts.shelf_empty')}</p> : null}
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {withRemoved(ideas, removed).map(({ kind, idea }) => kind === 'removed' ? (
              <m.li
                key={`removed-${idea.id}`}
                layout={reduced ? false : 'position'}
                className="flex min-h-14 items-center gap-2 rounded-lg py-1 pl-3 pr-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: fade }}
                transition={{ ...smooth, opacity: fade }}
              >
                <p role="status" className="min-w-0 flex-1 truncate t-footnote text-text-2">
                  {t('gifts.shelf_removed', { title: idea.title })}
                </p>
                <button
                  type="button"
                  className="inline-flex h-11 shrink-0 items-center rounded-full px-3 t-subhead font-semibold text-accent-text tr-colors active:bg-fill"
                  onPointerDown={() => haptic('tap')}
                  onClick={onUndoRemove}
                >
                  {t('gifts.toast_undo')}
                </button>
              </m.li>
            ) : (
              <m.li
                key={idea.id}
                layout={reduced ? false : 'position'}
                className="flex items-center gap-2 rounded-lg p-2 pr-1 glass-panel"
                // an idea brought back by "Rückgängig" fades in at its place (the first rows do not: initial={false} above)
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduced ? { opacity: 0, transition: fade } : { opacity: 0, x: -24, transition: { ...smooth, opacity: fade } }}
                transition={smooth}
              >
                <m.button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                  whileTap={tap}
                  onPointerDown={() => haptic('tap')}
                  onClick={() => onOpen(idea)}
                >
                  <GiftPicture idea={idea} size="thumb" className="h-14 w-14 shrink-0 rounded-[14px]" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 t-subhead font-semibold text-text [overflow-wrap:anywhere]">{idea.title}</span>
                    <span className="block t-footnote tabular-nums text-text-2">{priceRangeLabel(t, idea, locale)}</span>
                  </span>
                  <IconForward size={16} className="shrink-0 text-text-3" />
                </m.button>
                {onAddToList ? (
                  <button
                    type="button"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-text tr-colors active:bg-accent-200"
                    aria-label={t('gifts.add_to_list')}
                    onPointerDown={() => haptic('tap')}
                    onClick={() => onAddToList(idea)}
                  >
                    <IconPlus size={20} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-2 tr-colors active:bg-fill"
                  aria-label={t('gifts.shelf_remove', { title: idea.title })}
                  onPointerDown={() => haptic('tap')}
                  onClick={() => onRemove(idea)}
                >
                  <IconX size={18} />
                </button>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </Sheet>
  )
}
