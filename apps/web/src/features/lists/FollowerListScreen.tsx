import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { buildMailto } from '../../lib/api/account'
import { unfollow } from '../../lib/api/lists'
import { asWishlist, type ListScreen } from '../../lib/api/lists.types'
import { SUPPORT_EMAIL } from '../../lib/app'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { qk } from '../../lib/queryKeys'
import { toast } from '../../lib/toast'
import { Button, IconButton, IconGift, IconMore, List, ListRow, ListRowContent, Page, TopBar, cn, fade, listItemClass, listRowClass, useReducedMotionPref } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { AmbientTint } from '../../ui/AmbientTint'
import { useOnline } from '../auth/shared'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { AvatarPhoto, BannerPhoto } from '../profilePhotos/PersonPhoto'
import { GuestWishlist } from '../wishes/GuestWishlist'
import { BannerArt, bannerOf } from './banners'
import { coverToneOf } from './covers'
import { CountStack } from './CountStack'
import { ListHeroCover } from './ListCover'
import { showsCover, useListCover } from './listCovers'
import { previewOf } from './previews'
import { dateWords, longDate } from './dates'
import { useFindGiftFor } from './findGift'
import { ListTitleBlock, useBackToLists } from './parts'
import { invalidateLists, listsKeys } from './queries'
import './lists.css'

// A follower list of someone I follow (follows-design §2.7) — GUEST module (the giver's side: it may speak about
// the giver's OWN reservations). The list's cover photo on top when it has one (the tapped card's photo glides into
// it, listTransition.ts) — else the owner's banner —, the owner's avatar and name; the wishes through GuestWishlist:
// "Ich schenke das" / "Von dir reserviert" / "Reserviert" — NOT optimistic, online only, the hamster
// celebrates after the server's yes; the 6th own reservation for this person → the limit sentence with the
// name (limit_reached, only the giver ever sees it). "Geschenk finden für …" (a list of theirs is readable
// here, so Find Gift has something). ⋯: Nicht mehr folgen · Melden (mailto like the occasion screen).

export interface FollowerListScreenProps {
  screen: ListScreen
  userId: string
}

