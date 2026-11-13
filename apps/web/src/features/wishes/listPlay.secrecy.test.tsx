// SECRECY of «Помпон в открытом списке» (31.10; CLAUDE.md "Secrecy of reservations"): the list Pompon only answers the
// owner's own actions on her own list. Proven three ways:
//   1. the sources of his triggers (the app's ListPompon.tsx / listPlay.ts / mascot-ui/pomponPlay.ts and the package's
//      listplay entry) import nothing of reservations and name no reservation field (comments stripped);
//   2. his triggers take only geometry: a tile whose every attribute / data field throws when read still plays;
//   3. the owner's list with LEAKED reservation fields (as if a bug let them through) sends him exactly the same calls
//      and props as without them — the same moments, the same order — and none of them carries wish data at all.
// Fictional data only.
import type { ReactNode, Ref } from 'react'
import { useRef } from 'react'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OccasionScreenWish, OccasionScreenWishlist, Wish } from '../../lib/api/types'
import listPlaySource from './listPlay.ts?raw'
import listPomponSource from './ListPompon.tsx?raw'
import pomponPlaySource from '../mascot-ui/pomponPlay.ts?raw'
// the package's listplay entry (@bunprise/mascot/listplay), every file of it
import pkgIndex from '../../../../../packages/mascot/src/listplay/index.ts?raw'
import pkgRig from '../../../../../packages/mascot/src/listplay/rig.ts?raw'
import pkgMoves from '../../../../../packages/mascot/src/listplay/moves.ts?raw'
import pkgPlayer from '../../../../../packages/mascot/src/listplay/player.ts?raw'
import pkgBox from '../../../../../packages/mascot/src/listplay/box.ts?raw'
import pkgShake from '../../../../../packages/mascot/src/listplay/shake.ts?raw'

const api = vi.hoisted(() => ({
  setWishReceived: vi.fn<(wishId: string, received: boolean, expectedUserId?: string) => Promise<{ received_at: string | null }>>(),
  updateWish: vi.fn<(wishId: string, patch: Record<string, unknown>, expectedUserId?: string) => Promise<Wish>>(),
  deleteWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
}))
vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  setWishReceived: api.setWishReceived,
  updateWish: api.updateWish,
  deleteWish: api.deleteWish,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return <a href={href} className={className} aria-label={(rest as { 'aria-label'?: string })['aria-label']}>{children}</a>
  }
  return { Link, createLink: () => Link }
})
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => () => Promise.resolve() }))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref }: { ref?: Ref<unknown> }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined }), [])
    return <div data-testid="mascot" />
  }
  return { Mascot, preloadMascot: () => undefined }
})

/** What the list Pompon is given: every prop he sees and every call he gets, as plain text. */
const seen = vi.hoisted(() => ({ log: [] as string[], args: [] as unknown[] }))
vi.mock('./ListPompon', async () => {
  const { useImperativeHandle } = await import('react')
  type Props = { mode: string; newWish?: string | null; selecting?: boolean; handle: { current: unknown } }
  function ListPompon(props: Props) {
    seen.log.push(`props mode=${props.mode} newWish=${String(props.newWish ?? null)} selecting=${String(!!props.selecting)}`)
    useImperativeHandle(props.handle, () => {
      const record = (name: string, args: unknown[]) => {
        seen.args.push(...args)
        const tile = args[0] instanceof HTMLElement ? args[0].dataset.wishId : undefined
        seen.log.push(`${name}${tile ? ` ${tile}` : ''}`)
      }
      return {
        busy: false,
        seen: true,
        setStill: () => undefined,
        setPaused: () => undefined,
        setNight: () => undefined,
        wish: (...a: unknown[]) => (record('wish', a), true),
        received: (...a: unknown[]) => (record('received', a), true),
        remove: (...a: unknown[]) => (record('remove', a), true),
        selection: (...a: unknown[]) => record('selection', a),
        pop: (...a: unknown[]) => (record('pop', a), false),
        destroy: () => undefined,
      }
    }, [])
    return null
  }
  return { default: ListPompon }
})

import { OwnerWishlist } from './OwnerWishlist'
import { createListPompon } from './listPlay'
import { resetPendingWishDeletes } from './pendingDeletes'
import '../mascot-ui/test-shims'

