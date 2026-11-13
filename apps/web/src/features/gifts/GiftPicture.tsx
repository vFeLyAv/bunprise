import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { drawnArtId, ownImagePath, photoFallbackArt, type GiftIdea } from '../../lib/api/giftIdeas'
import { cn, tileTone } from '../../ui'
import { ART_TONE, DemoArt, PresentArt } from './art'
import { rememberShownPhoto, wasPhotoShown } from './photoMemory'
import './gifts.css'

// The picture of an idea (Felix: "фото обязательно"). Four cases, and the device never talks to a shop:
// - a demo product or a catalogue product without a photo: our own drawing (art/), drawn inline —
//   "/api/gift-ideas/demo-art/<id>" and "/api/gift-ideas/art/<id>" are never fetched;
// - a catalogue product's real photo (Felix 25.10, closed pilot): "/api/gift-ideas/img/<art>/<id>" from our
//   Worker, which fetched it from the shop's page; it fails → the drawing <art>; on the card a small
//   "Bild: <Shop>" says whose picture it is;
// - any other real provider's picture: ONLY a path of our own origin under /api/gift-ideas/ (the Worker proxies
//   it), loaded with no referrer; anything else was already dropped by the parser and is checked again here;
// - no picture (or it failed without a drawing): the wrapped present.
// Decorative (alt=""): the card's title says what it is.
// Coming back (Felix 28.10 «фотки дёргаются» — Ideen → Profil → Ideen): a photo shown lately (photoMemory.ts,
// addresses only, bounded) is not lazy and is decoded with its first frame; a photo the browser already has
// (complete before the first paint) wears its „Bild: <Shop>“ in that same frame — nothing pops in afterwards.

export function GiftPicture({ idea, size = 'card', className, credit }: {
  idea: Pick<GiftIdea, 'id' | 'image_url'>
  size?: 'card' | 'thumb'
  className?: string
  /** the shop the photo comes from ("Bild: Thalia"); shown on the card once the photo is there */
  credit?: string | null
}) {
  const { t } = useTranslation('gifts')
  const drawn = drawnArtId(idea.image_url)
  const src = drawn ? null : ownImagePath(idea.image_url)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const art = drawn ?? (failed ? photoFallbackArt(idea.image_url) : null)
  const photo = !art && src && !failed ? src : null
  // read once per picture: switching lazy/async → eager/sync after the load would change nothing on screen
  const [seen] = useState(() => wasPhotoShown(src))
  const image = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const img = image.current
    if (!photo || !img || !img.complete || img.naturalWidth === 0) return
    // already there (the browser's cache): before the first paint, so the credit comes with the photo
    rememberShownPhoto(photo)
    setLoaded(true)
  }, [photo])
  const tone = (art ? ART_TONE[art] : undefined) ?? tileTone(idea.id)
  return (
    <div className={cn('gift-picture', className)} data-tone={tone} data-size={size} data-photo={photo ? '' : undefined} aria-hidden="true">
      {art ? (
        <div className="gift-picture-art">
          <DemoArt id={art} />
        </div>
      ) : photo ? (
        <img ref={image} src={photo} alt="" loading={seen ? 'eager' : 'lazy'} decoding={seen ? 'sync' : 'async'} referrerPolicy="no-referrer" draggable={false}
          onLoad={() => { rememberShownPhoto(photo); setLoaded(true) }} onError={() => setFailed(true)} />
      ) : (
        <div className="gift-picture-art">
          <PresentArt />
        </div>
      )}
      {photo && loaded && credit && size === 'card' ? <span className="gift-picture-credit">{t('gifts.picture_credit', { shop: credit })}</span> : null}
    </div>
  )
}
