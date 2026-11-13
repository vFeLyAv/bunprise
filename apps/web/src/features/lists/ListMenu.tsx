import { Suspense, lazy, useRef, useState, type ChangeEvent } from 'react'
import * as m from 'motion/react-m'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { LIST_PHOTOS_PER_OWNER } from '../../lib/api/listPhotos'
import type { CoverIcon, CoverTone, ListVisibility } from '../../lib/api/lists.types'
import { isPhotoLimitError } from '../../lib/api/photos'
import type { ListPhotoMeta } from '../../lib/api/types'
import { isFeatureUnavailableError } from '../../lib/api/unavailable'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { IconButton, IconMore, List, ListRow, haptic, useSpring, useTapScale } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { useFollowLinks } from './links'
import { applyListVisibility, changeListCover, markCoverPreparing, useCoverChange } from './listCovers'
import { ListShareSheet } from './ListShareSheet'
import { scheduleListDelete } from './pendingListDeletes'
import { VisibilitySheet } from './VisibilitySheet'

// The "⋯" of one of MY lists (Felix 22.10) — on its card in "Listen" and in its screen's bar. OWNER module: every
// row is about the owner's own list, nothing depends on anything anybody else did on it.
//   Teilen        → ListShareSheet (the list's link for followers, the follow link for new people; "Nur ich" → visibility)
//   Bearbeiten    → the existing edit sheet (title, colour, symbol, date)
//   Sichtbarkeit  → the existing "Wer sieht die Liste?" (its confirm step for "Nur ich" stays)
//   Titelbild     → the system picker → preparePhoto on the device (≤ 1600 px, WebP/JPEG ≤ 400 KB, no EXIF/GPS) →
//                   uploadListPhoto; "entfernen" → deleteListPhoto. The new picture shows at once (listCovers.ts).
//   Liste löschen → the confirm sheet, then the 5 s "Rückgängig" of pendingListDeletes.ts
// A server without today's migration: FeatureUnavailableError → the calm "Das geht bald" toast.

const CreateListSheet = lazy(() => import('./CreateListSheet'))

export interface ListMenuList {
  id: string
  title: string
  visibility: ListVisibility
  cover_tone: CoverTone | null
  cover_icon: CoverIcon | null
  due_on: string | null
  photo?: ListPhotoMeta | null
}

export type ListMenuStage = 'menu' | 'share' | 'edit' | 'visibility' | 'delete' | null

export interface ListMenuProps {
  list: ListMenuList
  userId: string
  /** stats.followers for the visibility sheet — null when unknown */
  followers: number | null
  stage: ListMenuStage
  onStage: (stage: ListMenuStage) => void
  /** the delete was confirmed (the list's own screen goes back to the tab) */
  onDeleted?: () => void
}

const PROBLEM_KEY = { not_image: 'lists.cover.not_image', too_large: 'lists.cover.too_large', failed: 'lists.cover.failed' } as const

/** Says calmly why a list call did not work (shared by the menu's actions). */
export function listActionError(t: TFunction<'lists'>, err: unknown): void {
  feedback('error')
  if (isFeatureUnavailableError(err)) {
    toast.info(t('lists.unavailable'))
    return
  }
  if (isPhotoLimitError(err)) {
    toast.error(t('lists.cover.limit', { max: LIST_PHOTOS_PER_OWNER }))
    return
  }
  const error = toAppError(err)
  toast.error(t(error.key, error.params))
}

