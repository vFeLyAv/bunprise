import { useEffect, useRef } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { createWish } from '../../lib/api/wishes'
import { AppError, toAppError } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { LargeTitle, Page, Skeleton, TopBar } from '../../ui'
import { AmbientTint } from '../../ui/AmbientTint'
import { usePageTitle } from '../auth/shared'
import { cameFromOwnerList, markWishAdded } from '../wishes/wishAdded'
import { EMPTY_WISH_FORM, WishForm } from '../wishes/WishForm'
import { saveWishPhoto } from '../wishes/wishPhotos'
import { coverToneOf } from './covers'
import { listsEnabled } from './flag'
import { ListsSoon } from './ListsPage'
import { ListLoadError, ListUnavailable } from './parts'
import { invalidateLists, isListUnavailable, useListScreen } from './queries'

// "+ Wunsch" on a list without an occasion (follows-design §2.7) — OWNER screen: the SAME link-first WishForm
// as an occasion's list (features/wishes, reused as is), targeting this list. After saving: back to the list
// it was opened from (Pompon carries the new wish in there, wishAdded.ts keyed by the list's id), otherwise
// (a deep link, a later "+" menu target) the list replaces this screen. Only the list's owner sees the form;
// anyone else gets the one "nicht verfügbar" page. A save belongs to the account of the screen.

export function ListNewWishPage({ listId, userId }: { listId: string; userId: string }) {
  if (!listsEnabled()) return <ListsSoon />
  return <NewWish listId={listId} userId={userId} />
}

function NewWish({ listId, userId }: { listId: string; userId: string }) {
  const { t } = useTranslation(['wishes', 'lists'])
  const queryClient = useQueryClient()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  // the list's screen is usually in memory already: no extra request (a deep link loads it once)
  const screen = useListScreen(listId, userId)
  const title = t('wish.new_title')
  usePageTitle(title)
  const fromList = useRef(false)
  useEffect(() => {
    fromList.current = cameFromOwnerList(listId)
  }, [listId])

  const goBack = () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/lists/$listId', params: { listId }, replace: true })
  }

  if ((screen.isError && isListUnavailable(screen.error)) || (screen.data && screen.data.viewer.role !== 'owner')) return <ListUnavailable />
  const list = screen.data?.list
  return (
    <Page topBar={<TopBar large title={title} back={{ label: t('common.back'), onClick: goBack }} />}>
      <AmbientTint tone={coverToneOf(list?.cover_tone ?? null, listId)} />
      <div className="pt-4">
        <LargeTitle className={list ? 'mb-1' : 'mb-4'}>{title}</LargeTitle>
        {list ? <p className="mb-4 line-clamp-2 t-callout text-text-2 [overflow-wrap:anywhere]">{t('lists:lists.new_wish.lead', { list: list.title })}</p> : null}
        {!screen.data ? (
          screen.isError ? (
            <ListLoadError error={toAppError(screen.error)} onRetry={() => void screen.refetch()} />
          ) : (
            <div aria-busy="true" className="flex flex-col gap-4">
              <div className="h-[50px]" />
              <Skeleton height={64} rounded="full" />
              <Skeleton height={176} rounded="lg" />
            </div>
          )
        ) : (
          <WishForm
            initial={EMPTY_WISH_FORM}
            submitLabel={t('wish.add')}
            variant="new"
            onSubmit={async (input, { photo }) => {
              const epoch = captureEpoch()
              if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) throw new AppError('session_expired')
              const wish = await createWish(listId, input, userId)
              if (!epoch.isCurrent()) return
              // a wish of their own is saved: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
              void import('../sammlung/note').then((m) => m.noteMilestone('wish'), () => undefined)
              // the photo follows the saved wish (a failure keeps the wish and says so calmly)
              const saved = await saveWishPhoto(queryClient, wish.id, photo, userId)
              if (!epoch.isCurrent()) return
              if (!saved.ok) toast.info(t('wish.photo_save_failed'))
              // the moment on the list (keyed by its id), the list screen and the tab refresh
              markWishAdded(listId, wish.id)
              void invalidateLists(queryClient, listId).catch(() => undefined)
              if (fromList.current) goBack()
              else void navigate({ to: '/lists/$listId', params: { listId }, replace: true })
            }}
          />
        )}
      </div>
    </Page>
  )
}
