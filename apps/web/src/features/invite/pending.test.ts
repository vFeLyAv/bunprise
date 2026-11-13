import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumePendingInvite, getPendingInvite, setPendingInvite, takeInviteFromLink } from './pending'

// The invite token lives only in this tab's sessionStorage (docs/storage-registry.md) until the
// person explicitly joins; nothing about it goes to the URL or to localStorage.

const TOKEN = 'a'.repeat(64)
const OTHER = '0123456789abcdef'.repeat(4)
const KEY = 'bunprise.pendingInvite'

beforeEach(() => {
  sessionStorage.clear()
  consumePendingInvite()
})
afterEach(() => vi.restoreAllMocks())

describe('pending invite token', () => {
  it('keeps a well-formed link token in sessionStorage only, until it is consumed', () => {
    takeInviteFromLink(TOKEN)
    expect(sessionStorage.getItem(KEY)).toBe(TOKEN)
    expect(Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes(TOKEN))).toBe(false)
    expect(getPendingInvite()).toBe(TOKEN)
    expect(getPendingInvite()).toBe(TOKEN) // reading does not consume
    expect(consumePendingInvite()).toBe(TOKEN)
    expect(getPendingInvite()).toBeNull()
    expect(consumePendingInvite()).toBeNull()
  })

  it('lets the newest link win and drops a malformed one together with an older link', () => {
    takeInviteFromLink(TOKEN)
    takeInviteFromLink(OTHER)
    expect(getPendingInvite()).toBe(OTHER)
    for (const broken of [OTHER.slice(0, 63), OTHER.toUpperCase(), `${OTHER}x`, 'not-a-token', '<script>']) {
      takeInviteFromLink(TOKEN)
      takeInviteFromLink(broken)
      expect(getPendingInvite(), broken).toBeNull()
      expect(sessionStorage.getItem(KEY)).toBeNull()
    }
  })

  it('still works within the page when the browser blocks storage', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    takeInviteFromLink(TOKEN)
    expect(getPendingInvite()).toBe(TOKEN)
    setPendingInvite(OTHER)
    expect(consumePendingInvite()).toBe(OTHER)
    expect(getPendingInvite()).toBeNull()
  })
})
