import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ChipGroup, IconTile, haptic } from '../../ui'
import { IN_TELEGRAM } from '../../lib/telegram/detect'
import { readPlatform } from '../onboarding/platform'
import type { GlyphProps } from '../nav/glyphs'
import { APP_ICONS, DEFAULT_APP_ICON, appIconLinks } from './appIconVariants'
import { appIconHint, onAppIconChange, readAppIcon, setAppIcon } from './appIconChoice'
import { SettingsControlRow } from './settingsParts'
import './appIcon.css'

// Einstellungen → Darstellung → App-Symbol (Felix 27.10): the home-screen icon of this device, one of twelve
// (appIconVariants.ts). A grid of the icons themselves (their SVGs, loaded lazily — none of them is precached), the
// chosen one ringed, its name next to the title like "Farbschema". Under the grid the honest part: a phone takes the
// icon when Bunprise is ADDED to the home screen, so the hint says what that means here (iPhone / Android, in the
// browser or already installed). In Telegram there is no home-screen icon to choose: the row is not there.

/** Four little app tiles: the home screen. */
function GlyphAppIcons({ size = 24 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </svg>
  )
}

export function AppIconPicker() {
  const { t } = useTranslation('settings')
  const current = useSyncExternalStore(onAppIconChange, readAppIcon, () => DEFAULT_APP_ICON)
  if (IN_TELEGRAM) return null
  const hint = appIconHint(readPlatform())
  return (
    <SettingsControlRow>
      <div className="flex flex-col gap-3 px-4 py-3" data-app-icon-picker="">
        <div className="flex items-center gap-3">
          <IconTile tone="apricot"><GlyphAppIcons /></IconTile>
          <span className="t-body text-text">{t('settings.app_icon')}</span>
          <span className="ml-auto t-subhead text-text-2" data-app-icon-name="">{t(`settings.app_icon_${current}`)}</span>
        </div>
        <ChipGroup label={t('settings.app_icon')} className="app-icon-grid">
          {APP_ICONS.map((id) => {
            const selected = id === current
            return (
              <button key={id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
                aria-label={t(`settings.app_icon_${id}`)} className="app-icon-choice" data-icon={id}
                onPointerDown={() => haptic('select')} onClick={() => { if (!selected) setAppIcon(id) }}>
                <img src={appIconLinks(id).icon} alt="" width={60} height={60} loading="lazy" decoding="async" draggable={false} />
              </button>
            )
          })}
        </ChipGroup>
        <p className="t-footnote text-text-2" data-app-icon-hint={hint}>{t(`settings.app_icon_hint_${hint}`)}</p>
      </div>
    </SettingsControlRow>
  )
}
