import type { ReactNode, Ref } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, Wish, WishInput, WishWithList } from '../../lib/api/types'
import type { LinkPreview, LinkPreviewErrorCode, LinkPreviewOptions } from '../../lib/api/linkPreview'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { getToasts, toast } from '../../lib/toast'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'

const api = vi.hoisted(() => ({
  createWish: vi.fn<(wishlistId: string, input: WishInput, expectedUserId?: string) => Promise<Wish>>(),
  updateWish: vi.fn<(wishId: string, patch: Partial<WishInput>, expectedUserId?: string) => Promise<Wish>>(),
  getWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<WishWithList>>(),
  deleteWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  getOccasionScreen: vi.fn<(occasionId: string) => Promise<OccasionScreen>>(),
  fetchPreview: vi.fn<(url: string, options?: LinkPreviewOptions) => Promise<LinkPreview>>(),
  back: vi.fn(),
  navigate: vi.fn(),
  /** false = opened directly (deep link / reload): no history entry to go back to */
  canGoBack: true,
  mascot: [] as string[],
}))

vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  createWish: api.createWish,
  updateWish: api.updateWish,
  getWish: api.getWish,
  deleteWish: api.deleteWish,
}))
vi.mock('../../lib/api/occasions', () => ({ getOccasionScreen: api.getOccasionScreen }))
vi.mock('../../lib/api/linkPreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/linkPreview')>()),
  fetchLinkPreview: api.fetchPreview,
}))
vi.mock('@tanstack/react-router', () => {
  const mocked = {
    Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
    useRouter: () => ({ history: { back: api.back } }),
    useCanGoBack: () => api.canGoBack,
    useNavigate: () => api.navigate,
  }
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { ...mocked, createLink: () => mocked.Link }
})
// The real wrapper loads the SVG package lazily (WAAPI); here a stub records which scenes are asked for.
vi.mock('../mascot-ui/Mascot', async () => {
  const { useEffect, useImperativeHandle } = await import('react')
  function Mascot({ kind, scene, ref, onReady }: { kind: string; scene?: string; ref?: Ref<unknown>; onReady?: () => void }) {
    useImperativeHandle(ref, () => ({ play: (next: string) => { api.mascot.push(`${kind}:play:${next}`); return Promise.resolve() }, tap: () => undefined, instance: { busy: false } }), [kind])
    useEffect(() => {
      if (scene) api.mascot.push(`${kind}:${scene}`)
    }, [kind, scene])
    useEffect(() => { onReady?.() }, [onReady])
    return <div data-testid="mascot" data-kind={kind} />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { LinkPreviewError } from '../../lib/api/linkPreview'
import { EMPTY_WISH_FORM, WishForm, previewDomain, validateWishForm } from './WishForm'
import { EditWishPage, NewWishPage } from './WishEditorPages'
import { isWishDeletePending, resetPendingWishDeletes } from './pendingDeletes'
import { WISH_ADDED_KEY, noteOwnerListLeft, resetOwnerListTrail } from './wishAdded'

const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const WISHLIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
const WISH_ID = '00000000-0000-4000-8000-00000000000a'
/** the account the screen was rendered for (the session watcher reports it in the app) */
const OWNER_ACCOUNT = 'host-profile'

const HEADPHONES: LinkPreview = { url: 'https://www.shop.example/kopfhoerer', site: 'shop.example', title: 'Kabellose Kopfhörer', priceCents: 7999, partial: false }

function savedWish(overrides: Partial<Wish> = {}): Wish {
  return {
    id: WISH_ID,
    wishlist_id: WISHLIST_ID,
    title: 'Kopfhörer',
    price_cents: null,
    currency: 'EUR',
    url: null,
    note: null,
    priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', // (no updated_at: not REST-readable since wave 2b M1)
    ...overrides,
  }
}

/** getWish(): the wish with the list row it belongs to (owner + occasion). */
function wishWithList(ownerId: string, overrides: Partial<Wish> = {}): WishWithList {
  return { ...savedWish(overrides), wishlist: { id: WISHLIST_ID, occasion_id: OCCASION_ID, owner_id: ownerId } }
}

function occasionScreen(role: 'host' | 'member'): OccasionScreen {
  return {
    occasion: {
      id: OCCASION_ID,
      title: 'Milas Geburtstag',
      starts_at: '2026-11-02T00:00:00+00:00',
      tz: 'Europe/Berlin',
      all_day: true,
      place_text: null,
      description: null,
      created_at: '2026-10-01T09:00:00+00:00',
      host: { id: 'host-profile', display_name: 'Mila' },
    },
    viewer: { role, rsvp: 'going' },
    members: [],
    invite: null,
    wishlist: {
      id: WISHLIST_ID,
      owner_id: 'host-profile',
      title: 'Geburtstag',
      wishes: [
        {
          id: WISH_ID,
          title: 'Kopfhörer',
          url: 'https://www.amazon.de/dp/1',
          price_cents: 4999,
          currency: 'EUR',
          note: 'schwarz',
          priority: 3,
          created_at: '2026-10-01T10:00:00+00:00',
          reserved: null,
          reserved_by_me: null,
        },
      ],
    },
  }
}

function withProviders(node: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        {node}
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const linkField = () => screen.getByLabelText('Link zu deinem Wunsch') as HTMLInputElement
const titleField = () => screen.getByLabelText('Titel') as HTMLTextAreaElement
const priceField = () => screen.getByLabelText('Preis') as HTMLInputElement
const noteField = () => screen.getByLabelText('Notiz') as HTMLTextAreaElement
const slider = () => screen.getByRole('slider', { name: 'Wie sehr?' }) as HTMLInputElement

function paste(text: string) {
  fireEvent.paste(linkField(), { clipboardData: { getData: () => text } })
}

function typePrice(text: string) {
  const price = priceField()
  fireEvent.focus(price)
  fireEvent.change(price, { target: { value: text } })
  fireEvent.blur(price)
}

function renderForm(props: Partial<Parameters<typeof WishForm>[0]> = {}) {
  const onSubmit = vi.fn<(input: WishInput) => Promise<void>>().mockResolvedValue(undefined)
  // the spy records the wish input only (the photo decision, the 2nd argument, is covered in WishPhotoFlow.test.tsx)
  const view = withProviders(<WishForm initial={EMPTY_WISH_FORM} submitLabel="Wunsch hinzufügen" onSubmit={(input) => onSubmit(input)} {...props} />)
  return { ...view, onSubmit: props.onSubmit ? (props.onSubmit as typeof onSubmit) : onSubmit }
}

async function submit(label = 'Wunsch hinzufügen') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }))
  })
}

