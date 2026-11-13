import type { ReactNode } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, OccasionInput, OccasionScreen } from '../../../lib/api/types'
import { qk } from '../../../lib/queryKeys'
import { HOST_ID, OCCASION_ID, hostScreen, makeQueryClient, renderWithClient } from '../test-utils'

// The motif in the occasion form (Felix 26.10): the title's motif is there BEFORE saving, marked "Automatisch";
// the strip changes it, "Kein Motiv" switches it off; saving stores what the form showed; editing keeps a picked
// motif and lets an automatic one follow the title; without the flag or the server's key nothing changes.

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn() }))
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
const flag = vi.hoisted(() => ({ on: true }))

vi.mock('@tanstack/react-router', () => {
  const Link = ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>
  return {
    useRouter: () => ({ navigate: nav.navigate, history: { back: nav.back }, state: { location: { pathname: '/occasions/new', search: {} } } }),
    useCanGoBack: () => false,
    Link,
    createLink: () => Link,
  }
})
vi.mock('../../../lib/api/occasions', () => api)
vi.mock('../../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/places')>()),
  searchPlaces: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))
vi.mock('./flag', () => ({ coversEnabled: () => flag.on }))

import { EditOccasionPage } from '../EditOccasionPage'
import { NewOccasionPage } from '../NewOccasionPage'
import { resetSavingForTests } from '../saving'

const NEW_ID = '77777777-7777-4777-8777-777777777777'

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  flag.on = true
  nav.navigate.mockResolvedValue(undefined)
  api.newOccasionId.mockReturnValue(NEW_ID)
  api.createOccasion.mockResolvedValue({ occasionId: NEW_ID })
  api.updateOccasion.mockResolvedValue({})
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  api.getFeed.mockReturnValue(new Promise(() => {}))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

const setTitle = (value: string) => fireEvent.change(screen.getByLabelText('Titel'), { target: { value } })
const chooseTomorrow = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Datum/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Morgen' }))
}
const save = () => fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
const group = () => screen.getByRole('group', { name: 'Titelfoto' })
const strip = () => screen.getByRole('radiogroup', { name: 'Motiv' })
const sent = (): OccasionInput => api.createOccasion.mock.calls[0]?.[0] as OccasionInput

