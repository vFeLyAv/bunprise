import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { BannerKey, ListsOverview } from '../../lib/api/lists.types'
import type { ProfilePhotoMeta } from '../../lib/api/types'
import { IconButton, IconEdit, IconForward, IconGift, IconShare, Skeleton, fade, haptic, useSpring, useTapScale } from '../../ui'
import type { ProfileCollapse } from '../account/ProfileHeader'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { GlyphCamera } from '../profilePhotos/GlyphCamera'
import { AvatarPhoto, BannerPhoto } from '../profilePhotos/PersonPhoto'
import { BannerArt } from './banners'
import type { FollowLinks } from './links'
import type { ListsSegment } from './ListsPage'
import { GlyphPeople } from './OwnerListCard'
import { usePendingListDeletes } from './pendingListDeletes'
import { listsTabView } from './tabView'

// The header of the "Wunschlisten" tab (follows-design §2.2) — OWNER module: only the signed-in person's own
// data (name, banner, counters that are never counted from reservations; W01/W02). Telegram-style like the
// Profil tab: the 88 px initials avatar lies on the banner's lower edge and glides into the bar on scroll
// (account/ProfileHeader.tsx useProfileCollapse — the same hook, own markup), the name stays in the content.
// Since 20261024120000 my own profile photo lies over the initials and my own banner photo over the preset banner
// (features/profilePhotos); a tap on the avatar opens the avatar sheet (its little camera says so).

const AVATAR_PX = 88
const BAR_AVATAR_PX = 26

export interface ListsBarProps {
  barRef: ProfileCollapse['bar']
  slotRef: ProfileCollapse['barSlot']
  floatRef: ProfileCollapse['float']
  glide: boolean
  name: string | null
  seed: string
  /** my profile photo's meta (overview.me.photo) */
  photo?: ProfilePhotoMeta | null
  onShare: () => void
}

/** The fixed bar: "Wunschlisten" (+ the small avatar once the header collapsed) and the share icon. */
export function ListsBar({ barRef, slotRef, floatRef, glide, name, seed, photo, onShare }: ListsBarProps) {
  const { t } = useTranslation('lists')
  return (
    <header ref={barRef} className="lt-bar glass-bar fixed inset-x-0 top-0 z-(--z-bar) pt-safe">
      <div className="mx-auto grid h-(--topbar-h) max-w-(--page-w) grid-cols-[1fr_auto_1fr] items-center px-3">
        <span aria-hidden="true" />
        {/* decorative: the content's sr-only h1 names the screen */}
        <span aria-hidden="true" className="lt-bar-title t-headline">
          <span ref={slotRef} className="lt-bar-slot">
            {glide ? null : (
              <ProfileAvatar seed={seed} name={name} size={BAR_AVATAR_PX}>
                <AvatarPhoto profileId={seed} meta={photo} eager />
              </ProfileAvatar>
            )}
          </span>
          {t('lists.title')}
        </span>
        <div className="flex items-center justify-end">
          {/* SLOT (agent K2): the follow-link sheet — features/lists/links.ts shareFollowLink */}
          {/* icon only (Felix 26.10: the word crowded the title — in Russian "Поделиться" pressed on "Списки желаний") */}
          <IconButton variant="glass" label={t('lists.header.share_label')} onClick={onShare}>
            <IconShare size={20} />
          </IconButton>
        </div>
      </div>
      {glide ? (
        <span ref={floatRef} aria-hidden="true" className="lt-float">
          <ProfileAvatar seed={seed} name={name} size={AVATAR_PX} className="lt-avatar">
            <AvatarPhoto profileId={seed} meta={photo} eager />
          </ProfileAvatar>
          <span className="pph-cam"><GlyphCamera size={16} /></span>
        </span>
      ) : null}
    </header>
  )
}

export interface ListsHeroProps {
  heroRef: ProfileCollapse['heroSlot']
  glide: boolean
  seed: string
  name: string | null
  banner: BannerKey
  /** my profile / banner photo's meta (overview.me) */
  photo?: ProfilePhotoMeta | null
  bannerPhoto?: ProfilePhotoMeta | null
  overview: ListsOverview | undefined
  onBanner: () => void
  /** the avatar was tapped: the avatar sheet */
  onAvatar: () => void
  onSegment: (segment: ListsSegment) => void
  links: FollowLinks
  /** Pompon (the Lists buddy, ListsBuddy.tsx) is on: keep his row between the name and the tiles. */
  buddyRoom?: boolean
}

