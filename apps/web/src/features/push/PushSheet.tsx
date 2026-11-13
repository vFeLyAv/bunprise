import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { getPushSettings, setPushInvitations, type PushSettings } from '../../lib/api/push'
import { currentLanguage } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { Button, Skeleton, Switch, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { currentEndpoint, disablePush, enablePush } from './device'
import { notificationPermission, pushPlatform, readPushMarker } from './platform'

// "Benachrichtigungen" (docs/spec/web-push-design.md §3) — a lazy chunk. Opened from Profil › Auf diesem Gerät
// (mode 'settings') or from the hint under an invitation card (mode 'prompt'). OUR explanation and a preview come
// first; the browser's own prompt only after "Benachrichtigungen erlauben" / the device switch (a user gesture —
// device.ts calls Notification.requestPermission before anything else is awaited). Per platform: iPhone in Safari →
// how to add Bunprise to the home screen; blocked → where to allow it; no Push API → why not. The demo simulates.
// The settings answer lives in memory only (query key ['push', …]; the persisted cache is ['feed'] only).

export interface PushSheetProps {
  userId: string
  open: boolean
  onClose: () => void
  mode?: 'settings' | 'prompt'
  /** the device was switched on or off here (the row re-reads its value) */
  onChanged?: (on: boolean) => void
}

export const pushSettingsKey = (userId: string) => ['push', 'settings', userId] as const

export default function PushSheet({ userId, open, onClose, mode = 'settings', onChanged }: PushSheetProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const online = useOnline()
  const platform = pushPlatform()
  const [permission, setPermission] = useState(notificationPermission)
  const [busy, setBusy] = useState(false)
  const [invitesOverride, setInvitesOverride] = useState<boolean | null>(null)
  const [deviceOverride, setDeviceOverride] = useState<boolean | null>(null)
  const working = useRef(false)
  const usable = platform === 'demo' || (platform === 'ready' && permission !== 'denied')
  const settings = useQuery({
    queryKey: pushSettingsKey(userId),
    queryFn: async (): Promise<PushSettings> => getPushSettings(await currentEndpoint(userId).catch(() => null), userId),
    enabled: open && usable,
    staleTime: 0,
  })
  const marked = readPushMarker(userId) !== null
  const deviceOn = deviceOverride ?? (settings.data ? settings.data.device : marked)
  const invitations = invitesOverride ?? settings.data?.invitations ?? true
  const available = settings.data?.available ?? true

  function stillHere(epoch: ReturnType<typeof captureEpoch>): boolean {
    return epoch.isCurrent() && (epoch.userId === undefined || epoch.userId === userId)
  }

  async function turnOn() {
    if (working.current || !online) {
      if (!online) toast.error(t('push.sheet.offline'))
      return
    }
    const epoch = captureEpoch()
    if (!stillHere(epoch)) return
    working.current = true
    setBusy(true)
    try {
      // first call, no await before it: the browser prompt needs this tap
      const result = await enablePush(userId, currentLanguage())
      if (!stillHere(epoch)) return
      if (result === 'on') {
        haptic('success')
        setDeviceOverride(true)
        onChanged?.(true)
        toast.success(platform === 'demo' ? t('push.sheet.demo') : t('push.sheet.enabled'))
        void queryClient.invalidateQueries({ queryKey: pushSettingsKey(userId) })
        if (mode === 'prompt') onClose()
      } else if (result === 'denied') {
        setPermission(notificationPermission())
      } else {
        toast.error(t('push.sheet.unavailable'))
      }
    } catch {
      if (stillHere(epoch)) toast.error(t('push.sheet.failed'))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function turnOff() {
    if (working.current) return
    if (!online) {
      toast.error(t('push.sheet.offline'))
      return
    }
    const epoch = captureEpoch()
    if (!stillHere(epoch)) return
    working.current = true
    setBusy(true)
    setDeviceOverride(false)
    try {
      await disablePush(userId)
      if (!stillHere(epoch)) return
      onChanged?.(false)
      toast.success(t('push.sheet.disabled'))
      void queryClient.invalidateQueries({ queryKey: pushSettingsKey(userId) })
    } catch {
      if (stillHere(epoch)) {
        setDeviceOverride(null)
        toast.error(t('push.sheet.failed'))
      }
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function toggleInvitations(next: boolean) {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!stillHere(epoch)) return
    working.current = true
    const previous = invitations
    setInvitesOverride(next) // optimistic
    try {
      const saved = await setPushInvitations(next, userId)
      if (!stillHere(epoch)) return
      setInvitesOverride(saved)
      void queryClient.invalidateQueries({ queryKey: pushSettingsKey(userId) })
    } catch {
      if (stillHere(epoch)) {
        setInvitesOverride(previous)
        toast.error(t('push.sheet.failed'))
      }
    } finally {
      working.current = false
    }
  }

  const prompt = mode === 'prompt' && usable && !deviceOn
  const footer = prompt ? (
    <div className="flex flex-col gap-2">
      <Button size="lg" fullWidth disabled={!online || !available} loading={busy} onClick={() => void turnOn()}>{t('push.sheet.allow')}</Button>
      <Button size="lg" fullWidth variant="ghost" disabled={busy} onClick={onClose}>{t('push.sheet.later')}</Button>
    </div>
  ) : undefined

  return (
    <Sheet open={open} onClose={onClose} title={t('push.sheet.title')} closeLabel={t('common.close')} footer={footer}>
      <div className="flex flex-col gap-4" data-push-sheet={platform}>
        <p className="t-body text-text">{t('push.sheet.intro')}</p>
        <NotificationPreview label={t('push.sheet.preview_label')} app={t('push.sheet.preview_app')} time={t('push.sheet.preview_time')}
          title={t('push.sheet.preview_title')} body={t('push.sheet.preview_body')} />

        {platform === 'ios-browser' ? (
          <Notice title={t('push.sheet.ios_title')}>
            <p>{t('push.sheet.ios_body')}</p>
            <ol className="mt-2 list-decimal pl-5">
              <li>{t('push.sheet.ios_step_1')}</li>
              <li>{t('push.sheet.ios_step_2')}</li>
              <li>{t('push.sheet.ios_step_3')}</li>
            </ol>
          </Notice>
        ) : platform === 'unsupported' ? (
          <Notice title={t('push.sheet.unsupported_title')}><p>{t('push.sheet.unsupported_body')}</p></Notice>
        ) : platform === 'ready' && permission === 'denied' ? (
          <Notice title={t('push.sheet.denied_title')}><p>{t('push.sheet.denied_body')}</p></Notice>
        ) : prompt ? (
          platform === 'demo' ? null : <p className="t-footnote text-text-2">{t('push.sheet.allow_note')}</p>
        ) : settings.isPending && !settings.data ? (
          <Skeleton height={124} rounded="lg" className="rounded-[22px]" />
        ) : (
          <div className="glass-panel flex flex-col rounded-[22px]">
            <div className="px-4 py-3">
                <Switch className="min-w-0 flex-1" checked={deviceOn} disabled={busy || !available} label={t('push.sheet.device')}
                  description={t('push.sheet.device_hint')} onChange={(next) => void (next ? turnOn() : turnOff())} />
            </div>
            <div className="mx-4 h-px bg-separator" aria-hidden="true" />
            <div className="px-4 py-3">
                <Switch className="min-w-0 flex-1" checked={invitations} disabled={busy || !online} label={t('push.sheet.invitations')}
                  description={t('push.sheet.invitations_hint')} onChange={(next) => void toggleInvitations(next)} />
            </div>
          </div>
        )}
        {!available && usable ? <p role="status" className="t-footnote text-text-2">{t('push.sheet.unavailable')}</p> : null}
        <p className="t-footnote text-text-2">{t('push.sheet.privacy')}</p>
      </div>
    </Sheet>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="note" className="rounded-[18px] bg-fill px-4 py-3 t-callout text-text">
      <p className="t-headline text-text">{title}</p>
      <div className="mt-1 text-text-2">{children}</div>
    </div>
  )
}

/** A still picture of a notification on a lock screen (no live data: the example words come from the locale file). */
function NotificationPreview({ label, app, time, title, body }: { label: string; app: string; time: string; title: string; body: string }) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="t-footnote text-text-2">{label}</figcaption>
      <div className="glass-panel flex items-start gap-3 rounded-[20px] px-3.5 py-3 elev-1" aria-hidden="true">
        <img src="/icons/icon-192.png" alt="" width={36} height={36} className="mt-0.5 h-9 w-9 shrink-0 rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 t-caption-1 text-text-2">
            <span className="uppercase tracking-wide">{app}</span>
            <span>{time}</span>
          </div>
          <p className="t-subhead font-semibold text-text">{title}</p>
          <p className="t-subhead text-text">{body}</p>
        </div>
      </div>
    </figure>
  )
}
