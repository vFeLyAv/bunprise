import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '../../../lib/api/linkPreview'
import type { Me, OccasionScreen, OwnerWish } from '../../../lib/api/types'
import { AppError } from '../../../lib/errors'
import { qk } from '../../../lib/queryKeys'
import { deferred, HOST_ID, hostScreen, renderWithClient } from '../test-utils'
import type { LinkRead } from './model'

// "Gleich mit eintragen" (Felix 26.10): the new-occasion form with wishes and bring-along entries, from typing to
// the requests after the occasion was confirmed. API wrappers, the link reading and the lists picker are mocked;
// the demo world runs the same steps for real in src/mocks/createExtras.test.ts.

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn(), pathname: '/occasions/new', search: {} as Record<string, unknown> }))
const api = vi.hoisted(() => ({
  createOccasion: vi.fn(),
  newOccasionId: vi.fn(),
  updateOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  leaveOccasion: vi.fn(),
  removeMember: vi.fn(),
  setRsvp: vi.fn(),
  getOccasionScreen: vi.fn(),
  getFeed: vi.fn(),
}))
const writes = vi.hoisted(() => ({ addPotluckItem: vi.fn(), createWish: vi.fn(), moveWish: vi.fn(), calls: [] as string[] }))
const reads = vi.hoisted(() => ({ readLink: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: nav.navigate,
    history: { back: nav.back },
    state: {
      location: {
        get pathname() {
          return nav.pathname
        },
        get search() {
          return nav.search
        },
      },
    },
  }),
  useCanGoBack: () => false,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
}))
vi.mock('../../../lib/api/occasions', () => api)
vi.mock('../../../lib/api/potluck', () => ({ addPotluckItem: writes.addPotluckItem }))
vi.mock('../../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/wishes')>()),
  createWish: writes.createWish,
  moveWish: writes.moveWish,
}))
vi.mock('./readLink', () => reads)
vi.mock('../../../lib/toast', () => ({ toast: toasts }))
vi.mock('../../potluck/flag', () => ({ potluckEnabled: () => true }))
vi.mock('../../lists/flag', () => ({ listsEnabled: () => true }))
vi.mock('../../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))
// the lists picker (its own lazy chunk, tested in features/lists): here it hands back one wish of "Geburtstag"
vi.mock('../../lists/BringFromListsSheet', () => ({
  default: ({ open, onPick, onClose }: { open: boolean; onPick?: (picked: { wishes: OwnerWish[]; listId: string; listTitle: string }) => void; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Aus meinen Listen holen">
        <button
          type="button"
          onClick={() => {
            onPick?.({ wishes: [TEAPOT], listId: 'list-b', listTitle: 'Geburtstag' })
            onClose()
          }}
        >
          1 Wunsch hierher holen
        </button>
      </div>
    ) : null,
}))

import { NewOccasionPage } from '../NewOccasionPage'
import { peekDraft, resetSavingForTests } from '../saving'

const NEW_ID = '77777777-7777-4777-8777-777777777777'
const LINK = 'https://www.kuechenkontor.example/kaffeemuehle-kegel'
const TEAPOT = { id: 'w-teapot', title: 'Teekanne', url: null, price_cents: 2500, currency: 'EUR', note: null, priority: 2, created_at: '2030-01-01T10:00:00.000Z', photo: null } as OwnerWish
const ME: Me = {
  profile: { id: HOST_ID, display_name: 'Mila', locale: 'de', onboarding_done_at: null },
  consents_ok: true,
  legal_versions: { terms: 'terms-1', privacy: 'privacy-1', age: 'age-1' },
}

function preview(): LinkPreview {
  return { url: LINK, site: 'Küchenkontor', title: 'Handkaffeemühle „Kegel“', priceCents: 4990, partial: false, imageUrl: null }
}

let link = deferred<LinkRead>()

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  nav.pathname = '/occasions/new'
  nav.search = {}
  nav.navigate.mockImplementation(async ({ to, params, search }: { to: string; params?: { occasionId: string }; search?: Record<string, unknown> }) => {
    nav.pathname = params ? to.replace('$occasionId', params.occasionId) : to
    nav.search = search ?? {}
  })
  api.newOccasionId.mockReturnValue(NEW_ID)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  link = deferred<LinkRead>()
  reads.readLink.mockReturnValue(link.promise)
  writes.calls = []
  writes.addPotluckItem.mockImplementation(async (_id: string, title: string) => {
    writes.calls.push(`item:${title}`)
    return { id: `i-${title}` }
  })
  writes.createWish.mockImplementation(async (_list: string, input: { title: string }) => {
    writes.calls.push(`wish:${input.title}`)
    return { id: `w-${input.title}` }
  })
  writes.moveWish.mockImplementation(async (wishId: string) => {
    writes.calls.push(`move:${wishId}`)
  })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

const saveButton = () => screen.getByRole('button', { name: /Speichern/ }) as HTMLButtonElement
const wishField = () => screen.getByRole('textbox', { name: 'Wunsch oder Link' }) as HTMLInputElement
const bringField = () => screen.getByRole('textbox', { name: 'Was soll mitgebracht werden?' }) as HTMLInputElement
const wishRows = () => within(screen.getByRole('list', { name: 'Wünsche' })).queryAllByRole('listitem')
const bringRows = () => within(screen.getByRole('list', { name: 'Mitbringen' })).queryAllByRole('listitem')

function fillOccasion() {
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Milas Gartenfest' } })
  fireEvent.click(screen.getByRole('button', { name: /^Datum/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Morgen' }))
}

function openWishes() {
  fireEvent.click(screen.getByRole('button', { name: /Wünsche gleich eintragen/ }))
}

function addWish(text: string) {
  fireEvent.change(wishField(), { target: { value: text } })
  fireEvent.keyDown(wishField(), { key: 'Enter' })
}

describe('new occasion: wishes right away', () => {
  it('one calm row until tapped; then the field takes the focus', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(screen.queryByRole('textbox', { name: 'Wunsch oder Link' })).toBeNull()
    openWishes()
    expect(document.activeElement).toBe(wishField())
    expect(screen.getByText('Ein Shop-Link wird gelesen wie beim Wunsch: Titel, Preis, Foto.')).toBeTruthy()
  })

  it('Enter adds the wish and never saves the occasion; the field is empty for the next one', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    fillOccasion()
    openWishes()
    addWish('Puzzle mit 1000 Teilen')
    expect(api.createOccasion).not.toHaveBeenCalled()
    expect(wishRows().map((row) => row.textContent)).toEqual([expect.stringContaining('Puzzle mit 1000 Teilen')])
    expect(wishField().value).toBe('')
    expect(screen.getByText('Wird mit dem Anlass gespeichert – ändern kannst du alles später.')).toBeTruthy()
    // nothing typed: nothing happens
    fireEvent.keyDown(wishField(), { key: 'Enter' })
    expect(wishRows()).toHaveLength(1)
  })

  it('a pasted shop link is in at once and read through our Worker: "wird gelesen" → title, price, shop', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    openWishes()
    fireEvent.paste(wishField(), { clipboardData: { getData: () => LINK } })
    expect(reads.readLink).toHaveBeenCalledWith(LINK)
    const [row] = wishRows()
    expect(within(row!).getByText('Link wird gelesen …')).toBeTruthy()
    expect(within(row!).getByText('kuechenkontor.example')).toBeTruthy()
    await act(async () => link.resolve({ preview: preview(), photo: null }))
    expect(within(row!).getByText('Handkaffeemühle „Kegel“')).toBeTruthy()
    expect(within(row!).getByText('≈ 49,90 € · Küchenkontor')).toBeTruthy()
  })

  it('a link without an answer stays — saved anyway, its title the shop’s name', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    openWishes()
    addWish(LINK)
    await act(async () => link.resolve({ preview: null, photo: null, code: 'offline' }))
    expect(within(wishRows()[0]!).getByText('Ohne Vorschau – der Link wird trotzdem gespeichert')).toBeTruthy()
  })

  it('refuses a title over 120 characters instead of cutting it; an entry can be removed again', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    openWishes()
    addWish('x'.repeat(121))
    expect(wishRows()).toHaveLength(0)
    expect(wishField().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Höchstens 120 Zeichen.')).toBeTruthy()
    addWish('Buch')
    fireEvent.click(screen.getByRole('button', { name: '„Buch“ entfernen' }))
    return waitFor(() => expect(wishRows()).toHaveLength(0))
  })

  it('"Aus meinen Listen holen" picks wishes; they show where they come from', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    openWishes()
    fireEvent.click(screen.getByRole('button', { name: 'Aus meinen Listen holen' }))
    fireEvent.click(await screen.findByRole('button', { name: '1 Wunsch hierher holen' }))
    const [row] = wishRows()
    expect(within(row!).getByText('Teekanne')).toBeTruthy()
    expect(within(row!).getByText('≈ 25,00 € · aus „Geburtstag“')).toBeTruthy()
  })
})

