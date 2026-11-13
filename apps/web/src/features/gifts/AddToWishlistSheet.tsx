import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { DEMO_MODE, LIMITS } from '../../lib/app'
import { isDemoShopUrl, type GiftIdea } from '../../lib/api/giftIdeas'
import { createList, newListId } from '../../lib/api/lists'
import { LIST_TITLE_MAX } from '../../lib/api/lists.types'
import { createWish } from '../../lib/api/wishes'
import { toAppError } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { Button, Chip, ChipGroup, Skeleton, TextField, buttonClass } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { listsEnabled } from '../lists/flag'
import { PressLink } from '../shell/MotionLink'
import { markWishAdded } from '../wishes/wishAdded'
import { invalidateWishViews } from '../wishes/wishCache'
import { EMPTY_WISH_FORM, WishForm, type WishFormValues } from '../wishes/WishForm'
import { saveWishPhoto } from '../wishes/wishPhotos'
import { giftKeys, useLoadedLists, useMyGiftLists } from './sources'
import './gifts.css'

// "Zu meiner Wunschliste" ("Für mich"): the EXISTING new-wish form (features/wishes/WishForm — same fields,
// limits, link reading and save), opened in a sheet and filled with the idea: title, price, link. Only lists
// I host take wishes (RLS wishes_insert; the pilot: one list per occasion). After saving, the occasion's list
// gets the "wish added" moment (Pompon carries it in when it is opened next — wishAdded.ts) and the screen
// says so with a way there. Owner side: no reservation code here (features/gifts/secrecy.test.ts).
// An invented demo shop's link and price are only taken in the demo world: outside it they would point
// nowhere and cost nothing real — then only the title is filled.
// Without an own list (every new user): "Wunschliste anlegen" right here — a list for me alone ("Nur ich", the
// default of a new list), named "Meine Wünsche" unless I type another name — and the same sheet goes on to the
// prefilled form, so the idea is not lost. "Lieber für einen Anlass" stays as the second way.

export interface AddToWishlistSheetProps {
  userId: string
  idea: GiftIdea | null
  open: boolean
  onClose: () => void
  /** saved: the wish's title and the list it is on (with its occasion, when it has one) */
  onAdded: (idea: GiftIdea, result: { title: string; occasionId: string | null; listId: string }) => void
}

function prefill(idea: GiftIdea): WishFormValues {
  const offer = idea.offers[0]
  const real = offer ? !isDemoShopUrl(offer.url) || DEMO_MODE : false
  return {
    ...EMPTY_WISH_FORM,
    title: [...idea.title].slice(0, LIMITS.wishTitle).join(''),
    priceCents: offer && real ? offer.price_cents : null,
    url: offer && real ? offer.url : '',
  }
}

export default function AddToWishlistSheet({ userId, idea, open, onClose, onAdded }: AddToWishlistSheetProps) {
  const { t } = useTranslation(['gifts', 'wishes'])
  const queryClient = useQueryClient()
  const mine = useMyGiftLists(userId)
  const refs = mine.data ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const ref = refs.find((candidate) => candidate.key === picked) ?? refs[0] ?? null
  const pickedRefs = useMemo(() => (ref ? [ref] : []), [ref])
  const loaded = useLoadedLists(userId, pickedRefs)
  const list = loaded.lists[0] ?? null

  let body
  if (mine.isPending || (ref && loaded.pending)) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-4">
        <p role="status" className="sr-only">
          {t('gifts.add_loading')}
        </p>
        <Skeleton height={64} rounded="full" />
        <Skeleton height={176} rounded="lg" />
        <Skeleton height={96} rounded="lg" />
      </div>
    )
  } else if (mine.isError || loaded.failed) {
    body = (
      <div className="flex flex-col gap-3">
        <p role="alert" className="t-body text-danger">
          {t('gifts.add_error')}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            if (mine.isError) void mine.refetch()
            loaded.refetchFailed()
          }}
        >
          {t('gifts.retry')}
        </Button>
      </div>
    )
  } else if (!ref || !list?.wishlistId) {
    body = <NewListStep userId={userId} onCreated={setPicked} onLeave={onClose} />
  } else if (idea) {
    const wishlistId = list.wishlistId
    body = (
      <div className="flex flex-col gap-4">
        {refs.length > 1 ? (
          <section className="flex flex-col gap-2">
            <h3 className="px-1 t-caption-1 font-semibold uppercase tracking-[0.06em] text-text-2">{t('gifts.add_which')}</h3>
            <ChipGroup label={t('gifts.add_which')}>
              {refs.map((candidate) => (
                <Chip key={candidate.key} role="radio" selected={candidate.key === ref.key} onClick={() => setPicked(candidate.key)}>
                  {candidate.title}
                </Chip>
              ))}
            </ChipGroup>
          </section>
        ) : null}
        <WishForm
          key={`${idea.id}-${ref.key}`}
          initial={prefill(idea)}
          submitLabel={t('gifts.add_submit')}
          variant="edit"
          onSubmit={async (input, { photo }) => {
            const epoch = captureEpoch()
            const wish = await createWish(wishlistId, input, epoch.userId ?? userId).catch((err: unknown) => {
              throw toAppError(err)
            })
            if (!epoch.isCurrent()) return
            // a wish of their own is saved: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
            void import('../sammlung/note').then((m) => m.noteMilestone('wish'), () => undefined)
            // a photo read from the link ("Neu einlesen") follows the saved wish; a failure keeps the wish
            const saved = await saveWishPhoto(queryClient, wish.id, photo, epoch.userId ?? userId)
            if (!epoch.isCurrent()) return
            if (!saved.ok) toast.info(t('wishes:wish.photo_save_failed'))
            if (list.occasionId) markWishAdded(list.occasionId, wish.id)
            void invalidateWishViews(queryClient, list.occasionId).catch(() => undefined)
            onAdded(idea, { title: wish.title, occasionId: list.occasionId, listId: wishlistId })
          }}
        />
      </div>
    )
  }

  // the short "no list yet" step floats at its own height; the form takes the full sheet
  const short = !mine.isPending && !mine.isError && !(ref && loaded.pending) && !loaded.failed && (!ref || !list?.wishlistId)
  return (
    <Sheet open={open} onClose={onClose} title={t('gifts.add_title')} closeLabel={t('common.close')} detent={short ? 'content' : 'full'}>
      {body}
    </Sheet>
  )
}

