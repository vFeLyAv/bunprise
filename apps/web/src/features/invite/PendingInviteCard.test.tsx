import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  )
  return { Link, createLink: () => Link }
})

import PendingInviteCard from './PendingInviteCard'
import { consumePendingInvite, getPendingInvite, setPendingInvite } from './pending'

// "Nicht jetzt" on the join screen keeps the link in this tab; this card (mounted lazily by Start) is the way
// back to it — and the place to drop it. It says nothing about the occasion (nothing is known before joining).

const TOKEN = 'b'.repeat(64)

beforeEach(() => {
  sessionStorage.clear()
  consumePendingInvite()
})
afterEach(() => vi.restoreAllMocks())

describe('pending invite card', () => {
  it('is not there without a waiting link', () => {
    const { container } = render(<PendingInviteCard />)
    expect(container.textContent).toBe('')
  })

  it('leads back to the join question (/i) while a link waits, and names no occasion', () => {
    setPendingInvite(TOKEN)
    render(<PendingInviteCard />)
    expect(screen.getByRole('heading', { name: 'Eine Einladung wartet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ansehen' }).getAttribute('href')).toBe('/i')
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('"Einladung verwerfen" forgets the link and hides the card', () => {
    setPendingInvite(TOKEN)
    render(<PendingInviteCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Einladung verwerfen' }))
    expect(getPendingInvite()).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Eine Einladung wartet' })).toBeNull()
  })
})
