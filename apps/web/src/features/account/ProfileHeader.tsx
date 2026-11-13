import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { BannerKey } from '../../lib/api/lists.types'
import type { ProfilePhotoMeta } from '../../lib/api/types'
import { IconButton, IconEdit, Skeleton, haptic, useLayerRoot } from '../../ui'
import { BannerArt } from '../lists/banners'
import { GlyphPencil } from './glyphs'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { appScroller } from '../nav/scroller'
import { GlyphCamera } from '../profilePhotos/GlyphCamera'
import { AvatarPhoto, BannerPhoto } from '../profilePhotos/PersonPhoto'
import '../lists/lists.css'

// The big profile header of the Profil tab (K11, Telegram): a large avatar tile, the name, the e-mail and
// "Name ändern". Scrolling down, the avatar shrinks and glides into the top bar and the name becomes the
// bar title; scrolling up it all comes back — scroll-linked, transform/opacity only, smooth both ways;
// pulling down at the top stretches the avatar a little (iOS rubber band).
//
// How: the avatar the person sees is ONE element in the fixed bar layer (above the bar's glass, so it
// never slides under it). Its position is computed from the scroll offset every frame: at the top it lies
// exactly on the header's placeholder and moves with the content; after `distance` px it sits in the
// bar's title slot. One passive scroll listener, read once per frame; no React render per frame.
// The bar's name fades in exactly while the big name slides under the bar (and the big name fades out), so
// the name is never shown twice and never ghosts behind the gliding avatar (QA ACCOUNT-9).
// Reduced motion: no gliding — the header avatar scrolls away and the bar title fades in.
// Felix 24.10 (20261024120000): my banner (preset or own photo, with its pencil → the banner sheet) lies behind the
// avatar, and my own profile photo over the initials; a tap on the avatar opens the avatar sheet (its little camera
// says so) — the same pieces as the "Listen" header (features/lists/ListsHeader.tsx, features/profilePhotos).

const AVATAR_PX = 88
const BAR_AVATAR_PX = 26

