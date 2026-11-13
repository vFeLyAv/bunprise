import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { IconTile, haptic } from '../../ui'
import { SettingsButtonRow } from '../account/settingsParts'
import { ComicHost } from './ComicHost'
import { readComicProgress, subscribeComicProgress } from './progress'
import { openComic, useComicState } from './store'

// The comic's permanent home (decided 26.10): Profil › Über Bunprise › «Pompon & Tapsi – ihre Geschichte». Opens the
// reader at once; says "Weiterlesen" while a started story is not read to its end; offline "Nur online" (the reader
// is not in the offline cache — unless it was already loaded in this tab). Hosts the reader's sheet for the profile.

const subscribeOnline = (notify: () => void) => onlineManager.subscribe(notify)

/** A comic page: two panels and a small star (24 × 24, 1.75 px round strokes, decorative). */
function GlyphComic({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="4" y="3.5" width="16" height="17" rx="2.4" />
      <path d="M4 11.2 20 9.4M11.6 10.4 10.8 20.5" />
      <path d="m15.6 13.6.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z" />
    </svg>
  )
}

export function ComicProfileRow() {
  const { t } = useTranslation('settings')
  const online = useSyncExternalStore(subscribeOnline, () => onlineManager.isOnline(), () => true)
  const progress = useSyncExternalStore(subscribeComicProgress, readComicProgress, () => null)
  const comic = useComicState()
  const offline = !online && !comic.loaded
  return (
    <>
      <SettingsButtonRow
        icon={<IconTile tone="apricot"><GlyphComic /></IconTile>}
        label={t('about.comic')}
        hint={offline ? t('about.comic_offline') : progress ? t('about.comic_continue') : undefined}
        disabled={offline}
        onClick={() => {
          haptic('tap')
          void openComic()
        }}
      />
      <ComicHost />
    </>
  )
}
