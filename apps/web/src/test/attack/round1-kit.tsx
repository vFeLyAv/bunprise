import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, domMax } from 'motion/react'
import type { OccasionScreen, OccasionScreenWish } from '../../lib/api/types'
import { queryClient } from '../../lib/query'
import { ToastHost } from '../../ui/ToastHost'

// Shared helpers of the adversarial round-1 tests (src/test/attack/round1-*.test.tsx).
// Invented fixture accounts only; nothing here is a real person or a real token.
// This module holds no vi.mock: every test file declares its own mocks (they are hoisted per file).

export const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
export const WISHLIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
/** the guest who reserves */
export const GUEST_A = '00000000-0000-4000-8000-0000000000a1'
/** the owner of the list (and host of the occasion) */
export const OWNER_B = '00000000-0000-4000-8000-0000000000b2'
/** a host account used by the host-side scenarios */
export const HOST_A = '00000000-0000-4000-8000-0000000000a3'
export const OTHER_GUEST = '00000000-0000-4000-8000-0000000000c4'
export const FREE = '00000000-0000-4000-8000-00000000f001'
export const MINE = '00000000-0000-4000-8000-00000000f002'
export const TAKEN = '00000000-0000-4000-8000-00000000f003'
export const INVITE_TOKEN = '6a'.repeat(32)

/** Every word of the guest's reservation UI (wishes.json "reserve.*", German test locale). */
export const RESERVATION_TEXT =
  /Reserviert|Von dir reserviert|Ich schenke das|Reservierung aufheben|Meine Reservierungen|schenkt schon|Versteckt|Jemand war schneller|Reserviere/i

export function fixtureSession(userId: string): Session {
  return {
    access_token: `fixture-token-${userId}`,
    refresh_token: `fixture-refresh-${userId}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: userId, aud: 'authenticated', created_at: '2026-10-20T12:00:00Z', app_metadata: {}, user_metadata: {} },
  }
}

/** What supabase-js keeps under the auth storage key (only the parts the app reads). */
export function storedSession(userId: string): string {
  return JSON.stringify({ access_token: `fixture-token-${userId}`, user: { id: userId } })
}

export function wish(id: string, title: string, reserved: boolean | null, mine: boolean | null): OccasionScreenWish {
  return {
    id, title, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved, reserved_by_me: mine,
  }
}

/** The same occasion of host `hostId` as a guest (reservation flags) or as its host (literal nulls). */
export function screenFor(viewer: 'guest' | 'owner', hostId: string = OWNER_B, hostName = 'Ben'): OccasionScreen {
  const guest = viewer === 'guest'
  return {
    occasion: {
      id: OCCASION_ID, title: 'Bens Grillabend', starts_at: '2030-06-15T16:00:00.000Z', tz: 'Europe/Berlin', all_day: false,
      place_text: null, description: null, created_at: '2030-01-01T10:00:00.000Z', host: { id: hostId, display_name: hostName },
    },
    viewer: guest ? { role: 'member', rsvp: 'none' } : { role: 'host', rsvp: 'going' },
    members: [
      { profile_id: hostId, display_name: hostName, role: 'host', rsvp: 'going' },
      { profile_id: guest ? GUEST_A : OTHER_GUEST, display_name: 'Jonas', role: 'member', rsvp: 'none' },
    ],
    invite: null,
    wishlist: {
      id: WISHLIST_ID, owner_id: hostId, title: 'Bens Grillabend',
      wishes: [
        wish(FREE, 'Grillzange', guest ? false : null, guest ? false : null),
        wish(MINE, 'Schürze', guest ? true : null, guest ? true : null),
        wish(TAKEN, 'Kohle', guest ? true : null, guest ? false : null),
      ],
    },
  }
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets queued microtasks and 0 ms timers run (MSW, the fake channel, React effects). */
export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * BroadcastChannel as separate tabs see it: a message reaches every OTHER open instance of the same
 * name, asynchronously; an instance never receives its own messages.
 */
export class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>()
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  private readonly listeners = new Set<(event: MessageEvent) => void>()
  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.add(this)
  }
  postMessage(data: unknown): void {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError')
    for (const other of FakeBroadcastChannel.channels) {
      if (other !== this && other.name === this.name) {
        const event = new MessageEvent('message', { data: structuredClone(data) })
        queueMicrotask(() => other.deliver(event))
      }
    }
  }
  private deliver(event: MessageEvent): void {
    if (this.closed) return
    this.onmessage?.(event)
    for (const listener of this.listeners) listener(event)
  }
  /** auth-js listens with addEventListener('message', …) */
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener)
  }
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener)
  }
  close(): void {
    this.closed = true
    FakeBroadcastChannel.channels.delete(this)
  }
  static closeAll(): void {
    for (const channel of FakeBroadcastChannel.channels) channel.close()
  }
}

/** The app's providers as main.tsx builds them (the real query client) plus the real toast host. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        {children}
        <ToastHost />
      </LazyMotion>
    </QueryClientProvider>
  )
}

/** True when a person can neither see nor use the element: inside [inert], or an ancestor hides it. */
export function isHiddenFromUser(el: Element): boolean {
  if (el.closest('[inert]')) return true
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node instanceof HTMLElement && (node.hidden || node.style.visibility === 'hidden' || node.style.display === 'none')) {
      return true
    }
  }
  return false
}

/** Every text on the page (portals included) matching `pattern` that a person could still see or use. */
export function visibleMatches(pattern: RegExp): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    const parent = node.parentElement
    if (parent && pattern.test(text) && !isHiddenFromUser(parent)) found.push(text.trim())
  }
  // form fields keep typed text in their value, not in a text node
  for (const field of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))) {
    if (pattern.test(field.value) && !isHiddenFromUser(field)) found.push(`[field] ${field.value}`)
  }
  return found
}

/** A PostgREST error body as the database raises it (`raise exception using message = '<code>'`). */
export function pgError(code: string, status = 400): Response {
  return new Response(JSON.stringify({ code: 'P0001', message: code, details: null, hint: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
