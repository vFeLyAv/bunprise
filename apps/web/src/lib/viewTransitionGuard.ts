// When a navigation starts while the previous view transition is still running, the browser skips the
// older one and rejects its promises with an AbortError ("Transition was skipped. New ViewTransition
// started"). The router (defaultViewTransition) does not await them, so they surfaced as uncaught page
// errors. This guard attaches no-op handlers to every transition's promises; what happens on screen is
// unchanged, and anyone who awaits a promise still sees its rejection.

type StartViewTransition = (...args: unknown[]) => ViewTransition

export function guardViewTransitions(doc: Document = document): void {
  const original = (doc as { startViewTransition?: unknown }).startViewTransition
  if (typeof original !== 'function') return
  const start = (original as StartViewTransition).bind(doc)
  const guarded: StartViewTransition = (...args) => {
    const transition = start(...args)
    for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) {
      promise?.catch(() => {})
    }
    return transition
  }
  ;(doc as { startViewTransition: StartViewTransition }).startViewTransition = guarded
}
