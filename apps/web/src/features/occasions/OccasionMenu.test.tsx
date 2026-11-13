import type { ReactNode } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUEST_ID, guestScreen, HOST_ID, hostScreen, OCCASION_ID, renderWithClient } from './test-utils'

// "Melden" once the contact address is configured: a mailto with our own subject and body.

vi.mock('../../lib/app', async (original) => ({
  ...(await original<typeof import('../../lib/app')>()),
  SUPPORT_EMAIL: 'kontakt@example.test',
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn(), history: { back: vi.fn() }, state: { location: { pathname: '/' } } }),
  useCanGoBack: () => true,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}))

import { OccasionMenu } from './OccasionMenu'

beforeEach(() => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('occasion menu — report', () => {
  for (const [who, data, userId] of [['host', hostScreen(), HOST_ID], ['guest', guestScreen(), GUEST_ID]] as const) {
    it(`offers a report mail to the ${who}, naming only the occasion id`, () => {
      renderWithClient(<OccasionMenu screen={data} userId={userId} />)
      fireEvent.click(screen.getByRole('button', { name: 'Mehr' }))
      const link = within(screen.getByRole('dialog', { name: 'Optionen' })).getByRole('link', { name: 'Melden' })
      const href = link.getAttribute('href') ?? ''
      expect(href.startsWith('mailto:kontakt@example.test?subject=')).toBe(true)
      expect(decodeURIComponent(href)).toContain(`[Bunprise] Meldung: Anlass ${OCCASION_ID}`)
      expect(decodeURIComponent(href)).not.toContain(data.occasion.title)
      expect(screen.queryByText('Der Kontakt zum Melden wird vor dem Pilotbetrieb ergänzt.')).toBeNull()
    })
  }
})
