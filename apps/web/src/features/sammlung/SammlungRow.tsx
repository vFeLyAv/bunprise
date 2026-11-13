import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { IconTile } from '../../ui'
import type { GlyphProps } from '../nav/glyphs'
import { SettingsGroup, SettingsLinkRow } from '../account/settingsParts'

// The Profil row «Pompons Sammlung  4/9 ›» (design §2, above «Rechtliches»): an orange tile, the name, the count in
// grey. A new find = a small orange dot at the count — no pop-up, no toast (Felix 28.10, §0 #8). Shown only while the
// bunnies are (the caller checks "Kaninchen zeigen"). Device data only (store.ts): nothing is fetched. The count is a
// lazy chunk of its own (./SammlungCount.tsx): the row never moves, only its right side fills in.
const SammlungCount = lazy(() => import('./SammlungCount'))

/** A little gallery frame with a star: «a collection». 24 × 24, 1.75 px round strokes like the other rows. */
function GlyphSammlung({ size = 24, className }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className}>
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3" />
      <path d="m12 8.4 1.1 2.25 2.45.35-1.78 1.73.42 2.45L12 14.02l-2.19 1.16.42-2.45-1.78-1.73 2.45-.35z" />
    </svg>
  )
}

export function SammlungRow({ userId }: { userId: string }) {
  const { t } = useTranslation('settings')
  return (
    <SettingsGroup>
      <SettingsLinkRow to="/settings/sammlung" icon={<IconTile tone="apricot"><GlyphSammlung /></IconTile>} label={t('sammlung.title')}
        value={<Suspense fallback={null}><SammlungCount userId={userId} /></Suspense>} />
    </SettingsGroup>
  )
}