let clipboard: PropertyDescriptor | undefined

beforeEach(() => {
  vi.clearAllMocks()
  api.canGoBack = true
  api.mascot.length = 0
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.sessionStorage.clear()
  toast.clear()
  setRenderedAccount(OWNER_ACCOUNT)
  resetOwnerListTrail()
  clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetPendingWishDeletes()
  toast.clear()
  resetAccountBoundaryForTests()
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
  else delete (navigator as { clipboard?: unknown }).clipboard
})

describe('validateWishForm (same rules as the database)', () => {
  it('needs a title and limits it to 120 characters (code points, trimmed)', () => {
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: '   ' })).toEqual({ ok: false, errors: { title: 'wish.title_required' } })
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'x'.repeat(121) })).toMatchObject({ ok: false, errors: { title: 'wish.title_too_long' } })
    // 120 emoji are 240 UTF-16 units but 120 characters for Postgres length()
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: '🎧'.repeat(120) }).ok).toBe(true)
  })

  it('normalises the link: https:// by default, only http(s), javascript:/data: rejected', () => {
    const ok = validateWishForm({ ...EMPTY_WISH_FORM, title: 'Kopfhörer', url: 'amazon.de/dp/123' })
    expect(ok).toEqual({
      ok: true,
      input: { title: 'Kopfhörer', price_cents: null, currency: 'EUR', url: 'https://amazon.de/dp/123', note: null, priority: 2 },
    })
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/file', 'localhost', `https://shop.example/${'a'.repeat(2048)}`]) {
      expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', url: bad })).toMatchObject({ ok: false, errors: { url: 'wish.url_invalid' } })
    }
    expect(previewDomain('https://www.thalia.de/buch')).toBe('thalia.de')
    expect(previewDomain('javascript:alert(1)')).toBeNull()
  })

  it('keeps the note optional (≤ 500) and the price within 0 … 1 000 000 €', () => {
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', note: '  ' })).toMatchObject({ ok: true, input: { note: null } })
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', note: 'n'.repeat(500) }).ok).toBe(true)
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', note: 'n'.repeat(501) })).toMatchObject({ ok: false, errors: { note: 'wish.note_too_long' } })
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X' }, { priceInvalid: true })).toMatchObject({ ok: false, errors: { price: 'wish.price_invalid' } })
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', priceCents: -1 })).toMatchObject({ ok: false, errors: { price: 'wish.price_invalid' } })
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', priceCents: 0 }).ok).toBe(true)
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', priceCents: 100_000_000 }).ok).toBe(true)
    expect(validateWishForm({ ...EMPTY_WISH_FORM, title: 'X', priceCents: 100_000_001 })).toMatchObject({ ok: false, errors: { price: 'wish.price_invalid' } })
  })
})

