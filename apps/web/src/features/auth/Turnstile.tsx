import { useEffect, useRef } from 'react'
import { TURNSTILE_SITE_KEY } from '../../lib/app'

interface WidgetOptions {
  sitekey: string
  theme: 'auto'
  size: 'flexible'
  'response-field': false
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
  'timeout-callback': () => void
}

interface TurnstileApi {
  ready: (callback: () => void) => void
  render: (container: HTMLElement, options: WidgetOptions) => string
  remove: (widgetId: string) => void
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | null = null

function currentApi(): TurnstileApi | undefined {
  return (window as Window & { turnstile?: TurnstileApi }).turnstile
}

// Keep the shared script across SPA navigation and StrictMode effect replays.
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
function loadTurnstile(): Promise<TurnstileApi> {
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    let script = Array.from(document.scripts).find((candidate) =>
      candidate.src.split('?')[0] === SCRIPT_URL.split('?')[0],
    )
    const existing = Boolean(script)
    const cleanup = () => {
      window.clearTimeout(timeout)
      script?.removeEventListener('load', loaded)
      script?.removeEventListener('error', failed)
    }
    const failed = () => {
      cleanup()
      if (!existing) script?.remove()
      reject(new Error('Turnstile did not load'))
    }
    const loaded = () => {
      const api = currentApi()
      if (!api) {
        failed()
        return
      }
      api.ready(() => {
        cleanup()
        resolve(api)
      })
    }
    const timeout = window.setTimeout(failed, 15_000)
    if (currentApi()) {
      loaded()
      return
    }
    if (!script) {
      script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.defer = true
    }
    script.addEventListener('load', loaded)
    script.addEventListener('error', failed)
    if (!existing) document.head.append(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

export interface TurnstileProps {
  onToken: (token: string | null) => void
  resetKey: number
  label: string
}

export function Turnstile({ onToken, resetKey, label }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    const sitekey = TURNSTILE_SITE_KEY
    const host = container.current
    if (!sitekey || !host) return
    let cancelled = false
    let widget: { api: TurnstileApi; id: string } | null = null
    const invalidate = () => {
      if (!cancelled) onTokenRef.current(null)
    }
    invalidate()
    void loadTurnstile().then((api) => {
      if (cancelled) return
      const id = api.render(host, {
        sitekey,
        theme: 'auto',
        size: 'flexible',
        'response-field': false,
        callback: (token) => {
          if (!cancelled) onTokenRef.current(token)
        },
        'expired-callback': invalidate,
        'error-callback': invalidate,
        'timeout-callback': invalidate,
      })
      widget = { api, id }
    }).catch(invalidate)
    return () => {
      cancelled = true
      widget?.api.remove(widget.id)
      onTokenRef.current(null)
    }
  }, [resetKey])

  if (!TURNSTILE_SITE_KEY) return null
  return (
    <div role="group" aria-label={label} className="space-y-2">
      <p className="t-footnote text-text-2">{label}</p>
      <div ref={container} />
    </div>
  )
}
