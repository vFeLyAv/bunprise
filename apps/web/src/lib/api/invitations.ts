import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '../database.types'
import { AppError } from '../errors'
import { timed, unwrap, unwrapVoid } from './base'
import { asAccount, bearer, type CapturedAccount } from './identity'
import { asProfileCard, type ProfileCard } from './lists.types'
import type { ExportedData } from './types'
import { isMissingServerFeature } from './unavailable'

// In-app invitations to an occasion — "Freunde einladen" (supabase/migrations/20261027120000_occasion_invitations.sql,
// docs/spec/in-app-invites-design.md v1.1). The host always, a guest only while the host allows it, invites FRIENDS
// (people they follow and who follow them back). The invitee sees a card on Start and joins or declines silently.
//
// What the wrappers promise:
//   * pinned to ONE account (identity.ts asAccount, expected account = the last parameter), like every write;
//   * the normalisers copy the known keys only — a stray field never reaches a component;
//   * the sender's projection: 'invited' is all a sender ever learns about a person (waiting, declined, ignored or
//     silently kept away all look the same, design §2.5) — nothing here could tell them apart, by design;
//   * nothing here knows about the wish list's private part: the feature never reads it (its tests check that).
// Nothing is cached on disk: the query keys of this feature live in memory only (lib/query.ts allow-list ['feed']).

/** A friend in the picker, through the sender's eyes. */
export type CandidateState = 'none' | 'invited' | 'withdrawn'
/** The sender's projection of one invitation (private.invitation_sender_state). */
export type SenderState = 'invited' | 'withdrawn' | 'accepted' | 'expired'

/** get_invite_candidates(p_occasion_id)[] */
export interface InviteCandidate {
  profile: ProfileCard
  state: CandidateState
  /** while invited / withdrawn: until when the invitation counts (ISO) */
  expires_at: string | null
}

/** send_occasion_invites(p_occasion_id, p_profile_ids)[] — the same answer whether delivered or not */
export interface SentAnswer {
  profile_id: string
  state: SenderState
  expires_at: string | null
}

/** get_my_invitations()[] — the invitee's card: the host only by NAME (no id, no photo) */
export interface MyInvitation {
  id: string
  occasion: { id: string; title: string; starts_at: string; tz: string; all_day: boolean }
  host_name: string | null
  /** the inviter is the host (no "… sieht, dass X dich eingeladen hat" then) */
  from_host: boolean
  inviter: ProfileCard
  expires_at: string
  created_at: string
}

/** get_occasion_invite_info(p_occasion_id) — the occasion screen's invitation part */
export interface OccasionInviteInfo {
  /** "Gäste dürfen Freunde einladen" */
  guests_can_invite: boolean
  /** may I invite right now (host; a guest while allowed; never after the start or when cancelled) */
  can_invite: boolean
  /** host only: who joined through a GUEST's invitation (else []) */
  invited_by: { profile_id: string; inviter: { id: string; display_name: string | null } }[]
}

/** "Einladungen in Anlässe" */
export type InvitationsFrom = 'friends' | 'nobody'

type Loose = Record<string, unknown>
const loose = (value: unknown): Loose => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function asCandidateState(value: unknown): CandidateState {
  return value === 'invited' || value === 'withdrawn' ? value : 'none'
}

function asSenderState(value: unknown): SenderState {
  return value === 'withdrawn' || value === 'accepted' || value === 'expired' ? value : 'invited'
}

export function asInviteCandidates(raw: unknown): InviteCandidate[] {
  return list(raw).flatMap((entry) => {
    const row = loose(entry)
    const profile = asProfileCard(row.profile)
    if (!profile) return []
    const state = asCandidateState(row.state)
    return [{ profile, state, expires_at: state === 'none' ? null : text(row.expires_at) }]
  })
}

export function asSentAnswers(raw: unknown): SentAnswer[] {
  return list(raw).flatMap((entry) => {
    const row = loose(entry)
    const id = text(row.profile_id)
    return id ? [{ profile_id: id, state: asSenderState(row.state), expires_at: text(row.expires_at) }] : []
  })
}

