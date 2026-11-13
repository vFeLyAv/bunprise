import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { IconGlobe } from '../../ui/iconGlobe'

// Top banner "no connection" (product-pilot.md S15). Source of truth is TanStack Query's
// onlineManager (window online/offline events); features may also call onlineManager.setOnline()
// after a failed fetch (performance-plan.md 2.5).
// Shell rule: this file is in every route's initial chunk (the invite landing /i has a hard budget), so it
// draws the kit's offline strip (ui/Banner kind "offline", sticky) with the same classes itself instead of
// importing the Banner module.

function subscribe(callback: () => void): () => void {
  return onlineManager.subscribe(callback)
}

function isOnline(): boolean {
  return onlineManager.isOnline()
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true)
  const { t } = useTranslation()
  if (online) return null
  return (
    <div
      role="status"
      className="sticky top-[calc(var(--topbar-h)+var(--sa-top)+var(--sp-2))] z-(--z-sticky) flex min-h-11 items-center gap-3 rounded-md bg-surface-2 px-4 py-2 t-subhead text-text-2 ring-1 ring-inset ring-separator"
    >
      <span className="shrink-0">
        <IconGlobe size={20} />
      </span>
      <div className="min-w-0 flex-1">{t('common.offline_banner')}</div>
    </div>
  )
}