/** The elements the scroll-linked header moves (refs only; whether it glides is a prop of its own). */
export interface ProfileCollapse {
  bar: RefObject<HTMLElement | null>
  barSlot: RefObject<HTMLSpanElement | null>
  heroSlot: RefObject<HTMLDivElement | null>
  /** the big name under the avatar: the bar's name takes over while it slides under the bar */
  heroName: RefObject<HTMLDivElement | null>
  float: RefObject<HTMLSpanElement | null>
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

export function useProfileCollapse(glide: boolean, watch: unknown): ProfileCollapse {
  const root = useLayerRoot()
  const bar = useRef<HTMLElement>(null)
  const barSlot = useRef<HTMLSpanElement>(null)
  const heroSlot = useRef<HTMLDivElement>(null)
  const heroName = useRef<HTMLDivElement>(null)
  const float = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const barEl = bar.current
    const slotEl = barSlot.current
    const heroEl = heroSlot.current
    const nameEl = heroName.current
    if (!barEl || !slotEl || !heroEl) return
    const scroller = appScroller(root)
    let geo = { heroX: 0, heroY: 0, barX: 0, barY: 0, distance: 1, nameFrom: 0, nameSpan: 1 }

    const measure = () => {
      const b = barEl.getBoundingClientRect()
      // the dev phone frame is zoomed: rects are visual px, transforms are CSS px
      const zoom = b.width > 0 && barEl.offsetWidth > 0 ? b.width / barEl.offsetWidth : 1
      const s = scroller.top()
      const h = heroEl.getBoundingClientRect()
      const t = slotEl.getBoundingClientRect()
      const heroX = (h.left - b.left + h.width / 2) / zoom
      const heroY = (h.top - b.top + h.height / 2) / zoom + s
      const barX = (t.left - b.left + t.width / 2) / zoom
      const barY = (t.top - b.top + t.height / 2) / zoom
      // the big name: from the scroll offset where its top meets the bar's bottom edge until it is fully under it
      const n = nameEl?.getBoundingClientRect()
      const nameFrom = n ? (n.top - b.top) / zoom + s - b.height / zoom : 0
      geo = { heroX, heroY, barX, barY, distance: Math.max(1, heroY - barY), nameFrom, nameSpan: Math.max(1, (n?.height ?? 0) / zoom) }
    }

    const apply = () => {
      const s = scroller.top()
      const p = Math.min(1, Math.max(0, s / geo.distance))
      const handoff = Math.min(1, Math.max(0, (s - geo.nameFrom) / geo.nameSpan))
      barEl.style.setProperty('--collapse', p.toFixed(3))
      barEl.style.setProperty('--name-in', handoff.toFixed(3))
      if (nameEl) nameEl.style.opacity = (1 - handoff).toFixed(3)
      barEl.toggleAttribute('data-scrolled', s > 2)
      barEl.toggleAttribute('data-collapsed', p >= 0.999)
      const floatEl = float.current
      if (!floatEl) return
      let cx = geo.heroX
      let cy = geo.heroY - s
      let scale = 1
      if (s < 0) {
        // rubber band at the top: the avatar comes down with the content and stretches a little
        scale = 1 + Math.min(0.22, -s / 420)
      } else {
        const k = easeInOut(p)
        cx = geo.heroX + (geo.barX - geo.heroX) * k
        cy = p < 1 ? geo.heroY - s : geo.barY
        scale = 1 + (BAR_AVATAR_PX / AVATAR_PX - 1) * p
      }
      floatEl.style.transform = `translate3d(${(cx - AVATAR_PX / 2).toFixed(2)}px, ${(cy - AVATAR_PX / 2).toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
    }

    measure()
    apply()
    let frame = 0
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          apply()
        })
      }
    }
    const onResize = () => {
      measure()
      apply()
    }
    scroller.target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    ro?.observe(heroEl)
    ro?.observe(slotEl)
    if (nameEl) ro?.observe(nameEl)
    return () => {
      scroller.target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [root, glide, watch])

  return { bar, barSlot, heroSlot, heroName, float }
}

/** The fixed top bar of the Profil tab: glass after scrolling, the small avatar + name when collapsed. */
export function ProfileBar({
  barRef,
  slotRef,
  floatRef,
  glide,
  name,
  seed,
  photo,
}: {
  barRef: ProfileCollapse['bar']
  slotRef: ProfileCollapse['barSlot']
  floatRef: ProfileCollapse['float']
  glide: boolean
  name: string | null
  seed: string
  /** my profile photo's meta (get_me) */
  photo?: ProfilePhotoMeta | null
}) {
  return (
    <header ref={barRef} className="set-bar glass-bar fixed inset-x-0 top-0 z-(--z-bar) pt-safe">
      <div className="mx-auto flex h-(--topbar-h) max-w-(--page-w) items-center justify-center px-12">
        {/* decorative: the header below carries the name for assistive technology */}
        <span aria-hidden="true" className="set-bar-title">
          <span ref={slotRef} className="set-bar-slot">
            {glide ? null : (
              <ProfileAvatar seed={seed} name={name} size={BAR_AVATAR_PX}>
                <AvatarPhoto profileId={seed} meta={photo} eager />
              </ProfileAvatar>
            )}
          </span>
          <span className="set-bar-name t-headline">{name}</span>
        </span>
      </div>
      {glide ? (
        <span ref={floatRef} aria-hidden="true" className="set-float">
          <ProfileAvatar seed={seed} name={name} size={AVATAR_PX} className="set-float-avatar">
            <AvatarPhoto profileId={seed} meta={photo} eager />
          </ProfileAvatar>
          <span className="pph-cam"><GlyphCamera size={16} /></span>
        </span>
      ) : null}
    </header>
  )
}

/** The big header in the content: avatar placeholder (the gliding avatar lies on it), name, e-mail, action. */
export function ProfileHero({
  heroRef,
  nameRef,
  glide,
  name,
  email,
  seed,
  loading,
  title,
  editLabel,
  onEdit,
  banner,
  photo,
  bannerPhoto,
  onBanner,
  onAvatar,
}: {
  heroRef: ProfileCollapse['heroSlot']
  nameRef?: ProfileCollapse['heroName']
  /** the gliding avatar lies on the placeholder (else the header shows its own avatar) */
  glide: boolean
  name: string | null
  email: ReactNode
  seed: string
  loading: boolean
  /** the screen's heading for assistive technology ("Einstellungen") */
  title: string
  editLabel: string
  onEdit: () => void
  /** my banner: the preset shown now (chosen or derived) and my own banner photo's meta */
  banner: BannerKey
  photo?: ProfilePhotoMeta | null
  bannerPhoto?: ProfilePhotoMeta | null
  /** the banner's pencil: the banner sheet */
  onBanner: () => void
  /** the avatar: the avatar sheet */
  onAvatar: () => void
}) {
  const { t } = useTranslation('settings')
  return (
    <section aria-label={t('settings.profile_header')} className="set-hero">
      <h1 className="sr-only">{title}</h1>
      <BannerArt banner={banner} animate className="set-banner" photo={<BannerPhoto profileId={seed} meta={bannerPhoto} eager />}>
        <IconButton variant="glass" label={t('settings.banner_edit')} onClick={onBanner} className="lt-banner-edit">
          <IconEdit size={20} />
        </IconButton>
      </BannerArt>
      <div ref={heroRef} className="set-hero-avatar set-hero-avatar-over">
        {/* the gliding avatar lies on this button and lets the tap through */}
        <button type="button" className="pph-avatar-button" style={{ width: AVATAR_PX, height: AVATAR_PX }} aria-label={t('settings.photo_edit')}
          onPointerDown={() => haptic('tap')} onClick={onAvatar}>
          {glide ? null : (
            <>
              <ProfileAvatar seed={seed} name={name} size={AVATAR_PX} className="set-float-avatar">
                <AvatarPhoto profileId={seed} meta={photo} eager />
              </ProfileAvatar>
              <span aria-hidden="true" className="pph-cam"><GlyphCamera size={16} /></span>
            </>
          )}
        </button>
      </div>
      <div ref={nameRef} className="set-hero-name">{name ?? (loading ? <Skeleton width={160} height={28} className="mx-auto" /> : '—')}</div>
      <div className="set-hero-email t-subhead text-text-2">{email}</div>
      <button type="button" onClick={onEdit} className="set-hero-edit" onPointerDown={() => haptic('tap')}>
        <GlyphPencil size={16} />
        {editLabel}
      </button>
    </section>
  )
}