describe('WishForm — link first', () => {
  it('opens with one link field, "Einfügen", "Ohne Link hinzufügen" and the steps — no title or price form yet', () => {
    renderForm()
    expect(linkField().placeholder).toBe('Link einfügen')
    expect(screen.getByRole('button', { name: 'Einfügen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ohne Link hinzufügen' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'So geht’s' })).toBeTruthy()
    expect(screen.queryByLabelText('Titel')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Wunsch hinzufügen' })).toBeNull()
    // the old form headings are gone
    expect(screen.queryByText('Was wünschst du dir?')).toBeNull()
    expect(screen.queryByText('Preis (ca.)')).toBeNull()
    // Pompon greets the screen and asks for a link (his bubble is decorative: aria-hidden)
    expect(api.mascot).toEqual(['bunny:play:greet'])
    expect(screen.getByText('Hast du einen Link für mich?').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('"Kaninchen zeigen" off (or animations off): no Pompon and no bubble — the screen works the same', async () => {
    document.documentElement.dataset.bunnies = 'off'
    try {
      api.fetchPreview.mockResolvedValue(HEADPHONES)
      renderForm()
      expect(screen.queryByTestId('mascot')).toBeNull()
      expect(screen.queryByText('Hast du einen Link für mich?')).toBeNull()
      await act(async () => {
        paste('https://www.shop.example/kopfhoerer')
      })
      expect(titleField().value).toBe('Kabellose Kopfhörer')
      expect(api.mascot).toEqual([])
    } finally {
      delete document.documentElement.dataset.bunnies
    }
  })

  it('a pasted link is read at once (Pompon sniffs), the card fills in, the cleaned link is saved', async () => {
    const answer = deferred<LinkPreview>()
    api.fetchPreview.mockReturnValue(answer.promise)
    const { onSubmit } = renderForm()
    paste('Schau mal: https://www.shop.example/kopfhoerer?utm_source=newsletter 😍')

    expect(linkField().value).toBe('https://www.shop.example/kopfhoerer?utm_source=newsletter')
    expect(api.fetchPreview).toHaveBeenCalledTimes(1)
    expect(api.fetchPreview).toHaveBeenCalledWith(
      'https://www.shop.example/kopfhoerer?utm_source=newsletter',
      expect.objectContaining({ expectedUserId: OWNER_ACCOUNT, signal: expect.any(AbortSignal) as AbortSignal }),
    )
    // loading: the shop already, the sniffing line (a live region), no fields; saving waits for the answer
    expect(screen.getByText('Pompon schnuppert am Link …').closest('[role="status"]')).not.toBeNull()
    expect(screen.getByText('shop.example')).toBeTruthy()
    expect(screen.queryByLabelText('Titel')).toBeNull()
    expect((screen.getByRole('button', { name: 'Wunsch hinzufügen' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.mascot).toContain('bunny:play:alert')

    await act(async () => {
      answer.resolve(HEADPHONES)
    })
    expect(titleField().value).toBe('Kabellose Kopfhörer')
    expect(priceField().value).toBe('79,99')
    expect(screen.getByText('Aus dem Link gelesen')).toBeTruthy()
    expect(document.querySelector('[data-shop-tile]')?.textContent).toBe('S')
    expect(linkField().value).toBe('https://www.shop.example/kopfhoerer') // the cleaned link replaced the pasted one
    expect(api.mascot).toContain('bunny:play:jump')

    await submit()
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Kabellose Kopfhörer',
      price_cents: 7999,
      currency: 'EUR',
      url: 'https://www.shop.example/kopfhoerer',
      note: null,
      priority: 2,
      shop_name: 'shop.example', // the shop's name from the answer rides along (2026-10-22)
    })
    // after success the button stays busy (the page navigates away): no double save
    fireEvent.click(screen.getByRole('button', { name: 'Wunsch hinzufügen' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a partial answer (no title): the title field takes the focus with one line why; the price stays', async () => {
    api.fetchPreview.mockResolvedValue({ url: 'https://teekanne.example/teapot', site: 'teekanne.example', title: null, priceCents: 2490, partial: true })
    const { onSubmit } = renderForm()
    await act(async () => {
      paste('https://teekanne.example/teapot')
    })
    expect(document.activeElement).toBe(titleField())
    expect(titleField().value).toBe('')
    expect(screen.getByText('Im Link stand kein Titel – schreib ihn kurz selbst.')).toBeTruthy()
    expect(priceField().value).toBe('24,90')
    fireEvent.change(titleField(), { target: { value: 'Teekanne aus Steingut' } })
    await submit()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Teekanne aus Steingut', price_cents: 2490, url: 'https://teekanne.example/teapot' }))
  })

  it.each<[LinkPreviewErrorCode, string, boolean]>([
    ['invalid_request', 'Diesen Link verstehen wir nicht. Prüf ihn oder trag den Wunsch selbst ein.', false],
    ['unauthorized', 'Melde dich bitte neu an, dann lesen wir Links wieder. Bis dahin: selbst eintragen.', false],
    ['too_large', 'Das sieht nicht nach einer Shop-Seite aus. Trag den Wunsch selbst ein.', false],
    ['unsupported_content', 'Das sieht nicht nach einer Shop-Seite aus. Trag den Wunsch selbst ein.', false],
    ['blocked_target', 'Diesen Link dürfen wir nicht öffnen. Trag den Wunsch selbst ein.', false],
    ['rate_limited', 'Kurz durchatmen – gerade waren es viele Links. Gleich klappt’s wieder.', true],
    ['fetch_failed', 'Der Shop hat nicht geantwortet. Trag den Wunsch einfach selbst ein.', true],
    ['timeout', 'Der Shop war zu langsam. Trag den Wunsch einfach selbst ein.', true],
    ['offline', 'Du bist offline. Trag Titel und Preis einfach selbst ein.', true],
    ['unavailable', 'Die Link-Vorschau ist gerade nicht erreichbar. Trag den Wunsch einfach selbst ein.', true],
  ])('%s: the same card with empty fields and one calm line (retry: %s)', async (code, line, retry) => {
    api.fetchPreview.mockRejectedValue(new LinkPreviewError(code))
    const { onSubmit } = renderForm()
    await act(async () => {
      paste('https://www.shop.example/fail')
    })
    expect(screen.getByText(line)).toBeTruthy()
    expect(document.querySelector('[data-card-state]')?.getAttribute('data-card-state')).toBe('failed')
    expect(titleField().value).toBe('')
    expect(document.activeElement).toBe(titleField())
    // the field that takes the focus is described by the reason (screen readers hear why)
    const described = (titleField().getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toContain(line)
    expect(screen.getByText('Nicht gelesen').closest('[role="status"]')).not.toBeNull()
    const again = screen.queryByRole('button', { name: 'Nochmal' })
    expect(again !== null).toBe(retry)
    if (again) {
      api.fetchPreview.mockResolvedValue(HEADPHONES)
      await act(async () => {
        fireEvent.click(again)
      })
      expect(api.fetchPreview).toHaveBeenCalledTimes(2)
      expect(titleField().value).toBe('Kabellose Kopfhörer')
    } else {
      // the wish can be added by hand right there, the link is kept
      fireEvent.change(titleField(), { target: { value: 'Kuschelsocken' } })
      await submit()
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Kuschelsocken', url: 'https://www.shop.example/fail', price_cents: null }))
    }
  })

  it('anything unexpected from the call is "unavailable" (never a raw error)', async () => {
    api.fetchPreview.mockRejectedValue(new Error('boom'))
    renderForm()
    await act(async () => {
      paste('https://www.shop.example/x')
    })
    expect(screen.getByText('Die Link-Vorschau ist gerade nicht erreichbar. Trag den Wunsch einfach selbst ein.')).toBeTruthy()
    expect(screen.queryByText(/boom/)).toBeNull()
  })

  it('typing: a whole link is read after a short pause, a half-typed host is not; Enter reads at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    api.fetchPreview.mockResolvedValue(HEADPHONES)
    renderForm()
    fireEvent.change(linkField(), { target: { value: 'amazon.d' } })
    act(() => vi.advanceTimersByTime(2000))
    expect(api.fetchPreview).not.toHaveBeenCalled()

    fireEvent.change(linkField(), { target: { value: 'https://www.shop.example/kopfhoerer' } })
    act(() => vi.advanceTimersByTime(699))
    expect(api.fetchPreview).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(api.fetchPreview).toHaveBeenCalledWith('https://www.shop.example/kopfhoerer', expect.anything())
    // a typed read does not steal the focus from the link field
    expect(document.activeElement).not.toBe(screen.queryByLabelText('Titel'))

    fireEvent.change(linkField(), { target: { value: 'teekanne.example' } })
    await act(async () => {
      fireEvent.keyDown(linkField(), { key: 'Enter' })
    })
    expect(api.fetchPreview).toHaveBeenLastCalledWith('https://teekanne.example/', expect.anything())
  })

  it('a new link aborts the request for the old one; the old answer changes nothing', async () => {
    const first = deferred<LinkPreview>()
    const second = deferred<LinkPreview>()
    api.fetchPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    renderForm()
    paste('https://www.shop.example/kopfhoerer')
    const firstSignal = api.fetchPreview.mock.calls[0]?.[1]?.signal
    paste('https://teekanne.example/teapot')
    expect(firstSignal?.aborted).toBe(true)
    await act(async () => {
      first.resolve(HEADPHONES)
    })
    expect(screen.queryByLabelText('Titel')).toBeNull() // still loading the second link
    await act(async () => {
      second.resolve({ url: 'https://teekanne.example/teapot', site: 'teekanne.example', title: 'Teekanne', priceCents: null, partial: false })
    })
    expect(titleField().value).toBe('Teekanne')
    expect(priceField().value).toBe('')
  })

  it('clearing the link drops its answer and keeps what is in the card', async () => {
    api.fetchPreview.mockResolvedValue(HEADPHONES)
    renderForm()
    await act(async () => {
      paste('https://www.shop.example/kopfhoerer')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Link entfernen' }))
    expect(linkField().value).toBe('')
    expect(document.activeElement).toBe(linkField())
    expect(titleField().value).toBe('Kabellose Kopfhörer')
    expect(screen.getByText('Ohne Link')).toBeTruthy()
  })

  it('an answer never overwrites what the person typed; "Link neu einlesen" fills everything again', async () => {
    api.fetchPreview.mockResolvedValue(HEADPHONES)
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    fireEvent.change(titleField(), { target: { value: 'Meine Kopfhörer' } })
    await act(async () => {
      paste('https://www.shop.example/kopfhoerer')
    })
    expect(titleField().value).toBe('Meine Kopfhörer')
    expect(priceField().value).toBe('79,99') // the price field was empty: filled
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link neu einlesen' }))
    })
    expect(api.fetchPreview).toHaveBeenCalledTimes(2)
    expect(titleField().value).toBe('Kabellose Kopfhörer')
  })

  it('"Einfügen" reads the clipboard; without a link or without permission the field takes over with one line', async () => {
    api.fetchPreview.mockResolvedValue(HEADPHONES)
    const readText = vi.fn<() => Promise<string>>()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    renderForm()

    readText.mockResolvedValueOnce('nur ein Text')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Einfügen' }))
    })
    expect(screen.getByText('In der Zwischenablage ist kein Link.')).toBeTruthy()
    expect(document.activeElement).toBe(linkField())

    readText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Einfügen' }))
    })
    expect(screen.getByText('Halte das Feld gedrückt und wähle „Einfügen“.')).toBeTruthy()
    expect(api.fetchPreview).not.toHaveBeenCalled()

    readText.mockResolvedValueOnce('https://www.shop.example/kopfhoerer')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Einfügen' }))
    })
    expect(api.fetchPreview).toHaveBeenCalledWith('https://www.shop.example/kopfhoerer', expect.anything())
    expect(titleField().value).toBe('Kabellose Kopfhörer')
  })

  it('no clipboard API at all: "Einfügen" focuses the field and says how to paste', () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Einfügen' }))
    expect(document.activeElement).toBe(linkField())
    expect(screen.getByText('Halte das Feld gedrückt und wähle „Einfügen“.')).toBeTruthy()
  })

  it('while a link is read, "Selbst eintragen" stops waiting and hands over the title field', async () => {
    const answer = deferred<LinkPreview>()
    api.fetchPreview.mockReturnValue(answer.promise)
    renderForm()
    paste('https://www.shop.example/langsam')
    fireEvent.click(screen.getByRole('button', { name: 'Selbst eintragen' }))
    expect(api.fetchPreview.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(document.activeElement).toBe(titleField())
    await act(async () => {
      answer.resolve(HEADPHONES)
    })
    expect(titleField().value).toBe('') // the dropped answer writes nothing
  })
})

describe('WishForm — manual mode, note, "Wie sehr?", errors', () => {
  it('"Ohne Link hinzufügen" opens the card with the title focused; the payload has no link', async () => {
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    expect(document.activeElement).toBe(titleField())
    expect(screen.getByText('Ohne Link')).toBeTruthy()
    expect(api.fetchPreview).not.toHaveBeenCalled()
    fireEvent.change(titleField(), { target: { value: '  Ein Abend Karaoke  ' } })
    typePrice('1.299,50')
    fireEvent.change(noteField(), { target: { value: 'mit euch allen' } })
    expect(slider().getAttribute('aria-valuetext')).toBe('Gern') // default
    fireEvent.keyDown(slider(), { key: 'ArrowRight' })
    await submit()
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Ein Abend Karaoke',
      price_cents: 129950,
      currency: 'EUR',
      url: null,
      note: 'mit euch allen',
      priority: 3,
    })
  })

  it('shows inline errors and sends nothing while the input is invalid', async () => {
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    await submit()
    expect(screen.getByText('Bitte gib deinem Wunsch einen Titel')).toBeTruthy()
    expect(titleField().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(titleField())

    fireEvent.change(titleField(), { target: { value: 'Kopfhörer' } })
    fireEvent.change(linkField(), { target: { value: 'javascript:alert(1)' } })
    fireEvent.blur(linkField())
    expect(screen.getByText('Das ist kein gültiger Link (http/https)')).toBeTruthy()
    typePrice('abc')
    expect(screen.getByText('Bitte gib einen gültigen Betrag ein')).toBeTruthy()
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(api.fetchPreview).not.toHaveBeenCalled()
  })

  it('commits a price typed right before pressing Enter', async () => {
    const { onSubmit } = renderForm({ variant: 'edit', initial: { ...EMPTY_WISH_FORM, title: 'Buch' }, submitLabel: 'Speichern' })
    const price = priceField()
    price.focus()
    fireEvent.change(price, { target: { value: '9.99' } })
    await act(async () => {
      fireEvent.submit(price.closest('form')!)
    })
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ price_cents: 999 }))
  })

  it('keeps the input and explains the error when the server says no', async () => {
    const onSubmit = vi.fn<(input: WishInput) => Promise<void>>().mockRejectedValue(new AppError('network'))
    renderForm({ variant: 'edit', initial: { ...EMPTY_WISH_FORM, title: 'Buch' }, submitLabel: 'Speichern', onSubmit })
    await submit('Speichern')
    expect(getToasts().some((item) => item.kind === 'error' && item.text === 'Keine Verbindung')).toBe(true)
    expect(titleField().value).toBe('Buch')
    expect(screen.getByRole('button', { name: 'Speichern' }).getAttribute('aria-busy')).toBeNull()
  })

  it('cannot save offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderForm({ variant: 'edit', initial: { ...EMPTY_WISH_FORM, title: 'Buch' }, submitLabel: 'Speichern' })
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Speichern geht nur mit Netz')).toBeTruthy()
  })
})