describe('a new occasion', () => {
  it('"Geburtstag von Anna": the motif shows at once, marked "Automatisch", and is stored', async () => {
    const { client } = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    client.setQueryData<FeedScreen>(qk.feed(), { upcoming: [], past: [] })
    setTitle('Geburtstag von Anna')
    expect(await within(group()).findByText('Automatisch')).toBeTruthy()
    expect(within(group()).getByText('Motiv: Geburtstag')).toBeTruthy()
    expect(within(group()).getByText('Passt zum Titel – du kannst es ändern.')).toBeTruthy()
    expect(group().querySelector('svg[data-cover="birthday"]')).not.toBeNull()
    // the strip: "Kein Motiv" first, the title's motif next and chosen, all 16 motifs
    const options = within(strip()).getAllByRole('radio')
    expect(options).toHaveLength(17)
    expect(options[0]?.textContent).toContain('Kein Motiv')
    expect(options[1]?.textContent).toContain('Geburtstag')
    expect(options[1]?.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Motive sind Bilder von Bunprise – ohne Upload, ohne fremde Fotos.')).toBeTruthy()

    chooseTomorrow()
    save()
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    expect(sent().cover_theme).toBe('birthday')
    // the optimistic Start row and screen show it before the server answered
    expect(client.getQueryData<FeedScreen>(qk.feed())?.upcoming[0]?.cover_theme).toBe('birthday')
    expect(client.getQueryData<OccasionScreen>(qk.occasion(NEW_ID))?.occasion.cover_theme).toBe('birthday')
  })

  it('the motif follows the title while it is automatic: "Training im Gym", "Spieleabend"', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Training im Gym')
    expect(await within(group()).findByText('Motiv: Sport')).toBeTruthy()
    setTitle('Spieleabend')
    expect(within(group()).getByText('Motiv: Spieleabend')).toBeTruthy()
    expect(group().querySelector('svg[data-cover="gamenight"]')).not.toBeNull()
  })

  it('a title without a motif stays as before (+ "Motiv wählen"); nothing is sent', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Steuererklärung')
    expect(await within(group()).findByText('Motiv wählen')).toBeTruthy()
    expect(within(group()).getByRole('button', { name: /Foto hinzufügen/ })).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    chooseTomorrow()
    save()
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    expect('cover_theme' in sent()).toBe(false)
  })

  it('"Motiv wählen" opens the strip; a motif picked by hand stays when the title changes', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Freitag bei mir')
    fireEvent.click(await within(group()).findByRole('button', { name: /Motiv wählen/ }))
    expect(within(strip()).getByRole('radio', { name: 'Kein Motiv' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(strip()).getByRole('radio', { name: 'Spieleabend' }))
    expect(within(group()).getByText('Motiv: Spieleabend')).toBeTruthy()
    expect(within(group()).getByText('Von dir gewählt.')).toBeTruthy()
    expect(group().querySelector('.of-cover-chip')?.textContent).toBe('Motiv') // the chip: no longer "Automatisch"
    setTitle('Geburtstag')
    expect(within(group()).getByText('Motiv: Spieleabend')).toBeTruthy()
    chooseTomorrow()
    save()
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    expect(sent().cover_theme).toBe('gamenight')
  })

  it('"Kein Motiv" switches the automatic motif off ("none"); "Rückgängig" brings it back', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Geburtstag von Anna')
    await within(group()).findByText('Automatisch')
    fireEvent.click(within(strip()).getByRole('radio', { name: 'Kein Motiv' }))
    expect(within(group()).getByText('Kein Titelbild')).toBeTruthy()
    expect(within(group()).getByText('Das automatische Motiv ist aus.')).toBeTruthy()
    expect(group().querySelector('.of-cover-frame')).toBeNull()
    fireEvent.click(within(group()).getByRole('button', { name: /Rückgängig/ }))
    expect(within(group()).getByText('Automatisch')).toBeTruthy()
    // "Entfernen" on the preview = "Kein Motiv" too
    fireEvent.click(within(group()).getByRole('button', { name: 'Entfernen' }))
    expect(within(group()).getByText('Kein Titelbild')).toBeTruthy()
    chooseTomorrow()
    save()
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    expect(sent().cover_theme).toBe('none')
  })

  it('arrow keys move the choice in the strip', async () => {
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Geburtstag')
    await within(group()).findByText('Automatisch')
    const checked = within(strip()).getByRole('radio', { checked: true })
    expect(checked.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(checked, { key: 'ArrowRight' })
    expect(within(group()).getByText('Motiv: Party')).toBeTruthy()
    expect(document.activeElement?.getAttribute('data-cover')).toBe('party')
  })

  it('without the flag: no motif, nothing sent (a database without the column)', async () => {
    flag.on = false
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    setTitle('Geburtstag von Anna')
    await new Promise((done) => setTimeout(done, 30))
    expect(within(group()).queryByText('Automatisch')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    chooseTomorrow()
    save()
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    expect('cover_theme' in sent()).toBe(false)
  })
})

describe('editing an occasion', () => {
  function renderEdit(data: OccasionScreen) {
    const client = makeQueryClient()
    client.setQueryData(qk.occasion(OCCASION_ID), data)
    return renderWithClient(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_ID} />, client)
  }
  const screenWith = (title: string, cover_theme?: string | null) => {
    const base = hostScreen()
    return { ...base, occasion: { ...base.occasion, title, ...(cover_theme !== undefined ? { cover_theme } : {}) } }
  }
  const updated = () => api.updateOccasion.mock.calls[0]?.[1] as Partial<OccasionInput>

  it('an automatic motif follows the new title and is stored', async () => {
    renderEdit(screenWith('Geburtstag Anna', 'birthday'))
    expect(await within(group()).findByText('Automatisch')).toBeTruthy()
    setTitle('Spieleabend bei Anna')
    expect(within(group()).getByText('Motiv: Spieleabend')).toBeTruthy()
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(updated().cover_theme).toBe('gamenight')
  })

  it('a motif the host picked stays; an unchanged motif is not sent', async () => {
    renderEdit(screenWith('Geburtstag Anna', 'party'))
    expect(await within(group()).findByText('Von dir gewählt.')).toBeTruthy()
    setTitle('Spieleabend bei Anna')
    expect(within(group()).getByText('Motiv: Party')).toBeTruthy()
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect('cover_theme' in updated()).toBe(false)
  })

  it('"none" opens switched off', async () => {
    renderEdit(screenWith('Geburtstag Anna', 'none'))
    expect(await within(group()).findByText('Kein Titelbild')).toBeTruthy()
  })

  it('a server without the key: no motif choice, no cover_theme in the update', async () => {
    renderEdit(screenWith('Geburtstag Anna'))
    await new Promise((done) => setTimeout(done, 30))
    expect(within(group()).queryByText('Automatisch')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    setTitle('Geburtstag von Anna')
    save()
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect('cover_theme' in updated()).toBe(false)
  })
})
