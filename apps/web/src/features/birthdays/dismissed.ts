import { onAccountEnded } from '../../lib/accountBoundary'
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// "Ausblenden" on a birthday suggestion: per occasion and year (the anniversary's year), on this device —
// localStorage `birthdayHints` = { v: 1, owner, dismissed: ["<occasion id>:<year>", …] } (docs/storage-registry.md).
// Bound to the account (another owner's record is ignored), at most 50 entries (the oldest go), removed on sign-out with
// the prefix. Storage blocked: a memory copy for this tab.

const KEY = `${ACTIVE_STORAGE_PREFIX}birthdayHints`
const MAX = 50
const ENTRY = /^[0-9a-f-]{36}:\d{4}$/
let memory: { owner: string; dismissed: string[] } | null = null

function read(owner: string): string[] {
  const kept = memory?.owner === owner ? memory.dismissed : []
  return [...new Set([...readStorage(owner), ...kept])]
}

function readStorage(owner: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof value === 'object' && value !== null && (value as { v?: unknown }).v === 1 && (value as { owner?: unknown }).owner === owner) {
      const list = (value as { dismissed?: unknown }).dismissed
      return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string' && ENTRY.test(entry)) : []
    }
    return []
  } catch {
    return []
  }
}

export function dismissedHints(owner: string): Set<string> {
  return new Set(read(owner))
}

export function dismissHint(owner: string, key: string): void {
  if (!ENTRY.test(key)) return
  const next = [...read(owner).filter((entry) => entry !== key), key].slice(-MAX)
  memory = { owner, dismissed: next }
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, owner, dismissed: next }))
  } catch {
    /* storage blocked: the memory copy keeps it for this tab */
  }
}

onAccountEnded(() => {
  memory = null
})
