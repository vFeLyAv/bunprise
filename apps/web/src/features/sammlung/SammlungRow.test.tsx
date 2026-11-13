import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
}))
import { setRenderedAccount } from '../../lib/accountBoundary'
import { SammlungRow } from './SammlungRow'
import { markSeen, noteScene } from './store'

// The Profil row «Pompons Sammlung  n/m ›» (design §2): the count, a dot for a new find (no pop-up), device data only.

const A = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  window.localStorage.clear()
  setRenderedAccount(A)
})
afterEach(() => {
  setRenderedAccount(undefined)
  window.localStorage.clear()
})

describe('SammlungRow', () => {
  it('links to the collection with «0/8» (no iPhone: «Hier wohne ich» is not counted) and no dot', async () => {
    render(<SammlungRow userId={A} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/settings/sammlung')
    expect(link.textContent).toContain('Pompons Sammlung')
    // the count is its own small lazy chunk: the row is there at once, its right side fills in
    expect(await screen.findByText('0/8')).toBeTruthy()
    expect(link.querySelector('[data-sammlung-new]')).toBeNull()
  })

  it('a find: the count grows and a dot appears — until the collection was looked at', async () => {
    const view = render(<SammlungRow userId={A} />)
    noteScene('tower')
    expect(await screen.findByText('1/8')).toBeTruthy()
    expect(view.container.querySelector('[data-sammlung-new]')).not.toBeNull()
    expect(screen.getByText(/Neu gefunden, 1 von 8 gefunden/)).toBeTruthy()
    markSeen(A)
    await vi.waitFor(() => expect(view.container.querySelector('[data-sammlung-new]')).toBeNull())
  })
})
