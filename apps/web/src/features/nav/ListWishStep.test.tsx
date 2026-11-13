import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ListScreen, ListsOverview } from '../../lib/api/lists.types'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { createMenu, resetCreateMenuForTests } from './createMenuStore'
import { feedRow, renderLayout, USER } from './test-utils'

const api = vi.hoisted(() => ({ getListsOverview: vi.fn(), createList: vi.fn(), getListScreen: vi.fn() }))
vi.mock('../../lib/api/lists', async (original) => ({ ...await original<object>(), ...api, newListId: () => 'new-list' }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))
const empty: ListsOverview = { me: { id: USER, display_name: 'Mila', banner: null, live_links: 0 }, stats: { my_wishes: 0, my_lists: 0, friends_lists: 0, followers: 0, following: 0, requests: 0 }, my_lists: [], following: [], upcoming: [], suggestions: [] }
const feed = { upcoming: [], past: [] }

beforeEach(() => { vi.stubEnv('VITE_LISTS', '1'); setRenderedAccount(USER); api.getListsOverview.mockResolvedValue(empty); api.getListScreen.mockReset() })
afterEach(() => { act(() => resetCreateMenuForTests()); resetAccountBoundaryForTests(); vi.unstubAllEnvs(); vi.clearAllMocks() })

async function open(lists = empty, withOccasion = false) {
  const view = renderLayout('/soon', { lists, feed: withOccasion ? { ...feed, upcoming: [feedRow('occasion', 'Geburtstag', 'host', new Date(Date.now() + 86400000).toISOString())] } : feed })
  fireEvent.click(await screen.findByRole('button', { name: 'Neu erstellen' }))
  const dialog = await screen.findByRole('dialog')
  return { ...view, dialog }
}

it('loads no list data just for a page; the menu offers wish, occasion and new list in order', async () => {
  renderLayout('/soon', { feed })
  const plus = await screen.findByRole('button', { name: 'Neu erstellen' })
  expect(api.getListsOverview).not.toHaveBeenCalled()
  fireEvent.click(plus)
  const dialog = await screen.findByRole('dialog')
  const names = within(dialog).getAllByRole('button').map((button) => button.textContent)
  expect(names.slice(0, 3).join('|')).toMatch(/Wunsch hinzufügen.*\|Anlass erstellen.*\|Neue Wunschliste/)
})

it('first wish without an occasion creates a private list only after the explanatory button', async () => {
  api.createList.mockResolvedValue({ id: 'new-list', created_at: new Date().toISOString() })
  const { dialog, router } = await open()
  fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
  const create = await screen.findByRole('button', { name: '„Meine Wünsche“ anlegen' })
  expect(screen.getByText('Nur du siehst diese Liste – teilen kannst du sie jederzeit.')).toBeTruthy()
  expect(api.createList).not.toHaveBeenCalled()
  fireEvent.click(create)
  await waitFor(() => expect(router.state.location.pathname).toBe('/lists/new-list/wishes/new'))
  expect(api.createList).toHaveBeenCalledWith(expect.objectContaining({ title: 'Meine Wünsche', visibility: 'private', due_on: null }), USER)
})

it('standalone targets appear before hosted occasions and keep their audience label', async () => {
  const card = { id: 'private-list', title: 'Bücher', kind: 'standalone' as const, visibility: 'private' as const, cover_tone: null, cover_icon: null, due_on: null, wish_count: 1, occasion: null, created_at: '2026-10-20' }
  const { dialog } = await open({ ...empty, my_lists: [card] }, true)
  fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
  await screen.findByRole('heading', { name: 'In welche Liste?' })
  const choices = Array.from(document.querySelectorAll('.cm-choice')).map((button) => button.textContent)
  expect(choices[0]).toBe('BücherNur ich')
  // an occasion's wishlist says what it is: its date page and "Anlass · Morgen"
  expect(choices[1]).toMatch(/Geburtstag\s*Anlass · Morgen$/)
  expect(document.querySelectorAll('.cm-choice')[1]?.querySelector('.tile')).not.toBeNull()
})

it('a late create cannot navigate or repopulate a changed account', async () => {
  let finish!: (value: { id: string; created_at: string }) => void
  api.createList.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const { dialog, router, queryClient } = await open()
  fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
  fireEvent.click(await screen.findByRole('button', { name: '„Meine Wünsche“ anlegen' }))
  act(() => { endAccountEpoch(); setRenderedAccount('other'); queryClient.clear() })
  await act(async () => { finish({ id: 'new-list', created_at: new Date().toISOString() }) })
  expect(router.state.location.pathname).toBe('/soon')
  expect(queryClient.getQueryData(['list', 'new-list'])).toBeUndefined()
  expect(createMenu.isOpen()).toBe(false)
})

it('recovers the same committed list after a lost response without replacing its current server state', async () => {
  const recovered: ListScreen = {
    list: { id: 'new-list', title: 'Already renamed', kind: 'standalone', visibility: 'followers', cover_tone: null, cover_icon: 'gift', due_on: null,
      created_at: '2026-10-21T00:00:00Z', owner: { id: USER, display_name: 'Mila', banner: null } },
    viewer: { role: 'owner' }, wishes: [],
  }
  api.createList.mockRejectedValue(new Error('connection lost'))
  api.getListScreen.mockResolvedValue(recovered)
  const { dialog, router, queryClient } = await open()
  fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
  fireEvent.click(await screen.findByRole('button', { name: '„Meine Wünsche“ anlegen' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/lists/new-list/wishes/new'))
  expect(api.createList).toHaveBeenCalledTimes(1)
  expect(api.getListScreen).toHaveBeenCalledWith('new-list', USER)
  expect(queryClient.getQueryData(['list', 'new-list'])).toEqual(recovered)
})

it.each([false, true])('closing the menu while create is in flight does not navigate after it completes (reopened=%s)', async (reopened) => {
  let finish!: (value: { id: string; created_at: string }) => void
  api.createList.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const { dialog, router } = await open()
  fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
  fireEvent.click(await screen.findByRole('button', { name: '„Meine Wünsche“ anlegen' }))
  act(() => createMenu.close())
  if (reopened) act(() => createMenu.open())
  await act(async () => { finish({ id: 'new-list', created_at: '2026-10-21T00:00:00Z' }) })
  expect(router.state.location.pathname).toBe('/soon')
  expect(createMenu.isOpen()).toBe(reopened)
})

it('"Neue Wunschliste" away from Listen opens the sheet over the screen: × keeps you there, "Anlegen" leads on to Listen', async () => {
  api.createList.mockResolvedValue({ id: 'new-list', created_at: '2026-10-21T00:00:00Z' })
  const { dialog, router } = await open()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Neue Wunschliste' }))
  const sheet = await screen.findByRole('dialog', { name: 'Neue Wunschliste' })
  expect(router.state.location.pathname).toBe('/soon')
  fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Neue Wunschliste' })).toBeNull())
  expect(router.state.location.pathname).toBe('/soon')
  // again, and this time create it
  fireEvent.click(await screen.findByRole('button', { name: 'Neu erstellen' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Neue Wunschliste' }))
  const again = await screen.findByRole('dialog', { name: 'Neue Wunschliste' })
  fireEvent.change(within(again).getByLabelText('Titel'), { target: { value: 'Bücher' } })
  fireEvent.click(within(again).getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/lists'))
  expect(api.createList).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bücher', visibility: 'private' }), USER)
})
