import { useCallback, useEffect, useRef, useState } from 'react'
import { captureEpoch } from '../../lib/accountBoundary'
import {
  fetchLinkPreview,
  isAbortError,
  isLinkPreviewError,
  type LinkPreview,
  type LinkPreviewErrorCode,
  type LinkPreviewOptions,
} from '../../lib/api/linkPreview'

// The link preview of the wish screen as a small state machine:
//   idle → loading(url) → ready(url, preview) | failed(url, code)
// - one request at a time: a new link (or reset) aborts the request before it;
// - an answer counts only for the link it was asked for and only while the account of the screen is
//   still the tab's account (captureEpoch): a late answer writes nothing;
// - every failure is calm: `failed` carries the code, the screen shows the same card with empty fields.

export type LinkPreviewState =
  | { status: 'idle' }
  | { status: 'loading'; url: string; id: number }
  | { status: 'ready'; url: string; id: number; preview: LinkPreview }
  | { status: 'failed'; url: string; id: number; code: LinkPreviewErrorCode }

export type LinkPreviewFetcher = (url: string, options: LinkPreviewOptions) => Promise<LinkPreview>

/** A settled answer (ready or failed) — handed to `onSettled` right after it became the state. */
export type SettledLinkPreview = Extract<LinkPreviewState, { status: 'ready' | 'failed' }>

export interface UseLinkPreviewOptions {
  fetcher?: LinkPreviewFetcher
  /** called once per answer that counts (not for aborted, stale or former-account answers) */
  onSettled?: (settled: SettledLinkPreview) => void
}

export function useLinkPreview({ fetcher = fetchLinkPreview, onSettled }: UseLinkPreviewOptions = {}) {
  const [state, setState] = useState<LinkPreviewState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const counter = useRef(0)
  const settledRef = useRef(onSettled)
  useEffect(() => {
    settledRef.current = onSettled
  })

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
  }, [])

  const request = useCallback(
    (url: string) => {
      controller.current?.abort()
      const own = new AbortController()
      controller.current = own
      const id = (counter.current += 1)
      const epoch = captureEpoch()
      setState({ status: 'loading', url, id })
      const settle = (settled: SettledLinkPreview) => {
        controller.current = null
        setState(settled)
        settledRef.current?.(settled)
      }
      fetcher(url, { signal: own.signal, ...(epoch.userId ? { expectedUserId: epoch.userId } : {}) }).then(
        (preview) => {
          if (own.signal.aborted || controller.current !== own || !epoch.isCurrent()) return
          settle({ status: 'ready', url, id, preview })
        },
        (err: unknown) => {
          if (own.signal.aborted || controller.current !== own || !epoch.isCurrent() || isAbortError(err)) return
          settle({ status: 'failed', url, id, code: isLinkPreviewError(err) ? err.code : 'unavailable' })
        },
      )
    },
    [fetcher],
  )

  // the screen closes: a request still on its way is dropped
  useEffect(
    () => () => {
      controller.current?.abort()
      controller.current = null
    },
    [],
  )

  return { state, request, reset }
}

/** Codes after which "Nochmal" makes sense (the same link may work a moment later). */
export function isRetryable(code: LinkPreviewErrorCode): boolean {
  return code === 'fetch_failed' || code === 'timeout' || code === 'rate_limited' || code === 'offline' || code === 'unavailable'
}
