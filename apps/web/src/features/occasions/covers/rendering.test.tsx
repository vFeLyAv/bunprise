import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedOccasion } from '../../../lib/api/types'
import { browserTimeZone } from '../../../lib/time'
import { guestScreen, hostScreen, renderWithClient } from '../test-utils'

// The stored motif on the Start card and in the occasion's hero (Felix 26.10): shown only without a photo (a photo
// always wins), in the photo's own box, for the host and the guests alike; null, 'none', an unknown key and a
// missing key (an older server) show the card / hero exactly as before.

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/photos')>()),
  getOccasionPhoto: api.get,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ children, className, ...rest }: { children?: ReactNode; className?: string }) => (
    <a className={className} {...(rest as Record<string, unknown>)}>{children}</a>
  )
  return { useRouter: () => ({ navigate: vi.fn() }), useNavigate: () => vi.fn(), useCanGoBack: () => true, Link, createLink: () => Link }
})

import { FeedCard } from '../../feed/FeedCard'
import { OccasionHero } from '../OccasionHero'

const ID = '0b7c8a1e-2222-4a5b-9c3d-000000000001'
const PHOTO = { width: 1200, height: 800, updated_at: '2026-10-25T10:00:00.000Z' }

// Invented fixture (no real data).
function row(overrides: Partial<FeedOccasion> = {}): FeedOccasion {
  return {
    id: ID, title: 'Geburtstag von Anna', starts_at: '2030-10-28T17:00:00.000Z', tz: browserTimeZone(), all_day: false,
    place_text: null, role: 'member', rsvp: 'none', host_name: 'Anna', host_id: 'host-1',
    member_count: 4, wish_count: 6, my_reservation_count: 0,
    ...overrides,
  }
}

function renderCard(occasion: FeedOccasion) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        <FeedCard occasion={occasion} />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

const art = (theme: string) => document.querySelector<SVGElement>(`svg.cv-art[data-cover="${theme}"]`)

beforeEach(() => {
  api.get.mockReset()
  api.get.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } })
  URL.createObjectURL = vi.fn(() => 'blob:cover')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Start card', () => {
  it('a motif without a photo: the cover box from the first render, then our picture in it', async () => {
    renderCard(row({ cover_theme: 'birthday', photo: null }))
    const box = document.querySelector<HTMLElement>('.feed-cover')
    expect(box).not.toBeNull()
    expect(box?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.feed-card')?.hasAttribute('data-cover')).toBe(true)
    await waitFor(() => expect(art('birthday')?.getAttribute('data-state')).toBe('ready'))
    const svg = art('birthday')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice')
    expect(svg.getAttribute('viewBox')).toBe('0 0 480 320')
    expect(svg.innerHTML.length).toBeGreaterThan(400)
    // the title stays the card's name; the picture is decoration
    expect(screen.getByText('Geburtstag von Anna')).toBeTruthy()
  })

  it('a photo always wins over the motif', async () => {
    renderCard(row({ cover_theme: 'birthday', photo: PHOTO }))
    expect(document.querySelector('.feed-cover')).not.toBeNull()
    await new Promise((done) => setTimeout(done, 30))
    expect(art('birthday')).toBeNull()
  })

  it('no motif: null, "none", an unknown key, an older server (no key) — the card as before', async () => {
    for (const cover_theme of [null, 'none', 'hiking', undefined]) {
      const view = renderCard(row({ ...(cover_theme !== undefined ? { cover_theme } : {}), photo: null }))
      await new Promise((done) => setTimeout(done, 10))
      expect(document.querySelector('.feed-cover'), String(cover_theme)).toBeNull()
      expect(document.querySelector('.feed-card')?.hasAttribute('data-cover')).toBe(false)
      view.unmount()
    }
  })
})

describe('the occasion hero', () => {
  const withTheme = (screenData = hostScreen(), cover_theme: string | null = 'sport', photo: typeof PHOTO | null = null) =>
    ({ ...screenData, occasion: { ...screenData.occasion, cover_theme, photo } })

  it('host and guests see the motif in the photo box when there is no photo', async () => {
    for (const data of [withTheme(hostScreen()), withTheme(guestScreen())]) {
      const view = renderWithClient(<OccasionHero screen={data} />)
      expect(document.querySelector('.occ-cover')).not.toBeNull() // the box from the first render
      expect(document.querySelector('header')?.classList.contains('occ-hero-covered')).toBe(true)
      await waitFor(() => expect(art('sport')?.getAttribute('data-state')).toBe('ready'))
      expect(document.querySelector('.occ-cover')?.getAttribute('aria-hidden')).toBe('true')
      view.unmount()
    }
  })

  it('a photo always wins; no motif = the hero as before', async () => {
    renderWithClient(<OccasionHero screen={withTheme(hostScreen(), 'sport', PHOTO)} />)
    await new Promise((done) => setTimeout(done, 30))
    expect(document.querySelector('.occ-cover')).not.toBeNull()
    expect(art('sport')).toBeNull()
    document.body.innerHTML = ''
    for (const cover_theme of [null, 'none']) {
      const view = renderWithClient(<OccasionHero screen={withTheme(hostScreen(), cover_theme)} />)
      await new Promise((done) => setTimeout(done, 10))
      expect(document.querySelector('.occ-cover')).toBeNull()
      view.unmount()
    }
  })
})