export default function FollowerListScreen({ screen, userId }: FollowerListScreenProps) {
  const { t, i18n } = useTranslation('lists')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnline()
  const back = useBackToLists()
  const findGiftFor = useFindGiftFor()
  const [open, setOpen] = useState<'menu' | 'unfollow' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const working = useRef(false)
  const { list } = screen
  const owner = list.owner
  const name = owner.display_name?.trim() || null
  const shownName = name ?? t('listGuest.name_fallback')
  const tone = coverToneOf(list.cover_tone, list.id)
  const locale = i18n.resolvedLanguage ?? 'de'
  const due = list.due_on ? dateWords(list.due_on, locale) : null
  const reduced = useReducedMotionPref()
  const cover = useListCover(list.id, list.photo)
  const hasCover = showsCover(cover)
  // one object per screen answer: the confirmed answers of GuestWishlist stay valid until fresh data comes
  const wishlist = useMemo(() => asWishlist(screen), [screen])
  const total = screen.wishes.length + (screen.received?.length ?? 0)
  const reportHref = SUPPORT_EMAIL.includes('@')
    ? buildMailto(SUPPORT_EMAIL, t('listGuest.report_mail_subject', { id: list.id }), t('listGuest.report_mail_body'))
    : null

  // after every reserve / cancel: this screen (fresh "Reserviert"), the tab, my plans
  const refresh = useCallback(() => {
    void invalidateLists(queryClient, list.id).catch(() => undefined)
  }, [queryClient, list.id])
  const standalone = useMemo(
    () => ({
      listId: list.id,
      ownerName: name,
      limitText: name ? t('listGuest.limit', { name }) : t('listGuest.limit_neutral'),
      onSettled: refresh,
    }),
    [list.id, name, t, refresh],
  )

  async function leave() {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    working.current = true
    setLeaving(true)
    try {
      await unfollow(owner.id, userId)
      if (!epoch.isCurrent()) return
      feedback('success')
      toast.info(t('listGuest.unfollowed', { name: shownName }))
      // the list is gone for me: the tab and my plans are refreshed, this screen's entry is dropped
      queryClient.removeQueries({ queryKey: listsKeys.list(list.id), exact: true })
      void queryClient.invalidateQueries({ queryKey: listsKeys.overview() }).catch(() => undefined)
      void queryClient.invalidateQueries({ queryKey: qk.myReservations() }).catch(() => undefined)
      void navigate({ to: '/lists', replace: true })
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      feedback('error')
      toast.error(t(error.key, error.params))
    } finally {
      working.current = false
      if (epoch.isCurrent()) setLeaving(false)
    }
  }

  const topBar = (
    <TopBar
      large
      title={list.title}
      back={{ label: t('common.back'), onClick: back }}
      right={
        <IconButton label={t('listGuest.menu')} aria-haspopup="dialog" onClick={() => setOpen('menu')}>
          <IconMore />
        </IconButton>
      }
    />
  )

  return (
    <Page topBar={topBar}>
      <AmbientTint tone={tone} />
      {/* outside the content's fade: the shared-element transition lands on it in its first frame */}
      {hasCover ? <ListHeroCover cover={cover} tone={tone} named={!reduced} /> : null}
      <m.div className={cn('flex flex-col gap-5 pt-4', hasCover && 'ls-covered')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
        {hasCover ? null : (
          <div className="ls-owner">
            <BannerArt banner={bannerOf(owner.banner, owner.id)} className="ls-owner-banner" photo={<BannerPhoto profileId={owner.id} meta={owner.banner_photo} eager />} />
            <div className="ls-owner-id">
              <ProfileAvatar seed={owner.id} name={owner.display_name} size={56} className="lt-avatar ls-owner-avatar">
                <AvatarPhoto profileId={owner.id} meta={owner.photo} eager />
              </ProfileAvatar>
              <span className="ls-owner-name t-headline">{shownName}</span>
            </div>
          </div>
        )}

        <ListTitleBlock
          tone={tone}
          icon={list.cover_icon}
          title={list.title}
          photo={hasCover}
          date={due && due.kind !== 'past' ? due : null}
          dateText={list.due_on ? t('lists.screen.date', { date: longDate(list.due_on, locale) }) : null}
          facts={
            <>
              {hasCover ? (
                <span className="ls-owner-chip">
                  <ProfileAvatar seed={owner.id} name={owner.display_name} size={24}>
                    <AvatarPhoto profileId={owner.id} meta={owner.photo} eager />
                  </ProfileAvatar>
                  {shownName}
                </span>
              ) : null}
              <CountStack count={total} preview={previewOf(screen)} seed={list.id} />
            </>
          }
          compact
        />

        <GuestWishlist wishlist={wishlist} entrance standalone={standalone} />

        <Button variant="ghost" fullWidth icon={<IconGift />} onClick={() => findGiftFor(owner.id)}>
          {t('listGuest.find_gift', { name: shownName })}
        </Button>

      </m.div>

      <Sheet open={open === 'menu'} onClose={() => setOpen(null)} title={t('listGuest.menu_title', { name: shownName })} closeLabel={t('common.close')}>
        <List className="pb-2">
          <ListRow title={<span className="text-danger">{t('listGuest.unfollow')}</span>} disabled={!online} onPress={() => setOpen('unfollow')} />
          {reportHref ? (
            <li className={listItemClass}>
              <a href={reportHref} className={listRowClass({ pressable: true })} onClick={() => setOpen(null)}>
                <ListRowContent title={t('listGuest.report')} />
              </a>
            </li>
          ) : (
            <ListRow title={t('listGuest.report')} subtitle={t('listGuest.report_pending')} />
          )}
        </List>
      </Sheet>

      <Confirm
        open={open === 'unfollow'}
        destructive
        title={t('listGuest.unfollow_title', { name: shownName })}
        message={t('listGuest.unfollow_message', { name: shownName })}
        confirmLabel={t('listGuest.unfollow')}
        cancelLabel={t('common.cancel')}
        loading={leaving}
        onConfirm={() => void leave()}
        onCancel={() => {
          if (!leaving) setOpen(null)
        }}
      />
    </Page>
  )
}