/** Banner (+ pencil), avatar, name, the two counter tiles, "N Follower · Du folgst M" and the requests pill. */
export function ListsHero({ heroRef, glide, seed, name, banner, photo, bannerPhoto, overview, onBanner, onAvatar, onSegment, links, buddyRoom = false }: ListsHeroProps) {
  const { t } = useTranslation('lists')
  // the counters count what the tab shows (tabView.ts): my lists without an occasion (a list waiting for its undo
  // is gone from "Meine" already — its wishes leave the counter at the same time) and the lists of people I follow
  const pendingDeletes = usePendingListDeletes()
  const stats = overview ? listsTabView(overview, pendingDeletes).stats : undefined
  const loading = overview === undefined
  return (
    <section aria-label={t('lists.header.region')} className="lt-hero">
      <BannerArt banner={banner} animate className="lt-banner" photo={<BannerPhoto profileId={seed} meta={bannerPhoto} eager />}>
        <IconButton variant="glass" label={t('lists.header.banner_edit')} onClick={onBanner} className="lt-banner-edit">
          <IconEdit size={20} />
        </IconButton>
      </BannerArt>
      <div className="lt-id">
        {/* data-buddy-avatar: Pompon walks under it and admires it (ListsBuddy) */}
        <div ref={heroRef} className="lt-avatar-slot" data-buddy-avatar="">
          {/* the gliding avatar lies on this button and lets the tap through */}
          <button type="button" className="pph-avatar-button" style={{ width: AVATAR_PX, height: AVATAR_PX }} aria-label={t('lists.photo.avatar_edit')}
            onPointerDown={() => haptic('tap')} onClick={onAvatar}>
            {glide ? null : (
              <>
                <ProfileAvatar seed={seed} name={name} size={AVATAR_PX} className="lt-avatar">
                  <AvatarPhoto profileId={seed} meta={photo} eager />
                </ProfileAvatar>
                <span aria-hidden="true" className="pph-cam"><GlyphCamera size={16} /></span>
              </>
            )}
          </button>
        </div>
        <div className="lt-name">
          {name ?? (loading ? <Skeleton width={150} height={24} /> : t('lists.header.name_fallback'))}
        </div>
      </div>

      {/* the tiles' top edge is the buddy's home floor; his row above it stays reserved while he is on (no jump) */}
      <div className="lt-stats" data-buddy-floor="stats" data-buddy-room={buddyRoom && stats ? '' : undefined}>
        <StatTile
          kind="wishes"
          value={stats?.my_wishes}
          label={t('lists.header.wishes', { count: stats?.my_wishes ?? 0 })}
          aria={stats ? t('lists.header.wishes_label', { count: stats.my_wishes }) : undefined}
          onPress={() => onSegment('mine')}
        />
        <StatTile
          kind="shared"
          value={stats?.friends_lists}
          label={t('lists.header.shared')}
          aria={stats ? t('lists.header.shared_label', { count: stats.friends_lists }) : undefined}
          onPress={() => onSegment('friends')}
        />
      </div>

      <div className="lt-people">
        {stats ? (
          <button type="button" className="lt-people-link" onPointerDown={() => haptic('tap')} onClick={links.openPeople}>
            <span className="truncate">{t('lists.header.people', { count: stats.followers, followers: stats.followers, following: stats.following })}</span>
            <IconForward size={16} className="shrink-0" />
          </button>
        ) : (
          <Skeleton width={190} height={14} />
        )}
        <AnimatePresence initial={false}>
          {stats && stats.requests > 0 ? (
            <RequestsPill key="requests" count={stats.requests} onPress={links.openRequests} />
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  )
}

/**
 * A counter as a small picture (Felix 22.10: graphical, without clutter): a soft icon tile — the gift for my wishes,
 * two people for the lists shared with me — next to the big number and its word. The tile is decorative; the
 * button's name says the whole thing ("4 Wünsche – zu deinen Listen").
 */
function StatTile({ kind, value, label, aria, onPress }: { kind: 'wishes' | 'shared'; value: number | undefined; label: string; aria?: string; onPress: () => void }) {
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  return (
    <m.button
      type="button"
      className="lt-stat glass-panel"
      data-kind={kind}
      data-zero={value === 0 ? '' : undefined}
      aria-label={aria}
      disabled={value === undefined}
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      <span aria-hidden="true" className="lt-stat-icon">
        {kind === 'wishes' ? <IconGift size={20} /> : <GlyphPeople />}
      </span>
      <span className="lt-stat-text">
        <span className="lt-stat-value tabular-nums">{value ?? <Skeleton width={36} height={26} />}</span>
        <span className="lt-stat-label">{label}</span>
      </span>
    </m.button>
  )
}

function RequestsPill({ count, onPress }: { count: number; onPress: () => void }) {
  const { t } = useTranslation('lists')
  const bouncy = useSpring('bouncy')
  return (
    <m.button
      type="button"
      className="lt-requests"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ ...bouncy, opacity: fade }}
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      <span aria-hidden="true" className="lt-requests-dot" />
      {t('lists.header.requests', { count })}
      <IconForward size={14} className="shrink-0" />
    </m.button>
  )
}
