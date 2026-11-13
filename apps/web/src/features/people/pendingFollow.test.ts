import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import { clearSessionDrafts } from '../../lib/query'
import { consumePendingFollow, followCodeOf, getPendingFollow, setPendingFollow, takeFollowFromLink } from './pendingFollow'

// The follow-link code lives in this tab's sessionStorage (docs/storage-registry.md "pendingFollow", W04) and in the
// address's fragment until the person asks or says "Nicht jetzt" (add-friends-design §1) — never in localStorage;
// the gate cleans the address when it uses the code up (lib/linkAddress.test.ts); the account's end and sign-out clear it with every key of the active prefix.

const CODE = 'c'.repeat(64)
const OTHER = '0123456789abcdef'.repeat(4)
const KEY = 'bunprise.pendingFollow'

beforeEach(() => {
  sessionStorage.clear()
  consumePendingFollow()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
})

describe('pending follow code', () => {
  it('keeps a well-formed code in sessionStorage only, until it is consumed', () => {
    takeFollowFromLink(CODE)
    expect(sessionStorage.getItem(KEY)).toBe(CODE)
    expect(Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes(CODE))).toBe(false)
    expect(getPendingFollow()).toBe(CODE)
    expect(getPendingFollow()).toBe(CODE) // reading does not consume
    expect(consumePendingFollow()).toBe(CODE)
    expect(getPendingFollow()).toBeNull()
  })

  it('lets the newest link win and drops a malformed one together with an older link', () => {
    takeFollowFromLink(CODE)
    takeFollowFromLink(OTHER)
    expect(getPendingFollow()).toBe(OTHER)
    for (const broken of [OTHER.slice(0, 63), OTHER.toUpperCase(), `${OTHER}x`, 'not-a-code-at-all', '<script>', 'UUUU-UUUU', 'K7M4QX2']) {
      takeFollowFromLink(CODE)
      takeFollowFromLink(broken)
      expect(getPendingFollow(), broken).toBeNull()
      expect(sessionStorage.getItem(KEY)).toBeNull()
    }
  })

  it('a friend code is a code too — in its canonical form (the QR and "Code eingeben" never carry another)', () => {
    expect(takeFollowFromLink('K7M4QX2P')).toBe('K7M4QX2P')
    expect(getPendingFollow()).toBe('K7M4QX2P')
    for (const other of ['k7m4qx2p', 'K7M4-QX2P', 'K7M4QX2U', 'K7M4QX2']) expect(followCodeOf(other), other).toBeNull()
    expect(followCodeOf(CODE)).toBe(CODE)
    expect(followCodeOf(CODE.toUpperCase())).toBeNull()
  })

  it('the address is left alone here (a first-screen module): the lazy gate cleans it when the code is used up', () => {
    history.replaceState(null, '', `/f#${CODE}`)
    takeFollowFromLink(CODE)
    consumePendingFollow(CODE)
    expect(location.hash).toBe(`#${CODE}`)
    history.replaceState(null, '', '/')
  })

  it('still works within the page when the browser blocks storage; the account end forgets the memory copy', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    takeFollowFromLink(CODE)
    expect(getPendingFollow()).toBe(CODE)
    endAccountEpoch()
    expect(getPendingFollow()).toBeNull()
    setPendingFollow(OTHER)
    expect(consumePendingFollow()).toBe(OTHER)
    expect(getPendingFollow()).toBeNull()
  })

  it('sign-out / the account reset clear it with the other drafts of the prefix', () => {
    takeFollowFromLink(CODE)
    clearSessionDrafts()
    expect(getPendingFollow()).toBeNull()
  })
})
