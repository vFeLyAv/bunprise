import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch, renderedAccount } from '../../lib/accountBoundary'
import { asOwnerWishes, type OwnerWish } from '../../lib/api/types'
import { moveWish } from '../../lib/api/wishes'
import { addWishesToList, isSharedWishesUnavailable, sharedWishesEnabled } from '../../lib/api/wishPlaces'
import { toAppError, type AppError } from '../../lib/errors'
import { formatApproxPrice } from '../../lib/format'
import { feedback } from '../../lib/haptics'
import { ensureNamespaces } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { Button, Checkbox, IconBack, List, ListRow, SkeletonList } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { invalidateSharedWishViews, invalidateWishViews } from '../wishes/wishCache'
import { WishThumb } from '../wishes/WishPhoto'
import { coverToneOf, CoverTile } from './covers'
import { usePendingListDeletes } from './pendingListDeletes'
import { useListScreen, useListsOverview } from './queries'
import { isTabList } from './tabView'
import './lists.css'

// "Aus meinen Listen holen" (Felix 25.10) — OWNER module, a lazy chunk of the occasion screen's own wishlist
// (features/wishes/OwnerWishlist.tsx). Step 1: one of my lists without an occasion (who sees it, like
// MoveWishSheet); step 2: some of its open wishes; confirm → each wish MOVES into this occasion's list (move_wish).
// A move, never a copy: a copy would be a second wish two friends could both give — the same gift twice.
// Online only and server-confirmed one by one (no optimistic success); whatever the database does for givers
// stays in the database — this sheet only ever reads my own list through asOwnerWishes().
// SHARED WISHES (20261027200000, VITE_SHARED_WISHES — Felix 27.10 «одно желание в двух местах»): instead of moving, the
// chosen wishes are ADDED to this occasion's list in ONE call (add_wishes_to_list): the same wish, also still in its own
// list — one photo, one price, one reservation for everybody. Wishes already here show "Schon drin" (the owner list
// screen's also_in). A server without the migration or with the database switch off: the sheet says so and goes back to
// moving (one more tap — it never moves what you asked to share without telling you).

// the occasion screen can open this before anything of the lists tab was loaded
void ensureNamespaces('lists')

export interface BringFromListsSheetProps {
  open: boolean
  onClose: () => void
  /** my wishlist of the occasion: where the wishes move to (never offered as a source); none while only picking */
  targetListId?: string
  /** the occasion whose screen shows the moved wishes afterwards */
  occasionId?: string
  /**
   * Pick only (the new-occasion form, features/occasions/extras — Felix 26.10): the occasion does not exist yet, so
   * the chosen wishes are handed back instead of moved; they move once it does (extras/send.ts, the same move_wish).
   * Nothing is sent from the sheet then, so it works offline too.
   */
  onPick?: (picked: { wishes: OwnerWish[]; listId: string; listTitle: string }) => void
  /** wishes picked already: not offered again */
  exclude?: ReadonlySet<string>
}

type Stage = { kind: 'lists' } | { kind: 'wishes'; listId: string; title: string }

interface Outcome {
  failed: number
  total: number
  error: AppError
  /** shared mode: nothing was added (one call) */
  shared?: boolean
}

