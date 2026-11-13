import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { setListVisibility } from '../../lib/api/lists'
import { asWishlist, type ListScreen } from '../../lib/api/lists.types'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { Button, Page, TopBar, cn, fade, useReducedMotionPref } from '../../ui'
import { AmbientTint } from '../../ui/AmbientTint'
import { useOnline } from '../auth/shared'
import { OwnerWishlist } from '../wishes/OwnerWishlist'
import { FollowLinkSheetHost } from '../people/linkSheetHost'
import { coverToneOf } from './covers'
import { CountStack } from './CountStack'
import { dateWords, longDate } from './dates'
import { useFollowLinks } from './links'
import { CoverBusyPill, ListHeroCover } from './ListCover'
import { applyListVisibility, showsCover, useCoverChange, useListCover } from './listCovers'
import { ListBarMenuButton, ListMenu, type ListMenuStage } from './ListMenu'
import { GlyphLock, GlyphPeople, VisibilityChip } from './OwnerListCard'
import { ListTitleBlock, useBackToLists } from './parts'
import { previewOf } from './previews'
import { useListsOverview } from './queries'
import './lists.css'

// A list without an occasion as its OWNER sees it (follows-design §2.7; Felix 22.10) — OWNER module: no reservation
// module, no reservation field (OwnerWishlist strips them, secrecy.test.ts guards both). On top the list's cover photo
// when it has one (full-bleed, dissolving into the paper — the photo of the tapped card glides into it,
// listTransition.ts), then the title, the little wish picture + "Follower", the STATIC secret line (the same whatever
// happens on the list), "+ Wunsch" and the wishes as square tiles; a "Nur ich" list shows "Nur du siehst diese Liste.
// [Mit Followern teilen]" instead. The ⋯ is the list's settings (ListMenu: Teilen · Bearbeiten · Sichtbarkeit ·
// Titelbild · Löschen). Every text here depends only on the owner's own data.

export interface OwnerListScreenProps {
  screen: ListScreen
  userId: string
}

export function OwnerListScreen({ screen, userId }: OwnerListScreenProps) {
  const { t, i18n } = useTranslation('lists')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnline()
  const back = useBackToLists()
  const links = useFollowLinks()
  const reduced = useReducedMotionPref()
  const [stage, setStage] = useState<ListMenuStage>(null)
  const [sharing, setSharing] = useState(false)
  const sharingRef = useRef(false)
  // «Помпон в открытом списке» (31.10): his layer (this content, it scrolls with the list) and his seat (the right end
  // of the title block's icon row; a list with a cover photo has no such row: no header Pompon there)
  const contentRef = useRef<HTMLDivElement>(null)
  const seatRef = useRef<HTMLDivElement>(null)
  const { list } = screen
  const tone = coverToneOf(list.cover_tone, list.id)
  const locale = i18n.resolvedLanguage ?? 'de'
  // one object per screen answer: the wish grid keeps its pending changes against it (OwnerWishlist)
  const wishlist = useMemo(() => asWishlist(screen), [screen])
  const cover = useListCover(list.id, list.photo)
  const change = useCoverChange(list.id)
  const hasCover = showsCover(cover)
  const pompon = useMemo(() => ({ layer: contentRef, seatRow: hasCover ? null : seatRef }), [hasCover])
  // the card's number: open + received wishes (get_lists_overview counts both)
  const total = screen.wishes.length + (screen.received?.length ?? 0)
  // the tab's overview from the cache (no second request on this screen): my own follower count, never
  // anything about the list's reservations — null when the tab was not open yet
  const followers = useListsOverview(userId, false).data?.stats.followers ?? null
  // a follower list while nobody follows me: say so honestly and offer the follow link
  const unseen = list.visibility === 'followers' && followers === 0

  /** "Mit Followern teilen" on the "Nur ich" banner: one tap, waits for the server (it widens who sees it). */
  async function shareWithFollowers() {
    if (sharingRef.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    sharingRef.current = true
    setSharing(true)
    try {
      await setListVisibility(list.id, 'followers', userId)
      if (!epoch.isCurrent()) return
      applyListVisibility(queryClient, list.id, 'followers')
      feedback('success')
      toast.success(t('lists.screen.shared_now'))
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      feedback('error')
      toast.error(t(error.key, error.params))
    } finally {
      sharingRef.current = false
      if (epoch.isCurrent()) setSharing(false)
    }
  }

  const due = list.due_on ? dateWords(list.due_on, locale) : null
  const topBar = (
    <TopBar
      large
      title={list.title}
      back={{ label: t('common.back'), onClick: back }}
      right={<ListBarMenuButton onPress={() => setStage('menu')} />}
    />
  )

  return (
    <Page topBar={topBar}>
      <AmbientTint tone={tone} />
      {/* outside the content's fade: the shared-element transition lands on it in its first frame */}
      {hasCover ? <ListHeroCover cover={cover} tone={tone} named={!reduced} /> : null}
      <m.div ref={contentRef} className={cn('relative flex flex-col gap-6 pt-4', hasCover && 'ls-covered')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
        <ListTitleBlock
          tone={tone}
          icon={list.cover_icon}
          title={list.title}
          photo={hasCover}
          seatRef={hasCover ? undefined : seatRef}
          date={due && due.kind !== 'past' ? due : null}
          dateText={list.due_on ? t('lists.screen.date', { date: longDate(list.due_on, locale) }) : null}
          facts={
            <>
              <CountStack count={total} preview={previewOf(screen)} seed={list.id} />
              <VisibilityChip visibility={list.visibility} />
            </>
          }
        />
        {change && change.kind !== 'preparing' ? <CoverBusyPill removing={change.kind === 'remove'} /> : null}

        {list.visibility === 'private' ? (
          <div className="ls-private glass-panel" role="note">
            <span aria-hidden="true" className="ls-private-icon">
              <GlyphLock />
            </span>
            <p className="min-w-0 flex-1 t-subhead text-text">{t('lists.screen.private_banner')}</p>
            <Button size="sm" variant="secondary" loading={sharing} disabled={!online} onClick={() => void shareWithFollowers()}>
              {t('lists.screen.private_share')}
            </Button>
          </div>
        ) : null}

        {unseen ? (
          <div className="ls-private glass-panel" role="note">
            <span aria-hidden="true" className="ls-private-icon">
              <GlyphPeople />
            </span>
            <p className="min-w-0 flex-1 t-subhead text-text">{t('lists.screen.no_followers')}</p>
            <Button size="sm" variant="secondary" onClick={links.shareFollowLink}>
              {t('lists.screen.share_link')}
            </Button>
          </div>
        ) : null}

        <OwnerWishlist
          wishlist={wishlist}
          entrance
          pompon={pompon}
          standalone={{
            listId: list.id,
            hint: list.visibility === 'followers' && !unseen ? t('lists.screen.secret_hint') : null,
            emptyText:
              list.visibility !== 'followers'
                ? t('lists.screen.empty_private')
                : unseen
                  ? t('lists.screen.empty_no_followers')
                  : t('lists.screen.empty_followers'),
          }}
        />
      </m.div>

      <ListMenu
        list={list}
        userId={userId}
        followers={followers}
        stage={stage}
        onStage={setStage}
        onDeleted={() => void navigate({ to: '/lists', replace: true })}
      />
      {/* "Folgen-Link teilen" of the share sheet and of the "nobody follows" note (agent K2, features/people) */}
      <FollowLinkSheetHost userId={userId} />
    </Page>
  )
}
