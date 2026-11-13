import { describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import {
  asInviteCandidates,
  asMyInvitations,
  asOccasionInviteInfo,
  asSentAnswers,
  sendOccasionInvites,
  withInvitations,
} from './invitations'

// The normalisers of lib/api/invitations.ts: known keys only, odd values become the closed default, a malformed
// entry is dropped instead of crashing a screen. Invented ids.

const A = '00000000-0000-4000-8000-0000000000a1'
const O = '00000000-0000-4000-8000-0000000000b1'

describe('asInviteCandidates', () => {
  it('copies the card and the sender state; an unknown state reads "none" and then carries no date', () => {
    expect(asInviteCandidates([
      { profile: { id: A, display_name: 'Anna', banner: 'sky', photo: null, banner_photo: null, secret: 'x' }, state: 'invited', expires_at: '2030-01-01T00:00:00Z', extra: 1 },
      { profile: { id: 'b', display_name: 'Ben' }, state: 'declined', expires_at: '2030-01-01T00:00:00Z' },
      { profile: null, state: 'none' },
      'junk',
    ])).toEqual([
      { profile: { id: A, display_name: 'Anna', banner: 'sky', photo: null, banner_photo: null }, state: 'invited', expires_at: '2030-01-01T00:00:00Z' },
      // "declined" is no state a sender can ever see: the closed default
      { profile: { id: 'b', display_name: 'Ben', banner: null, photo: null, banner_photo: null }, state: 'none', expires_at: null },
    ])
    expect(asInviteCandidates(null)).toEqual([])
  })
})

describe('asSentAnswers', () => {
  it('the sender projection only: invited unless withdrawn / accepted / expired', () => {
    expect(asSentAnswers([
      { profile_id: A, state: 'invited', expires_at: 'x', delivered: false },
      { profile_id: 'b', state: 'void', expires_at: 'y' },
      { profile_id: 'c', state: 'withdrawn', expires_at: null },
      { state: 'invited' },
    ])).toEqual([
      { profile_id: A, state: 'invited', expires_at: 'x' },
      { profile_id: 'b', state: 'invited', expires_at: 'y' },
      { profile_id: 'c', state: 'withdrawn', expires_at: null },
    ])
  })
})

describe('asMyInvitations', () => {
  it('keeps the host as a NAME only and drops any place / guest / id the server might ever add', () => {
    const [one] = asMyInvitations([{
      id: 'i1',
      occasion: { id: O, title: 'Grillabend', starts_at: '2030-11-14T17:00:00Z', tz: 'Europe/Berlin', all_day: false, place_text: 'Gartenweg 1' },
      host_name: 'Ben', host_id: 'h1', from_host: false, members: [{ id: 'x' }],
      inviter: { id: A, display_name: 'Anna' }, expires_at: '2030-11-02T00:00:00Z', created_at: '2030-10-26T00:00:00Z',
    }])
    expect(one).toEqual({
      id: 'i1',
      occasion: { id: O, title: 'Grillabend', starts_at: '2030-11-14T17:00:00Z', tz: 'Europe/Berlin', all_day: false },
      host_name: 'Ben', from_host: false,
      inviter: { id: A, display_name: 'Anna', banner: null, photo: null, banner_photo: null },
      expires_at: '2030-11-02T00:00:00Z', created_at: '2030-10-26T00:00:00Z',
    })
    expect(JSON.stringify(one)).not.toMatch(/Gartenweg|h1|members/)
  })

  it('drops entries without an id, a title, a start, an inviter or an expiry', () => {
    const base = { id: 'i', occasion: { id: O, title: 'T', starts_at: 's' }, inviter: { id: A }, expires_at: 'e' }
    expect(asMyInvitations([base, { ...base, id: null }, { ...base, inviter: null }, { ...base, expires_at: 5 }, { ...base, occasion: { id: O } }])).toHaveLength(1)
  })
})

describe('asOccasionInviteInfo', () => {
  it('booleans default to false; invited_by keeps only complete rows', () => {
    expect(asOccasionInviteInfo({ guests_can_invite: 'yes', can_invite: true, invited_by: [{ profile_id: 'g', inviter: { id: A, display_name: 'Anna' } }, { profile_id: 'x' }] }))
      .toEqual({ guests_can_invite: false, can_invite: true, invited_by: [{ profile_id: 'g', inviter: { id: A, display_name: 'Anna' } }] })
    expect(asOccasionInviteInfo(null)).toEqual({ guests_can_invite: false, can_invite: false, invited_by: [] })
  })
})

describe('the wrappers', () => {
  it('an empty or too long list never reaches the server', async () => {
    await expect(sendOccasionInvites(O, [])).rejects.toEqual(new AppError('invalid_input'))
    await expect(sendOccasionInvites(O, Array.from({ length: 11 }, (_, i) => String(i)))).rejects.toEqual(new AppError('invalid_input'))
  })

  it('the export gets an `invitations` part only when the server sent one', () => {
    expect(withInvitations({ format: 'v2' }, null)).toEqual({ format: 'v2' })
    expect(withInvitations({ format: 'v2' }, { sent: [] })).toEqual({ format: 'v2', invitations: { sent: [] } })
  })
})
