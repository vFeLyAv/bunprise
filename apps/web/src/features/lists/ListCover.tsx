import { useState, type CSSProperties, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { markDecoded, useObjectUrl, wasDecoded } from '../../lib/objectUrl'
import { Spinner, cn, type TileTone } from '../../ui'
import type { ListCover } from './listCovers'
import { LIST_COVER_VT } from './listTransition'

// A list's cover photo — the card in "Listen" and the big header of the list's screen. The ONLY <img> of the lists
// feature, and its `src` is always an object URL of a Blob from OUR database (or the picture just prepared on this
// device): never an address of anybody else (lists/secrecy.test.ts checks it). Decorative (alt=""): the list's title
// is said right next to it.

// URLs that were decoded once in this page session (lib/objectUrl.ts wasDecoded): shown again (the transition's other
// end, a tab that comes back) they appear at once.

function CoverImage({ blob, className, eager = false }: { blob: Blob; className?: string; eager?: boolean }) {
  const url = useObjectUrl(blob)
  const [loaded, setLoaded] = useState<string | null>(null)
  if (!url) return null
  const again = wasDecoded(url)
  const ready = loaded === url || again
  return (
    <img
      src={url}
      alt=""
      decoding={eager || again ? 'sync' : 'async'}
      draggable={false}
      className={cn('lcv-img', className)}
      data-loaded={ready ? '' : undefined}
      onLoad={() => {
        markDecoded(url)
        setLoaded(url)
      }}
    />
  )
}

export interface CardCoverProps {
  cover: ListCover
  /** carries the view-transition name (set in the tap, listTransition.ts) */
  photoRef?: Ref<HTMLSpanElement>
  /** the card the person came back from keeps its name (the photo shrinks back into it) */
  named?: boolean
}

/** The photo that fills a list card (with a scrim at the bottom, so the white title on it stays readable). */
export function CardCover({ cover, photoRef, named = false }: CardCoverProps) {
  const style: CSSProperties | undefined = named ? { viewTransitionName: LIST_COVER_VT } : undefined
  return (
    <span ref={photoRef} aria-hidden="true" className="lc-photo" data-state={cover.state} data-cover="" data-list-cover-vt="" style={style}>
      {cover.blob ? <CoverImage blob={cover.blob} /> : null}
    </span>
  )
}

/** The busy mark on a card while my cover change travels (decorative; the menu's toast says the result). */
export function CardCoverBusy() {
  return (
    <span aria-hidden="true" className="lc-photo-busy">
      <Spinner />
    </span>
  )
}

/**
 * The header photo of a list's screen: full-bleed from the top, dissolving into the paper (like an occasion's
 * cover); the box is there from the first frame in the list's tint and the photo fades in — or is there at once,
 * when the card just showed it (the shared-element transition lands on it).
 */
export function ListHeroCover({ cover, tone, named }: { cover: ListCover; tone: TileTone; named: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="ls-cover"
      data-tint={tone}
      data-state={cover.state}
      data-list-hero=""
      style={named ? { viewTransitionName: LIST_COVER_VT } : undefined}
    >
      {cover.blob ? <CoverImage blob={cover.blob} eager /> : null}
    </div>
  )
}

/** "Titelbild wird gespeichert …" under the header while my change travels. */
export function CoverBusyPill({ removing }: { removing: boolean }) {
  const { t } = useTranslation('lists')
  return (
    <p role="status" className="glass-panel ls-cover-busy">
      <Spinner />
      {removing ? t('lists.cover.removing') : t('lists.cover.saving')}
    </p>
  )
}