/** Code without comments (they may explain the rule). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('the list Pompon’s triggers never read reservation data', () => {
  it('his sources import nothing of reservations and name no reservation field', () => {
    const sources: Record<string, string> = {
      'ListPompon.tsx': listPomponSource,
      'listPlay.ts': listPlaySource,
      'mascot-ui/pomponPlay.ts': pomponPlaySource,
      'listplay index.ts': pkgIndex,
      'listplay rig.ts': pkgRig,
      'listplay moves.ts': pkgMoves,
      'listplay player.ts': pkgPlayer,
      'listplay box.ts': pkgBox,
      'listplay shake.ts': pkgShake,
    }
    for (const [name, source] of Object.entries(sources)) {
      expect(source.length, name).toBeGreaterThan(200)
      const body = code(source)
      expect(body, name).not.toMatch(/api\/reservations|lib\/queries|myReservations/)
      expect(body, name).not.toMatch(/reserv/i)
      expect(body, name).not.toMatch(/lib\/api\//)
    }
  })

  it('his triggers take only geometry: a tile whose attributes and data throw when read still plays', async () => {
    vi.useFakeTimers()
    try {
      const layer = document.createElement('div')
      const block = document.createElement('div')
      const row = document.createElement('div')
      block.append(row)
      layer.append(block)
      const tile = document.createElement('li')
      const media = document.createElement('span')
      media.className = 'wt-media'
      tile.append(media)
      layer.append(tile)
      document.body.append(layer)
      const trap = (el: Element) => {
        for (const key of ['getAttribute', 'getAttributeNames', 'hasAttribute', 'getAttributeNode']) {
          Object.defineProperty(el, key, { value: () => { throw new Error(`read ${key}`) } })
        }
        Object.defineProperty(el, 'dataset', { get: () => { throw new Error('read dataset') } })
        Object.defineProperty(el, 'attributes', { get: () => { throw new Error('read attributes') } })
      }
      trap(tile)
      trap(media)
      const rects = new Map<Element, DOMRect>([
        [layer, new DOMRect(0, 0, 390, 1400)],
        [block, new DOMRect(16, 70, 358, 160)],
        [row, new DOMRect(16, 70, 200, 56)],
        [tile, new DOMRect(16, 300, 171, 230)],
        [media, new DOMRect(22, 306, 159, 159)],
      ])
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return rects.get(this) ?? new DOMRect(300, 120, 52, 58)
      })
      const played: string[] = []
      const p = createListPompon({ mode: 'list', layer, seatRow: () => row, scroller: window, still: false, endText: '…', insets: () => ({ top: 60, bottom: 80 }), onMoment: (n) => played.push(n) })
      expect(p.wish(tile)).toBe(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(p.received(tile, { onStamp: () => undefined, onBack: () => undefined })).toBe(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(p.remove(tile.getBoundingClientRect())).toBe(true)
      expect(played).toEqual(['wish', 'received', 'delete'])
      p.destroy()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
      document.body.replaceChildren()
    }
  })
})

describe('the owner’s list with leaked reservation fields: exactly the same Pompon', () => {
  beforeAll(async () => {
    // the sheets and the leaving tiles finish at once (the app's motion level 'off' does the same)
    MotionGlobalConfig.instantAnimations = true
    // warm the menu's lazy picker (it would load after the test otherwise)
    await import('../lists/MoveWishSheet')
  })
  afterEach(() => {
    seen.log = []
    seen.args = []
    resetPendingWishDeletes()
  })

  const ME = '00000000-0000-4000-8000-0000000000aa'
  const LIST = '11111111-1111-4111-8111-111111111111'
  const wish = (id: string, title: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish => ({
    id, title, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved: null, reserved_by_me: null, photo: null, received_at: null, ...overrides,
  })
  const A = '00000000-0000-4000-8000-00000000000a'
  const B = '00000000-0000-4000-8000-00000000000b'

  function Screen({ wishlist }: { wishlist: OccasionScreenWishlist }) {
    const layer = useRef<HTMLDivElement>(null)
    const seat = useRef<HTMLDivElement>(null)
    return (
      <div ref={layer}>
        <div ref={seat} />
        <OwnerWishlist wishlist={wishlist} pompon={{ layer, seatRow: seat }} standalone={{ listId: LIST, hint: null, emptyText: 'Noch leer.' }} />
      </div>
    )
  }

  async function capture(wishes: OccasionScreenWish[]): Promise<string[]> {
    // (a delete of the run before is still waiting for its "Rückgängig")
    resetPendingWishDeletes()
    api.setWishReceived.mockResolvedValue({ received_at: '2026-10-31T10:00:00Z' })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const view = render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <Screen wishlist={{ id: LIST, owner_id: ME, title: 'Meine Wünsche', wishes, received: [], photo: null }} />
        </LazyMotion>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(seen.log.some((l) => l.startsWith('props'))).toBe(true))
    // «Erhalten» from the ⋯ of the first wish, then «Löschen» of the second one
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Kopfhörer' })).getByRole('button', { name: 'Als erhalten markieren' }))
    // (the menu's sheet slides out first)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kopfhörer' })).toBeNull(), { timeout: 3000 })
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr zu „Buch“' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Buch' })).getByRole('button', { name: /löschen/i }))
    await act(async () => {
      await Promise.resolve()
    })
    view.unmount()
    // what he got: only DOM elements, boxes (numbers) and callbacks — never a wish, never a text or a field of one
    for (const arg of seen.args) {
      const ok = arg instanceof HTMLElement || typeof arg === 'function' || (typeof arg === 'object' && arg !== null && Object.values(arg).every((v) => typeof v === 'function' || typeof v === 'number'))
      expect(ok, String(arg)).toBe(true)
    }
    return seen.log.splice(0)
  }

  it('the same calls and props in the same order — whatever the reservation fields say', async () => {
    const plain = [wish(A, 'Kopfhörer', { priority: 3 }), wish(B, 'Buch')]
    const leaked = plain.map((w, i) => ({ ...w, reserved: true, reserved_by_me: i === 0 }))
    const clean = await capture(plain)
    seen.args = []
    const dirty = await capture(leaked)
    expect(dirty).toEqual(clean)
    expect(clean).toContain(`received ${A}`)
    expect(clean).toContain('remove')
    expect(clean.every((line) => !/reserv/i.test(line))).toBe(true)
  })
})
