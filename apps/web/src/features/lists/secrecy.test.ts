import { describe, expect, it } from 'vitest'
import listsPage from './ListsPage.tsx?raw'
import listsHeader from './ListsHeader.tsx?raw'
import bannerSheet from './BannerSheet.tsx?raw'
import myListsGrid from './MyListsGrid.tsx?raw'
import ownerListCard from './OwnerListCard.tsx?raw'
import createListSheet from './CreateListSheet.tsx?raw'
import ownerListScreen from './OwnerListScreen.tsx?raw'
import visibilitySheet from './VisibilitySheet.tsx?raw'
import listScreenPage from './ListScreenPage.tsx?raw'
import listNewWishPage from './ListNewWishPage.tsx?raw'
import friendsSection from './FriendsSection.tsx?raw'
import parts from './parts.tsx?raw'
import queries from './queries.ts?raw'
import createFlow from './createFlow.ts?raw'
import pendingListDeletes from './pendingListDeletes.ts?raw'
import covers from './covers.tsx?raw'
import banners from './banners.tsx?raw'
import dates from './dates.ts?raw'
import templates from './templates.ts?raw'
import flag from './flag.ts?raw'
import links from './links.ts?raw'
import findGift from './findGift.ts?raw'
import sticky from './sticky.ts?raw'
import listsApi from '../../lib/api/lists.ts?raw'
import followerListScreen from './FollowerListScreen.tsx?raw'
import giftPlans from './GiftPlans.tsx?raw'
// lists wave 2 (Felix 22.10): the tab's view, the cards' wish picture, the ⋯ menu + share sheet, the cover photo
import tabView from './tabView.ts?raw'
import countStack from './CountStack.tsx?raw'
import listMenu from './ListMenu.tsx?raw'
import listShareSheet from './ListShareSheet.tsx?raw'
import listCover from './ListCover.tsx?raw'
import listCovers from './listCovers.ts?raw'
import previews from './previews.ts?raw'
import listTransition from './listTransition.ts?raw'
import moveWishSheet from './MoveWishSheet.tsx?raw'
import listsDe from '../../locales/de/lists.json'
import listsEn from '../../locales/en/lists.json'
import listsRu from '../../locales/ru/lists.json'
import listsUk from '../../locales/uk/lists.json'

// Static guard of the lists feature (CLAUDE.md "Secrecy of reservations", follows-design W01/W02): the modules
// the OWNER's screens are built from — the tab header, "Meine", the cards, the sheets, the owner's list screen,
// the data layer — never import the reservation API or lib/queries (myReservationsQuery) and never say a word
// about reservations; "Freunde" shows others' lists without any own reservation on them. Reservation UI lives
// only in the guest modules (FollowerListScreen → GuestWishlist, GiftPlans). Comments may explain the rule.

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const OWNER_SIDE = {
  listsPage, listsHeader, bannerSheet, myListsGrid, ownerListCard, createListSheet, ownerListScreen, visibilitySheet,
  listScreenPage, listNewWishPage, friendsSection, parts, queries, createFlow, pendingListDeletes, covers, banners, dates,
  templates, flag, links, findGift, sticky, listsApi,
  tabView, countStack, listMenu, listShareSheet, listCover, listCovers, previews, listTransition, moveWishSheet,
}

/** Every module of the feature (not the tests), for the picture rule below. */
const FEATURE_MODULES = import.meta.glob<string>(['./*.ts', './*.tsx', '!./*.test.ts', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })

/** Like code(), but a `//` right after a colon (https://…) is not taken for a comment: URLs stay visible. */
function codeWithUrls(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

type Tree = { [key: string]: string | Tree }

function strings(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) => (typeof value === 'string' ? [value] : strings(value)))
}

