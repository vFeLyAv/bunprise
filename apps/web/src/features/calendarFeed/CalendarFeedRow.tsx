import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaces } from '../../lib/i18n'
import { IconCalendar, IconTile } from '../../ui'
import { SettingsButtonRow } from '../account/settingsParts'
import { calendarFeedEnabled } from './flag'

// Profil › Daten › "Kalender-Abo" (docs/handoffs/2026-10-27-calendar.md): a tap opens the lazy sheet (explanation, the
// secret address once, Apple / Google / Outlook, new address, end). Nothing without the flag.

const CalendarFeedSheet = lazy(() => Promise.all([import('./CalendarFeedSheet'), ensureNamespaces('settings')]).then(([mod]) => mod))

export function CalendarFeedRow({ userId, disabled = false }: { userId: string; disabled?: boolean }) {
  if (!calendarFeedEnabled()) return null
  return <Row userId={userId} disabled={disabled} />
}

function Row({ userId, disabled }: { userId: string; disabled: boolean }) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  return (
    <>
      <SettingsButtonRow onClick={() => { setMounted(true); setOpen(true) }} disabled={disabled}
        icon={<IconTile tone="sky"><IconCalendar size={18} /></IconTile>} label={t('calendar_feed.row')} />
      {mounted ? (
        <Suspense fallback={null}>
          <CalendarFeedSheet userId={userId} open={open && !disabled} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
