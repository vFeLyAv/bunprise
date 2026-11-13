import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnniversarySuggestion } from '../../lib/api/calendarFeed'
import type { FeedOccasion, FeedScreen } from '../../lib/api/types'
import { themeOf } from '../occasions/covers/detect'

// The birthday suggestion on Start (Felix 27.10: a suggestion, never an event): which past occasion counts as a
// birthday, "already planned", dismissed per occasion and year, the nearest wins; the card for host and guest;
// "wieder feiern?" opens "Neuer Anlass" with title + date only. Invented data only.

const api = vi.hoisted(() => ({ getAnniversarySuggestions: vi.fn<(userId?: string) => Promise<AnniversarySuggestion[]>>() }))
const nav = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('../../lib/api/calendarFeed', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/calendarFeed')>()), ...api }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => nav.navigate,
  Link: ({ children, params, className }: { children: ReactNode; params: { profileId: string }; className?: string }) =>
    <a href={`/people/${params.profileId}`} className={className}>{children}</a>,
}))

import BirthdayHint from './BirthdayHint'
import { dismissHint, dismissedHints } from './dismissed'
import { alreadyPlanned, dismissKey, looksLikeBirthday, pickSuggestion } from './suggestion'
import { clearOccasionPrefill, peekOccasionPrefill } from '../occasions/prefill'

const ME = '00000000-0000-4000-8000-0000000000aa'
const ANNA = '00000000-0000-4000-8000-0000000000bb'
const detect = (title: string) => themeOf(title)

function suggestion(over: Partial<AnniversarySuggestion> = {}): AnniversarySuggestion {
  return {
    occasion_id: 'd1e0b000-0000-4000-8000-000000000001', title: 'Annas Geburtstag', starts_at: '2025-11-14T23:00:00Z', tz: 'Europe/Berlin',
    all_day: true, cover_theme: null, role: 'member', host_id: ANNA, host_name: 'Anna', anniversary: '2026-11-15', days_ahead: 19, ...over,
  }
}

function feedRow(over: Partial<FeedOccasion> = {}): FeedOccasion {
  return {
    id: 'd1e0b000-0000-4000-8000-0000000000f1', title: 'Annas 30. Geburtstag', starts_at: '2026-11-15T17:00:00Z', ends_at: null, tz: 'Europe/Berlin',
    all_day: false, place_text: null, role: 'member', rsvp: 'none', host_name: 'Anna', host_id: ANNA, member_count: 3, wish_count: 0,
    my_reservation_count: 0, cover_theme: null, ...over,
  }
}

const feed = (upcoming: FeedOccasion[] = []): FeedScreen => ({ upcoming, past: [] })

beforeEach(() => {
  window.localStorage.clear()
  api.getAnniversarySuggestions.mockReset()
  nav.navigate.mockReset()
  clearOccasionPrefill(ME)
})
afterEach(() => vi.restoreAllMocks())

describe('which suggestion', () => {
  it('a birthday: the stored motif, or no motif and a birthday title; another motif never', () => {
    expect(looksLikeBirthday({ title: 'Feier', cover_theme: 'birthday' }, detect)).toBe(true)
    expect(looksLikeBirthday({ title: 'Annas Geburtstag', cover_theme: null }, detect)).toBe(true)
    expect(looksLikeBirthday({ title: 'День рождения Ани', cover_theme: 'none' }, detect)).toBe(true)
    expect(looksLikeBirthday({ title: 'Annas Geburtstag', cover_theme: 'bbq' }, detect)).toBe(false)
    expect(looksLikeBirthday({ title: 'Spieleabend', cover_theme: null }, detect)).toBe(false)
  })

  it('already planned: an upcoming birthday of the same host within ±14 days of the anniversary', () => {
    const item = suggestion()
    expect(alreadyPlanned(item, feed([feedRow()]), detect)).toBe(true)
    expect(alreadyPlanned(item, feed([feedRow({ starts_at: '2026-12-10T17:00:00Z' })]), detect)).toBe(false)
    expect(alreadyPlanned(item, feed([feedRow({ title: 'Spieleabend' })]), detect)).toBe(false)
    expect(alreadyPlanned(item, feed([feedRow({ host_id: '00000000-0000-4000-8000-0000000000cc' })]), detect)).toBe(false)
    // my own: the feed row is mine as host
    const mine = suggestion({ role: 'host', host_id: ME })
    expect(alreadyPlanned(mine, feed([feedRow({ role: 'host', host_id: ME })]), detect)).toBe(true)
  })

  it('the nearest that fits; dismissed per occasion and year; outside 14–28 days never', () => {
    const near = suggestion({ occasion_id: 'd1e0b000-0000-4000-8000-000000000002', days_ahead: 15, anniversary: '2026-11-11' })
    const far = suggestion({ days_ahead: 25 })
    const odd = suggestion({ occasion_id: 'd1e0b000-0000-4000-8000-000000000003', days_ahead: 30 })
    expect(pickSuggestion([far, odd, near], { feed: feed(), detect, dismissed: new Set() })?.occasion_id).toBe(near.occasion_id)
    expect(pickSuggestion([far, near], { feed: feed(), detect, dismissed: new Set([dismissKey(near)]) })?.occasion_id).toBe(far.occasion_id)
    expect(pickSuggestion([odd], { feed: feed(), detect, dismissed: new Set() })).toBeNull()
    expect(dismissKey(near)).toBe('d1e0b000-0000-4000-8000-000000000002:2026')
  })

  it('dismissals are per account, at most 50, and survive in storage', () => {
    for (let i = 0; i < 55; i++) dismissHint(ME, `d1e0b000-0000-4000-8000-${String(i).padStart(12, '0')}:2026`)
    dismissHint(ME, 'not-a-key')
    const kept = dismissedHints(ME)
    expect(kept.size).toBe(50)
    expect(kept.has('d1e0b000-0000-4000-8000-000000000054:2026')).toBe(true)
    expect(kept.has('d1e0b000-0000-4000-8000-000000000000:2026')).toBe(false)
    expect(dismissedHints(ANNA).size).toBe(0)
    const stored = JSON.parse(window.localStorage.getItem('bunprise.birthdayHints') ?? '{}') as { v: number; owner: string }
    expect(stored).toMatchObject({ v: 1, owner: ME })
  })
})

