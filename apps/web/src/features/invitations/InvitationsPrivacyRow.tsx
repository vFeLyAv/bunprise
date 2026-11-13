import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { setInvitationsFrom, type InvitationsFrom } from '../../lib/api/invitations'
import { toast } from '../../lib/toast'
import { IconTile, Segmented } from '../../ui'
import { useOnline } from '../auth/shared'
import { SettingsControlRow } from '../account/settingsParts'
import { ownMeQuery } from '../people/queries'
import { invitesEnabled } from './flag'
import { setMyInvitationsFrom } from './queries'

// Profil › Privatsphäre › "Einladungen in Anlässe: Von Freunden · Niemand (nur per Link)" (design §2.3, Р8; default
// "Von Freunden"). "Niemand" keeps every new in-app invitation away silently and ends the waiting ones (the database
// does it, trigger profiles_invitations_from) — links keep working. A REST write of the own profiles.invitations_from
// (no SELECT: the value comes from get_me), optimistic with rollback. Only while the flag is on.

export function InvitationsPrivacyRow({ userId, disabled = false }: { userId: string; disabled?: boolean }) {
  if (!invitesEnabled()) return null
  return <Row userId={userId} disabled={disabled} />
}

function Row({ userId, disabled }: { userId: string; disabled: boolean }) {
  const { t, ready } = useTranslation('invitations')
  const queryClient = useQueryClient()
  const online = useOnline()
  const me = useQuery(ownMeQuery(userId))
  const [override, setOverride] = useState<InvitationsFrom | null>(null)
  const saving = useRef(false)
  const stored = me.data?.profile.id === userId ? me.data.profile.invitations_from : undefined
  const value: InvitationsFrom = override ?? stored ?? 'friends'
  if (!ready) return null

  async function change(next: InvitationsFrom) {
    if (saving.current || disabled || !online || next === value) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const previous = value
    saving.current = true
    setOverride(next)
    try {
      await setInvitationsFrom(next, userId)
      if (!epoch.isCurrent()) return
      setMyInvitationsFrom(queryClient, userId, next)
      setOverride(null)
      // "Niemand" ended the waiting invitations: the dot goes with get_me's next answer
      void queryClient.invalidateQueries({ queryKey: ['me'], exact: true })
    } catch {
      if (!epoch.isCurrent()) return
      setOverride(previous)
      toast.error(t('invitations.privacy.failed'))
    } finally {
      saving.current = false
    }
  }

  return (
    <SettingsControlRow>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <IconTile tone="honey" className="mt-0.5"><GlyphEnvelope /></IconTile>
          <div className="min-w-0 flex-1">
            <p className="t-body text-text">{t('invitations.privacy.label')}</p>
            <p className="mt-0.5 t-footnote text-text-2">{value === 'nobody' ? t('invitations.privacy.hint_nobody') : t('invitations.privacy.hint_friends')}</p>
          </div>
        </div>
        <Segmented
          label={t('invitations.privacy.label')}
          value={value}
          disabled={disabled || !online || stored === undefined}
          onChange={(next) => void change(next)}
          options={[
            { value: 'friends', label: t('invitations.privacy.friends') },
            { value: 'nobody', label: t('invitations.privacy.nobody') },
          ]}
        />
      </div>
    </SettingsControlRow>
  )
}

function GlyphEnvelope() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  )
}
