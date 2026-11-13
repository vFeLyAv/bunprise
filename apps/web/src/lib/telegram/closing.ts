// Unsaved changes ↔ Telegram's "close anyway?" question (docs/spec/telegram-mini-app.md §3.11, Bot API ≥ 6.2).
// The editors' leave guard (features/occasions/leaveGuard.tsx) holds while a form has unsaved changes; the Telegram
// bridge (lib/telegram/bridge.ts — lazy, only inside Telegram) listens and switches the client's closing
// confirmation. Outside Telegram nobody listens: then this is just a counter.

let holds = 0
let listener: ((need: boolean) => void) | null = null

/** A form has unsaved changes. Call the returned release after saving or leaving (safe to call twice). */
export function holdClosing(): () => void {
  holds += 1
  if (holds === 1) listener?.(true)
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    if (holds === 0) listener?.(false)
  }
}

/** The bridge's listener: called at once with the current state, then on every change. Returns the unsubscribe. */
export function onClosingChange(next: (need: boolean) => void): () => void {
  listener = next
  next(holds > 0)
  return () => {
    if (listener === next) listener = null
  }
}
