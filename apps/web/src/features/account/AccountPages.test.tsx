import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
const api = vi.hoisted(() => ({
  export: vi.fn(), remove: vi.fn(), download: vi.fn(), assert: vi.fn(), details: vi.fn(), photos: vi.fn(),
  wishPhotos: vi.fn(), listPhotos: vi.fn(), profilePhotos: vi.fn(),
  navigate: vi.fn(), signOut: vi.fn(), clearDevice: vi.fn(), historyBack: vi.fn(), canGoBack: false,
  callback: null as ((event: string, session: Session | null) => void) | null,
}))
vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useNavigate: () => api.navigate,
    useRouter: () => ({ history: { back: api.historyBack } }),
    useCanGoBack: () => api.canGoBack,
    Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
  }
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../../lib/api/account', () => ({
  exportMyData: api.export, deleteMyAccount: api.remove, downloadJson: api.download,
  exportFilename: () => 'bunprise-export-fixture.json', getAccountDetails: api.details,
}))
vi.mock('../../lib/api/identity', () => ({ assertCurrentAccount: api.assert }))
// the own cover photos (wave 2): their own RPC; the merge into the file is the real one
vi.mock('../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/photos')>()),
  exportMyOccasionPhotos: api.photos,
}))
// the own wish photos, list covers and profile / banner photos: their own RPCs as well (the merges are the real ones)
vi.mock('../../lib/api/wishPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPhotos')>()),
  exportMyWishPhotos: api.wishPhotos,
}))
vi.mock('../../lib/api/listPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/listPhotos')>()),
  exportMyListPhotos: api.listPhotos,
}))
vi.mock('../../lib/api/profilePhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/profilePhotos')>()),
  exportMyProfilePhotos: api.profilePhotos,
}))
vi.mock('../../lib/api/auth', () => ({ onAuthStateChange: (callback: typeof api.callback) => {
  api.callback = callback
  return () => { api.callback = null }
} }))
const cache = vi.hoisted(() => ({ client: null as import('@tanstack/react-query').QueryClient | null }))
vi.mock('../../lib/query', async () => ({
  get queryClient() { return cache.client },
  isOfflineFeedEnabled: () => false, setOfflineFeedEnabled: vi.fn(), signOutEverywhere: api.signOut, clearAccountDeviceState: api.clearDevice,
}))
vi.mock('../../lib/api/profile', () => ({ updateMyProfile: vi.fn() }))
import { DeletePage, ExportPage, SettingsPage } from './AccountPages'
import { updateMyProfile } from '../../lib/api/profile'
import { sammlungKey } from '../sammlung/key'
import i18next from 'i18next'

beforeEach(() => {
  vi.clearAllMocks()
  api.callback = null
  api.canGoBack = false
  cache.client = new QueryClient()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.assert.mockResolvedValue(undefined)
  api.export.mockResolvedValue({ profile: { id: 'account-a' } })
  api.photos.mockResolvedValue([])
  api.wishPhotos.mockResolvedValue([])
  api.listPhotos.mockResolvedValue([])
  api.profilePhotos.mockResolvedValue([])
  api.remove.mockResolvedValue(undefined)
  api.details.mockResolvedValue({ me: { profile: { id: 'account-a', display_name: 'Mia' }, consents_ok: false }, email: 'fixture@example.org' })
})
afterEach(() => vi.restoreAllMocks())

