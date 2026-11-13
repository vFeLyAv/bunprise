import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { canGoBack: () => false, back: () => undefined }, navigate: () => Promise.resolve() }),
}))

import { IMPRINT_VERSION, LegalPage, warmLegalText } from './LegalPage'

// CLS on the legal pages (perf audit 2026-10-20: 0.019): the route loader warms the archived text, so the
// page renders WITH it — no skeleton that the text later replaces (the footer under it never jumps).
describe('LegalPage', () => {
  it('renders a text the route loader warmed at once, without a loading skeleton', async () => {
    await warmLegalText('impressum', IMPRINT_VERSION, 'de')
    render(<LegalPage kind="impressum" version={IMPRINT_VERSION} locale="de" />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getAllByText(/ENTWURF/).length).toBeGreaterThan(0)
  })

  it('without a warmed text it shows a screen-tall skeleton first (the footer stays below the fold), then the text', async () => {
    render(<LegalPage kind="impressum" version={IMPRINT_VERSION} locale="en" />)
    const loading = screen.getByRole('status')
    expect(loading.className).toContain('min-h-[calc(100dvh-var(--topbar-h)-var(--sa-top))]')
    expect((await screen.findAllByText(/DRAFT|ENTWURF/)).length).toBeGreaterThan(0)
  })
})
