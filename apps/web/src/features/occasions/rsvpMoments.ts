import { onAccountEnded } from '../../lib/accountBoundary'

// One tab visit, never persisted: another account starts with its own moments.
const prompts = new Set<string>()
const arrivals = new Set<string>()
export function hasRsvpPrompt(id: string): boolean { return prompts.has(id) }
export function markRsvpPrompt(id: string): void { prompts.add(id) }
export function takeRsvpArrival(id: string): boolean {
  if (arrivals.has(id)) return false
  arrivals.add(id)
  return true
}
export function resetRsvpMoments(): void { prompts.clear(); arrivals.clear() }
onAccountEnded(resetRsvpMoments)
