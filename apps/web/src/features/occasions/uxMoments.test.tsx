import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { GUEST_ID, guestScreen, HOST_ID, hostScreen, OCCASION_ID, renderWithClient } from './test-utils'

const api = vi.hoisted(() => ({ mutate: vi.fn(), remove: vi.fn(), carry: vi.fn(), copy: vi.fn(), share: vi.fn(), create: vi.fn(), enabled: true }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, className, children }: { to: string; params: { profileId: string }; className: string; children: ReactNode }) => <a className={className} href={to.replace('$profileId', params.profileId)}>{children}</a>,
  createLink: () => () => null,
}))
vi.mock('./actions', () => ({ useRsvp: () => ({ mutate: api.mutate }), useRemoveMember: () => ({ run: api.remove, busy: false }) }))
vi.mock('../lists/flag', () => ({ listsEnabled: () => api.enabled }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: (props: { kind: string; momentClass?: string }) => <span data-testid={props.momentClass === 'response' ? 'bunny-response' : `bunny-${props.kind}`} /> }))
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => api.carry }))
vi.mock('../../lib/share', () => ({ copyText: api.copy, share: api.share, canNativeShare: () => true }))
vi.mock('../../lib/api/invites', () => ({ createInvite: api.create, buildInviteUrl: (token: string) => `https://example.test/i#${token}` }))
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { RsvpSection } from './RsvpSection'
import { resetRsvpMoments } from './rsvpMoments'
import { MembersSection } from './MembersSection'
import { InviteLinkPanel } from './InviteSection'
import { forgetInviteLinksForTests, rememberInviteLink } from './inviteLink'

beforeEach(() => {
  vi.clearAllMocks(); resetRsvpMoments(); resetAccountBoundaryForTests(); forgetInviteLinksForTests()
  api.enabled = true
  api.carry.mockResolvedValue(undefined); api.copy.mockResolvedValue(true); api.share.mockResolvedValue('shared')
  setRenderedAccount(GUEST_ID)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('prompts only unanswered guests, once per occasion per tab visit', () => {
  const view = render(<RsvpSection screen={guestScreen()} userId={GUEST_ID} />)
  expect(screen.getByTestId('bunny-pop-up')).toBeTruthy()
  view.rerender(<RsvpSection screen={guestScreen({ viewer: { role: 'member', rsvp: 'maybe' } })} userId={GUEST_ID} />)
  expect(screen.queryByTestId('bunny-pop-up')).toBeNull()
  view.unmount()
  render(<RsvpSection screen={guestScreen()} userId={GUEST_ID} />)
  expect(screen.queryByTestId('bunny-pop-up')).toBeNull()
  expect(screen.queryByTestId('bunny-response')).toBeNull()
})

it('waits for a successful first going answer and the 280 ms switch spring', () => {
  vi.useFakeTimers()
  api.mutate.mockImplementation((_next, options) => options.onSuccess())
  const view = render(<RsvpSection screen={guestScreen()} userId={GUEST_ID} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
  act(() => vi.advanceTimersByTime(279))
  expect(screen.queryByTestId('bunny-response')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('bunny-response')).toBeTruthy()
  view.unmount()
  render(<RsvpSection screen={guestScreen()} userId={GUEST_ID} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Vielleicht' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Absage' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.queryByTestId('bunny-response')).toBeNull()
})

it('does not celebrate a failed/pending answer or a late answer for another account', () => {
  vi.useFakeTimers()
  const callbacks: (() => void)[] = []
  api.mutate.mockImplementation((_next, options) => callbacks.push(options.onSuccess))
  render(<RsvpSection screen={guestScreen()} userId={GUEST_ID} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.queryByTestId('bunny-response')).toBeNull()
  endAccountEpoch(); setRenderedAccount(HOST_ID)
  act(() => { callbacks[0]?.(); vi.advanceTimersByTime(1000) })
  expect(screen.queryByTestId('bunny-response')).toBeNull()
})

it('does not celebrate a going response after the guest has changed their answer', () => {
  vi.useFakeTimers()
  const callbacks: (() => void)[] = []
  api.mutate.mockImplementation((_next, options) => callbacks.push(options.onSuccess))
  render(<RsvpSection screen={guestScreen()} userId={GUEST_ID} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Vielleicht' }))
  act(() => { callbacks[0]?.(); vi.advanceTimersByTime(1000) })
  expect(screen.queryByTestId('bunny-response')).toBeNull()
})

it('links other people while keeping own rows and remove controls outside links', () => {
  const view = render(<MembersSection screen={hostScreen()} userId={HOST_ID} />)
  expect(screen.getByRole('link', { name: /Jonas/ }).getAttribute('href')).toBe(`/people/${GUEST_ID}`)
  expect(screen.queryByRole('link', { name: /Mila/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Jonas entfernen' }).closest('a')).toBeNull()
  api.enabled = false
  view.rerender(<MembersSection screen={hostScreen()} userId={HOST_ID} />)
  expect(screen.queryByRole('link')).toBeNull()
})

function invite() {
  setRenderedAccount(HOST_ID)
  rememberInviteLink(HOST_ID, OCCASION_ID, `https://example.test/i#${'a'.repeat(64)}`)
  return renderWithClient(<InviteLinkPanel screen={hostScreen()} userId={HOST_ID} updatedAt={0} saveState={undefined} />)
}

it('carries a letter only after copy completes, with a ten second cooldown', async () => {
  let now = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  let finish!: (done: boolean) => void
  api.copy.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  invite()
  fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }))
  expect(api.carry).not.toHaveBeenCalled()
  await act(async () => finish(true))
  expect(api.carry).toHaveBeenCalledWith(expect.objectContaining({ item: 'letter', away: 'right' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kopieren' })))
  expect(api.carry).toHaveBeenCalledTimes(1)
  now += 10_000
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kopieren' })))
  expect(api.carry).toHaveBeenCalledTimes(2)
})

it('waits for the native share result, ignores cancel and ignores an account-ended response', async () => {
  let finish!: (result: string) => void
  api.share.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  invite()
  fireEvent.click(screen.getByRole('button', { name: 'Teilen' }))
  expect(api.carry).not.toHaveBeenCalled()
  await act(async () => finish('cancelled'))
  expect(api.carry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Teilen' }))
  endAccountEpoch(); setRenderedAccount(GUEST_ID)
  await act(async () => finish('shared'))
  expect(api.carry).not.toHaveBeenCalled()
})
