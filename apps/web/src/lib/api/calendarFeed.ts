import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '../database.types'
import { APP_URL } from '../app'
import { timed, unwrap } from './base'
import { asAccount, bearer, type CapturedAccount } from './identity'
import type { ExportedData } from './types'
import { isMissingServerFeature } from './unavailable'

// Kalender-Abo and the birthday suggestion (supabase/migrations/20261027170000_calendar_feed.sql,
// docs/handoffs/2026-10-27-calendar.md). Every call is pinned to ONE account (identity.ts asAccount). The feed address is
// shown once (only its sha256 is stored) and kept in memory only — never in storage, the query cache or the URL.

export type FeedLanguage = 'de' | 'en' | 'ru' | 'uk'

export interface CalendarFeedStatus {
  active: boolean
  created_at: string | null
  last_fetched_at: string | null
  lang: FeedLanguage | null
}

export interface AnniversarySuggestion {
  occasion_id: string
  title: string
  starts_at: string
  tz: string
  all_day: boolean
  cover_theme: string | null
  role: 'host' | 'member'
  host_id: string
  host_name: string | null
  /** "YYYY-MM-DD": this year's day in the occasion's zone */
  anniversary: string
  days_ahead: number
}

type CalendarDatabase = {
  __InternalSupabase: { PostgrestVersion: '13' }
  public: {
    Tables: { [_ in never]: never }
    Views: { [_ in never]: never }
    Functions: {
      create_calendar_feed: { Args: { p_lang: string }; Returns: Json }
      get_calendar_feed: { Args: Record<PropertyKey, never>; Returns: Json }
      revoke_calendar_feed: { Args: Record<PropertyKey, never>; Returns: Json }
      export_my_calendar_feed: { Args: Record<PropertyKey, never>; Returns: Json }
      get_anniversary_suggestions: { Args: Record<PropertyKey, never>; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

function client(account: CapturedAccount): SupabaseClient<CalendarDatabase> {
  return account.supabase as unknown as SupabaseClient<CalendarDatabase>
}

const LANGS: readonly FeedLanguage[] = ['de', 'en', 'ru', 'uk']
export const feedLanguage = (lang: string): FeedLanguage => (LANGS as readonly string[]).includes(lang) ? (lang as FeedLanguage) : 'de'

/** https://bunprise.de/api/calendar/<token>.ics — what Google wants ("Per URL"). */
export function feedHttpsUrl(token: string, origin: string = APP_URL): string {
  return `${origin.replace(/\/+$/, '')}/api/calendar/${token}.ics`
}

/** webcal://… — opens the subscription dialog of Apple Kalender / Outlook. */
export function feedWebcalUrl(token: string, origin: string = APP_URL): string {
  return feedHttpsUrl(token, origin).replace(/^https?:\/\//, 'webcal://')
}

function asStatus(value: unknown): CalendarFeedStatus {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    active: v.active === true,
    created_at: typeof v.created_at === 'string' ? v.created_at : null,
    last_fetched_at: typeof v.last_fetched_at === 'string' ? v.last_fetched_at : null,
    lang: typeof v.lang === 'string' ? feedLanguage(v.lang) : null,
  }
}

/** get_calendar_feed — a server without the migration: "no feed" (the sheet then cannot create one either). */
export function getCalendarFeed(expectedUserId?: string): Promise<CalendarFeedStatus & { available: boolean }> {
  return timed('get_calendar_feed', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_calendar_feed').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return { available: false, ...asStatus(null) }
    return { available: true, ...asStatus(unwrap(result)) }
  }))
}

/** create_calendar_feed — a NEW address (the old one stops); the token comes back once. */
export function createCalendarFeed(lang: string, expectedUserId?: string): Promise<{ token: string; created_at: string }> {
  return timed('create_calendar_feed', () => asAccount(expectedUserId, async (account) => {
    const data = unwrap(await client(account).rpc('create_calendar_feed', { p_lang: feedLanguage(lang) }).setHeader('Authorization', bearer(account))) as Record<string, unknown>
    if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error('calendar feed: bad token')
    return { token: data.token, created_at: typeof data.created_at === 'string' ? data.created_at : new Date().toISOString() }
  }))
}

export function revokeCalendarFeed(expectedUserId?: string): Promise<void> {
  return timed('revoke_calendar_feed', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('revoke_calendar_feed').setHeader('Authorization', bearer(account)))
  }))
}

/** export_my_calendar_feed() for "Meine Daten herunterladen". A server without the migration: null. */
export function exportMyCalendarFeed(expectedUserId?: string): Promise<Json | null> {
  return timed('export_my_calendar_feed', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('export_my_calendar_feed').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return null
    return unwrap(result) as Json
  }))
}

/** The export file with my feed part (`calendar_feed`); unchanged without a feed (or without the server function). */
export function withCalendarFeed(data: ExportedData, feed: Json | null | undefined): ExportedData {
  if (feed === undefined || feed === null || typeof data !== 'object' || data === null || Array.isArray(data)) return data
  return { ...(data as Record<string, Json | undefined>), calendar_feed: feed }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asSuggestion(value: unknown): AnniversarySuggestion | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.occasion_id !== 'string' || !UUID.test(v.occasion_id) || typeof v.title !== 'string' || typeof v.starts_at !== 'string'
    || typeof v.host_id !== 'string' || typeof v.anniversary !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.anniversary)) return null
  return {
    occasion_id: v.occasion_id, title: v.title, starts_at: v.starts_at, tz: typeof v.tz === 'string' ? v.tz : 'Europe/Berlin',
    all_day: v.all_day === true, cover_theme: typeof v.cover_theme === 'string' ? v.cover_theme : null,
    role: v.role === 'host' ? 'host' : 'member', host_id: v.host_id, host_name: typeof v.host_name === 'string' ? v.host_name : null,
    anniversary: v.anniversary, days_ahead: typeof v.days_ahead === 'number' ? v.days_ahead : 0,
  }
}

/** get_anniversary_suggestions — [] from a server without the migration (the hint simply never shows). */
export function getAnniversarySuggestions(expectedUserId?: string): Promise<AnniversarySuggestion[]> {
  return timed('get_anniversary_suggestions', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_anniversary_suggestions').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return []
    const data = unwrap(result)
    return Array.isArray(data) ? data.map(asSuggestion).filter((s): s is AnniversarySuggestion => s !== null) : []
  }))
}
