import { useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { renderedAccount } from '../../lib/accountBoundary'
import type { ProfilePhotoKind } from '../../lib/api/profilePhotos'
import type { ProfilePhotoMeta } from '../../lib/api/types'
import { markDecoded, useObjectUrl, wasDecoded } from '../../lib/objectUrl'
import { fade } from '../../ui'
import { useInView } from '../wishes/inView'
import { useOwnPhotoChange, usePersonPhoto } from './photos'
import './profilePhotos.css'

// A person's own photo over their initials avatar (ProfileAvatar) or over their preset banner (BannerArt). The ONLY
// <img> of a person, and its `src` is always an object URL of a Blob from OUR database (or the picture just prepared
// on this device) — never anybody's address. Decorative (alt=""): the name is said right next to it.
// - no layout shift, no spinner: the initials / the preset banner are there from the first frame and stay under the
//   photo; the photo fades in once decoded (a picture decoded before in this page session is there at once);
// - a new photo fades in OVER the old one (the old one stays until then); a removed photo fades out;
// - lists stay fast: the bytes are asked for only when the picture is (nearly) on screen (shared IntersectionObserver)
//   and through the small shared queue; the headers pass `eager`.

// URLs decoded once in this page session (lib/objectUrl.ts wasDecoded): shown again (another screen, a tab that
// comes back) they appear at once, painted with the rest of the screen.

const layerVariants = {
  // a successor fades in over the outgoing photo: it stays fully visible underneath until then; without a successor
  // (the photo was removed) it fades out
  exit: (mode: 'under' | 'out') => (mode === 'out' ? { opacity: 0, transition: fade } : { opacity: 1, transition: { duration: 0.24 } }),
}

function PhotoLayer({ url, className }: { url: string; className: string }) {
  const [again] = useState(() => wasDecoded(url))
  const [loaded, setLoaded] = useState(again)
  return (
    <m.img
      src={url}
      alt=""
      draggable={false}
      decoding={again ? 'sync' : 'async'}
      className={className}
      data-loaded={loaded ? '' : undefined}
      variants={layerVariants}
      initial={{ opacity: again ? 1 : 0 }}
      animate={{ opacity: loaded ? 1 : 0 }}
      exit="exit"
      transition={fade}
      onLoad={() => {
        markDecoded(url)
        setLoaded(true)
      }}
    />
  )
}

interface PhotoProps {
  profileId: string
  /** the photo's meta from the screen's answer (null / undefined = none) */
  meta: ProfilePhotoMeta | null | undefined
  /** ask for the bytes at once (a header at the top), not only once it is near the screen */
  eager?: boolean
}

function Layers({ url }: { url: string | null }) {
  return (
    <AnimatePresence initial={false} custom={url ? 'under' : 'out'}>
      {url ? <PhotoLayer key={url} url={url} className="pph-img" /> : null}
    </AnimatePresence>
  )
}

const CLASS: Record<ProfilePhotoKind, string> = { avatar: 'pph-avatar', banner: 'pph-banner' }

/**
 * Nothing at all for a person without a photo (no observer, no query: most people in a list have none). My own
 * picture also listens to my change on its way: it can bring a photo before any screen data has its meta (and keeps
 * the layer mounted while a removal fades out).
 */
function Photo(props: PhotoProps & { kind: ProfilePhotoKind }) {
  const self = props.profileId === renderedAccount()
  const change = useOwnPhotoChange(self ? props.profileId : null, props.kind)
  if (!props.meta && !change) return null
  return <StoredPhoto {...props} />
}

function StoredPhoto({ profileId, meta, eager = false, kind }: PhotoProps & { kind: ProfilePhotoKind }) {
  const ref = useRef<HTMLSpanElement>(null)
  // (my own change on its way needs no download: its bytes are in memory / seeded in the cache already)
  const near = useInView(ref, !eager && Boolean(meta))
  const photo = usePersonPhoto(profileId, kind, meta, eager || near)
  const url = useObjectUrl(photo.blob)
  return (
    <span ref={ref} aria-hidden="true" className={CLASS[kind]} data-photo-state={photo.state} data-profile-photo={kind}>
      <Layers url={url} />
    </span>
  )
}

/** A picture that is not stored yet (the sheets' preview of a just picked file), with the same fade. */
export function PickedPhoto({ blob, kind }: { blob: Blob | null; kind: ProfilePhotoKind }) {
  const url = useObjectUrl(blob)
  return (
    <span aria-hidden="true" className={CLASS[kind]} data-profile-photo={kind} data-photo-state={url ? 'ready' : 'none'}>
      <Layers url={url} />
    </span>
  )
}

/** The photo inside a ProfileAvatar (its child): fills the round tile, the initials stay underneath. */
export function AvatarPhoto(props: PhotoProps) {
  return <Photo {...props} kind="avatar" />
}

/** The photo inside a BannerArt (its `photo` slot): covers the preset art, the banner's own children stay on top. */
export function BannerPhoto(props: PhotoProps) {
  return <Photo {...props} kind="banner" />
}
