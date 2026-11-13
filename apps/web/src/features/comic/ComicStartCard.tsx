import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as m from 'motion/react-m'
import { Button, IconX, fade, haptic } from '../../ui'
import { openComic } from './store'
import still from './card-still.webp'

// The comic card on Start (a lazy chunk, fetched only when ComicStartSlot's rules let it show): a still of episode 1's
// last panel (door 14, Pompon holds out the invitation with the "+1", the star glows in Tapsi's cheek — no text in the
// picture; 440 × 327 WebP, ≤ 10 KB, loaded only with the card), the question, «Geschichte lesen» and "×".
// The reader's sheet is hosted apart from it (ComicStartSlot.tsx ComicHostSlot): it outlasts the card.

export interface ComicStartCardProps {
  /** "×": never again for episode 1 on this device */
  onDismiss: () => void
}

export default function ComicStartCard({ onDismiss }: ComicStartCardProps) {
  const { t } = useTranslation('feed')
  const titleId = useId()
  const [opening, setOpening] = useState(false)
  return (
    <m.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={fade}
      aria-labelledby={titleId}
      data-comic-card=""
      className="glass-panel relative overflow-hidden rounded-card"
    >
      <img src={still} alt="" width={440} height={327} decoding="async" className="block h-auto w-full" style={{ background: '#FFFFFF' }} />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 pt-2 t-headline text-text [text-wrap:balance]">{t('feed.comic.title')}</h2>
          <button
            type="button"
            aria-label={t('feed.comic.hide')}
            className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-text-2 focus-visible:outline-2 focus-visible:outline-accent-500"
            onClick={() => {
              haptic('tap')
              onDismiss()
            }}
          >
            <IconX size={20} />
          </button>
        </div>
        <Button
          variant="primary"
          fullWidth
          aria-busy={opening || undefined}
          onClick={() => {
            setOpening(true)
            void openComic().finally(() => setOpening(false))
          }}
        >
          {t('feed.comic.read')}
        </Button>
      </div>
    </m.section>
  )
}