describe('the card', () => {
  function show(items: AnniversarySuggestion[], upcoming: FeedOccasion[] = []) {
    api.getAnniversarySuggestions.mockResolvedValue(items)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><BirthdayHint userId={ME} feed={feed(upcoming)} /></QueryClientProvider>)
  }

  it('host: "wieder feiern?" → Neuer Anlass with title and this year’s date only', async () => {
    show([suggestion({ role: 'host', host_id: ME, title: 'Mein Geburtstag', cover_theme: 'birthday', anniversary: '2026-11-14' })])
    expect(await screen.findByText('„Mein Geburtstag“ ist am 14. Nov. – wieder feiern?', undefined, { timeout: 3000 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Neuen Anlass anlegen' }))
    expect(peekOccasionPrefill(ME)).toEqual({ title: 'Mein Geburtstag', date: '2026-11-14' })
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/new' })
  })

  it('guest: the host’s wishes; "×" hides it for this year and shows the next', async () => {
    show([suggestion(), suggestion({ occasion_id: 'd1e0b000-0000-4000-8000-00000000be09', title: 'Bens Geburtstag', host_name: 'Ben', days_ahead: 27, anniversary: '2026-11-23' })])
    expect(await screen.findByText('„Annas Geburtstag“ naht (15. Nov.) – schau, ob Anna Wünsche hat.', undefined, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Wünsche ansehen' }).getAttribute('href')).toBe(`/people/${ANNA}`)
    fireEvent.click(screen.getByRole('button', { name: 'Vorschlag ausblenden' }))

    const next = await screen.findByText(/„Bens Geburtstag“ naht/, undefined, { timeout: 3000 })
    // the next one comes after the screen: it fades in (only the card shown at once on a return does not)
    expect((next.closest('[data-birthday-hint]') as HTMLElement).style.opacity).toBe('0')
    expect(dismissedHints(ME).has('d1e0b000-0000-4000-8000-000000000001:2026')).toBe(true)
  })

  // Felix 31.10 «мигают данные»: back on Start the card is part of the screen from its first frame — no fade-in
  it('a return: the card is there at once, without fading in again', async () => {
    // (an occasion of its own: the card tests above dismissed the default one in this tab's memory)
    api.getAnniversarySuggestions.mockResolvedValue([suggestion({ occasion_id: 'd1e0b000-0000-4000-8000-0000000000c7' })])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = () => <QueryClientProvider client={client}><BirthdayHint userId={ME} feed={feed()} /></QueryClientProvider>
    const first = render(view())
    const card = await screen.findByText(/„Annas Geburtstag“ naht/, undefined, { timeout: 3000 })
    // the first appearance fades in (it arrived after the screen)
    expect((card.closest('[data-birthday-hint]') as HTMLElement).style.opacity).toBe('0')
    first.unmount()
    const again = render(view())
    const hint = again.container.querySelector<HTMLElement>('[data-birthday-hint]')
    expect(hint).not.toBeNull()
    expect(hint!.style.opacity).not.toBe('0')
    expect(api.getAnniversarySuggestions).toHaveBeenCalledTimes(1)
  })

  it('nothing when it is already planned, not a birthday, or the server has none', async () => {
    const { container } = show([suggestion({ title: 'Sommerfest' }), suggestion({ occasion_id: 'd1e0b000-0000-4000-8000-000000000005' })], [feedRow()])
    await waitFor(() => expect(api.getAnniversarySuggestions).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container.querySelector('[data-birthday-hint]')).toBeNull()
  })
})
