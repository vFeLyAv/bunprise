import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch, onAccountEnded, type AccountEpoch } from '../../lib/accountBoundary'
import { buildInviteUrl, createInvite } from '../../lib/api/invites'
import type { OccasionScreen } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { canNativeShare, copyText, share, type ShareResult } from '../../lib/share'
import { formatDate } from '../../lib/time'
import { toast } from '../../lib/toast'
import { Button, haptic, IconCopy, IconPlus, IconShare, listItemClass, listRowClass, TextField, useReducedMotionPref } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { IconLink } from '../../ui/iconLink'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { useCarry } from '../mascot-ui/carry'
import { InviteFriends } from '../invitations/OccasionInviteEntry'
import { rememberInviteLink, useRememberedInviteLink, visibleInviteLink } from './inviteLink'
import '../../styles/occasion.css'
import type { SaveState } from './saving'

// "Einladen" lives in "Wer kommt" (Felix 27.10: no separate card at the top of the occasion any more — the ways to
// invite sit where the people are). InviteActions = the rows at the top of the members card:
//   "Freunde einladen" — the in-app picker (features/invitations): the host until the start, a guest while the host
//                        allows it;
//   "Per Link einladen" — HOST ONLY: a sheet with the invite link (InviteLinkPanel).
// The calendar's "Freunde einladen" pill (K10, ./inviteFocus.ts) brings these rows into view with the focus and a
// glow, once. While the optimistic create is still on its way, no invite action yet.

/** How long the invite rows glow after the calendar's "Freunde einladen" opened the occasion. */
const SPOTLIGHT_MS = 1800

export interface InviteActionsProps {
  screen: OccasionScreen
  userId: string
  /** when the screen data was last written (query.dataUpdatedAt) — the link panel's remembered link */
  updatedAt: number
  /** optimistic create/edit still on its way: no invite actions yet */
  saveState: SaveState | undefined
  /** opened for inviting (the calendar's pill): these rows come into view with the focus */
  focus?: boolean
}

export function InviteActions({ screen, userId, updatedAt, saveState, focus = false }: InviteActionsProps) {
  const { t } = useTranslation('occasion')
  const isHost = screen.viewer.role === 'host'
  const saving = saveState === 'saving'
  const [linkOpen, setLinkOpen] = useState(false)
  const reduced = useReducedMotionPref()
  const groupRef = useRef<HTMLDivElement>(null)
  // the rows glide into view, the group takes the focus and glows once in the accent (styles/occasion.css)
  const [spotlight, setSpotlight] = useState(focus)
  useEffect(() => {
    if (!focus) return
    const frame = requestAnimationFrame(() => {
      groupRef.current?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      groupRef.current?.focus({ preventScroll: true })
    })
    const timer = window.setTimeout(() => setSpotlight(false), SPOTLIGHT_MS)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focus, reduced])
  const invite = screen.invite

  return (
    <>
      <InviteFriends screen={screen} userId={userId}>
        {(friends) => !isHost && !friends ? null : (
          <div
            ref={groupRef}
            role="group"
            aria-label={t('occasion.invite_title')}
            tabIndex={-1}
            id="invite"
            className="invite-actions outline-none"
            data-spotlight={spotlight ? '' : undefined}
          >
            {friends ? (
              <InviteRow
                icon={<IconPlus size={18} />}
                title={friends.label}
                subtitle={friends.hint}
                disabled={friends.disabled || saving}
                onPointerDown={friends.preload}
                onClick={friends.start}
              />
            ) : null}
            {isHost ? (
              <InviteRow
                icon={<IconLink size={18} />}
                title={t('occasion.invite_link_row')}
                subtitle={invite?.active && !saving ? t('occasion.invite_active', { date: formatDate(invite.expires_at) }) : null}
                disabled={saving}
                onClick={() => setLinkOpen(true)}
              />
            ) : null}
          </div>
        )}
      </InviteFriends>
      {isHost ? (
        <Sheet open={linkOpen} onClose={() => setLinkOpen(false)} title={t('occasion.invite_link_row')} closeLabel={t('common.close')}>
          <InviteLinkPanel screen={screen} userId={userId} updatedAt={updatedAt} saveState={saveState} />
        </Sheet>
      ) : null}
    </>
  )
}

