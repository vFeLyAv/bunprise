import { onAccountEnded } from '../../lib/accountBoundary'

// One navigation intent in tab memory. Never a query string or persistent storage.
let pending: { listId: string; wishId: string } | null = null
export function requestOpenWish(listId: string, wishId: string): void { pending = { listId, wishId } }
export function peekOpenWish(listId: string): string | null { return pending?.listId === listId ? pending.wishId : null }
export function takeOpenWish(listId: string): string | null {
  if (pending?.listId !== listId) return null
  const id = pending.wishId
  pending = null
  return id
}
onAccountEnded(() => { pending = null })