describe('lists: owner-side modules', () => {
  for (const [name, source] of Object.entries(OWNER_SIDE)) {
    it(`${name}: no reservation API, query, strings or fields`, () => {
      const body = code(source)
      expect(body).not.toMatch(/api\/reservations|lib\/queries|myReservations|listGuest\./)
      expect(body).not.toMatch(/reserv/i)
    })
  }

  it('the guest modules are the only ones with reservation UI (and they are separate lazy chunks)', () => {
    expect(code(followerListScreen)).toMatch(/GuestWishlist/)
    expect(code(giftPlans)).toMatch(/myReservationsQuery/)
    expect(code(listScreenPage)).toMatch(/lazy\(\(\) => import\('\.\/FollowerListScreen'\)\)/)
    expect(code(friendsSection)).toMatch(/lazy\(\(\) => import\('\.\/GiftPlans'\)\)/)
  })

  it('the only <img> of the feature is the list cover, and it shows OUR bytes: an object URL of a Blob, never an address', () => {
    const withImg = Object.entries(FEATURE_MODULES).filter(([, source]) => /<img\b/.test(codeWithUrls(source))).map(([path]) => path)
    expect(withImg).toEqual(['./ListCover.tsx'])
    const body = codeWithUrls(listCover)
    expect(body).not.toMatch(/favicon|new Image\(|https?:\/\//i)
    const sources = [...body.matchAll(/<img\b[^>]*?\ssrc=\{([^}]*)\}/g)].map((match) => match[1])
    expect(sources).toEqual(['url'])
    // every url handed to that <img> comes from useObjectUrl (lib/objectUrl.ts)
    const assignments = [...body.matchAll(/const url = ([^\n]+)/g)].map((match) => match[1])
    expect(assignments.length).toBeGreaterThan(0)
    for (const assignment of assignments) expect(assignment).toMatch(/^useObjectUrl\(/)
    // and the bytes come from our database only (getListPhoto) or the photo just prepared on this device
    expect(codeWithUrls(listCovers)).toMatch(/getListPhoto\(listId, userId\)/)
  })

  it('the round wish dots show a shop’s icon only through the wishes’ ShopIcon (our Worker’s bytes), no address', () => {
    const body = codeWithUrls(countStack)
    expect(body).toMatch(/import \{ ShopIcon \} from '\.\.\/wishes\/ShopTile'/)
    expect(body).toMatch(/<ShopIcon host=\{wish\.host\} \/>/)
    expect(body).not.toMatch(/<img\b|https?:\/\/|favicon|new Image\(/i)
  })
})

/** "reserv…" (DE / EN) and "брон…" (RU: бронь, забронировать; UK: бронь, забронювати) */
const RESERVATION_WORD = /reserv|брон/i

describe('lists: locale keys', () => {
  it('the owner / viewer group "lists" has no word about reservations (DE, EN, RU and UK); only "listGuest" may', () => {
    for (const locale of [listsDe, listsEn, listsRu, listsUk] as Tree[]) {
      const lists = locale.lists as Tree
      const guest = locale.listGuest as Tree
      for (const text of strings(lists)) expect(text).not.toMatch(RESERVATION_WORD)
      expect(strings(guest).some((text) => RESERVATION_WORD.test(text))).toBe(true)
    }
  })

  it('the warnings before narrowing are static sentences: the same for every list, no counts, no names', () => {
    type Warnings = { lists: { visibility: { warning: string; confirm: string }; delete: { message_followers: string } } }
    const de = listsDe as unknown as Warnings
    const ru = listsRu as unknown as Warnings
    const uk = listsUk as unknown as Warnings
    for (const text of [de, ru, uk].flatMap((locale) => [locale.lists.visibility.warning, locale.lists.delete.message_followers, locale.lists.visibility.confirm])) {
      expect(text).not.toMatch(/\{\{|\d/)
      expect(text).not.toMatch(RESERVATION_WORD)
    }
    expect(de.lists.visibility.warning).toContain('Was deine Follower hier heimlich geplant haben, wird dabei aufgehoben – ob es so etwas gibt, erfährst du nie.')
    expect(de.lists.visibility.confirm).toBe('Nur für mich sichtbar machen')
    // the Russian promise says the same: whatever was planned in secret ends — and whether there was anything, never
    expect(ru.lists.visibility.warning).toContain('Всё, что подписчики здесь тайно запланировали, при этом отменится — было ли что-то такое, ты никогда не узнаешь.')
    expect(uk.lists.visibility.warning).toContain('Усе, що підписники тут таємно запланували, при цьому скасується — чи було щось таке, ти ніколи не дізнаєшся.')
  })
})
