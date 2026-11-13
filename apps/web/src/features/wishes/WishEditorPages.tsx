import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { getOccasionScreen } from '../../lib/api/occasions'
import type { OccasionScreen, OwnerWish } from '../../lib/api/types'
import { createWish, getWish, updateWish } from '../../lib/api/wishes'
import { isAppError, toAppError, type AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { toast } from '../../lib/toast'
import { Button, EmptyState, LargeTitle, Page, Skeleton, TopBar, buttonClass, tileTone } from '../../ui'
import { AmbientTint } from '../../ui/AmbientTint'
import { usePageTitle } from '../auth/shared'
import { scheduleWishDelete } from './pendingDeletes'
import { cameFromOwnerList, markWishAdded } from './wishAdded'
import { findCachedWish, invalidateWishViews, patchCachedWish } from './wishCache'
import { EMPTY_WISH_FORM, WishForm, type WishFormValues } from './WishForm'
import { saveWishPhoto } from './wishPhotos'
import { PressLink } from '../shell/MotionLink'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { useLeaveGuard } from '../occasions/leaveGuard'

// S8 screens (owner only): /occasions/$occasionId/wishes/new and /wishes/$wishId/edit.
// Owner screens: no reservation module, no reservation fields (the cache helpers strip them).
// After saving we return to the occasion: history back when the screen was opened from its list, otherwise
// (the "+" menu of the tab bar, a deep link) the occasion replaces this screen — the new wish is carried in.
// A save belongs to the account of the screen (captureEpoch): an answer after that account ended in
// this tab writes no cache, sets no flag and navigates nowhere.
// "Not found" and "not yours" are one answer, the same friendly page as for an occasion (product S15).
// The photo (2026-10-22) is saved AFTER the wish (saveWishPhoto): a failed photo leaves the wish saved and says so
// calmly; an edit that left a detail empty clears it on the server.

/** "Not found" / "no access" is a final answer: show it at once instead of retrying. */
function isFinal(error: unknown): boolean {
  return isAppError(error, 'not_found') || isAppError(error, 'not_allowed') || isAppError(error, 'forbidden')
}

function retryTransient(failureCount: number, error: unknown): boolean {
  return !isFinal(error) && failureCount < 1
}

function useReturn() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return useCallback(
    (occasionId: string | null) => {
      if (canGoBack) router.history.back()
      else if (occasionId) void navigate({ to: '/occasions/$occasionId', params: { occasionId }, replace: true })
      else void navigate({ to: '/soon', replace: true })
    },
    [router, canGoBack, navigate],
  )
}

function EditorPage({
  title,
  lead,
  occasionId,
  onBack,
  children,
}: {
  title: string
  lead?: string | null
  /** the wish belongs to this occasion: the screen glows in its colour, like the occasion screen */
  occasionId?: string | null
  onBack: () => void
  children: ReactNode
}) {
  const { t } = useTranslation('wishes')
  usePageTitle(title)
  return (
    <Page topBar={<TopBar large title={title} back={{ label: t('common.back'), onClick: onBack }} />}>
      {occasionId ? <AmbientTint tone={tileTone(occasionId)} /> : null}
      <div className="pt-4">
        <LargeTitle className={lead ? 'mb-1' : 'mb-4'}>{title}</LargeTitle>
        {lead ? <p className="mb-4 line-clamp-2 t-callout text-text-2 [overflow-wrap:anywhere]">{lead}</p> : null}
        {children}
      </div>
    </Page>
  )
}

/** "Wunsch verwerfen?" / "Änderungen verwerfen?" before typed input is thrown away (back tap or gesture). */
function useWishLeaveGuard(variant: 'new' | 'edit') {
  const { t } = useTranslation('wishes')
  const [dirty, setDirty] = useState(false)
  const guard = useLeaveGuard(dirty, {
    title: t(variant === 'new' ? 'wish.discard_new_title' : 'wish.discard_edit_title'),
    message: t('wish.discard_message'),
    confirm: t('wish.discard_confirm'),
    cancel: t('wish.discard_cancel'),
  })
  return { ...guard, onDirtyChange: setDirty }
}

/** The occasion's title from the screen already in memory (no request of its own). */
function useOccasionTitle(occasionId: string | null): string | null {
  const queryClient = useQueryClient()
  if (!occasionId) return null
  const screen = queryClient.getQueryData<OccasionScreen>(qk.occasion(occasionId))
  return screen?.occasion.title.trim() || null
}

/** Same shape as the form, so nothing jumps when it arrives (no spinner). */
function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="h-[50px]" />
      <Skeleton height={64} rounded="full" />
      <Skeleton height={176} rounded="lg" />
      <Skeleton height={96} rounded="lg" />
      <Skeleton height={148} rounded="lg" />
    </div>
  )
}