interface InviteRowProps {
  icon: ReactNode
  title: string
  subtitle: string | null
  disabled: boolean
  onPointerDown?: () => void
  onClick: () => void
}

/** An action row in the members card: accent circle + accent title, like a person's row with its avatar. */
function InviteRow({ icon, title, subtitle, disabled, onPointerDown, onClick }: InviteRowProps) {
  return (
    <div className={listItemClass}>
      <button
        type="button"
        className={`${listRowClass({ tall: Boolean(subtitle), pressable: true })} disabled:opacity-50`}
        disabled={disabled}
        onPointerDown={() => { haptic('tap'); onPointerDown?.() }}
        onClick={onClick}
      >
        <span aria-hidden="true" className="invite-row-icon">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block t-headline text-accent-text">{title}</span>
          {subtitle ? <span className="mt-0.5 block t-subhead text-text-2 [overflow-wrap:anywhere]">{subtitle}</span> : null}
        </span>
      </button>
    </div>
  )
}

// HOST ONLY — the invite link (S7 owner view, F6), in the "Per Link einladen" sheet. The token is shown once by
// create_invite(); the database keeps only its hash, so a link from an earlier session cannot be shown again: the
// panel then says "link active, valid until …" and offers a new one (which revokes the old). A link from this tab
// stays in memory (inviteLink.ts) — never in storage or the URL. The share text is impersonal and says nothing about
// reservations. The bunny (invitations are its zone) carries a letter away when the link was copied or shared
// (pilot-decisions §7). Account boundary: a link created for this host is never remembered, shared or copied — and
// no toast or bunny follows — once the host's account ended in this tab (captureEpoch).

export interface InviteLinkPanelProps {
  screen: OccasionScreen
  /** the host's account id (the remembered link belongs to it) */
  userId: string
  /** when the screen data was last written (query.dataUpdatedAt) */
  updatedAt: number
  /** optimistic create/edit still on its way: no invite actions yet */
  saveState: SaveState | undefined
}