/** No own list yet: make one here (for me alone), then the sheet shows the form for it. */
function NewListStep({ userId, onCreated, onLeave }: { userId: string; onCreated: (key: string) => void; onLeave: () => void }) {
  const { t } = useTranslation(['gifts', 'wishes'])
  const queryClient = useQueryClient()
  const online = useOnline()
  const [title, setTitle] = useState(() => t('gifts.add_new_list_name'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = title.trim()
  const tooLong = [...name].length > LIST_TITLE_MAX

  async function create() {
    if (busy || name === '' || tooLong) return
    if (!online) {
      setError(t('gifts.add_new_list_offline'))
      return
    }
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    setBusy(true)
    setError(null)
    const id = newListId()
    try {
      // "Nur ich": nobody else sees it until I share it (the lists tab can change that later)
      await createList({ id, title: name, visibility: 'private', cover_tone: null, cover_icon: 'star', due_on: null }, userId)
      if (!epoch.isCurrent()) return
      // a list of their own: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      void import('../sammlung/note').then((m) => m.noteMilestone('list'), () => undefined)
      onCreated(`list:${id}`)
      // the lists tab and "Für mich" learn about it; this sheet's own list query brings the form
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lists'], exact: true }),
        queryClient.invalidateQueries({ queryKey: giftKeys.myLists(userId) }),
      ])
    } catch (err) {
      if (!epoch.isCurrent()) return
      const appError = toAppError(err)
      setError(appError.code === 'network' ? t('gifts.add_new_list_offline') : t(appError.key, appError.params))
    } finally {
      if (epoch.isCurrent()) setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-1">
      <div className="flex flex-col gap-1.5">
        <h3 className="t-title-3 text-text">{t('gifts.add_none_title')}</h3>
        <p className="t-callout text-text-2">{listsEnabled() ? t('gifts.add_none_text') : t('gifts.add_none_text_occasion')}</p>
      </div>
      {listsEnabled() ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <TextField
            label={t('gifts.add_new_list_label')}
            value={title}
            maxLength={LIST_TITLE_MAX + 20}
            autoComplete="off"
            enterKeyHint="done"
            error={tooLong ? t('gifts.add_new_list_too_long', { max: LIST_TITLE_MAX }) : (error ?? undefined)}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy || name === '' || tooLong}>
            {busy ? t('gifts.add_new_list_busy') : t('gifts.add_new_list_action')}
          </Button>
        </form>
      ) : null}
      <PressLink to="/occasions/new" className={buttonClass({ variant: listsEnabled() ? 'ghost' : 'primary', size: 'lg', fullWidth: true })} onClick={onLeave}>
        {listsEnabled() ? t('gifts.add_none_occasion') : t('gifts.add_none_action')}
      </PressLink>
    </div>
  )
}
