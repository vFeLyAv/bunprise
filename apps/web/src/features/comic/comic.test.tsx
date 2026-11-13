import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, Me } from '../../lib/api/types'
import { hasSeenHint, otherHintShown, resetHintSession, showHint } from '../../lib/hints'
import { me, USER } from '../nav/test-utils'
import { ComicProfileRow } from './ComicProfileRow'
import { ComicHostSlot, ComicStartSlot } from './ComicStartSlot'
import { writeComicProgress } from './progress'
import { resetComicState } from './store'

// The reader's inside is the package's comic (tested there and in ComicBody.test.tsx); here a stand-in that "loads".
vi.mock('./ComicBody', () => ({
  default: function Body({ onLoaded, start }: { onLoaded: () => void; start: { episode: number; panel: number } | null }) {
    useEffect(() => onLoaded(), [onLoaded])
    return <p>Reader {start ? `${start.episode}/${start.panel}` : 'from the start'}</p>
  },
}))

const FEED: FeedScreen = { upcoming: [], past: [] }
const TITLE = 'Wie haben sich Pompon und Tapsi kennengelernt?'
/** this page session started at performance.timeOrigin: an onboarding `days` before it */
const onboarded = (days: number): Me => {
  const profile = me(USER, 'Mila')
  profile.profile.onboarding_done_at = new Date(performance.timeOrigin - days * 86400000).toISOString()
  return profile
}

function mountStart(profile: Me = onboarded(2), firstStepsVisible = false, afterBirthday = false) {
  const client = new QueryClient()
  client.setQueryData(['me'], profile)
  render(<QueryClientProvider client={client}>
    <ComicStartSlot feed={FEED} firstStepsVisible={firstStepsVisible} className="mt-8" afterBirthday={afterBirthday} />
    <ComicHostSlot />
    <h2>Danach</h2>
  </QueryClientProvider>)
  return client
}

beforeEach(() => {
  localStorage.clear()
  resetHintSession()
  resetComicState()
  onlineManager.setOnline(true)
})
afterEach(() => {
  delete document.documentElement.dataset.bunnies
  onlineManager.setOnline(true)
})

describe('the comic card on Start', () => {
  it('a later day\'s session: the still, the question, «Geschichte lesen» and a 44 px "×"; it is this session\'s hint', async () => {
    mountStart()
    const heading = await screen.findByRole('heading', { name: TITLE })
    const card = heading.closest('section')
    expect(card?.parentElement?.className).toBe('mt-8')
    // the picture is decoration (no text in it): the heading says what the card is
    expect(card?.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(screen.getByRole('button', { name: 'Geschichte lesen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Comic-Karte ausblenden' }).className).toMatch(/\bsize-11\b/)
    await waitFor(() => expect(otherHintShown('first-steps')).toBe(true))
  })

  it('"×": gone for good on this device (lib/hints.ts story-1)', async () => {
    mountStart()
    fireEvent.click(await screen.findByRole('button', { name: 'Comic-Karte ausblenden' }))
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
    expect(hasSeenHint('story-1')).toBe(true)
    resetHintSession()
    mountStart()
    await act(async () => {})
    expect(screen.queryAllByRole('heading', { name: TITLE })).toHaveLength(0)
  })

  it.each([
    ['on the onboarding day', () => mountStart(onboarded(0))],
    ['while «Erste Schritte» shows', () => mountStart(onboarded(2), true)],
    ['after another hint in this session', () => { showHint('reserve-hint')(); mountStart() }],
    ['offline', () => { onlineManager.setOnline(false); mountStart() }],
    ['with "Kaninchen zeigen" off', () => { document.documentElement.dataset.bunnies = 'off'; mountStart() }],
  ])('no card %s', async (_, mount) => {
    mount()
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
    expect(document.querySelector('[data-comic-slot]')).toBeNull()
  })

  it('a hint that comes onto the screen after it (the birthday suggestion) makes it step aside', async () => {
    mountStart()
    await screen.findByRole('heading', { name: TITLE })
    let gone = () => {}
    act(() => { gone = showHint('birthday') })
    await waitFor(() => expect(screen.queryByRole('heading', { name: TITLE })).toBeNull())
    // closed again: still not back in this session (one optional hint per session)
    act(() => gone())
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
  })

  it('on Start’s list it waits until the birthday suggestion has decided', async () => {
    const client = mountStart(onboarded(2), false, true)
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
    act(() => client.setQueryData(['anniversaries', USER], []))
    expect(await screen.findByRole('heading', { name: TITLE })).toBeTruthy()
  })

  it('«Geschichte lesen» opens the reader (a dialog titled «Pompon & Tapsi»); once it loaded, the card is gone', async () => {
    mountStart()
    fireEvent.click(await screen.findByRole('button', { name: 'Geschichte lesen' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pompon & Tapsi' }, { timeout: 5000 })
    // the reader's chunk is lazy: under a busy test run it may take a moment
    expect(await screen.findByText('Reader from the start', undefined, { timeout: 5000 })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('heading', { name: TITLE })).toBeNull())
    // the reader stays open although the card that opened it is gone
    expect(dialog.isConnected).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('Profil › Über Bunprise', () => {
  function mountRow() {
    render(<QueryClientProvider client={new QueryClient()}><ul><ComicProfileRow /></ul></QueryClientProvider>)
  }

  it('«Pompon & Tapsi – ihre Geschichte» opens the reader; "Weiterlesen" where the person stopped', async () => {
    writeComicProgress({ episode: 1, panel: 6 })
    mountRow()
    const row = screen.getByRole('button', { name: /Pompon & Tapsi – ihre Geschichte/ })
    expect(row.textContent).toContain('Weiterlesen')
    fireEvent.click(row)
    expect(await screen.findByRole('dialog', { name: 'Pompon & Tapsi' }, { timeout: 5000 })).toBeTruthy()
    expect(await screen.findByText('Reader 1/6', undefined, { timeout: 5000 })).toBeTruthy()
  })

  it('offline: "Nur online" and it does not open', () => {
    onlineManager.setOnline(false)
    mountRow()
    const row = screen.getByRole('button', { name: /Pompon & Tapsi – ihre Geschichte/ })
    expect(row.textContent).toContain('Nur online')
    expect(row.hasAttribute('disabled')).toBe(true)
    expect(row.textContent).not.toContain('Weiterlesen')
  })
})