export default function BringFromListsSheet({ open, onClose, targetListId, occasionId, onPick, exclude }: BringFromListsSheetProps) {
  const { t } = useTranslation('lists')
  const queryClient = useQueryClient()
  const userId = renderedAccount() ?? ''
  const online = useOnline()
  const [stage, setStage] = useState<Stage>({ kind: 'lists' })
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // shared mode until the server says it cannot (then: the old move, after one more tap)
  const [shareOff, setShareOff] = useState(false)
  // the create flow (onPick) adds them too once the occasion exists (extras/send.ts): the same hint
  const shareHint = sharedWishesEnabled() && !shareOff
  const sharing = shareHint && !onPick && targetListId !== undefined
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // every opening starts at the lists again
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setStage({ kind: 'lists' })
      setSelected(new Set())
      setOutcome(null)
    }
  }

  const overview = useListsOverview(userId, open && userId !== '')
  const pendingDeletes = usePendingListDeletes()
  const lists = overview.data?.my_lists.filter((card) => isTabList(card) && card.id !== targetListId && !pendingDeletes.has(card.id)) ?? null

  const listId = stage.kind === 'wishes' ? stage.listId : ''
  const screen = useListScreen(listId, userId, open && stage.kind === 'wishes' && userId !== '')
  // the open wishes only ("Erhalten" ones stay where they are); my own data, cleaned first
  const wishes: OwnerWish[] | null =
    stage.kind === 'wishes' && screen.data ? asOwnerWishes(screen.data.wishes).filter((wish) => !exclude?.has(wish.id)) : null
  /** shared mode: the wish is in this occasion's list already ("Schon drin") */
  const isHere = (wish: OwnerWish) => sharing && (wish.also_in ?? []).some((place) => place.id === targetListId)
  const busy = progress !== null
  // Q4 (default: yes, with a warning): wishes from a "Nur ich" list become visible to the guests of the occasion
  const fromPrivate = shareHint && stage.kind === 'wishes'
    && overview.data?.my_lists.some((card) => card.id === stage.listId && card.visibility === 'private') === true
  const chosenCount = wishes ? wishes.filter((wish) => selected.has(wish.id) && !isHere(wish)).length : 0

  function toggle(wishId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(wishId)
      else next.delete(wishId)
      return next
    })
  }

  async function bring() {
    if (!wishes || busy) return
    const chosen = wishes.filter((wish) => selected.has(wish.id) && !isHere(wish))
    if (chosen.length === 0) return
    if (onPick) {
      // picking for an occasion that does not exist yet: hand them back, they move once it does
      if (stage.kind !== 'wishes') return
      onPick({ wishes: chosen, listId: stage.listId, listTitle: stage.title })
      feedback('success')
      onClose()
      return
    }
    if (!online || !targetListId) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    setOutcome(null)
    setProgress({ done: 0, total: chosen.length })
    if (sharing) {
      try {
        await addWishesToList(targetListId, chosen.map((wish) => wish.id), epoch.userId)
        if (!epoch.isCurrent()) return
        void invalidateSharedWishViews(queryClient, occasionId ?? null).catch(() => undefined)
        if (!alive.current) return
        setProgress(null)
        feedback('success')
        toast.success(t('lists.bring.added', { count: chosen.length }))
        onClose()
      } catch (err) {
        if (!epoch.isCurrent() || !alive.current) return
        setProgress(null)
        feedback('error')
        if (isSharedWishesUnavailable(err)) {
          // the server cannot share yet: say so, the button now moves (as before)
          setShareOff(true)
          toast.info(t('lists.bring.share_unavailable'))
          return
        }
        setOutcome({ failed: chosen.length, total: chosen.length, error: toAppError(err), shared: true })
      }
      return
    }
    const failedIds: string[] = []
    let firstError: AppError | null = null
    for (const [index, wish] of chosen.entries()) {
      try {
        await moveWish(wish.id, targetListId, epoch.userId)
      } catch (err) {
        failedIds.push(wish.id)
        firstError ??= toAppError(err)
      }
      if (!epoch.isCurrent()) return // a former account's answers: not a word about them
      if (alive.current) setProgress({ done: index + 1, total: chosen.length })
    }
    // both lists, the tab's numbers, this occasion's screen and the feed
    void invalidateWishViews(queryClient, occasionId ?? null).catch(() => undefined)
    if (!alive.current) return
    setProgress(null)
    const moved = chosen.length - failedIds.length
    if (failedIds.length === 0) {
      feedback('success')
      toast.success(t('lists.bring.done', { count: moved }))
      onClose()
      return
    }
    feedback('error')
    // the ones that did not move stay chosen, so "again" is one tap
    setSelected(new Set(failedIds))
    setOutcome({ failed: failedIds.length, total: chosen.length, error: firstError ?? toAppError(null) })
  }

  const back =
    stage.kind === 'wishes' ? (
      <button
        type="button"
        className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 t-subhead font-semibold text-accent-text disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setStage({ kind: 'lists' })
          setSelected(new Set())
          setOutcome(null)
        }}
      >
        <IconBack size={18} />
        {t('lists.bring.back')}
      </button>
    ) : null

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={stage.kind === 'lists' ? t('lists.bring.title') : stage.title}
      closeLabel={t('common.close')}
      footer={
        stage.kind === 'wishes' && wishes && wishes.length > 0 ? (
          <div className="flex flex-col gap-2">
            {progress ? (
              <p role="status" className="t-footnote text-text-2">
                {t('lists.bring.progress', { done: progress.done, total: progress.total })}
              </p>
            ) : !online && !onPick ? (
              <p role="status" className="t-footnote text-text-2">
                {t('lists.bring.offline')}
              </p>
            ) : null}
            <Button size="lg" fullWidth loading={busy} loadingLabel={sharing ? t('lists.bring.adding') : t('lists.bring.moving')} disabled={(!online && !onPick) || chosenCount === 0} onClick={() => void bring()}>
              {chosenCount === 0 ? t('lists.bring.confirm_none') : sharing ? t('lists.bring.confirm_shared', { count: chosenCount }) : t('lists.bring.confirm', { count: chosenCount })}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 pb-2" data-bring-picker="">
        {back}
        <p className="t-subhead text-text-2">{shareHint ? t('lists.bring.hint_shared') : t('lists.bring.hint')}</p>
        {fromPrivate && stage.kind === 'wishes' ? (
          <p className="t-footnote text-text-2" data-bring-private="">{t('lists.bring.private_warning', { list: stage.title })}</p>
        ) : null}
        {stage.kind === 'lists' ? (
          lists === null ? (
            overview.isError ? (
              <div className="flex flex-col items-start gap-2">
                <p className="t-body text-text">{t('lists.card.load_failed')}</p>
                <Button size="sm" variant="secondary" onClick={() => void overview.refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : (
              <div className="glass-panel rounded-lg">
                <SkeletonList rows={2} />
              </div>
            )
          ) : lists.length === 0 ? (
            <p className="ls-move-empty glass-panel">{t('lists.bring.no_lists')}</p>
          ) : (
            <List className="glass-panel rounded-lg">
              {lists.map((card) => {
                const title = card.title?.trim() || t('lists.card.untitled')
                return (
                  <ListRow
                    key={card.id}
                    leading={<CoverTile tone={coverToneOf(card.cover_tone, card.id)} icon={card.cover_icon} size={40} />}
                    title={title}
                    subtitle={`${t('lists.card.wishes', { count: card.wish_count })} · ${t(`lists.card.visibility_${card.visibility}`)}`}
                    chevron
                    disabled={card.wish_count === 0}
                    onPress={() => setStage({ kind: 'wishes', listId: card.id, title })}
                  />
                )
              })}
            </List>
          )
        ) : wishes === null ? (
          screen.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="t-body text-text">{t('lists.card.load_failed')}</p>
              <Button size="sm" variant="secondary" onClick={() => void screen.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <div className="glass-panel rounded-lg">
              <SkeletonList rows={3} />
            </div>
          )
        ) : wishes.length === 0 ? (
          <p className="ls-move-empty glass-panel">{t('lists.bring.list_empty')}</p>
        ) : (
          <div className="glass-panel flex flex-col rounded-lg px-4 py-1" role="group" aria-label={t('lists.bring.choose_label')}>
            {wishes.map((wish) => {
              const price = formatApproxPrice(wish.price_cents, { currency: wish.currency })
              const here = isHere(wish)
              return (
                <Checkbox key={wish.id} checked={here || selected.has(wish.id)} disabled={busy || here} onChange={(on) => toggle(wish.id, on)} className="items-center">
                  <span className="flex min-w-0 items-center gap-3">
                    {/* the photo lies OVER the letter tile (wish-thumb-img: absolute, same box) — a class of its own
                        here put it into a second grid row, cut off by overflow-hidden: no photo (Felix 27.10) */}
                    <WishThumb wish={wish} className="size-11 overflow-hidden rounded-md bg-fill">
                      <span aria-hidden="true" className="grid size-11 place-items-center t-headline text-text-2">
                        {wish.title.trim().charAt(0).toUpperCase()}
                      </span>
                    </WishThumb>
                    <span className="flex min-w-0 flex-col">
                      <span className="line-clamp-2 t-subhead text-text [overflow-wrap:anywhere]">{wish.title}</span>
                      {here ? <span className="t-footnote text-text-2" data-bring-already="">{t('lists.bring.already')}</span> : price ? <span className="t-footnote tabular-nums text-text-2">{price}</span> : null}
                    </span>
                  </span>
                </Checkbox>
              )
            })}
          </div>
        )}
        {outcome ? (
          <p role="alert" className="t-footnote text-danger">
            {outcome.shared ? t('lists.bring.add_failed') : t('lists.bring.partial', { count: outcome.failed, total: outcome.total })} {t(outcome.error.key, outcome.error.params)}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