/**
 * One friendly page for "does not exist" and "not yours" (S15), built like OccasionUnavailable. It
 * never uses what a refused answer might tell (e.g. the wish's occasion): back = history or the feed.
 */
function WishUnavailable({ title }: { title: string }) {
  const { t } = useTranslation('wishes')
  const goBack = useReturn()
  usePageTitle(title)
  return (
    <Page topBar={<TopBar back={{ label: t('common.back'), onClick: () => goBack(null) }} />}>
      <EmptyState
        mascot={<BunnyMoment kind="lost" className="relative h-36 w-56" />}
        title={t('errors.not_found')}
        text={t('wish.not_found_hint')}
        action={
          <PressLink to="/soon" replace className={buttonClass({ variant: 'primary', size: 'lg', fullWidth: true })}>
            {t('common.to_start')}
          </PressLink>
        }
      />
    </Page>
  )
}

/** A transient load error (network, server hiccup): text + retry. Final answers never get here. */
function LoadError({ error, onRetry }: { error: AppError; onRetry: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    <div className="flex flex-col gap-4">
      <p role="alert" className="t-body text-danger">
        {t(error.key, error.params)}
      </p>
      <Button variant="secondary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}

type FormSource = Pick<OwnerWish, 'title' | 'price_cents' | 'url' | 'note' | 'priority' | 'description' | 'brand' | 'color' | 'gtin' | 'shop_name' | 'quantity'>

function toFormValues(wish: FormSource): WishFormValues {
  return {
    title: wish.title,
    priceCents: wish.price_cents,
    url: wish.url ?? '',
    note: wish.note ?? '',
    priority: wish.priority,
    // "Anzahl" (20261030120000): an older server sends none = 1
    quantity: wish.quantity ?? 1,
    description: wish.description ?? '',
    brand: wish.brand ?? '',
    color: wish.color ?? '',
    gtin: wish.gtin ?? null,
    shopName: wish.shop_name ?? null,
  }
}

export function NewWishPage({ occasionId }: { occasionId: string }) {
  const { t } = useTranslation('wishes')
  const queryClient = useQueryClient()
  const goBack = useReturn()
  // The occasion screen is usually still in memory: no extra request; a deep link loads it once.
  const screen = useQuery({
    queryKey: qk.occasion(occasionId),
    queryFn: () => getOccasionScreen(occasionId),
    refetchOnMount: (query) => query.state.data?.viewer.role === 'host' && !query.state.data.wishlist ? 'always' : false,
    refetchOnWindowFocus: false,
    retry: retryTransient,
  })
  const wishlistId = screen.data?.viewer.role === 'host' ? (screen.data.wishlist?.id ?? null) : null
  const occasionTitle = wishlistId ? screen.data?.occasion.title.trim() || null : null
  const title = t('wish.new_title')
  const navigate = useNavigate()
  const guard = useWishLeaveGuard('new')
  // opened from this occasion's list? (asked after mounting: the list's unmount came first, wishAdded.ts)
  const fromList = useRef(false)
  useEffect(() => {
    fromList.current = cameFromOwnerList(occasionId)
  }, [occasionId])

  if ((screen.isError && isFinal(screen.error)) || (screen.data && screen.data.viewer.role !== 'host')) return <WishUnavailable title={title} />
  return (
    <EditorPage
      title={title}
      lead={occasionTitle ? t('wish.for_occasion', { occasion: occasionTitle }) : null}
      occasionId={occasionId}
      onBack={() => guard.leave(() => goBack(occasionId))}
    >
      {guard.sheet}
      {screen.isPending || (!wishlistId && screen.isFetching) ? (
        <FormSkeleton />
      ) : screen.isError || !wishlistId ? (
        <LoadError error={toAppError(screen.error)} onRetry={() => void screen.refetch()} />
      ) : (
        <WishForm
          initial={EMPTY_WISH_FORM}
          submitLabel={t('wish.add')}
          variant="new"
          onDirtyChange={guard.onDirtyChange}
          onSubmit={async (input, { photo }) => {
            const epoch = captureEpoch()
            const wish = await createWish(wishlistId, input, epoch.userId)
            if (!epoch.isCurrent()) return
            // a wish of their own is saved: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
            void import('../sammlung/note').then((m) => m.noteMilestone('wish'), () => undefined)
            // the wish is saved; its photo follows (a failure keeps the wish and says so calmly)
            const saved = await saveWishPhoto(queryClient, wish.id, photo, epoch.userId)
            if (!epoch.isCurrent()) return
            if (!saved.ok) toast.info(t('wish.photo_save_failed'))
            guard.allow()
            markWishAdded(occasionId, wish.id)
            void invalidateWishViews(queryClient, occasionId).catch(() => undefined)
            // back to the list it was opened from; from the "+" menu or a deep link: open the occasion (this
            // screen's entry is replaced), so the new wish is carried into its list in front of the person
            if (fromList.current) goBack(occasionId)
            else void navigate({ to: '/occasions/$occasionId', params: { occasionId }, replace: true })
          }}
        />
      )}
    </EditorPage>
  )
}

export interface EditWishPageProps {
  wishId: string
  /** the account of the screen (the _authed guard's session): the owner check and the deep-link read */
  userId: string
}

export function EditWishPage({ wishId, userId }: EditWishPageProps) {
  const { t } = useTranslation('wishes')
  const queryClient = useQueryClient()
  const goBack = useReturn()
  // Usually opened from the occasion screen's sheet: prefill from memory, no request.
  const [cached] = useState(() => findCachedWish(queryClient, wishId))
  // Deep link / reload: the wish with its list row — occasion (return target) and owner. Memory
  // only, dropped on leave; pinned to the account of the screen.
  const fetched = useQuery({
    queryKey: ['wishForm', wishId],
    queryFn: () => getWish(wishId, userId),
    enabled: cached === null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: retryTransient,
  })
  const loaded = fetched.data ?? null
  const occasionId = cached?.occasionId ?? loaded?.wishlist.occasion_id ?? null
  // pilot: the list owner is the host — known from the occasion screen in memory, or from the list row
  const isOwner = cached ? cached.isHost : loaded !== null && loaded.wishlist.owner_id === userId
  const source = cached?.wish ?? loaded
  const title = t('wish.edit_title')
  const occasionTitle = useOccasionTitle(isOwner ? occasionId : null)
  const guard = useWishLeaveGuard('edit')

  function remove(wishTitle: string) {
    scheduleWishDelete({
      wishId,
      occasionId,
      queryClient,
      text: { deleted: t('wish.deleted', { title: wishTitle }), undo: t('wish.undo') },
      onError: (error) => {
        toast.error(t(error.key, error.params))
      },
    })
    // deleting leaves on purpose (the toast offers "Rückgängig")
    guard.allow()
    goBack(occasionId)
  }

  if ((source && !isOwner) || (!source && fetched.isError && isFinal(fetched.error))) return <WishUnavailable title={title} />

  let body: ReactNode
  if (!source && fetched.isError) body = <LoadError error={toAppError(fetched.error)} onRetry={() => void fetched.refetch()} />
  else if (!source) body = <FormSkeleton />
  else {
    body = (
      <WishForm
        initial={toFormValues(source)}
        submitLabel={t('common.save')}
        variant="edit"
        onDirtyChange={guard.onDirtyChange}
        onDelete={() => remove(source.title)}
        savedPhoto={{ wishId, meta: 'photo' in source ? source.photo : undefined }}
        onSubmit={async (input, { photo }) => {
          const epoch = captureEpoch()
          // a detail left empty in the form is cleared (the form leaves empty details out)
          const saved = await updateWish(
            wishId,
            {
              ...input,
              description: input.description ?? null,
              brand: input.brand ?? null,
              color: input.color ?? null,
              gtin: input.gtin ?? null,
              shop_name: input.shop_name ?? null,
            },
            epoch.userId,
          )
          if (!epoch.isCurrent()) return
          const photoSaved = await saveWishPhoto(queryClient, wishId, photo, epoch.userId)
          if (!epoch.isCurrent()) return
          if (!photoSaved.ok) toast.info(t('wish.photo_save_failed'))
          guard.allow()
          patchCachedWish(queryClient, occasionId, wishId, {
            title: saved.title,
            url: saved.url,
            price_cents: saved.price_cents,
            note: saved.note,
            priority: saved.priority,
            description: saved.description ?? null,
            brand: saved.brand ?? null,
            color: saved.color ?? null,
            gtin: saved.gtin ?? null,
            shop_name: saved.shop_name ?? null,
            ...(saved.quantity !== undefined ? { quantity: saved.quantity } : {}),
            ...(photoSaved.ok && photoSaved.photo !== undefined ? { photo: photoSaved.photo } : {}),
          })
          void invalidateWishViews(queryClient, occasionId).catch(() => undefined)
          goBack(occasionId)
        }}
      />
    )
  }

  return (
    <EditorPage
      title={title}
      lead={occasionTitle ? t('wish.for_occasion', { occasion: occasionTitle }) : null}
      occasionId={isOwner ? occasionId : null}
      onBack={() => guard.leave(() => goBack(occasionId))}
    >
      {guard.sheet}
      {body}
    </EditorPage>
  )
}
