import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import i18next from 'i18next'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The topic screen in Russian and Ukrainian (Felix 30.10: "So wird gespielt" was German for everyone): the request
// carries the UI language, the sheet shows the rules in it (marked with its lang), a language switch asks again
// (the language is part of the query key) and a text the Worker had to send in English says so.
// The test setup bundles German only; this file adds the Russian and Ukrainian gifts texts.

const account = vi.hoisted(() => ({ session: { user: { id: 'account-me' }, access_token: 'fixture-token' } }))
vi.mock('../../../lib/supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))
vi.mock('../../../motion/MotionScope', () => ({ MotionScope: ({ children }: { children: React.ReactNode }) => children }))

import { answerCatalog, CATALOG, type CatalogLang } from '../../../../../../workers/edge/src/giftIdeas/catalog'
import { resetAccountBoundaryForTests } from '../../../lib/accountBoundary'
import { toast } from '../../../lib/toast'
import { resetGiftStorageForTests } from '../storage'
import { TopicPage } from './TopicPage'

const USER = 'account-me'
const CARCASSONNE = CATALOG.find((entry) => entry.id === 'cat:hig-carcassonne')
const fetchMock = vi.fn<typeof fetch>()
/** tests: the Worker had no text in the asked language and sent English */
let englishRules = false

const bundles = import.meta.glob<{ default: Record<string, unknown> }>('../../../locales/{ru,uk}/*.json', { eager: true })

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderTopic(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const root = createRootRoute({ component: () => <Outlet /> })
  const gifts = createRoute({ getParentRoute: () => root, path: '/gifts', component: () => <main>gifts</main> })
  const page = createRoute({ getParentRoute: () => root, path: '/gifts/topic/$topic', component: () => <TopicPage userId={USER} topic="brettspiele" /> })
  const router = createRouter({ routeTree: root.addChildren([gifts, page]), history: createMemoryHistory({ initialEntries: ['/gifts/topic/brettspiele'] }) })
  return render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

const sentLangs = () => fetchMock.mock.calls.map((call) => (JSON.parse(String(call[1]?.body)) as { lang: string }).lang)

async function openCarcassonne(): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector('[data-idea="cat:hig-carcassonne"]')).not.toBeNull())
  const card = document.querySelector('[data-idea="cat:hig-carcassonne"]') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: /^Carcassonne,/ }))
  return screen.findByRole('dialog', { name: 'Carcassonne' })
}

beforeAll(() => {
  MotionGlobalConfig.instantAnimations = true
  for (const [path, mod] of Object.entries(bundles)) {
    const [lang, file] = path.split('/').slice(-2)
    i18next.addResourceBundle(lang ?? '', file?.replace('.json', '') ?? '', mod.default, true, true)
  }
})
afterAll(async () => {
  MotionGlobalConfig.instantAnimations = false
  await i18next.changeLanguage('de')
})

beforeEach(() => {
  window.localStorage.clear()
  englishRules = false
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.origin !== window.location.origin || url.pathname !== '/api/gift-ideas') throw new Error(`unexpected request ${url.href}`)
    const body = JSON.parse(String(init?.body)) as { topic?: string; lang: CatalogLang }
    const answer = answerCatalog({ interests: [], budget: { min_cents: 0, max_cents: 100_000_000 }, exclude_ids: [], lang: body.lang, ...(body.topic ? { topic: body.topic } : {}) })
    if (englishRules) {
      for (const item of answer.items) if (item.id === 'cat:hig-carcassonne') Object.assign(item, { how_to_play: CARCASSONNE?.how_to_play?.en, how_to_play_lang: 'en' })
    }
    return json(answer)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  act(() => {
    resetGiftStorageForTests()
    toast.clear()
  })
  resetAccountBoundaryForTests()
})

describe('the topic screen in the UI language', () => {
  it('Russian: the request says "ru"; the sheet shows the Russian rules, marked lang="ru", without a "German" note', async () => {
    await act(() => i18next.changeLanguage('ru'))
    renderTopic()
    const sheet = await openCarcassonne()
    expect(sentLangs()).toEqual(['ru'])
    expect(within(sheet).getByRole('heading', { name: 'Как играть' })).toBeTruthy()
    const rules = within(sheet).getByText(CARCASSONNE?.how_to_play?.ru ?? '-')
    expect(rules.getAttribute('lang')).toBe('ru')
    expect(within(sheet).getByText(CARCASSONNE?.blurb?.ru ?? '-').getAttribute('lang')).toBe('ru')
    expect(within(sheet).queryByText('Правила кратко — на немецком')).toBeNull()
    expect(within(sheet).queryByText('Правила кратко — на английском')).toBeNull()
    expect(within(sheet).queryByText(CARCASSONNE?.how_to_play?.de ?? '-')).toBeNull()
    // an open-ended box (Jenga, Hasbro "1+"): "от 1" in the card's facts line, through i18n
    const jenga = document.querySelector('[data-idea="cat:hasbro-jenga"]') as HTMLElement
    expect(within(jenga).getByText('от 1 · 20–30 мин · от 6')).toBeTruthy()
  }, 20_000)

  it('a switch to Ukrainian asks again (the language is in the query key): no Russian answer is shown in Ukrainian', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(() => i18next.changeLanguage('ru'))
    renderTopic(queryClient)
    await openCarcassonne()
    cleanup()
    await act(() => i18next.changeLanguage('uk'))
    renderTopic(queryClient)
    const sheet = await openCarcassonne()
    expect(sentLangs()).toEqual(['ru', 'uk'])
    expect(within(sheet).getByRole('heading', { name: 'Як грати' })).toBeTruthy()
    expect(within(sheet).getByText(CARCASSONNE?.how_to_play?.uk ?? '-').getAttribute('lang')).toBe('uk')
    expect(within(sheet).queryByText(CARCASSONNE?.how_to_play?.ru ?? '-')).toBeNull()
  }, 20_000)

  it('a text the Worker had to send in English (a fallback) is marked lang="en" and says so in the UI language', async () => {
    englishRules = true
    await act(() => i18next.changeLanguage('uk'))
    renderTopic()
    const sheet = await openCarcassonne()
    expect(within(sheet).getByText(CARCASSONNE?.how_to_play?.en ?? '-').getAttribute('lang')).toBe('en')
    expect(within(sheet).getByText('Правила коротко — англійською')).toBeTruthy()
  }, 20_000)
})