describe('account self-service screens', () => {
  it.each(['löschen', 'Löschen', ' LÖSCHEN '])('accepts the localized deletion confirmation %s', (word) => {
    render(<DeletePage userId="account-a" />)
    fireEvent.change(screen.getByLabelText('Gib zur Bestätigung „LÖSCHEN“ ein'), { target: { value: word } })
    expect((screen.getByRole('button', { name: 'Endgültig löschen' }) as HTMLButtonElement).disabled).toBe(false)
    expect(api.remove).not.toHaveBeenCalled()
  })
  it('returns from export through SPA navigation so the demo session survives', () => {
    render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(api.navigate).toHaveBeenCalledWith({ to: '/settings' })
    expect(api.historyBack).not.toHaveBeenCalled()
  })

  // QA ACCOUNT-4: opened from the sign-up step (/welcome/profile), "Zurück" / "Abbrechen" return there,
  // not to the Profil tab of an account that is not finished
  it('"Zurück" and "Abbrechen" go back to where export / delete were opened from', () => {
    api.canGoBack = true
    const { unmount } = render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(api.historyBack).toHaveBeenCalledTimes(1)
    unmount()
    render(<DeletePage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(api.historyBack).toHaveBeenCalledTimes(2)
    expect(api.navigate).not.toHaveBeenCalled()
  })

  it('after building, "Herunterladen" is the primary action and a line says what happened (QA ACCOUNT-11)', async () => {
    render(<ExportPage userId="account-a" />)
    const build = screen.getByRole('button', { name: 'Datei erstellen' })
    const primary = build.className
    fireEvent.click(build)
    const download = await screen.findByRole('button', { name: 'Herunterladen' })
    expect(screen.getByRole('status').textContent).toBe('Deine Datei ist fertig – tippe auf „Herunterladen“.')
    // the download takes the primary look; "Datei erstellen" steps back (a rebuild stays possible)
    expect(download.className).toBe(primary)
    expect(screen.getByRole('button', { name: 'Datei erstellen' }).className).not.toBe(primary)
    fireEvent.click(download)
    await waitFor(() => expect(api.download).toHaveBeenCalledWith(expect.anything(), 'bunprise-export-fixture.json'))
    expect(screen.getByRole('status').textContent).toBe('Download gestartet: bunprise-export-fixture.json')
  })

  it('builds an export before download and removes old data when a rebuild fails', async () => {
    render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Herunterladen' }))
    await waitFor(() => expect(api.download).toHaveBeenCalledTimes(1))
    expect(api.export).toHaveBeenCalledWith('account-a')
    api.export.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
  })

  it('the export file carries the own occasions\' cover photos (asked for the same account)', async () => {
    const social = { follows: [{ follower_id: 'account-a', following_id: 'friend' }], follow_links: [{ id: 'own-link' }], blocked_users: [{ blocked_id: 'blocked-person' }] }
    api.export.mockResolvedValueOnce({ profile: { id: 'account-a' }, ...social })
    const cover = {
      occasion_id: 'occasion-1', occasion_title: 'Gartenfest', mime: 'image/webp', width: 1600, height: 1067,
      size_bytes: 3, updated_at: '2026-10-20T10:00:00.000Z', data_base64: 'AAAA',
    }
    api.photos.mockResolvedValue([cover])
    render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Herunterladen' }))
    await waitFor(() => expect(api.download).toHaveBeenCalledTimes(1))
    expect(api.photos).toHaveBeenCalledWith('account-a')
    expect(api.export).toHaveBeenCalledWith('account-a')
    expect(api.download).toHaveBeenCalledWith({
      profile: { id: 'account-a' }, ...social, occasion_photos: [cover], wish_photos: [], list_photos: [], profile_photos: [],
    }, 'bunprise-export-fixture.json')
  })

  it('the export file carries my wish photos, list covers and my profile / banner photo too (asked for the same account)', async () => {
    const at = '2026-10-24T10:00:00.000Z'
    const wish = { wish_id: 'wish-1', wish_title: 'Mühle', wishlist_id: 'list-1', mime: 'image/webp', width: 480, height: 480, size_bytes: 3, updated_at: at, data_base64: 'AAAA' }
    const list = { wishlist_id: 'list-1', list_title: 'Geburtstag', occasion_id: null, mime: 'image/webp', width: 960, height: 540, size_bytes: 3, updated_at: at, data_base64: 'BBBB' }
    const avatar = { kind: 'avatar', mime: 'image/webp', width: 512, height: 512, size_bytes: 3, updated_at: at, data_base64: 'CCCC' }
    const banner = { kind: 'banner', mime: 'image/jpeg', width: 1600, height: 640, size_bytes: 3, updated_at: at, data_base64: 'DDDD' }
    api.wishPhotos.mockResolvedValue([wish])
    api.listPhotos.mockResolvedValue([list])
    api.profilePhotos.mockResolvedValue([avatar, banner])
    render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Herunterladen' }))
    await waitFor(() => expect(api.download).toHaveBeenCalledTimes(1))
    for (const call of [api.wishPhotos, api.listPhotos, api.profilePhotos]) expect(call).toHaveBeenCalledWith('account-a')
    expect(api.download).toHaveBeenCalledWith({
      profile: { id: 'account-a' }, occasion_photos: [], wish_photos: [wish], list_photos: [list], profile_photos: [avatar, banner],
    }, 'bunprise-export-fixture.json')
  })

  it('no file when the photos cannot be read (an export is complete or not there)', async () => {
    api.photos.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
  })

  it('invalidates a ready export when the account changes', async () => {
    render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    await screen.findByRole('button', { name: 'Herunterladen' })
    act(() => api.callback?.('SIGNED_IN', { user: { id: 'account-b' } } as Session))
    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
    expect(api.download).not.toHaveBeenCalled()
  })

  it('does not download if the component unmounts during its identity check', async () => {
    let finish: (() => void) | undefined
    api.assert.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = render(<ExportPage userId="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Herunterladen' }))
    view.unmount()
    await act(async () => { finish?.() })
    expect(api.download).not.toHaveBeenCalled()
  })

  it('requires the localized deletion word and sends one request even on duplicate submits', async () => {
    let finish: (() => void) | undefined
    api.remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<DeletePage userId="account-a" />)
    const input = screen.getByLabelText('Gib zur Bestätigung „LÖSCHEN“ ein')
    const button = screen.getByRole('button', { name: 'Endgültig löschen' }) as HTMLButtonElement
    fireEvent.change(input, { target: { value: 'DELETE' } })
    expect(button.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'LÖSCHEN' } })
    fireEvent.submit(button.closest('form')!)
    fireEvent.submit(button.closest('form')!)
    expect(api.remove).toHaveBeenCalledTimes(1)
    expect(api.remove).toHaveBeenCalledWith({ expectedUserId: 'account-a', onDeleted: expect.any(Function) })
    // «Pompons Sammlung» stays on sign-out but goes with the account (features/sammlung/key.ts): after the server's yes
    window.localStorage.setItem(sammlungKey('account-a'), '{}')
    window.localStorage.setItem(sammlungKey('account-b'), '{}')
    const { onDeleted } = api.remove.mock.calls[0]![0] as { onDeleted: (id: string) => void }
    await waitFor(() => { onDeleted('account-a'); expect(window.localStorage.getItem(sammlungKey('account-a'))).toBeNull() })
    expect(window.localStorage.getItem(sammlungKey('account-b'))).toBe('{}')
    window.localStorage.removeItem(sammlungKey('account-b'))
    await act(async () => { finish?.() })
    expect(await screen.findByText('Konto gelöscht')).toBeTruthy()
    fireEvent.submit(button.closest('form')!)
    expect(api.remove).toHaveBeenCalledTimes(1)
  })

  it('disables destructive actions offline without issuing requests', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<DeletePage userId="account-a" />)
    fireEvent.change(screen.getByLabelText('Gib zur Bestätigung „LÖSCHEN“ ein'), { target: { value: 'LÖSCHEN' } })
    const button = screen.getByRole('button', { name: 'Endgültig löschen' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.submit(button.closest('form')!)
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('keeps account rights and sign-out available despite missing updated consents', async () => {
    render(<SettingsPage userId="account-a" />)
    const account = await screen.findByRole('region', { name: 'Konto' })
    expect(await within(account).findByText('fixture@example.org')).toBeTruthy()
    expect(within(account).getByText('E-Mail')).toBeTruthy()
    expect(within(account).getByText('Anmeldung')).toBeTruthy()
    expect(within(account).getByText('E-Mail-Code')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Meine Daten herunterladen' }).getAttribute('href')).toBe('/settings/export')
    expect(screen.getByRole('link', { name: 'Konto löschen' }).getAttribute('href')).toBe('/settings/delete')
    expect(screen.getByRole('button', { name: 'Abmelden (auf allen Geräten)' })).toBeTruthy()
    // the contact address is set since 24.10 (lib/app.ts SUPPORT_EMAIL): the row writes a mail, no placeholder text
    expect(screen.getByRole('link', { name: 'Melden oder Kontakt' }).getAttribute('href')).toBe('mailto:hello@bunprise.de')
    expect(screen.queryByText('Der Kontakt wird vor dem Pilotbetrieb ergänzt.')).toBeNull()
  })

  // Felix 31.10 «пропадает баннер, аватарка, имя, эл. почта, вход»: the Profil tab that comes back shows its data in
  // its first frame (memory cache) — no skeleton, no second request while the answer is fresh
  it('a return to Profil shows name, e-mail and sign-in method at once, without asking again', async () => {
    const first = render(<SettingsPage userId="account-a" />)
    expect((await screen.findAllByText('fixture@example.org')).length).toBeGreaterThan(0)
    first.unmount()
    const again = render(<SettingsPage userId="account-a" />)
    // synchronously, in the first render: the data, and not a single skeleton
    expect(within(screen.getByRole('region', { name: 'Konto' })).getByText('fixture@example.org')).toBeTruthy()
    expect(screen.getAllByText('Mia').length).toBeGreaterThan(0)
    expect(again.container.querySelector('.skeleton')).toBeNull()
    expect(api.details).toHaveBeenCalledTimes(1)
  })

  it('a first visit: banner, photo and name come from the cached get_me at once; only e-mail and sign-in wait', async () => {
    let answer: (value: unknown) => void = () => undefined
    api.details.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    cache.client!.setQueryData(['me'], { profile: { id: 'account-a', display_name: 'Mia', banner: null }, consents_ok: true })
    const view = render(<SettingsPage userId="account-a" />)
    const account = screen.getByRole('region', { name: 'Konto' })
    expect(screen.getAllByText('Mia').length).toBeGreaterThan(0)
    // e-mail (row + header) and sign-in method: skeletons until the details come
    expect(view.container.querySelectorAll('.skeleton').length).toBe(3)
    answer({ me: { profile: { id: 'account-a', display_name: 'Mia' }, consents_ok: true }, email: 'fixture@example.org', loginMethod: 'email' })
    expect(await within(account).findByText('fixture@example.org')).toBeTruthy()
    expect(view.container.querySelector('.skeleton')).toBeNull()
  })

  it('keeps the rhythm "caption → card" in every group (blocker 23)', async () => {
    render(<SettingsPage userId="account-a" />)
    expect((await screen.findAllByText('fixture@example.org')).length).toBeGreaterThan(0)
    // the language row lies in a card like every other group (the frosted panel of "Darstellung")
    const language = screen.getByRole('button', { name: /^Sprache/ })
    const appearance = screen.getByRole('region', { name: 'Darstellung' })
    expect(within(appearance).getByRole('heading', { level: 2, name: 'Darstellung' })).toBeTruthy()
    expect(language.closest('.glass-panel')).not.toBeNull()
    expect(appearance.contains(language)).toBe(true)
    // the per-device switch has its own caption
    const device = screen.getByRole('region', { name: 'Auf diesem Gerät' })
    expect(within(device).getByRole('heading', { level: 2, name: 'Auf diesem Gerät' })).toBeTruthy()
    expect(within(device).getByRole('switch', { name: /Schnellstart: Liste offline speichern/ })).toBeTruthy()
  })

  it('Sprache: one row with the current language; a tap opens the list, each language by its own name, a check on the current one (Felix 27.10)', async () => {
    render(<SettingsPage userId="account-a" />)
    const appearance = await screen.findByRole('region', { name: 'Darstellung' })
    // no grid of chips any more: one row, its value the current language by its own name
    expect(within(appearance).queryByRole('radiogroup', { name: 'Sprache' })).toBeNull()
    const row = within(appearance).getByRole('button', { name: /^Sprache/ })
    expect(row.querySelector('[data-language-name]')?.textContent).toBe('Deutsch')
    expect(row.querySelector('[data-language-name]')?.getAttribute('lang')).toBe('de')
    fireEvent.click(row)
    const sheet = await screen.findByRole('dialog', { name: 'Sprache' })
    const list = within(sheet).getByRole('radiogroup', { name: 'Sprache' })
    const radios = within(list).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['Deutsch', 'English', 'Русский', 'Українська'])
    expect(radios.map((radio) => radio.getAttribute('lang'))).toEqual(['de', 'en', 'ru', 'uk'])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    // the check mark sits on the current language only; online there is no offline note
    expect(radios.map((radio) => radio.querySelector('svg') !== null)).toEqual([true, false, false, false])
    expect(within(sheet).queryByText('Offline gilt eine neue Sprache nur auf diesem Gerät, nicht für dein Profil.')).toBeNull()
    // arrow keys only move the focus: nothing is picked by them
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(vi.mocked(updateMyProfile)).not.toHaveBeenCalled()
    try {
      fireEvent.click(within(list).getByRole('radio', { name: 'Українська' }))
      // the same handler as before: Ukrainian is kept on the device, the profile hears "de"
      await waitFor(() => expect(vi.mocked(updateMyProfile)).toHaveBeenCalledWith({ locale: 'de' }, 'account-a'))
      expect(localStorage.getItem('bunprise.lang')).toBe('uk')
      expect(i18next.language).toBe('uk')
      // the sheet closed itself (the tests bundle German strings only, so the row's new name is checked in e2e)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally {
      localStorage.removeItem('bunprise.lang')
      await act(() => i18next.changeLanguage('de'))
    }
  })

  it('Sprache offline: the list says the new language applies to this device only; English goes to the profile once online', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<SettingsPage userId="account-a" />)
    const appearance = await screen.findByRole('region', { name: 'Darstellung' })
    fireEvent.click(within(appearance).getByRole('button', { name: /^Sprache/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Sprache' })
    expect(within(sheet).getByRole('status').textContent).toBe('Offline gilt eine neue Sprache nur auf diesem Gerät, nicht für dein Profil.')
    try {
      fireEvent.click(within(sheet).getByRole('radio', { name: 'English' }))
      await waitFor(() => expect(i18next.language).toBe('en'))
      expect(vi.mocked(updateMyProfile)).not.toHaveBeenCalled()
    } finally {
      localStorage.removeItem('bunprise.lang')
      await act(() => i18next.changeLanguage('de'))
    }
  })

  it('Darstellung → Farbschema: System by default; "Dunkel" is stored on this device and pinned on <html> (Felix 25.10)', async () => {
    render(<SettingsPage userId="account-a" />)
    const appearance = await screen.findByRole('region', { name: 'Darstellung' })
    const theme = within(appearance).getByRole('radiogroup', { name: 'Farbschema' })
    expect(within(theme).getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(theme).getByRole('radio', { name: 'Dunkel' }))
    expect(localStorage.getItem('bunprise.theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(within(theme).getByRole('radio', { name: 'Dunkel' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(theme).getByRole('radio', { name: 'System' }))
    expect(localStorage.getItem('bunprise.theme')).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('Farbschema: six swatches named for screen readers, the chosen name next to the title (Felix 25.10, Schwarz 27.10)', async () => {
    render(<SettingsPage userId="account-a" />)
    const appearance = await screen.findByRole('region', { name: 'Darstellung' })
    const theme = within(appearance).getByRole('radiogroup', { name: 'Farbschema' })
    const radios = within(theme).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['System', 'Hell', 'Dunkel', 'Blau', 'Ozean', 'Schwarz'])
    expect(radios.map((radio) => radio.querySelector('.theme-swatch')?.getAttribute('data-swatch'))).toEqual(['system', 'light', 'dark', 'navy', 'ocean', 'black'])
    expect(appearance.querySelector('[data-theme-name]')?.textContent).toBe('System')
  })

  it.each([['Blau', 'navy'], ['Ozean', 'ocean'], ['Schwarz', 'black']])('Farbschema "%s": stored on this device, pinned on <html> once its stylesheet is in (Felix 25.10 / 27.10)', async (name, value) => {
    render(<SettingsPage userId="account-a" />)
    const appearance = await screen.findByRole('region', { name: 'Darstellung' })
    const theme = within(appearance).getByRole('radiogroup', { name: 'Farbschema' })
    fireEvent.click(within(theme).getByRole('radio', { name }))
    expect(localStorage.getItem('bunprise.theme')).toBe(value)
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe(value))
    expect(within(theme).getByRole('radio', { name }).getAttribute('aria-checked')).toBe('true')
    expect(appearance.querySelector('[data-theme-name]')?.textContent).toBe(name)
    fireEvent.click(within(theme).getByRole('radio', { name: 'System' }))
    expect(localStorage.getItem('bunprise.theme')).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('Farbschema "Schwarz": one line about OLED under the swatches, only while it is chosen (Felix 27.10)', async () => {
    render(<SettingsPage userId="account-a" />)
    const appearance = await screen.findByRole('region', { name: 'Darstellung' })
    const theme = within(appearance).getByRole('radiogroup', { name: 'Farbschema' })
    expect(within(appearance).queryByText(/OLED/)).toBeNull()
    fireEvent.click(within(theme).getByRole('radio', { name: 'Schwarz' }))
    expect(await within(appearance).findByText(/OLED-Displays spart das sogar Akku/)).toBeTruthy()
    fireEvent.click(within(theme).getByRole('radio', { name: 'Dunkel' }))
    await waitFor(() => expect(within(appearance).queryByText(/OLED/)).toBeNull())
  })

  it('shows the profile header: avatar initials, name, e-mail and "Name ändern"', async () => {
    render(<SettingsPage userId="account-a" />)
    const header = await screen.findByRole('region', { name: 'Dein Profil' })
    expect(await within(header).findByText('Mia')).toBeTruthy()
    expect(within(header).getByText('fixture@example.org')).toBeTruthy()
    expect(within(header).getByRole('button', { name: 'Name ändern' })).toBeTruthy()
    // one heading names the screen for assistive technology; the bar copy of the name is decorative
    expect(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeTruthy()
    const bar = document.querySelector('header.set-bar')
    expect(bar?.querySelector('[aria-hidden="true"]')?.textContent).toContain('Mia')
  })

  it('groups the settings Telegram-style: Konto · Darstellung · Auf diesem Gerät · Deine Daten · Über Bunprise · Rechtliches · Hilfe', async () => {
    render(<SettingsPage userId="account-a" />)
    await screen.findByRole('region', { name: 'Konto' })
    const names = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    // «Über Bunprise»: the comic «Pompon & Tapsi – ihre Geschichte» (features/comic, 31.10)
    expect(names).toEqual(['Dein Profil', 'Konto', 'Darstellung', 'Auf diesem Gerät', 'Deine Daten', 'Über Bunprise', 'Rechtliches', 'Hilfe'])
    const data = screen.getByRole('region', { name: 'Deine Daten' })
    expect(within(data).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/settings/export', '/settings/delete'])
    // every row carries its small coloured icon tile (decorative)
    expect(data.querySelectorAll('.set-row-icon > span[aria-hidden="true"]')).toHaveLength(2)
  })

  it('has the legal section of the former footer and, at the very bottom, the pilot line with the version', async () => {
    render(<SettingsPage userId="account-a" />)
    const legal = await screen.findByRole('region', { name: 'Rechtliches' })
    expect(within(legal).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Impressum', '/legal/impressum'],
      ['Datenschutzerklärung', '/legal/datenschutz'],
      ['Nutzungsbedingungen', '/legal/nutzung'],
    ])
    expect(legal.querySelectorAll('.set-row-icon > span[aria-hidden="true"]')).toHaveLength(3)
    const line = screen.getByText(/^Private Testversion · nur für Erwachsene \(18\+\) · Version \S+$/)
    // nothing of the screen comes after it
    const all = Array.from(document.body.querySelectorAll('main *'))
    expect(all.filter((el) => line.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !line.contains(el))).toEqual([])
  })

  it('signs out everywhere when online, clears only this device when offline', async () => {
    const online = render(<SettingsPage userId="account-a" />)
    await screen.findByRole('region', { name: 'Konto' })
    fireEvent.click(screen.getByRole('button', { name: 'Abmelden (auf allen Geräten)' }))
    expect(api.signOut).toHaveBeenCalledWith({ expectedUserId: 'account-a', redirectTo: '/' })
    online.unmount()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<SettingsPage userId="account-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Abmelden (auf allen Geräten)' }))
    expect(api.clearDevice).toHaveBeenCalledWith('account-a', '/')
    expect(api.signOut).toHaveBeenCalledTimes(1)
  })

  it('stops sign-out once another account took over the tab', async () => {
    render(<SettingsPage userId="account-a" />)
    await screen.findByRole('region', { name: 'Konto' })
    act(() => api.callback?.('SIGNED_IN', { user: { id: 'account-b' } } as Session))
    const button = screen.getByRole('button', { name: 'Abmelden (auf allen Geräten)' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api.signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('mounts the motion settings in their slot right after "Darstellung"', async () => {
    render(<SettingsPage userId="account-a" motionSection={<p>Bewegungs-Slot</p>} />)
    const slot = (await screen.findByText('Bewegungs-Slot')).closest('[data-settings-slot="motion"]')
    expect(slot).not.toBeNull()
    expect(slot?.previousElementSibling?.getAttribute('aria-label')).toBe('Darstellung')
  })
})