describe('new / edit wish screens', () => {
  it('an optimistic host screen without a wishlist refetches behind a skeleton, never a false 404', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.occasion(OCCASION_ID), { ...occasionScreen('host'), wishlist: null })
    const pending = deferred<OccasionScreen>()
    api.getOccasionScreen.mockReturnValue(pending.promise)
    withProviders(<NewWishPage occasionId={OCCASION_ID} />, client)
    expect(screen.queryByText('Nicht gefunden oder kein Zugriff')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => pending.resolve(occasionScreen('host')))
    expect(await screen.findByRole('button', { name: 'Ohne Link hinzufügen' })).toBeTruthy()
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(1)
  })
  it('opened from the occasion’s list: creates the wish, leaves the "added" flag and goes back there', async () => {
    api.getOccasionScreen.mockResolvedValue(occasionScreen('host'))
    api.createWish.mockResolvedValue(savedWish({ id: 'f5d2a8e4-1111-4c0d-9e8f-123456789abc' }))
    noteOwnerListLeft(OCCASION_ID) // the owner's list of this occasion was on screen a moment ago
    withProviders(<NewWishPage occasionId={OCCASION_ID} />)
    expect(await screen.findByText('Für „Milas Geburtstag“')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    fireEvent.change(titleField(), { target: { value: 'Kopfhörer' } })
    await submit()
    expect(api.createWish).toHaveBeenCalledWith(WISHLIST_ID, expect.objectContaining({ title: 'Kopfhörer', priority: 2, url: null }), OWNER_ACCOUNT)
    const flag = JSON.parse(window.sessionStorage.getItem(WISH_ADDED_KEY) ?? '{}') as { occasionId?: string; wishId?: string }
    expect(flag).toMatchObject({ occasionId: OCCASION_ID, wishId: 'f5d2a8e4-1111-4c0d-9e8f-123456789abc' })
    expect(api.back).toHaveBeenCalledTimes(1)
    expect(api.navigate).not.toHaveBeenCalled()
  })

  it('opened from the "+" menu (or a link): saving opens the occasion in place of this screen, so the wish is carried in', async () => {
    api.getOccasionScreen.mockResolvedValue(occasionScreen('host'))
    api.createWish.mockResolvedValue(savedWish({ id: 'f5d2a8e4-2222-4c0d-9e8f-123456789abc' }))
    withProviders(<NewWishPage occasionId={OCCASION_ID} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ohne Link hinzufügen' }))
    fireEvent.change(titleField(), { target: { value: 'Buch' } })
    await submit()
    expect(api.navigate).toHaveBeenCalledWith({ to: '/occasions/$occasionId', params: { occasionId: OCCASION_ID }, replace: true })
    expect(api.back).not.toHaveBeenCalled()
    // "Zurück" still goes back where the person came from
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(api.back).toHaveBeenCalledTimes(1)
  })

  it('a guest gets the neutral "not found or no access" answer instead of the form', async () => {
    api.getOccasionScreen.mockResolvedValue(occasionScreen('member'))
    withProviders(<NewWishPage occasionId={OCCASION_ID} />)
    expect(await screen.findByText('Nicht gefunden oder kein Zugriff')).toBeTruthy()
    expect(screen.getByText('Vielleicht wurde der Wunsch gelöscht – oder die Liste gehört jemand anderem.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zum Start' }).getAttribute('href')).toBe('/soon')
    expect(screen.queryByLabelText('Link zu deinem Wunsch')).toBeNull()
    expect(screen.queryByText(/Milas Geburtstag/)).toBeNull()
  })

  it('edits from memory without a request, patches the cached list and goes back', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.occasion(OCCASION_ID), occasionScreen('host'))
    api.updateWish.mockResolvedValue(savedWish({ title: 'Kopfhörer (Over-Ear)', price_cents: 4999, url: 'https://www.amazon.de/dp/1', note: 'schwarz', priority: 1 }))
    withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />, client)

    expect(titleField().value).toBe('Kopfhörer')
    expect(linkField().value).toBe('https://www.amazon.de/dp/1')
    expect(priceField().value).toBe('49,99')
    expect(noteField().value).toBe('schwarz')
    expect(slider().getAttribute('aria-valuetext')).toBe('Unbedingt')
    expect(screen.getByText('Für „Milas Geburtstag“')).toBeTruthy()
    expect(api.getWish).not.toHaveBeenCalled()
    expect(api.fetchPreview).not.toHaveBeenCalled() // the saved link is not read again by itself

    fireEvent.change(titleField(), { target: { value: 'Kopfhörer (Over-Ear)' } })
    fireEvent.keyDown(slider(), { key: 'Home' })
    await submit('Speichern')
    expect(api.updateWish).toHaveBeenCalledWith(WISH_ID, expect.objectContaining({ title: 'Kopfhörer (Over-Ear)', priority: 1, url: 'https://www.amazon.de/dp/1' }), OWNER_ACCOUNT)
    const cached = client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))
    expect(cached?.wishlist?.wishes[0]).toMatchObject({ title: 'Kopfhörer (Over-Ear)', priority: 1, reserved: null, reserved_by_me: null })
    expect(api.back).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Wunsch löschen' })).toBeTruthy()
  })

  it('"Zurück" with an edited note asks "Änderungen verwerfen?" first; "Weiter bearbeiten" keeps the note', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.occasion(OCCASION_ID), occasionScreen('host'))
    withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />, client)
    fireEvent.change(noteField(), { target: { value: 'schwarz, Größe M' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    const dialog = screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })
    expect(api.back).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Weiter bearbeiten' }).at(-1)!)
    expect(noteField().value).toBe('schwarz, Größe M')
    expect(api.back).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })).getByRole('button', { name: 'Verwerfen' }))
    expect(api.back).toHaveBeenCalledTimes(1)
    expect(api.updateWish).not.toHaveBeenCalled()
  })

  it('new wish: "Zurück" on an untouched form goes back at once; with a typed title it asks "Wunsch verwerfen?"', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.occasion(OCCASION_ID), occasionScreen('host'))
    withProviders(<NewWishPage occasionId={OCCASION_ID} />, client)
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(api.back).toHaveBeenCalledTimes(1)
    fireEvent.change(linkField(), { target: { value: 'https://shop.example/thermoskanne' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(screen.getByRole('dialog', { name: 'Wunsch verwerfen?' })).toBeTruthy()
    expect(api.back).toHaveBeenCalledTimes(1)
  })

  it('edit: "Link neu einlesen" reads the saved link on demand and fills the card', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.occasion(OCCASION_ID), occasionScreen('host'))
    api.fetchPreview.mockResolvedValue({ url: 'https://www.amazon.de/dp/1', site: 'amazon.de', title: 'Kopfhörer Over-Ear', priceCents: 5499, partial: false })
    withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />, client)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link neu einlesen' }))
    })
    expect(api.fetchPreview).toHaveBeenCalledWith('https://www.amazon.de/dp/1', expect.objectContaining({ expectedUserId: OWNER_ACCOUNT }))
    expect(titleField().value).toBe('Kopfhörer Over-Ear')
    expect(priceField().value).toBe('54,99')
  })

  it('a guest who has the occasion in memory gets the same page instead of the form', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(qk.occasion(OCCASION_ID), occasionScreen('member'))
    withProviders(<EditWishPage wishId={WISH_ID} userId="guest-profile" />, client)
    expect(await screen.findByText('Nicht gefunden oder kein Zugriff')).toBeTruthy()
    expect(screen.queryByLabelText('Titel')).toBeNull()
    expect(api.getWish).not.toHaveBeenCalled()
  })
})

