import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { setInSuggestions } from '../../lib/api/follows'
import { toast } from '../../lib/toast'
import { Button, IconTile, Skeleton, Switch, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { GlyphChevronRight } from '../nav/glyphs'
import { listsEnabled } from '../lists/flag'
import { GlyphBlock, GlyphEye, GlyphFollowLink, GlyphPeople, GlyphQr, GlyphSuggest } from '../people/glyphs'
import { friendCodesEnabled } from '../people/codeFlag'
import { FollowLinkSheetHost, openFollowLinkSheet } from '../people/linkSheetHost'
import { ownMeQuery, patchInSuggestions } from '../people/queries'
import { SettingsControlRow, SettingsGroup } from './settingsParts'
import { InvitationsPrivacyRow } from '../invitations/InvitationsPrivacyRow'
import { InviteEmailRow } from '../inviteEmail/InviteEmailRow'
import '../people/people.css'

// Profil › "Privatsphäre" (follows-design §2.11; wave 2b, agent K2) — one group of the Telegram-style profile:
//   Mein Code & Link (Felix 27.10: one row — the sheet shows the QR + code first, the link with "Alle Links
//   deaktivieren" below; without the codes' flag "Mein Folgen-Link", the link alone) · Follower & Anfragen (→ /people) · Blockierte
//   Personen (→ /people, section "Blockiert") · the switch "In Vorschlägen aus Anlässen erscheinen" (default OFF,
//   Art. 25 Abs. 2 DSGVO; a REST write of the own profiles.in_suggestions, optimistic with rollback) · "Wer sieht
//   was?" (a static sheet). The own value comes from get_me (profiles has no SELECT grant for it).
// Behind the flag (features/lists/flag.ts): without it the group does not exist. Built from ./settingsParts so it
// looks like its neighbours. Account boundary: a late answer for an account that ended here changes nothing.

export interface PrivacySettingsProps {
  userId: string
  /** the profile screen's account changed (useAccountBoundary): every action stops */
  disabled?: boolean
}

export function PrivacySettings({ userId, disabled = false }: PrivacySettingsProps) {
  if (!listsEnabled()) return null
  return <PrivacyGroup userId={userId} disabled={disabled} />
}

function PrivacyGroup({ userId, disabled }: { userId: string; disabled: boolean }) {
  const { t, ready } = useTranslation('people')
  const queryClient = useQueryClient()
  const online = useOnline()
  // the guard's own get_me (pinned to this account); a fresh one only when the cached answer is stale
  const me = useQuery(ownMeQuery(userId))
  const [override, setOverride] = useState<boolean | null>(null)
  const [whoOpen, setWhoOpen] = useState(false)
  const saving = useRef(false)
  const stored = me.data?.profile.id === userId ? me.data.profile.in_suggestions : undefined
  const value = override ?? stored ?? false
  const known = override !== null || stored !== undefined
  const codes = friendCodesEnabled()

  async function toggle(next: boolean) {
    if (saving.current || disabled || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const previous = value
    saving.current = true
    setOverride(next) // optimistic: the switch moves at once
    try {
      await setInSuggestions(next, userId)
      if (!epoch.isCurrent()) return
      patchInSuggestions(queryClient, userId, next)
    } catch {
      if (!epoch.isCurrent()) return
      setOverride(previous) // rollback
      toast.error(t('people.privacy.suggestions_failed'))
    } finally {
      saving.current = false
    }
  }

  if (!ready) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton width={110} height={14} className="mx-4" />
        <Skeleton height={312} rounded="lg" className="rounded-[22px]" />
      </div>
    )
  }

  return (
    <>
      <SettingsGroup title={t('people.privacy.title')}>
        {/* ONE row for my code and my link (Felix 27.10): the sheet opens on the QR + code, the link below it; without
            the codes (codeFlag.ts) it is my follow link alone, as before */}
        <ButtonRow icon={<IconTile tone="sky">{codes ? <GlyphQr /> : <GlyphFollowLink />}</IconTile>}
          label={t(codes ? 'people.privacy.mine' : 'people.privacy.link')} disabled={disabled}
          onPress={() => openFollowLinkSheet({ manage: true, tab: codes ? 'code' : 'link' })} />
        <LinkRow to="/people" icon={<IconTile tone="apricot"><GlyphPeople /></IconTile>} label={t('people.privacy.people')} disabled={disabled} />
        <LinkRow to="/people" section="blocked" icon={<IconTile tone="rose"><GlyphBlock /></IconTile>} label={t('people.privacy.blocked')} disabled={disabled} />
        <SettingsControlRow>
          <div className="set-switch">
            <IconTile tone="sage" className="self-start mt-0.5"><GlyphSuggest /></IconTile>
            {/* the kit switch is a <label> around its text and the toggle: that whole part is the hit area */}
            <Switch className="min-w-0 flex-1" checked={value} disabled={disabled || !online || !known} label={t('people.privacy.suggestions')}
              description={t('people.privacy.suggestions_hint')} onChange={(next) => void toggle(next)} />
          </div>
        </SettingsControlRow>
        {/* "Einladungen in Anlässe" (features/invitations, behind VITE_INVITES) */}
        <InvitationsPrivacyRow userId={userId} disabled={disabled} />
        {/* "Bei neuen Einladungen eine E-Mail schicken" (features/inviteEmail, behind VITE_INVITE_EMAIL; default off) */}
        <InviteEmailRow userId={userId} disabled={disabled} />
        <ButtonRow icon={<IconTile tone="lilac"><GlyphEye /></IconTile>} label={t('people.privacy.who')} onPress={() => setWhoOpen(true)} />
      </SettingsGroup>

      <Sheet open={whoOpen} onClose={() => setWhoOpen(false)} title={t('people.privacy.who_title')} closeLabel={t('common.close')}
        footer={<Button size="lg" fullWidth onClick={() => setWhoOpen(false)}>{t('people.privacy.who_close')}</Button>}>
        <ul className="pp-points pb-2">
          <li>{t('people.privacy.who_private')}</li>
          <li>{t('people.privacy.who_followers')}</li>
          <li>{t('people.privacy.who_occasion')}</li>
          <li>{t('people.privacy.who_direction')}</li>
          <li>{t('people.privacy.who_suggestions')}</li>
          <li>{t('people.privacy.who_photos')}</li>
          <li>{t('people.privacy.who_secret')}</li>
          <li>{t('people.privacy.who_followers_list')}</li>
        </ul>
      </Sheet>
      {disabled ? null : <FollowLinkSheetHost userId={userId} />}
    </>
  )
}