export function ListMenu({ list, userId, followers, stage, onStage, onDeleted }: ListMenuProps) {
  const { t } = useTranslation('lists')
  const queryClient = useQueryClient()
  const online = useOnline()
  const links = useFollowLinks()
  const input = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState<ReadonlySet<ListMenuStage>>(() => new Set())
  if (stage && !mounted.has(stage)) setMounted(new Set([...mounted, stage]))
  const change = useCoverChange(list.id)
  const hasCover = change?.kind === 'upload' || (change?.kind !== 'remove' && Boolean(list.photo))
  const busy = change !== undefined
  const close = () => onStage(null)

  function pickPhoto() {
    close()
    // in the tap itself (a user gesture): the system picker — library or camera on a phone
    input.current?.click()
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again
    if (!file) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    markCoverPreparing(list.id, true)
    try {
      const { preparePhoto, PhotoPrepareError } = await import('../occasions/photo/pipeline')
      const photo = await preparePhoto(file).catch((err: unknown) => {
        if (epoch.isCurrent()) {
          feedback('error')
          toast.error(t(err instanceof PhotoPrepareError ? PROBLEM_KEY[err.problem] : PROBLEM_KEY.failed))
        }
        return null
      })
      if (!photo || !epoch.isCurrent()) return
      const ok = await changeListCover({
        listId: list.id,
        userId,
        queryClient,
        change: { kind: 'upload', photo },
        onError: (err) => listActionError(t, err),
      })
      if (ok) {
        feedback('success')
        toast.success(t('lists.cover.saved'))
      }
    } finally {
      markCoverPreparing(list.id, false)
    }
  }

  function removePhoto() {
    close()
    void changeListCover({ listId: list.id, userId, queryClient, change: { kind: 'remove' }, onError: (err) => listActionError(t, err) }).then((ok) => {
      if (ok) {
        feedback('success')
        toast.info(t('lists.cover.removed'))
      }
    })
  }

  function remove() {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    close()
    scheduleListDelete({
      listId: list.id,
      userId,
      queryClient,
      text: { deleted: t('lists.delete.deleted', { title: list.title }), undo: t('lists.delete.undo') },
      onError: () => {
        toast.error(t('lists.delete.failed'))
      },
    })
    onDeleted?.()
  }

  return (
    <>
      <Sheet open={stage === 'menu'} onClose={close} title={list.title} closeLabel={t('common.close')}>
        {/* plain text rows like every ⋯ of the app (OccasionMenu): destructive last and in red */}
        <List className="pb-2" data-list-menu={list.id}>
          <ListRow title={t('lists.menu.share')} onPress={() => onStage('share')} />
          <ListRow title={t('lists.menu.edit')} onPress={() => onStage('edit')} />
          <ListRow title={t('lists.menu.visibility')} onPress={() => onStage('visibility')} />
          <ListRow
            title={hasCover ? t('lists.menu.cover_change') : t('lists.menu.cover_add')}
            subtitle={hasCover ? undefined : t('lists.menu.cover_hint')}
            disabled={!online || busy}
            onPress={pickPhoto}
          />
          {hasCover ? <ListRow title={t('lists.menu.cover_remove')} disabled={!online || busy} onPress={removePhoto} /> : null}
          <ListRow title={<span className="text-danger">{t('lists.menu.delete')}</span>} disabled={!online} onPress={() => onStage('delete')} />
        </List>
      </Sheet>

      {/* outside the sheets: it must still be in the page when the picker answers */}
      <input ref={input} type="file" accept="image/*" className="lc-file" tabIndex={-1} aria-hidden="true" onChange={(event) => void onFile(event)} />

      {mounted.has('share') ? (
        <ListShareSheet
          open={stage === 'share'}
          onClose={close}
          list={list}
          userId={userId}
          onVisibility={() => onStage('visibility')}
          onFollowLink={() => {
            close()
            links.shareFollowLink()
          }}
        />
      ) : null}

      {mounted.has('visibility') ? (
        <VisibilitySheet
          open={stage === 'visibility'}
          onClose={close}
          listId={list.id}
          visibility={list.visibility}
          followers={followers}
          userId={userId}
          onChanged={(visibility) => applyListVisibility(queryClient, list.id, visibility)}
        />
      ) : null}

      <Confirm
        open={stage === 'delete'}
        destructive
        title={t('lists.delete.title', { title: list.title })}
        // the text depends on the visibility only — never on what anybody did on the list
        message={list.visibility === 'followers' ? t('lists.delete.message_followers') : t('lists.delete.message')}
        confirmLabel={t('lists.delete.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={remove}
        onCancel={close}
      />

      {mounted.has('edit') ? (
        <Suspense fallback={null}>
          <CreateListSheet
            open={stage === 'edit'}
            onClose={close}
            userId={userId}
            mode={{ kind: 'edit', list: { id: list.id, title: list.title, cover_tone: list.cover_tone, cover_icon: list.cover_icon, due_on: list.due_on } }}
          />
        </Suspense>
      ) : null}
    </>
  )
}

/** The ⋯ of a list card: a small glass dot on the card's corner (44 px to tap), never inside the card's link. */
export function ListCardMenuButton({ title, onPress }: { title: string; onPress: () => void }) {
  const { t } = useTranslation('lists')
  const tap = useTapScale(0.9)
  const spring = useSpring('snappy')
  return (
    <m.button
      type="button"
      className="lc-more"
      aria-label={t('lists.menu.label', { title })}
      aria-haspopup="dialog"
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      <IconMore size={20} />
    </m.button>
  )
}

/** The ⋯ in a list screen's bar. */
export function ListBarMenuButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation('lists')
  return (
    <IconButton label={t('lists.screen.menu')} aria-haspopup="dialog" onClick={onPress}>
      <IconMore />
    </IconButton>
  )
}