export function asMyInvitations(raw: unknown): MyInvitation[] {
  return list(raw).flatMap((entry) => {
    const row = loose(entry)
    const occasion = loose(row.occasion)
    const id = text(row.id)
    const occasionId = text(occasion.id)
    const title = text(occasion.title)
    const startsAt = text(occasion.starts_at)
    const inviter = asProfileCard(row.inviter)
    const expiresAt = text(row.expires_at)
    if (!id || !occasionId || title === null || !startsAt || !inviter || !expiresAt) return []
    return [{
      id,
      occasion: { id: occasionId, title, starts_at: startsAt, tz: text(occasion.tz) ?? 'Europe/Berlin', all_day: occasion.all_day === true },
      host_name: text(row.host_name),
      from_host: row.from_host === true,
      inviter,
      expires_at: expiresAt,
      created_at: text(row.created_at) ?? expiresAt,
    }]
  })
}

export function asOccasionInviteInfo(raw: unknown): OccasionInviteInfo {
  const data = loose(raw)
  return {
    guests_can_invite: data.guests_can_invite === true,
    can_invite: data.can_invite === true,
    invited_by: list(data.invited_by).flatMap((entry) => {
      const row = loose(entry)
      const inviter = loose(row.inviter)
      const profileId = text(row.profile_id)
      const inviterId = text(inviter.id)
      return profileId && inviterId ? [{ profile_id: profileId, inviter: { id: inviterId, display_name: text(inviter.display_name) } }] : []
    }),
  }
}

/** The invitation contract of 20261027120000 (database.types.ts is generated later, with Felix's db push). */
export type InvitationsDatabase = {
  __InternalSupabase: { PostgrestVersion: '13' }
  public: {
    Tables: {
      occasions: { Row: { id: string }; Insert: { id: string }; Update: { guests_can_invite?: boolean }; Relationships: [] }
      profiles: { Row: { id: string }; Insert: { id: string }; Update: { invitations_from?: InvitationsFrom }; Relationships: [] }
    }
    Views: { [_ in never]: never }
    Functions: {
      get_invite_candidates: { Args: { p_occasion_id: string }; Returns: Json }
      send_occasion_invites: { Args: { p_occasion_id: string; p_profile_ids: string[] }; Returns: Json }
      withdraw_occasion_invite: { Args: { p_occasion_id: string; p_profile_id: string }; Returns: Json }
      get_occasion_invite_info: { Args: { p_occasion_id: string }; Returns: Json }
      get_my_invitations: { Args: Record<PropertyKey, never>; Returns: Json }
      respond_occasion_invite: { Args: { p_invitation_id: string; p_accept: boolean }; Returns: Json }
      export_my_invitations: { Args: Record<PropertyKey, never>; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

function client(account: CapturedAccount): SupabaseClient<InvitationsDatabase> {
  return account.supabase as unknown as SupabaseClient<InvitationsDatabase>
}

/** The client's batch limit (the database refuses more than 10 ids with `validation`). */
export const INVITE_BATCH_LIMIT = 10

// ---- the sender -------------------------------------------------------------------------------------------------

/** get_invite_candidates(p_occasion_id): my friends who are not in the occasion, by name. not_found = I may not invite. */
export function getInviteCandidates(occasionId: string, expectedUserId?: string): Promise<InviteCandidate[]> {
  return timed('get_invite_candidates', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_invite_candidates', { p_occasion_id: occasionId }).setHeader('Authorization', bearer(account))
    return asInviteCandidates(unwrap(result))
  }))
}

/** send_occasion_invites(p_occasion_id, p_profile_ids): 1..10 friends; one answer per person, delivered or not. */
export function sendOccasionInvites(occasionId: string, profileIds: readonly string[], expectedUserId?: string): Promise<SentAnswer[]> {
  if (profileIds.length < 1 || profileIds.length > INVITE_BATCH_LIMIT) return Promise.reject(new AppError('invalid_input'))
  return timed('send_occasion_invites', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('send_occasion_invites', { p_occasion_id: occasionId, p_profile_ids: [...profileIds] })
      .setHeader('Authorization', bearer(account))
    return asSentAnswers(unwrap(result))
  }))
}