describe('new occasion: bring-along entries right away', () => {
  it('only with "Mitbringen" / "Beides": suggestions are one tap each, an own entry by Enter, no twins', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(screen.queryByRole('textbox', { name: 'Was soll mitgebracht werden?' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Beides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Getränke' }))
    // a used suggestion leaves the chips
    expect(screen.queryByRole('button', { name: 'Salat' })).toBeNull()
    fireEvent.change(bringField(), { target: { value: 'Gartenstühle' } })
    fireEvent.keyDown(bringField(), { key: 'Enter' })
    expect(api.createOccasion).not.toHaveBeenCalled()
    expect(bringRows().map((row) => row.textContent)).toEqual(['Salat', 'Getränke', 'Gartenstühle'].map((title) => expect.stringContaining(title)))
    expect(screen.getByText('Geschenke gehören in die Wunschliste – dort bleiben sie geheim.')).toBeTruthy()
    fireEvent.change(bringField(), { target: { value: 'salat' } })
    fireEvent.keyDown(bringField(), { key: 'Enter' })
    expect(screen.getByText('Das steht schon auf der Liste.')).toBeTruthy()
    expect(bringRows()).toHaveLength(3)
  })

  it('"Nur Mitbringen" waits while wishes are in the form (they would vanish from sight)', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    openWishes()
    addWish('Buch')
    expect((screen.getByRole('radio', { name: 'Mitbringen' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('saving it all', () => {
  it('the occasion first (optimistic, entries shown at once), then entries, wishes and moves — then the screen loads once', async () => {
    const insert = deferred<{ occasionId: string }>()
    api.createOccasion.mockReturnValue(insert.promise)
    const { client } = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    client.setQueryData(qk.me(), ME)
    fillOccasion()
    openWishes()
    addWish(LINK)
    addWish('Puzzle')
    fireEvent.click(screen.getByRole('button', { name: 'Aus meinen Listen holen' }))
    fireEvent.click(await screen.findByRole('button', { name: '1 Wunsch hierher holen' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Beides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Getränke' }))
    fireEvent.change(bringField(), { target: { value: 'Gartenstühle' } })
    fireEvent.keyDown(bringField(), { key: 'Enter' })
    fireEvent.click(saveButton())

    expect(api.createOccasion).toHaveBeenCalledWith(expect.objectContaining({ id: NEW_ID, title: 'Milas Gartenfest', sections: 'both' }), HOST_ID)
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', search: { view: 'month', created: NEW_ID }, replace: true })
    // nothing else is sent before the occasion exists; its entries are on the optimistic screen already
    expect(writes.calls).toEqual([])
    const optimistic = client.getQueryData<OccasionScreen>(qk.occasion(NEW_ID))
    expect(optimistic?.potluck?.items.map((item) => item.title)).toEqual(['Salat', 'Getränke', 'Gartenstühle'])
    expect(optimistic?.wishlist).toBeNull()

    const confirmed = { ...hostScreen(), occasion: { ...hostScreen().occasion, id: NEW_ID, sections: 'both' as const }, wishlist: { ...hostScreen().wishlist!, wishes: [] } }
    api.getOccasionScreen.mockImplementation(async () => {
      writes.calls.push('screen')
      return confirmed
    })
    link.resolve({ preview: preview(), photo: null })
    await act(async () => insert.resolve({ occasionId: NEW_ID }))
    await waitFor(() => expect(writes.calls.at(-1)).toBe('screen'))
    expect(writes.calls).toEqual([
      'item:Salat',
      'item:Getränke',
      'item:Gartenstühle',
      'screen', // the list's id
      'wish:Handkaffeemühle „Kegel“',
      'wish:Puzzle',
      'move:w-teapot',
      'screen', // the refresh: the screen with everything in it
    ])
    expect(writes.createWish).toHaveBeenCalledWith(confirmed.wishlist.id, expect.objectContaining({ url: LINK, price_cents: 4990 }), HOST_ID)
    expect(writes.moveWish).toHaveBeenCalledWith('w-teapot', confirmed.wishlist.id, HOST_ID)
    expect(toasts.error).not.toHaveBeenCalled()
  })

  it('only what the chosen "Was gibt’s?" offers goes out: entries of a switched-off list stay unsent', async () => {
    api.createOccasion.mockResolvedValue({ occasionId: NEW_ID })
    api.getOccasionScreen.mockResolvedValue({ ...hostScreen(), occasion: { ...hostScreen().occasion, id: NEW_ID } })
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    fillOccasion()
    fireEvent.click(screen.getByRole('radio', { name: 'Beides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salat' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Wünsche' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Was soll mitgebracht werden?' })).toBeNull())
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.getOccasionScreen).toHaveBeenCalled())
    expect(writes.addPotluckItem).not.toHaveBeenCalled()
  })

  it('a refused occasion comes back with everything: the input, "Beides" and the added entries', async () => {
    api.createOccasion.mockRejectedValue(new AppError('network'))
    const first = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    fillOccasion()
    openWishes()
    addWish('Puzzle')
    fireEvent.click(screen.getByRole('radio', { name: 'Beides' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kuchen' }))
    nav.navigate.mockImplementation(async () => {
      nav.pathname = '/soon'
      nav.search = { view: 'month', created: NEW_ID }
    })
    fireEvent.click(saveButton())
    await waitFor(() => expect(peekDraft(HOST_ID, 'new')).toBeDefined())
    const draft = peekDraft(HOST_ID, 'new')!
    expect(draft.sections).toBe('both')
    expect(draft.extras?.wishes.map((wish) => wish.typed)).toEqual(['Puzzle'])
    expect(draft.extras?.items.map((item) => item.title)).toEqual(['Kuchen'])
    expect(writes.calls).toEqual([])
    first.unmount()

    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect((screen.getByRole('radio', { name: 'Beides' }) as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect(wishRows().map((row) => row.textContent)).toEqual([expect.stringContaining('Puzzle')])
    expect(bringRows().map((row) => row.textContent)).toEqual([expect.stringContaining('Kuchen')])
  })

  it('typed extras make leaving ask first', () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    openWishes()
    addWish('Buch')
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.getByText('Anlass verwerfen?')).toBeTruthy()
  })
})
