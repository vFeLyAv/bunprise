import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '../database.types'
import { AppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer, type CapturedAccount } from './identity'
import type { ExportedData } from './types'
import { isMissingServerFeature } from './unavailable'

// Web Push devices and preferences (supabase/migrations/20261027150000_web_push.sql, docs/spec/web-push-design.md).
// Every call is pinned to ONE account (identity.ts asAccount). The database binds a device to the session of the
// access token (session_id): a sign-out anywhere ends it. Nothing here is cached on disk.
// What a notification says is decided by the database + Worker; the app only registers this browser's subscription.

/** The version of the explanation the person agreed to (the sheet's text, locales/<lng>/push.json) — stored per device. */
export const PUSH_CONSENT = 'push-2026-10-27'

export interface PushDevice {
  endpoint: string
  /** base64url (no padding): the browser's P-256 key (65 bytes) and auth secret (16 bytes) */
  p256dh: string
  auth: string
}

export interface PushSettings {
  /** the database switch is on */
  available: boolean
  /** this endpoint is registered for me and my current session */
  device: boolean
  /** "Einladungen" (per person, all devices) */
  invitations: boolean
}

type PushDatabase = {
  __InternalSupabase: { PostgrestVersion: '13' }
  public: {
    Tables: { [_ in never]: never }
    Views: { [_ in never]: never }
    Functions: {
      push_subscribe: { Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_lang: string; p_consent: string }; Returns: Json }
      push_unsubscribe: { Args: { p_endpoint: string }; Returns: Json }
      get_push_settings: { Args: { p_endpoint: string | null }; Returns: Json }
      set_push_settings: { Args: { p_invitations: boolean }; Returns: Json }
      export_my_push: { Args: Record<PropertyKey, never>; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

function client(account: CapturedAccount): SupabaseClient<PushDatabase> {
  return account.supabase as unknown as SupabaseClient<PushDatabase>
}

function asSettings(value: unknown): PushSettings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { available: v.available === true, device: v.device === true, invitations: v.invitations !== false }
}

/** push_subscribe: register this browser for me. `push_endpoint_taken` = the endpoint belongs to another account. */
export function registerPushDevice(device: PushDevice, lang: string, expectedUserId?: string): Promise<{ invitations: boolean }> {
  return timed('push_subscribe', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('push_subscribe', {
      p_endpoint: device.endpoint, p_p256dh: device.p256dh, p_auth: device.auth, p_lang: lang, p_consent: PUSH_CONSENT,
    }).setHeader('Authorization', bearer(account))
    const message = (result.error as { message?: unknown } | null)?.message
    if (message === 'push_endpoint_taken') throw new AppError('conflict')
    const data = unwrap(result) as Record<string, unknown>
    return { invitations: data.invitations !== false }
  }))
}

/** push_unsubscribe: my row for this endpoint goes (always ok). */
export function unregisterPushDevice(endpoint: string, expectedUserId?: string): Promise<void> {
  return timed('push_unsubscribe', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('push_unsubscribe', { p_endpoint: endpoint }).setHeader('Authorization', bearer(account)))
  }))
}

export function getPushSettings(endpoint: string | null, expectedUserId?: string): Promise<PushSettings> {
  return timed('get_push_settings', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_push_settings', { p_endpoint: endpoint }).setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return { available: false, device: false, invitations: true }
    return asSettings(unwrap(result))
  }))
}

export function setPushInvitations(on: boolean, expectedUserId?: string): Promise<boolean> {
  return timed('set_push_settings', () => asAccount(expectedUserId, async (account) => {
    const data = unwrap(await client(account).rpc('set_push_settings', { p_invitations: on }).setHeader('Authorization', bearer(account)))
    return asSettings(data).invitations
  }))
}

/** export_my_push() for "Meine Daten herunterladen". A server without the migration: null (nothing to add). */
export function exportMyPush(expectedUserId?: string): Promise<Json | null> {
  return timed('export_my_push', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('export_my_push').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return null
    return unwrap(result) as Json
  }))
}

/** The export file with my push part (`push`); unchanged without one. */
export function withPush(data: ExportedData, push: Json | null): ExportedData {
  if (push === null || typeof data !== 'object' || data === null || Array.isArray(data)) return data
  return { ...(data as Record<string, Json | undefined>), push }
}

/** GET /api/push/key: the VAPID public key (base64url) — null while push is not set up on the server (501). */
export async function fetchPushKey(fetcher: typeof fetch = fetch): Promise<string | null> {
  const response = await fetcher('/api/push/key', { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) return null
  const body = (await response.json().catch(() => null)) as { publicKey?: unknown } | null
  return typeof body?.publicKey === 'string' && /^B[A-Za-z0-9_-]{86}$/.test(body.publicKey) ? body.publicKey : null
}