describe('deep link into the edit form (/wishes/$wishId/edit opened directly)', () => {
  beforeEach(() => {
    api.canGoBack = false // a fresh tab, a bookmark or a reload: nothing to go back to
  })

  const toOccasion = { to: '/occasions/$occasionId', params: { occasionId: OCCASION_ID }, replace: true }

  it('the owner: one request for the wish and its list, delete is offered, saving returns to the occasion', async () => {
    api.getWish.mockResolvedValue(wishWithList(OWNER_ACCOUNT, { title: 'Buch', priority: 3 }))
    api.updateWish.mockResolvedValue(savedWish({ title: 'Buch (gebunden)', priority: 3 }))
    withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />)
    await waitFor(() => expect(titleField().value).toBe('Buch'))
    expect(api.getWish).toHaveBeenCalledTimes(1)
    expect(api.getWish).toHaveBeenCalledWith(WISH_ID, OWNER_ACCOUNT) // pinned to the account of the screen
    expect(slider().getAttribute('aria-valuetext')).toBe('Unbedingt')
    expect(screen.getByRole('button', { name: 'Wunsch löschen' })).toBeTruthy()

    fireEvent.change(titleField(), { target: { value: 'Buch (gebunden)' } })
    await submit('Speichern')
    expect(api.updateWish).toHaveBeenCalledWith(WISH_ID, expect.objectContaining({ title: 'Buch (gebunden)' }), OWNER_ACCOUNT)
    expect(api.navigate).toHaveBeenCalledWith(toOccasion)
    expect(api.back).not.toHaveBeenCalled()
  })

  it('the owner: "Zurück" returns to the occasion, not to the feed', async () => {
    api.getWish.mockResolvedValue(wishWithList(OWNER_ACCOUNT))
    withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />)
    await waitFor(() => expect(titleField().value).toBe('Kopfhörer'))
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(api.navigate).toHaveBeenCalledWith(toOccasion)
  })

  it('the owner: "Wunsch löschen" starts the delete with undo and returns to the occasion', async () => {
    api.getWish.mockResolvedValue(wishWithList(OWNER_ACCOUNT))
    withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Wunsch löschen' }))
    expect(isWishDeletePending(WISH_ID)).toBe(true)
    expect(getToasts().find((item) => item.actionLabel === 'Rückgängig')?.text).toBe('„Kopfhörer“ gelöscht')
    expect(api.navigate).toHaveBeenCalledWith(toOccasion)
    expect(api.deleteWish).not.toHaveBeenCalled() // only after the undo pause
  })

  it("someone else's list and a missing wish get the same friendly page — no form, back to the feed", async () => {
    api.getWish.mockResolvedValue(wishWithList('host-profile-of-someone-else'))
    const notYours = withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />)
    expect(await screen.findByText('Nicht gefunden oder kein Zugriff')).toBeTruthy()
    expect(screen.queryByLabelText('Titel')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Wunsch löschen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(api.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }) // never the refused answer's occasion
    const notYoursText = notYours.container.textContent
    notYours.unmount()

    api.getWish.mockReset()
    api.getWish.mockRejectedValue(new AppError('not_found'))
    const missing = withProviders(<EditWishPage wishId={WISH_ID} userId={OWNER_ACCOUNT} />)
    expect(await screen.findByText('Nicht gefunden oder kein Zugriff')).toBeTruthy()
    expect(missing.container.textContent).toBe(notYoursText)
    expect(api.getWish).toHaveBeenCalledTimes(1) // a final answer: no retry
  })
})
