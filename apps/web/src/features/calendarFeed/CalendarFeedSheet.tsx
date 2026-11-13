import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { DEMO_MODE } from '../../lib/app'
import { createCalendarFeed, feedHttpsUrl, feedWebcalUrl, getCalendarFeed, revokeCalendarFeed } from '../../lib/api/calendarFeed'
import { currentLanguage } from '../../lib/i18n'
import { copyText } from '../../lib/share'
import { toast } from '../../lib/toast'
import { Button, ButtonLink, IconCopy, Skeleton, haptic } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'

// "Kalender-Abo" (a lazy chunk; docs/handoffs/2026-10-27-calendar.md). Our explanation first (what the calendar will
// see, that the address is a secret), then: create → the address ONCE (copy, webcal:// for Apple / Outlook, the steps
// for Google with the honest note that Google refreshes rarely) → later only its status (since when, last fetched),
// "Neue Adresse erstellen" (the old one stops) and "Abo beenden". The token lives in this component's state only —
// never in storage, the query cache or the address bar; closing the sheet forgets it.

export interface CalendarFeedSheetProps {
  userId: string
  open: boolean
  onClose: () => void
}

export const calendarFeedKey = (userId: string) => ['calendarFeed', userId] as const

function formatWhen(iso: string | null, withTime: boolean): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat(currentLanguage(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export default function CalendarFeedSheet({ userId, open, onClose }: CalendarFeedSheetProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const online = useOnline()
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'rotate' | 'stop' | null>(null)
  const working = useRef(false)
  const status = useQuery({ queryKey: calendarFeedKey(userId), queryFn: () => getCalendarFeed(userId), enabled: open, staleTime: 0 })

  function stillHere(epoch: ReturnType<typeof captureEpoch>): boolean {
    return epoch.isCurrent() && (epoch.userId === undefined || epoch.userId === userId)
  }

  async function run(action: () => Promise<void>) {
    if (working.current) return
    if (!online) {
      toast.error(t('calendar_feed.offline'))
      return
    }
    const epoch = captureEpoch()
    if (!stillHere(epoch)) return
    working.current = true
    setBusy(true)
    try {
      await action()
      if (!stillHere(epoch)) return
      void queryClient.invalidateQueries({ queryKey: calendarFeedKey(userId) })
    } catch {
      if (stillHere(epoch)) toast.error(t('calendar_feed.failed'))
    } finally {
      working.current = false
      setBusy(false)
      setConfirm(null)
    }
  }

  const create = () => run(async () => {
    const epoch = captureEpoch()
    const made = await createCalendarFeed(currentLanguage(), userId)
    haptic('success')
    setToken(made.token)
    // their own calendar subscription: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
    if (stillHere(epoch)) void import('../sammlung/note').then((m) => m.noteMilestone('calendar'), () => undefined)
  })
  const stop = () => run(async () => {
    await revokeCalendarFeed(userId)
    setToken(null)
    toast.success(t('calendar_feed.stopped'))
  })

  function close() {
    setToken(null) // the address is shown once: closing forgets it
    onClose()
  }

  const data = status.data
  let body: ReactNode
  if (token) {
    body = <Address token={token} />
  } else if (!data) {
    body = <Skeleton height={112} rounded="lg" className="rounded-[22px]" />
  } else if (data.active) {
    body = (
      <div className="flex flex-col gap-3" data-feed-state="active">
        <div className="glass-panel flex flex-col gap-1 rounded-[22px] px-4 py-3">
          <p className="t-headline text-text">{t('calendar_feed.active', { date: formatWhen(data.created_at, false) })}</p>
          <p className="t-subhead text-text-2">
            {data.last_fetched_at ? t('calendar_feed.last_fetched', { date: formatWhen(data.last_fetched_at, true) }) : t('calendar_feed.never_fetched')}
          </p>
        </div>
        <p className="t-footnote text-text-2">{t('calendar_feed.shown_once')}</p>
        <Button variant="secondary" size="lg" fullWidth disabled={!online} loading={busy && confirm !== 'stop'} onClick={() => setConfirm('rotate')}>
          {t('calendar_feed.rotate')}
        </Button>
        <Button variant="ghost" size="lg" fullWidth className="text-danger" disabled={!online || busy} onClick={() => setConfirm('stop')}>
          {t('calendar_feed.stop')}
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-3" data-feed-state="off">
        <p className="t-footnote text-text-2">{t('calendar_feed.secret')}</p>
        <Button size="lg" fullWidth disabled={!online || !data.available} loading={busy} onClick={() => void create()}>
          {t('calendar_feed.create')}
        </Button>
        {!data.available ? <p role="status" className="t-footnote text-text-2">{t('calendar_feed.unavailable')}</p> : null}
      </div>
    )
  }

  return (
    <>
      <Sheet open={open} onClose={close} title={t('calendar_feed.title')} closeLabel={t('common.close')}>
        <div className="flex flex-col gap-4 pb-2" data-calendar-feed-sheet="">
          <p className="t-body text-text">{t('calendar_feed.intro')}</p>
          <p className="t-footnote text-text-2">{t('calendar_feed.contains')}</p>
          {body}
          {DEMO_MODE ? <p className="t-footnote text-text-3">{t('calendar_feed.demo')}</p> : null}
        </div>
      </Sheet>
      <Confirm
        open={confirm === 'rotate'}
        title={t('calendar_feed.rotate_title')}
        message={t('calendar_feed.rotate_message')}
        confirmLabel={t('calendar_feed.rotate')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void create()}
        onCancel={() => { if (!busy) setConfirm(null) }}
      />
      <Confirm
        open={confirm === 'stop'}
        destructive
        title={t('calendar_feed.stop_title')}
        message={t('calendar_feed.stop_message')}
        confirmLabel={t('calendar_feed.stop')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void stop()}
        onCancel={() => { if (!busy) setConfirm(null) }}
      />
    </>
  )
}

/** The address, once: copy it, subscribe in Apple Kalender / Outlook (webcal://), or the steps for Google. */
function Address({ token }: { token: string }) {
  const { t } = useTranslation('settings')
  const https = feedHttpsUrl(token)
  async function copy() {
    if (await copyText(https)) {
      haptic('success')
      toast.success(t('calendar_feed.copied'))
    } else {
      toast.error(t('calendar_feed.failed'))
    }
  }
  return (
    <div className="flex flex-col gap-3" data-feed-state="address">
      <label className="flex flex-col gap-1.5">
        <span className="t-subhead font-semibold text-text">{t('calendar_feed.address_label')}</span>
        <input readOnly value={https} onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 w-full rounded-[14px] border border-separator bg-fill px-3 font-mono t-footnote text-text" />
      </label>
      <p className="t-footnote text-text-2">{t('calendar_feed.address_once')}</p>
      <ButtonLink size="lg" fullWidth href={feedWebcalUrl(token)}>{t('calendar_feed.apple')}</ButtonLink>
      <Button variant="secondary" size="lg" fullWidth onClick={() => void copy()}>
        <IconCopy size={18} className="shrink-0" />
        {t('calendar_feed.copy')}
      </Button>
      <div role="note" className="rounded-[18px] bg-fill px-4 py-3 t-callout text-text">
        <p className="t-headline text-text">{t('calendar_feed.google_title')}</p>
        <p className="mt-1 text-text-2">{t('calendar_feed.google_steps')}</p>
        <p className="mt-2 text-text-2">{t('calendar_feed.google_slow')}</p>
      </div>
      <p className="t-footnote text-text-2">{t('calendar_feed.outlook')}</p>
    </div>
  )
}
