import { describe, expect, it } from 'vitest'
import ownerList from './OwnerWishlist.tsx?raw'
import wishGrid from './WishGrid.tsx?raw'
import wishMenu from './WishMenu.tsx?raw'
import moveWishSheet from '../lists/MoveWishSheet.tsx?raw'
import bringFromListsSheet from '../lists/BringFromListsSheet.tsx?raw'
import editorPages from './WishEditorPages.tsx?raw'
import wishForm from './WishForm.tsx?raw'
import wishCard from './WishCard.tsx?raw'
import linkPill from './LinkPill.tsx?raw'
import wishOMeter from './WishOMeter.tsx?raw'
import shopTile from './ShopTile.tsx?raw'
import bunnyPeek from './BunnyPeek.tsx?raw'
import icons from './icons.tsx?raw'
import linkInput from './linkInput.ts?raw'
import priceText from './priceText.ts?raw'
import useLinkPreview from './useLinkPreview.ts?raw'
import linkPreviewApi from '../../lib/api/linkPreview.ts?raw'
import pendingDeletes from './pendingDeletes.ts?raw'
import wishCache from './wishCache.ts?raw'
import wishAdded from './wishAdded.ts?raw'
import wishOrder from './wishOrder.ts?raw'
import wishDetails from './WishDetails.tsx?raw'
import wishDetailFields from './WishDetailFields.tsx?raw'
import wishPhoto from './WishPhoto.tsx?raw'
import wishPhotos from './wishPhotos.ts?raw'
import useLinkPhoto from './useLinkPhoto.ts?raw'
import compareLinks from './compareLinks.ts?raw'
import linkImageApi from '../../lib/api/linkImage.ts?raw'
import wishPhotosApi from '../../lib/api/wishPhotos.ts?raw'
import objectUrl from '../../lib/objectUrl.ts?raw'
import shopIconApi from '../../lib/api/shopIcon.ts?raw'
import inView from './inView.ts?raw'
// 2026-10-25: the bring-along list "Mitbringen" — the host sees it, so it is owner side (design §2.7 item 6)
import potluckSection from '../potluck/PotluckSection.tsx?raw'
import potluckSheet from '../potluck/PotluckSheet.tsx?raw'
import potluckActions from '../potluck/actions.ts?raw'
import potluckCache from '../potluck/cache.ts?raw'
import potluckFlag from '../potluck/flag.ts?raw'
import potluckApi from '../../lib/api/potluck.ts?raw'
import sectionsField from '../occasions/form/SectionsField.tsx?raw'
// 2026-10-26: "Gleich mit eintragen" — my own wishes and bring-along entries added in the new-occasion form
import quickExtras from '../occasions/extras/QuickExtras.tsx?raw'
import extrasModel from '../occasions/extras/model.ts?raw'
import extrasPending from '../occasions/extras/pending.ts?raw'
import extrasReadLink from '../occasions/extras/readLink.ts?raw'
import extrasSend from '../occasions/extras/send.ts?raw'
// 2026-10-27: one wish in several lists (20261027200000) — the owner's hint line, RPCs and the reminder after an occasion
import wishPlaces from './wishPlaces.ts?raw'
import wishPlacesApi from '../../lib/api/wishPlaces.ts?raw'
import receivedPromptSheet from './ReceivedPromptSheet.tsx?raw'
// 2026-10-30: "Anzahl" + "Passt zusammen" — the owner's stepper, her link picker and the owner-only API module
import quantityStepper from './QuantityStepper.tsx?raw'
import togetherPickerSheet from './TogetherPickerSheet.tsx?raw'
import wishExtrasApi from '../../lib/api/wishExtras.ts?raw'

// Static guard for the owner side (CLAUDE.md "Secrecy of reservations", docs/contract.md §9):
// the modules the owner's screens are built from never import the reservation API, never use
// myReservationsQuery / reserve.* strings and never touch the reserved* fields. Comments are
// stripped first (they are allowed to explain the rule). Wave 1 added the link-first wish screen
// (card, link capsule, wish-o-meter, shop tile, Pompon, the link-preview client): the same rule.