export function InviteLinkPanel({ screen, userId, updatedAt, saveState }: InviteLinkPanelProps) {
  const { t } = useTranslation('occasion')
  const queryClient = useQueryClient()
  const online = useOnline()
  const carry = useCarry()
  const source = useRef<HTMLElement | null>(null)
  const sourceBox = useRef<DOMRect | null>(null)
  const lastLetter = useRef(-Infinity)
  const alive = useRef(false)
  const letterAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    const stop = onAccountEnded(() => { alive.current = false; letterAbort.current?.abort() })
    return () => { alive.current = false; letterAbort.current?.abort(); stop() }
  }, [])
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { occasion, invite } = screen
  const saving = saveState === 'saving'
  const disabled = !online || saving || busy
  const remembered = useRememberedInviteLink(userId, occasion.id)
  const panelRef = useRef<HTMLDivElement>(null)
  const link = visibleInviteLink(remembered, invite, updatedAt)

  const shareText = t('occasion.invite_share_text', {
    title: occasion.title,
    date: formatDate(occasion.starts_at, { timeZone: occasion.tz }),
  })

  function respond(epoch: AccountEpoch, result: ShareResult) {
    if (!alive.current || !epoch.isCurrent()) return
    if (result === 'copied') toast.success(t('occasion.invite_copied'))
    if (result === 'failed') toast.error(t('occasion.invite_copy_failed'))
    const target = source.current?.isConnected ? source.current : panelRef.current?.querySelector<HTMLElement>('[data-invite-copy]') ?? panelRef.current
    if ((result === 'copied' || result === 'shared') && target && Date.now() - lastLetter.current >= 10_000) {
      lastLetter.current = Date.now()
      letterAbort.current?.abort()
      letterAbort.current = new AbortController()
      void carry({ from: sourceBox.current ?? target.getBoundingClientRect(), to: target, item: 'letter', away: 'right', signal: letterAbort.current.signal })
    }
  }

  /** Copy / share the link shown on this screen — only while its account is still this tab's. */
  function handOut(action: (link: string) => Promise<ShareResult>, link: string, button: HTMLElement) {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    source.current = button
    sourceBox.current = button.getBoundingClientRect()
    void action(link).then((result) => respond(epoch, result))
  }

  async function newLink() {
    if (busy) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    setConfirmOpen(false)
    setBusy(true)
    let url: string
    try {
      url = buildInviteUrl(await createInvite(occasion.id, userId))
    } catch (err) {
      if (!alive.current || !epoch.isCurrent()) return
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
      setBusy(false)
      return
    }
    if (!alive.current || !epoch.isCurrent()) return // never remember, share or copy a link for an account that ended here
    rememberInviteLink(userId, occasion.id, url)
    // the invite link for an occasion of their own (host only): a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
    if (screen.viewer.role === 'host') void import('../sammlung/note').then((m) => m.noteMilestone('invite'), () => undefined)
    void queryClient.invalidateQueries({ queryKey: qk.occasion(occasion.id) })
    // the server part is done; the share sheet may stay open as long as the person likes
    setBusy(false)
    respond(epoch, await share({ title: occasion.title, text: shareText, url }))
  }

  let text: string
  if (saving) text = t('occasion.saving_hint')
  else if (link) text = t('occasion.invite_ready')
  else if (saveState === 'created') text = t('occasion.created_hint')
  else if (invite?.active) text = t('occasion.invite_active', { date: formatDate(invite.expires_at) })
  else text = t('occasion.invite_text')

  return (
    <div ref={panelRef} className="flex flex-col gap-4 pb-2">
      <div>
        <p role="status" className="t-subhead text-text-2">
          {text}
        </p>
        {!link && invite?.active && !saving ? (
          <p className="mt-2 t-footnote text-text-2">{t('occasion.invite_hidden_hint')}</p>
        ) : null}
      </div>

      {link ? (
        <>
          <TextField
            label={t('occasion.invite_link_label')}
            value={link}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex gap-2">
            {canNativeShare() ? (
              <Button
                className="flex-1"
                icon={<IconShare />}
                onClick={(event) => handOut((url) => share({ title: occasion.title, text: shareText, url }), link, event.currentTarget)}
              >
                {t('common.share')}
              </Button>
            ) : null}
            <Button
              data-invite-copy=""
              className="flex-1"
              variant="secondary"
              icon={<IconCopy />}
              onClick={(event) => handOut(async (url) => ((await copyText(url)) ? 'copied' : 'failed'), link, event.currentTarget)}
            >
              {t('common.copy')}
            </Button>
          </div>
        </>
      ) : null}

      {link || invite?.active ? (
        <Button
          variant={link ? 'ghost' : 'secondary'}
          fullWidth
          disabled={disabled}
          loading={busy}
          loadingLabel={t('occasion.invite_creating')}
          onClick={() => setConfirmOpen(true)}
        >
          {t('occasion.invite_regenerate')}
        </Button>
      ) : (
        <Button
          size="lg"
          fullWidth
          icon={<IconShare />}
          disabled={disabled}
          loading={busy}
          loadingLabel={t('occasion.invite_creating')}
          onClick={(event) => { source.current = event.currentTarget; sourceBox.current = event.currentTarget.getBoundingClientRect(); void newLink() }}
        >
          {t('occasion.invite_create')}
        </Button>
      )}
      <Confirm
        open={confirmOpen}
        title={t('occasion.invite_regenerate_title')}
        message={t('occasion.invite_regenerate_message')}
        confirmLabel={t('occasion.invite_regenerate')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void newLink()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
