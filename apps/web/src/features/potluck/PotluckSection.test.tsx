import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, PotluckItem } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { GUEST_ID, guestScreen, HOST_ID, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from '../occasions/test-utils'
import PotluckSection from './PotluckSection'

const api = vi.hoisted(() => ({
  addPotluckItem: vi.fn(),
  renamePotluckItem: vi.fn(),
  deletePotluckItem: vi.fn(),
  claimPotluckItem: vi.fn(),
  unclaimPotluckItem: vi.fn(),
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../lib/api/potluck', () => api)
vi.mock('../../lib/toast', () => ({ toast: toasts }))

const item = (patch: Partial<PotluckItem>): PotluckItem => ({
  id: 'x', title: 'x', created_at: '2030-01-01T10:00:00.000Z', can_edit: false, can_delete: false,
  claimed: false, claimed_by_me: false, bringer: null, ...patch,
})

const ITEMS: PotluckItem[] = [
  item({ id: 'salat', title: 'Salat' }),
  item({ id: 'sekt', title: 'Sekt', claimed: true, bringer: { profile_id: HOST_ID, display_name: 'Mila Sommer' } }),
  item({ id: 'box', title: 'Musikbox', claimed: true, bringer: null }),
  item({ id: 'kuchen', title: 'Kuchen', claimed: true, claimed_by_me: true, can_edit: true, can_delete: true, bringer: { profile_id: GUEST_ID, display_name: 'Jonas' } }),
]

function withList(base: OccasionScreen, items: PotluckItem[]): OccasionScreen {
  return { ...base, occasion: { ...base.occasion, sections: 'both' }, potluck: { max_items: 50, items } }
}

function setup(sc: OccasionScreen, userId: string) {
  const client = makeQueryClient()
  client.setQueryData(qk.occasion(OCCASION_ID), sc)
  return renderWithClient(<PotluckSection screen={sc} userId={userId} />, client)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

const row = (id: string) => within(document.querySelector(`[data-potluck-item="${id}"]`) as HTMLElement)

describe('the guest view', () => {
  it('shows each state of an entry in its row — and no text the rows already say (Felix 27.10)', () => {
    setup(withList(guestScreen(), ITEMS), GUEST_ID)
    expect(screen.getByRole('heading', { name: 'Mitbringen' })).toBeTruthy()
    // no "Du bringst: …", no "open for everyone" line under a filled list; the count only for screen readers
    expect(screen.queryByText(/^Du bringst/)).toBeNull()
    expect(screen.queryByText(/^Hier sieht jeder/)).toBeNull()
    expect(screen.getByText('3 von 4 verteilt').className).toContain('sr-only')
    // free → the pill; someone else → their chip (first name) and the whole sentence for screen readers
    expect(row('salat').getByRole('button', { name: 'Salat: Ich bring\'s mit' })).toBeTruthy()
    expect(row('sekt').getByText('Mila')).toBeTruthy()
    expect(row('sekt').getByText('Mila Sommer bringt es mit').className).toContain('sr-only')
    expect(row('box').getByText('Wird schon mitgebracht')).toBeTruthy()
    // mine → "Du"; "Doch nicht" waits in "⋯", not next to it
    expect(row('kuchen').getByText('Du')).toBeTruthy()
    expect(row('kuchen').queryByRole('button', { name: /doch nicht/ })).toBeNull()
    expect(row('salat').queryByText('Noch offen')).toBeNull()
    // the menu only on my own entry
    expect(screen.getAllByRole('button', { name: /^Mehr zu/ })).toHaveLength(1)
    // never the words of the secret wish list
    expect(document.body.textContent).not.toMatch(/reserv/i)
  })

  it('"Doch nicht" sits in "⋯" and waits for the server; the menu closes once it answered', async () => {
    let resolve: () => void = () => {}
    api.unclaimPotluckItem.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    const { client } = setup(withList(guestScreen(), ITEMS), GUEST_ID)
    const kuchen = () => client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items.find((i) => i.id === 'kuchen')!
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kuchen“' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Kuchen: doch nicht mitbringen' }).textContent).toBe('Doch nicht mitbringen')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kuchen: doch nicht mitbringen' }))
    expect(api.unclaimPotluckItem).toHaveBeenCalledWith('kuchen', GUEST_ID)
    expect(kuchen().claimed_by_me).toBe(true) // nothing changes before the answer
    resolve()
    await waitFor(() => expect(kuchen()).toMatchObject({ claimed: false, claimed_by_me: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('everything taken: no thank-you line, the rows say it', () => {
    setup(withList(guestScreen(), ITEMS.filter((entry) => entry.claimed)), GUEST_ID)
    expect(screen.queryByText(/Alles ist verteilt/)).toBeNull()
    expect(screen.getByText('3 von 3 verteilt').className).toContain('sr-only')
  })

  it('an empty list still says it is open for everyone (no row shows it yet)', () => {
    setup(withList(guestScreen(), []), GUEST_ID)
    expect(screen.getByText('Hier sieht jeder, wer was mitbringt – auch Mila.')).toBeTruthy()
    expect(screen.getByText('Mila hat noch nichts eingetragen. Du kannst etwas vorschlagen.')).toBeTruthy()
    expect(screen.queryByText(/verteilt/)).toBeNull()
  })

  it('"Ich bring\'s mit" waits for the server, then shows me', async () => {
    let resolve: () => void = () => {}
    api.claimPotluckItem.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    const { client } = setup(withList(guestScreen(), ITEMS), GUEST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Salat: Ich bring\'s mit' }))
    expect(api.claimPotluckItem).toHaveBeenCalledWith('salat', GUEST_ID)
    // nothing changes before the answer (two people may press at once)
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items[0]!.claimed).toBe(false)
    resolve()
    await waitFor(() => expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items[0]).toMatchObject({ claimed: true, claimed_by_me: true }))
  })

  it('somebody was faster: a toast, nothing of mine', async () => {
    api.claimPotluckItem.mockRejectedValue(new AppError('already_claimed'))
    const { client } = setup(withList(guestScreen(), ITEMS), GUEST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Salat: Ich bring\'s mit' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Das bringt schon jemand anderes mit'))
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items[0]!.claimed_by_me).toBe(false)
  })

  it('adding is optimistic; the sheet starts with "Ich bringe das selbst mit" on for a guest', async () => {
    api.addPotluckItem.mockResolvedValue({ id: 'server-id' })
    const { client } = setup(withList(guestScreen(), ITEMS), GUEST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Ich bringe … mit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Geschenke gehören in die Wunschliste – dort bleiben sie geheim.')).toBeTruthy()
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Eintrag'), { target: { value: '  Gitarre ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }))
    expect(api.addPotluckItem).toHaveBeenCalledWith(OCCASION_ID, '  Gitarre ', true, GUEST_ID)
    const items = () => client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items
    expect(items().at(-1)).toMatchObject({ title: 'Gitarre', claimed_by_me: true, can_edit: true })
    await waitFor(() => expect(items().at(-1)!.id).toBe('server-id'))
  })

  it('an empty title is refused in the sheet, nothing is sent', async () => {
    setup(withList(guestScreen(), ITEMS), GUEST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Ich bringe … mit' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }))
    expect(await within(dialog).findByText('Schreib kurz, was mitgebracht werden soll.')).toBeTruthy()
    expect(api.addPotluckItem).not.toHaveBeenCalled()
  })
})

describe('the host view', () => {
  it('an empty list offers suggestions; one tap adds an entry', async () => {
    api.addPotluckItem.mockResolvedValue({ id: 'id-1' })
    const { client } = setup(withList(hostScreen(), []), HOST_ID)
    expect(screen.getByText('Was sollen deine Gäste mitbringen?')).toBeTruthy()
    expect(screen.getByText('Hier sehen alle, wer was mitbringt.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Getränke' }))
    expect(api.addPotluckItem).toHaveBeenCalledWith(OCCASION_ID, 'Getränke', false, HOST_ID)
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items.map((i) => i.title)).toEqual(['Getränke'])
  })

  it('deleting an entry somebody brings asks first, naming the person; a failure rolls back', async () => {
    api.deletePotluckItem.mockRejectedValue(new AppError('network'))
    const items = [item({ id: 'bier', title: 'Bier', claimed: true, can_delete: true, bringer: { profile_id: GUEST_ID, display_name: 'Jonas' } })]
    const { client } = setup(withList(hostScreen(), items), HOST_ID)
    // the host sees who brings it (the chip), no "open for everyone" line under a filled list
    expect(row('bier').getByText('Jonas')).toBeTruthy()
    expect(screen.queryByText('Hier sehen alle, wer was mitbringt.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Bier“' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }))
    expect(await screen.findByText('Jonas wollte das mitbringen. Trotzdem löschen?')).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Löschen' }).at(-1)!
    fireEvent.click(confirm)
    expect(api.deletePotluckItem).toHaveBeenCalledWith('bier', HOST_ID)
    await waitFor(() => expect(toasts.error).toHaveBeenCalled())
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))!.potluck!.items.map((i) => i.id)).toEqual(['bier'])
  })
})
