import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { resetCreateMenuForTests } from './createMenuStore'
import { renderLayout, USER } from './test-utils'

// "+ → Wunsch hinzufügen" offline before the wish step's chunk was cached (QA START-6): the step's code
// cannot load — the menu says so in place instead of the whole app falling to the router's error page.
vi.mock('./ListWishStep', () => ({
  ListWishStep: () => {
    throw new TypeError('Failed to fetch dynamically imported module: http://localhost/src/features/nav/ListWishStep.tsx')
  },
}))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))

beforeEach(() => { vi.stubEnv('VITE_LISTS', '1'); setRenderedAccount(USER); vi.spyOn(console, 'error').mockImplementation(() => undefined) })
afterEach(() => { act(() => resetCreateMenuForTests()); resetAccountBoundaryForTests(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('a wish step that cannot load says so inside the menu, offers a retry and the way back', async () => {
  const { router } = renderLayout('/soon', { feed: { upcoming: [], past: [] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Neu erstellen' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
  expect(await within(dialog).findByText('Das konnte gerade nicht laden – bist du online?')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Nochmal versuchen' })).toBeTruthy()
  // the app is still there: the screen behind and the menu's way back
  expect(router.state.location.pathname).toBe('/soon')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zurück' }))
  expect(await within(dialog).findByRole('heading', { name: 'Was möchtest du erstellen?' })).toBeTruthy()
})
