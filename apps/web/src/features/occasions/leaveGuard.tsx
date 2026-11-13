import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { captureEpoch } from '../../lib/accountBoundary'
import { holdClosing } from '../../lib/telegram/closing'
import { Confirm } from '../../ui/Confirm'

// "Änderungen verwerfen?" for the editor screens (new / edit occasion, new / edit wish): a person who taps
// back by mistake does not lose what they typed without being asked. Two ways out are covered:
//   - the screen's own "Abbrechen" / "Zurück" (leave(go)): asks first while there are unsaved changes;
//   - any other navigation — the system back gesture, browser back, a tab — through the router history's
//     blocker; the sheet decides, and "Weiter bearbeiten" keeps the screen (the history steps back in place).
// Saving or deleting leaves on purpose: allow() first, then navigate. No beforeunload prompt (a reload in the
// demo resets everything anyway, and a native dialog would only startle). An account that ended in this tab is
// never held back (sign-out / switch navigate away without asking).
// Inside Telegram the same unsaved changes also switch on the client's "close anyway?" question
// (lib/telegram/closing.ts → the bridge); off again after save / leave.

export interface LeaveGuardText {
  title: string
  message: string
  confirm: string
  cancel: string
}

export interface LeaveGuard {
  /** The screen's back / cancel button: runs `go` at once, or after "Verwerfen" while there are changes. */
  leave: (go: () => void) => void
  /** A save or a delete leaves on purpose: no question from here on. */
  allow: () => void
  /** The confirmation sheet; render it once in the screen. */
  sheet: ReactNode
}

type Asking = { discard: () => void; stay: () => void }

interface BlockableHistory {
  block?: (blocker: { blockerFn: () => boolean | Promise<boolean>; enableBeforeUnload?: boolean }) => () => void
}

export function useLeaveGuard(dirty: boolean, text: LeaveGuardText): LeaveGuard {
  const router = useRouter()
  const dirtyRef = useRef(dirty)
  const allowed = useRef(false)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [epoch] = useState(captureEpoch)
  useLayoutEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const holds = useCallback(() => dirtyRef.current && !allowed.current && epoch.isCurrent(), [epoch])

  // Telegram's closing confirmation while there are changes (nobody listens outside Telegram)
  const releaseClosing = useRef<() => void>(() => {})
  useEffect(() => {
    if (!dirty || allowed.current) return
    releaseClosing.current = holdClosing()
    return releaseClosing.current
  }, [dirty])

  // a navigation waiting for the answer
  const pending = useRef<((stay: boolean) => void) | null>(null)
  const history = (router as { history?: BlockableHistory } | undefined)?.history
  useLayoutEffect(() => {
    if (typeof history?.block !== 'function') return
    return history.block({
      enableBeforeUnload: false,
      blockerFn: () => {
        if (!holds()) return false
        // true = stay (a back gesture is undone), false = go on
        return new Promise<boolean>((resolve) => {
          pending.current = resolve
          setAsking({
            discard: () => {
              allowed.current = true
              pending.current = null
              resolve(false)
            },
            stay: () => {
              pending.current = null
              resolve(true)
            },
          })
        })
      },
    })
  }, [history, holds])
  // a question still open when the screen goes (it cannot stay anyway): that navigation goes on
  useLayoutEffect(
    () => () => {
      pending.current?.(false)
      pending.current = null
    },
    [],
  )

  const leave = useCallback(
    (go: () => void) => {
      if (!holds()) {
        go()
        return
      }
      setAsking({
        discard: () => {
          allowed.current = true
          releaseClosing.current()
          go()
        },
        stay: () => {},
      })
    },
    [holds],
  )

  const allow = useCallback(() => {
    allowed.current = true
    releaseClosing.current()
  }, [])

  const sheet = (
    <Confirm
      open={asking !== null}
      title={text.title}
      message={text.message}
      confirmLabel={text.confirm}
      cancelLabel={text.cancel}
      destructive
      onConfirm={() => {
        const current = asking
        setAsking(null)
        current?.discard()
      }}
      onCancel={() => {
        const current = asking
        setAsking(null)
        current?.stay()
      }}
    />
  )

  return { leave, allow, sheet }
}