/** Like code(), but a `//` right after a colon (https://…) is not taken for a comment: URLs stay visible. */
function codeWithUrls(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const OWNER_SIDE = {
  ownerList,
  // 2026-10-22 (lists wave 2): the square tiles shared by both views, the owner's ⋯ menu and its move picker
  wishGrid,
  wishMenu,
  moveWishSheet,
  // 2026-10-25: "Aus meinen Listen holen" — my own list's wishes into the occasion's list
  bringFromListsSheet,
  editorPages,
  wishForm,
  wishCard,
  linkPill,
  wishOMeter,
  shopTile,
  bunnyPeek,
  icons,
  linkInput,
  priceText,
  useLinkPreview,
  linkPreviewApi,
  pendingDeletes,
  wishCache,
  wishAdded,
  wishOrder,
  // 2026-10-22: the details sheet, the product photo, the search links
  wishDetails,
  wishDetailFields,
  wishPhoto,
  wishPhotos,
  useLinkPhoto,
  compareLinks,
  linkImageApi,
  wishPhotosApi,
  objectUrl,
  // 2026-10-23: the shops' real icons through our Worker
  shopIconApi,
  inView,
  // 2026-10-25: the bring-along list (its own table; nothing of the secret part, not even the words)
  potluckSection,
  potluckSheet,
  potluckActions,
  potluckCache,
  potluckFlag,
  potluckApi,
  sectionsField,
  quickExtras,
  extrasModel,
  extrasPending,
  extrasReadLink,
  extrasSend,
  wishPlaces,
  wishPlacesApi,
  receivedPromptSheet,
  quantityStepper,
  togetherPickerSheet,
  wishExtrasApi,
}

describe('owner-side wish modules', () => {
  for (const [name, source] of Object.entries(OWNER_SIDE)) {
    it(`${name}: no reservation API, query, strings or fields`, () => {
      const body = code(source)
      expect(body).not.toMatch(/api\/reservations|lib\/queries|myReservations/)
      expect(body).not.toMatch(/reserv/i)
    })
  }

  it('the wish screens load nothing from shops: no <img>, no favicon services, no third-party origin', () => {
    for (const [name, source] of Object.entries({ wishGrid, wishMenu, moveWishSheet, bringFromListsSheet, receivedPromptSheet, wishForm, wishCard, linkPill, linkPreviewApi, wishDetails, wishDetailFields, wishPhotos, useLinkPhoto, linkImageApi, wishPhotosApi, shopIconApi, inView })) {
      const body = codeWithUrls(source)
      expect(body, name).not.toMatch(/<img\b|favicon|new Image\(|https?:\/\/(?!localhost)[a-z0-9.-]+\.[a-z]{2,}/i)
    }
  })

  it('the shop tile’s only <img> shows OUR bytes: an object URL of the Blob our Worker sent, never an address', () => {
    const body = codeWithUrls(shopTile)
    expect(body).not.toMatch(/favicon|new Image\(|https?:\/\/|srcSet|backgroundImage/i)
    expect(body).not.toMatch(/\burl\(/) // no CSS url(…) either
    // one <img>, and its src is the `url` prop …
    const sources = [...body.matchAll(/<img\b[^>]*?\ssrc=\{([^}]*)\}/g)].map((match) => match[1])
    expect(sources).toEqual(['url'])
    // … which is always the result of useShopIconUrl …
    const assignments = [...body.matchAll(/const url = ([^\n]+)/g)].map((match) => match[1])
    expect(assignments).toEqual(['useShopIconUrl(host, ref)'])
    expect(body).toMatch(/<ShopIconImage key=\{url\} url=\{url\}/)
    // … = an object URL (lib/objectUrl.ts) of the Blob of the shopIcon query, nothing else
    expect(body).toMatch(/return useObjectUrl\(query\.data \?\? null\)/)
    expect(body).toMatch(/useQuery\(\{ \.\.\.shopIconQuery\(key \?\? ''\)/)
    // the query's bytes come from our own origin's /api/shop-icon only (no shop address, no cookies, no referrer),
    // and only raster types become a Blob (never SVG: a blob: SVG could run script if opened in a tab)
    const api = codeWithUrls(shopIconApi)
    expect(api).toMatch(/export const SHOP_ICON_PATH = '\/api\/shop-icon'/)
    expect([...api.matchAll(/\bfetch\(([^,)]*)/g)].map((match) => match[1])).toEqual(['url'])
    expect(api).toMatch(/const url = new URL\(SHOP_ICON_PATH, window\.location\.origin\)/)
    expect(api).toMatch(/credentials: 'omit'/)
    expect(api).toMatch(/referrerPolicy: 'no-referrer'/)
    expect(api).toMatch(/queryFn: \(\) => queued\(\(\) => getShopIcon\(host\)\)/)
    expect(api).not.toMatch(/svg/i)
  })

  it('the quick wishes of the new-occasion form show only OUR bytes: the prepared photo as an object URL, no address', () => {
    const body = codeWithUrls(quickExtras)
    expect(body).not.toMatch(/favicon|new Image\(|https?:\/\/|srcSet|backgroundImage/i)
    const sources = [...body.matchAll(/<img\b[^>]*?\ssrc=\{([^}]*)\}/g)].map((match) => match[1])
    expect(sources).toEqual(['url'])
    const assignments = [...body.matchAll(/const url = ([^\n]+)/g)].map((match) => match[1])
    expect(assignments).toEqual(['useObjectUrl(blob)'])
    // the link is read only through our Worker (extras/readLink.ts → lib/api/linkPreview + linkImage)
    expect(codeWithUrls(extrasReadLink)).not.toMatch(/\bfetch\(|https?:\/\//)
  })

  it('the only <img> of the wish screens shows OUR bytes: an object URL of a Blob, never an address', () => {
    const body = codeWithUrls(wishPhoto)
    expect(body).not.toMatch(/favicon|new Image\(|https?:\/\//i)
    const sources = [...body.matchAll(/<img\b[^>]*?\ssrc=\{([^}]*)\}/g)].map((match) => match[1])
    expect(sources).toEqual(['url'])
    // every url handed to that <img> comes from useObjectUrl (lib/objectUrl.ts)
    const assignments = [...body.matchAll(/const url = ([^\n]+)/g)].map((match) => match[1])
    expect(assignments.length).toBeGreaterThan(0)
    for (const assignment of assignments) expect(assignment).toMatch(/^useObjectUrl\(/)
    expect(body).toMatch(/<FadeImage url=\{url\}/)
  })

  it('“Woanders finden” only links out to the four named search pages (no request, no tracking parameter)', () => {
    const body = codeWithUrls(compareLinks)
    const hosts = [...body.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1])
    expect(hosts).toEqual(['www.idealo.de', 'www.google.de', 'www.amazon.de', 'www.ebay.de'])
    expect(body).not.toMatch(/fetch\(|tag=|affiliate|utm_/i)
  })
})
