import { describe, expect, it, vi } from 'vitest'
import { guardViewTransitions } from './viewTransitionGuard'

function skipped(): Promise<void> {
  return Promise.reject(new DOMException('Transition was skipped. New ViewTransition started', 'AbortError'))
}

describe('guardViewTransitions', () => {
  // Vitest fails the run on any unhandled rejection, so these tests also prove that none escapes.
  it('a skipped transition no longer becomes an unhandled rejection; the transition itself is returned', async () => {
    const transition = { ready: skipped(), finished: skipped(), updateCallbackDone: skipped(), skipTransition: vi.fn() }
    const start = vi.fn(() => transition)
    const doc = { startViewTransition: start } as unknown as Document
    guardViewTransitions(doc)
    const update = () => {}
    const result = (doc as unknown as { startViewTransition: (cb: () => void) => unknown }).startViewTransition(update)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result).toBe(transition)
    expect(start).toHaveBeenCalledWith(update)
    // whoever awaits a promise still sees the rejection
    await expect(transition.finished).rejects.toThrow('Transition was skipped')
  })

  it('does nothing where the browser has no view transitions', () => {
    const doc = {} as Document
    expect(() => guardViewTransitions(doc)).not.toThrow()
    expect('startViewTransition' in doc).toBe(false)
  })
})
