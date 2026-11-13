import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaces } from '../../lib/i18n'
import { Button, IconButton } from '../../ui'
import { pushEnabled } from './flag'
import { GlyphBell } from './glyphs'
import { dismissPushHint, notificationPermission, pushHintDismissed, pushPlatform, readPushMarker } from './platform'

// The contextual question (docs/spec/web-push-design.md §3b): under an invitation card on Start — the moment a push
// would have helped — "Neue Einladungen sofort aufs Handy? [Ja, gerne] [×]". Never on a first visit (an invitation
// card exists only for a signed-in person with a pending invitation), never when the browser was already asked
// (permission not 'default'), when this device is on, in Telegram, or once closed on this device. "Ja, gerne" opens
// the sheet with our explanation; only its button calls the browser prompt.

const PushSheet = lazy(() => Promise.all([import('./PushSheet'), ensureNamespaces('settings')]).then(([mod]) => mod))

export function shouldOfferPush(userId: string): boolean {
  if (!pushEnabled() || pushHintDismissed() || readPushMarker(userId) !== null) return false
  const platform = pushPlatform()
  if (platform === 'demo' || platform === 'ios-browser') return true
  return platform === 'ready' && notificationPermission() === 'default'
}

export function PushHint({ userId }: { userId: string }) {
  const [offered] = useState(() => shouldOfferPush(userId))
  if (!offered) return null
  return <Hint userId={userId} />
}

function Hint({ userId }: { userId: string }) {
  const { t, ready } = useTranslation('settings')
  const [gone, setGone] = useState(false)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  if (!ready) return null
  return (
    <>
      {gone ? null : (
        <div className="mt-3 flex items-center gap-3 rounded-[18px] bg-fill py-2 pl-3.5 pr-1.5" data-push-hint>
          <span className="shrink-0 text-accent-text"><GlyphBell size={20} /></span>
          <p className="min-w-0 flex-1 t-subhead text-text">{t('push.hint.text')}</p>
          <Button size="sm" variant="ghost" onClick={() => { setMounted(true); setOpen(true) }}>{t('push.hint.action')}</Button>
          <IconButton label={t('push.hint.dismiss')} onClick={() => { dismissPushHint(); setGone(true) }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </IconButton>
        </div>
      )}
      {mounted ? (
        <Suspense fallback={null}>
          <PushSheet userId={userId} open={open} mode="prompt" onClose={() => setOpen(false)}
            onChanged={(on) => { if (on) setGone(true) }} />
        </Suspense>
      ) : null}
    </>
  )
}
