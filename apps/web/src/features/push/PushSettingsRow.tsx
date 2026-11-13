import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaces } from '../../lib/i18n'
import { IconTile } from '../../ui'
import { SettingsButtonRow, SettingsRow } from '../account/settingsParts'
import { pushEnabled } from './flag'
import { GlyphBell } from './glyphs'
import { notificationPermission, pushPlatform, readPushMarker } from './platform'

// Profil › "Auf diesem Gerät" › "Benachrichtigungen" (docs/spec/web-push-design.md §3a): the value on the right says
// what this device does; a tap opens the lazy sheet (explanation, preview, the two switches). Nothing in Telegram
// (no web push there) and nothing without the flag. Light on purpose: the sheet and the browser code are lazy.

const PushSheet = lazy(() => Promise.all([import('./PushSheet'), ensureNamespaces('settings')]).then(([mod]) => mod))

export function PushSettingsRow({ userId, disabled = false }: { userId: string; disabled?: boolean }) {
  if (!pushEnabled() || pushPlatform() === 'telegram') return null
  return <Row userId={userId} disabled={disabled} />
}

function Row({ userId, disabled }: { userId: string; disabled: boolean }) {
  const { t, ready } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [, setVersion] = useState(0)
  const icon = <IconTile tone="apricot"><GlyphBell /></IconTile>
  // same height while the words load: the groups below do not jump
  if (!ready) return <SettingsRow icon={icon} label={<span className="invisible">·</span>} />
  const platform = pushPlatform()
  const on = readPushMarker(userId) !== null && (platform === 'demo' || notificationPermission() === 'granted')
  const value = platform === 'ios-browser' ? t('push.row.home_screen')
    : platform === 'unsupported' ? t('push.row.unavailable')
      : on ? t('push.row.on') : t('push.row.off')
  return (
    <>
      <SettingsButtonRow onClick={() => { setMounted(true); setOpen(true) }} disabled={disabled} icon={icon} label={t('push.row.label')} value={value} />
      {mounted ? (
        <Suspense fallback={null}>
          <PushSheet userId={userId} open={open && !disabled} onClose={() => setOpen(false)} onChanged={() => setVersion((v) => v + 1)} />
        </Suspense>
      ) : null}
    </>
  )
}