function RowBody({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="set-row-icon">{icon}</span>
      <span className="set-row-main">
        <span className="set-row-text">
          <span className="block t-body text-text">{label}</span>
        </span>
        <GlyphChevronRight size={18} className="shrink-0 text-text-3" />
      </span>
    </>
  )
}

/** A row that opens a pushed screen of the people feature. */
function LinkRow({ to, section, icon, label, disabled }: { to: '/people'; section?: 'blocked'; icon: ReactNode; label: string; disabled: boolean }) {
  return (
    <li className="set-item">
      {/* the hash lets the router itself bring the section into view AFTER its own scroll reset of this
          navigation — the people screen's own scroll ran before that reset and was undone whenever its data
          was already cached (QA ACCOUNT-2) */}
      <Link to={to} search={section ? { section } : {}} hash={section ? `people-${section}` : undefined} className="set-row set-row-press" aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault()
        }}
        onPointerDown={() => haptic('tap')}>
        <RowBody icon={icon} label={label} />
      </Link>
    </li>
  )
}

/** A row that opens a sheet. */
function ButtonRow({ icon, label, onPress, disabled = false }: { icon: ReactNode; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <li className="set-item">
      <button type="button" className="set-row set-row-press w-full text-left" disabled={disabled} onPointerDown={() => haptic('tap')} onClick={onPress}>
        <RowBody icon={icon} label={label} />
      </button>
    </li>
  )
}