/** withdraw_occasion_invite(p_occasion_id, p_profile_id) → { ok }. No consents needed (it narrows). */
export function withdrawOccasionInvite(occasionId: string, profileId: string, expectedUserId?: string): Promise<void> {
  return timed('withdraw_occasion_invite', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('withdraw_occasion_invite', { p_occasion_id: occasionId, p_profile_id: profileId })
      .setHeader('Authorization', bearer(account)))
  }))
}

/** get_occasion_invite_info(p_occasion_id) — lazily, after the occasion screen's first paint. */
export function getOccasionInviteInfo(occasionId: string, expectedUserId?: string): Promise<OccasionInviteInfo> {
  return timed('get_occasion_invite_info', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_occasion_invite_info', { p_occasion_id: occasionId }).setHeader('Authorization', bearer(account))
    return asOccasionInviteInfo(unwrap(result))
  }))
}

/** "Gäste dürfen Freunde einladen" — the host's REST write of occasions.guests_can_invite (policy: the host only). */
export function setGuestsCanInvite(occasionId: string, allowed: boolean, expectedUserId?: string): Promise<void> {
  return timed('set_guests_can_invite', () => asAccount(expectedUserId, async (account) => {
    unwrapVoid(await client(account).from('occasions').update({ guests_can_invite: allowed }).eq('id', occasionId).setHeader('Authorization', bearer(account)))
  }))
}

// ---- the invitee ------------------------------------------------------------------------------------------------

/** get_my_invitations(): the invitations I see, newest first (≤ 20). Asked only while get_me says there are some. */
export function getMyInvitations(expectedUserId?: string): Promise<MyInvitation[]> {
  return timed('get_my_invitations', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_my_invitations').setHeader('Authorization', bearer(account))
    return asMyInvitations(unwrap(result))
  }))
}

/**
 * respond_occasion_invite(p_invitation_id, p_accept): join → the occasion's id; decline → nothing (silent).
 * invite_invalid = the invitation is not there any more (withdrawn, expired, already answered …: one answer).
 */
export function respondOccasionInvite(invitationId: string, accept: boolean, expectedUserId?: string): Promise<{ occasion_id: string } | null> {
  return timed('respond_occasion_invite', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('respond_occasion_invite', { p_invitation_id: invitationId, p_accept: accept })
      .setHeader('Authorization', bearer(account))
    const data = loose(unwrap(result))
    if (!accept) return null
    const occasionId = text(data.occasion_id)
    if (!occasionId) throw new AppError('invite_invalid')
    return { occasion_id: occasionId }
  }))
}

/** "Einladungen in Anlässe" — the person's own REST write of profiles.invitations_from (no SELECT: get_me serves it). */
export function setInvitationsFrom(value: InvitationsFrom, expectedUserId?: string): Promise<void> {
  return timed('set_invitations_from', () => asAccount(expectedUserId, async (account) => {
    unwrapVoid(await client(account).from('profiles').update({ invitations_from: value }).eq('id', account.userId).setHeader('Authorization', bearer(account)))
  }))
}

// ---- the own data -----------------------------------------------------------------------------------------------

/** export_my_invitations() for "Meine Daten herunterladen". A server without the migration: null (nothing to add). */
export function exportMyInvitations(expectedUserId?: string): Promise<Json | null> {
  return timed('export_my_invitations', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('export_my_invitations').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return null
    return unwrap(result) as Json
  }))
}

/** The export file with my invitation part (`invitations`, after the RPC's keys); unchanged without one. */
export function withInvitations(data: ExportedData, invitations: Json | null): ExportedData {
  if (invitations === null || typeof data !== 'object' || data === null || Array.isArray(data)) return data
  return { ...(data as Record<string, Json | undefined>), invitations }
}
