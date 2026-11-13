import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '../database.types'
import { timed, unwrap } from './base'
import { asAccount, bearer, type CapturedAccount } from './identity'
import type { ExportedData } from './types'
import { isMissingServerFeature } from './unavailable'

// The invitation e-mail "Bei neuen Einladungen eine E-Mail schicken" (supabase/migrations/20261028000000_invite_email.sql,
// docs/spec/invite-email-design.md). Every call is pinned to ONE account (identity.ts asAccount). The app never sees
// the address: the database only says WHETHER there is a usable one. What a mail says is decided by the Worker.
// Nothing here is cached on disk (the query key lives in memory only, docs/storage-registry.md).

/** The version of the text next to the switch (locales/<lng>/invitations.json "email.*") — stored with the opt-in. */
export const INVITE_EMAIL_CONSENT = 'invite-email-2026-10-28'

export interface InviteEmailSettings {
  /** the database switch is on */
  available: boolean
  /** I opted in */
  enabled: boolean
  /** my account has a confirmed address the mail can go to */
  address: boolean
}

type InviteEmailDatabase = {
  __InternalSupabase: { PostgrestVersion: '13' }
  public: {
    Tables: { [_ in never]: never }
    Views: { [_ in never]: never }
    Functions: {
      get_invite_email_settings: { Args: Record<PropertyKey, never>; Returns: Json }
      set_invite_email: { Args: { p_enabled: boolean; p_lang: string | null; p_consent: string | null }; Returns: Json }
      export_my_invite_email: { Args: Record<PropertyKey, never>; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

function client(account: CapturedAccount): SupabaseClient<InviteEmailDatabase> {
  return account.supabase as unknown as SupabaseClient<InviteEmailDatabase>
}

const OFF: InviteEmailSettings = { available: false, enabled: false, address: false }

function asSettings(value: unknown): InviteEmailSettings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { available: v.available === true, enabled: v.enabled === true, address: v.address === true }
}

/** get_invite_email_settings(). A server without the migration: everything off (the row stays hidden). */
export function getInviteEmailSettings(expectedUserId?: string): Promise<InviteEmailSettings> {
  return timed('get_invite_email_settings', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_invite_email_settings').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return OFF
    return asSettings(unwrap(result))
  }))
}

/** set_invite_email(on, app language, consent version): returns the stored state. Off needs neither. */
export function setInviteEmail(on: boolean, lang: string, expectedUserId?: string): Promise<boolean> {
  return timed('set_invite_email', () => asAccount(expectedUserId, async (account) => {
    const data = unwrap(await client(account).rpc('set_invite_email', {
      p_enabled: on, p_lang: on ? lang : null, p_consent: on ? INVITE_EMAIL_CONSENT : null,
    }).setHeader('Authorization', bearer(account))) as Record<string, unknown>
    return data.enabled === true
  }))
}

/** export_my_invite_email() for "Meine Daten herunterladen". A server without the migration: null. */
export function exportMyInviteEmail(expectedUserId?: string): Promise<Json | null> {
  return timed('export_my_invite_email', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('export_my_invite_email').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return null
    return unwrap(result) as Json
  }))
}

/** The export file with my invitation e-mail part (`invite_email`); unchanged without one. */
export function withInviteEmail(data: ExportedData, part: Json | null): ExportedData {
  if (part === null || typeof data !== 'object' || data === null || Array.isArray(data)) return data
  return { ...(data as Record<string, Json | undefined>), invite_email: part }
}
