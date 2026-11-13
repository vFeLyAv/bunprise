import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { WishPhotoMeta } from '../../lib/api/types'
import { markDecoded, useObjectUrl, wasDecoded } from '../../lib/objectUrl'
import { Button, IconTrash, cn, fade, useReducedMotionPref, useSpring } from '../../ui'
import { GlyphCamera } from '../profilePhotos/GlyphCamera'
import { IconRefresh } from './icons'
import { knownPhotoFit, measurePhotoFit, type PhotoFit } from './photoFit'
import { useInView, useWishPhoto } from './wishPhotos'
import './wishes.css'

// The ONLY place of the wish screens with an <img>, and its `src` is always an object URL of a Blob that came from
// OUR side: the wish photo from our database (getWishPhoto), the picture our Worker fetched for the form
// (fetchLinkImage → preparePhoto) or the owner's own photo from the device (preparePhoto, Felix 25.10). Never a
// shop's URL, never a favicon (features/wishes/secrecy.test.ts checks it).
// The pictures are decorative here (alt=""): the wish's title is said right next to them.

/**
 * An image that fades in once decoded (no pop; the box around it keeps its size, nothing moves). One decoded before
 * in this page session (another screen, a tab that comes back) is there at once.
 */
function FadeImage({ url, className }: { url: string; className?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [measured, setMeasured] = useState<{ url: string; fit: PhotoFit | null } | null>(null)
  const again = wasDecoded(url)
  // how it sits in its tile (photoFit.ts): measured once on load, known at once when it comes back
  const fit = measured?.url === url ? measured.fit : (knownPhotoFit(url) ?? null)
  return (
    <img
      src={url}
      alt=""
      decoding={again ? 'sync' : 'async'}
      draggable={false}
      className={cn('wish-photo-img', className)}
      data-loaded={loaded === url || again ? '' : undefined}
      data-fit={fit?.fit}
      style={fit?.fit === 'plate' ? ({ '--photo-plate': fit.plate } as CSSProperties) : undefined}
      onLoad={(event) => {
        markDecoded(url)
        setMeasured({ url, fit: measurePhotoFit(event.currentTarget, url) })
        setLoaded(url)
      }}
    />
  )
}

/**
 * A wish's picture in a list: the wish's photo when it has one, else (and until it is there, and after any error) the
 * given letter / gift tile. The bytes are asked for only once it is near the screen (useInView) and through the
 * shared queue (wishPhotos.ts), so a long list stays fast. Used by the square tiles of the wish grid (the photo fills
 * the tile) and by the little round thumbnails of the list cards (features/lists/CountStack.tsx).
 */
export function WishThumb({ wish, children, className, imgClassName }: {
  wish: { id: string; photo?: WishPhotoMeta | null }
  children: ReactNode
  className?: string
  /** replaces `wish-thumb-img`: it must lay the photo OVER the tile too (absolute, inset 0) — else it ends up beside or below it */
  imgClassName?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const meta = wish.photo ?? null
  const visible = useInView(ref, meta !== null)
  const query = useWishPhoto(wish.id, meta, visible)
  const url = useObjectUrl(query.data?.blob)
  return (
    <span ref={ref} className={cn('relative grid shrink-0', className)} data-wish-thumb={meta ? '' : undefined}>
      {children}
      {url ? <FadeImage url={url} className={imgClassName ?? 'wish-thumb-img'} /> : null}
    </span>
  )
}

/** The big photo at the top of the wish sheet (nothing at all when the wish has none or it cannot be read). */
export function SheetPhoto({ wish }: { wish: { id: string; photo?: WishPhotoMeta | null } }) {
  const meta = wish.photo ?? null
  const query = useWishPhoto(wish.id, meta)
  const url = useObjectUrl(query.data?.blob)
  if (!meta || query.isError) return null
  return (
    <div className={cn('wish-photo', !url && 'wish-shimmer')} data-size="lg" data-wish-photo="" aria-hidden="true">
      {url ? <FadeImage url={url} /> : null}
    </div>
  )
}

// ---- the photo of the wish card (new / edit screen) ------------------------------------------------------------

/**
 * What the card shows about the photo:
 *   loading  our Worker is fetching the picture, or the device prepares the owner's own one (`preparing`):
 *            a shimmering box of the photo's size
 *   new      a picture that is not saved yet, already downscaled on the device: read from the link, or the
 *            owner's own (`source: 'own'`, from the gallery / camera — Felix 25.10)
 *   saved    the wish's stored photo (edit screen; meta undefined = not known yet: asked once)
 *   removed  the person took it away ("Rückgängig" brings it back until saving)
 *   none     no picture: the card keeps the shop's letter tile in its header (and offers "Foto hinzufügen")
 */
export type CardPhoto =
  | { kind: 'none' }
  | { kind: 'loading'; preparing?: boolean }
  | { kind: 'new'; blob: Blob; source: 'link' | 'own' }
  | { kind: 'saved'; wishId: string; meta: WishPhotoMeta | null | undefined }
  | { kind: 'removed' }

/**
 * `onPick` (the owner's form) opens the device's photo picker: "Foto hinzufügen" where there is no picture, "Ändern"
 * next to a shown one. Without it the card only shows and removes.
 */
export function CardPhotoView({ photo, onRemove, onRestore, onPick }: { photo: CardPhoto; onRemove: () => void; onRestore: () => void; onPick?: () => void }) {
  switch (photo.kind) {
    case 'none':
      return onPick ? <AddPhoto onPick={onPick} /> : null
    case 'loading':
      return <LoadingPhoto preparing={photo.preparing} />
    case 'new':
      return <BlobPhoto blob={photo.blob} source={photo.source} onRemove={onRemove} onPick={onPick} />
    case 'saved':
      return <SavedPhoto wishId={photo.wishId} meta={photo.meta} onRemove={onRemove} onPick={onPick} />
    case 'removed':
      return <RemovedPhoto onRestore={onRestore} />
  }
}

function LoadingPhoto({ preparing = false }: { preparing?: boolean | undefined }) {
  const { t } = useTranslation('wishes')
  return (
    <div className="mt-4">
      <div className="wish-photo wish-shimmer" data-card-photo="loading" aria-hidden="true" />
      <p className="sr-only" role="status">
        {t(preparing ? 'wish.photo_preparing' : 'wish.photo_loading')}
      </p>
    </div>
  )
}

/** No picture (none from the link, or no link at all): the owner adds their own (Felix 25.10). */
function AddPhoto({ onPick }: { onPick: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    <button type="button" className="wish-photo-add" data-photo-add="" onClick={onPick}>
      <span className="wish-photo-add-icon" aria-hidden="true">
        <GlyphCamera size={20} />
      </span>
      <span className="flex min-w-0 flex-col text-left">
        <span className="t-subhead font-semibold text-accent-text">{t('wish.photo_add')}</span>
        <span className="t-footnote text-text-2">{t('wish.photo_add_hint')}</span>
      </span>
    </button>
  )
}

type Pick = (() => void) | undefined

function BlobPhoto({ blob, source, onRemove, onPick }: { blob: Blob; source: 'link' | 'own'; onRemove: () => void; onPick: Pick }) {
  const { t } = useTranslation('wishes')
  const url = useObjectUrl(blob)
  if (!url) return null
  return <PhotoWithRemove url={url} caption={t(source === 'own' ? 'wish.photo_own' : 'wish.photo_from_link')} onRemove={onRemove} onPick={onPick} />
}

function SavedPhoto({ wishId, meta, onRemove, onPick }: { wishId: string; meta: WishPhotoMeta | null | undefined; onRemove: () => void; onPick: Pick }) {
  const { t } = useTranslation('wishes')
  const query = useWishPhoto(wishId, meta)
  const url = useObjectUrl(query.data?.blob)
  if (meta === null || query.isError) return onPick ? <AddPhoto onPick={onPick} /> : null
  if (!url) return <LoadingPhoto />
  return <PhotoWithRemove url={url} caption={t('wish.photo_saved')} onRemove={onRemove} onPick={onPick} />
}

function PhotoWithRemove({ url, caption, onRemove, onPick }: { url: string; caption: string; onRemove: () => void; onPick: Pick }) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  return (
    <m.div
      className="mt-4 flex flex-col gap-1"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? fade : { ...smooth, opacity: fade }}
      data-card-photo="shown"
    >
      <div className="wish-photo" aria-hidden="true">
        <FadeImage url={url} />
      </div>
      <div className="flex items-center gap-1 pl-1">
        <p className="mr-auto min-w-0 t-footnote text-text-2">{caption}</p>
        {onPick ? (
          <Button variant="ghost" size="sm" icon={<GlyphCamera size={18} />} hapticKind="select" onClick={onPick} aria-label={t('wish.photo_change')} className="shrink-0">
            {t('wish.photo_change_short')}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={<IconTrash />} hapticKind="select" onClick={onRemove} aria-label={t('wish.photo_remove')} className="-mr-2 shrink-0">
          {t('wish.photo_remove_short')}
        </Button>
      </div>
    </m.div>
  )
}

function RemovedPhoto({ onRestore }: { onRestore: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl bg-fill py-1 pl-4 pr-1" data-card-photo="removed">
      <p role="status" className="min-w-0 t-subhead text-text-2">
        {t('wish.photo_removed')}
      </p>
      <Button variant="ghost" size="sm" icon={<IconRefresh />} hapticKind="select" onClick={onRestore} className="shrink-0">
        {t('wish.undo')}
      </Button>
    </div>
  )
}
