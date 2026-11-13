import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { currentLanguage } from '../../lib/i18n'
import { getInviteEmailSettings, setInviteEmail, type InviteEmailSettings } from '../../lib/api/inviteEmail'
import { toast } from '../../lib/toast'
import { IconTile, Switch } from '../../ui'
import { useOnline } from '../auth/shared'
import { SettingsControlRow } from '../account/settingsParts'
import { invitesEnabled } from '../invitations/flag'
import { inviteEmailEnabled } from './flag'

// Profil › Privatsphäre › "Bei neuen Einladungen eine E-Mail schicken" (docs/spec/invite-email-design.md §0, §3; default
// OFF), right under "Einladungen in Anlässe". The database decides everything (only a visible invitation causes a mail,
// at most one per 6 hours, neutral text); here only the person's own switch. Hidden without the flag, without the
// invitations, while the database switch is off and on a server without the migration. No usable address: the switch
// is off and disabled with a hint (switching OFF always works). Optimistic with rollback; the answer stays in memory.

export const inviteEmailKey = (userId: string) => ['inviteEmail', userId] as const

export function InviteEmailRow({ userId, disabled = false }: { userId: string; disabled?: boolean }) {
  if (!inviteEmailEnabled() || !invitesEnabled()) return null
  return <Row userId={userId} disabled={disabled} />
}

function Row({ userId, disabled }: { userId: string; disabled: boolean }) {
  const { t, ready } = useTranslation('invitations')
  const queryClient = useQueryClient()
  const online = useOnline()
  const settings = useQuery({ queryKey: inviteEmailKey(userId), queryFn: () => getInviteEmailSettings(userId), staleTime: 60_000 })
  const [override, setOverride] = useState<boolean | null>(null)
  const saving = useRef(false)
  const data = settings.data
  if (!ready || !data?.available) return null
  const value = override ?? data.enabled
  // turning ON needs an address; turning OFF never needs anything
  const blocked = !value && !data.address

  async function toggle(next: boolean) {
    if (saving.current || disabled || !online || (next && blocked)) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const previous = value
    saving.current = true
    setOverride(next)
    try {
      const stored = await setInviteEmail(next, currentLanguage(), userId)
      if (!epoch.isCurrent()) return
      queryClient.setQueryData<InviteEmailSettings>(inviteEmailKey(userId), (old) => (old ? { ...old, enabled: stored } : old))
      setOverride(null)
    } catch {
      if (!epoch.isCurrent()) return
      setOverride(previous)
      toast.error(t('invitations.email.failed'))
    } finally {
      saving.current = false
    }
  }

  return (
    <SettingsControlRow>
      <div className="set-switch">
        <IconTile tone="sky" className="self-start mt-0.5"><GlyphMailBell /></IconTile>
        {/* the kit switch is a <label> around its text and the toggle: that whole part is the hit area */}
        <Switch className="min-w-0 flex-1" checked={value} disabled={disabled || !online || blocked}
          label={t('invitations.email.label')}
          description={blocked ? t('invitations.email.no_address') : t('invitations.email.hint')}
          onChange={(next) => void toggle(next)} />
      </div>
    </SettingsControlRow>
  )
}

function GlyphMailBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="15" height="12" rx="2.5" />
      <path d="m3.5 7 7.5 5.5 7.5-5.5" />
      <circle cx="19" cy="6" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
