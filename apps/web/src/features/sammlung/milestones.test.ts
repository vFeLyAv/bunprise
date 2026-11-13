import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COSTUME_IDS } from '@bunprise/mascot/wardrobe-rules'
import { setRenderedAccount } from '../../lib/accountBoundary'
import { sammlungKey } from './key'
import { earnedCostumes, earnedMilestones, isNotedMilestone, knightFinds, MILESTONE_IDS, MILESTONES, type MilestoneId } from './milestones'
import { noteMilestone } from './note'
import { SCENE_IDS, type SceneId } from './scenes'
import { costumesOf, demoUnlockAll, markCostumesSeen, newCostumes, noteMilestoneOf, noteScene, readSammlung, setWear } from './store'
import { outfitToday } from './wear'
import milestonesSource from './milestones.ts?raw'
import noteSource from './note.ts?raw'
import storeSource from './store.ts?raw'

// The costumes of «Pompons Sammlung» (31.10): each one is the reward for ONE of the person's own milestones
// (./milestones.ts). Secrecy (CLAUDE.md): nothing here may depend on reservations, on other people or on their lists.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  window.localStorage.clear()
  setRenderedAccount(A)
})
afterEach(() => {
  setRenderedAccount(undefined)
  window.localStorage.clear()
})

const NOTED = MILESTONE_IDS.filter(isNotedMilestone)

describe('the milestones (milestones.ts)', () => {
  it('thirteen milestones, thirteen costumes: each approved costume exactly once, the laptop for the first wish, spa for a wish photo', () => {
    expect(MILESTONES).toHaveLength(13)
    expect(MILESTONES.map((m) => m.id)).toEqual([...MILESTONE_IDS])
    expect(MILESTONES.map((m) => m.costume).sort()).toEqual([...COSTUME_IDS].sort())
    expect(MILESTONES.find((m) => m.id === 'wish')?.costume).toBe('laptop')
    expect(MILESTONES.find((m) => m.id === 'wishphoto')?.costume).toBe('spa')
    expect(MILESTONES.filter((m) => m.derived).map((m) => m.id)).toEqual(['firststeps', 'scenes'])
  })

  it('recorded ones count once each; the two derived ones come from the record alone', () => {
    expect(earnedMilestones([], [])).toEqual([])
    expect(earnedMilestones([], ['comic', 'wish', 'comic'])).toEqual(['wish', 'comic'])
    // «Erste Schritte»: wish + occasion + friends — all three
    expect(earnedMilestones([], ['wish', 'occasion'])).not.toContain('firststeps')
    expect(earnedMilestones([], ['wish', 'occasion', 'friends'])).toEqual(['wish', 'occasion', 'friends', 'firststeps'])
    // derived names can never be stored and «given»
    expect(earnedMilestones([], ['firststeps', 'scenes'] as MilestoneId[])).toEqual([])
    // six finds → the knight
    const six: SceneId[] = ['tower', 'speck', 'footing', 'chase', 'overfed-a', 'overfed-b']
    expect(earnedMilestones(six.slice(0, 5), [])).toEqual([])
    expect(earnedCostumes(six, [])).toEqual(['knight'])
    expect(earnedCostumes([], ['wish', 'occasion', 'friends'])).toEqual(['laptop', 'groom', 'bunnyhood', 'sport'])
  })
})

describe('secrecy: nothing depends on reservations or on other people', () => {
  it('«Psst» (the find that means «I reserved a gift») never counts for a costume — for EVERY record', () => {
    expect(knightFinds(['psst', 'tower'])).toBe(1)
    // psst + five others = six finds, six outfits — but no knight
    expect(earnedCostumes(['psst', 'tower', 'speck', 'footing', 'chase', 'overfed-a'], [])).not.toContain('knight')
    // every subset of the scenes × a spread of milestone sets: with or without «Psst», the very same costumes
    const others = SCENE_IDS.filter((id) => id !== 'psst')
    const gots: MilestoneId[][] = [[], NOTED, ['wish'], ['wish', 'occasion', 'friends'], ['received', 'comic']]
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const found = others.filter((_, i) => mask & (1 << i))
      for (const got of gots) {
        expect(earnedCostumes([...found, 'psst'], got), `${found.join(',')} | ${got.join(',')}`).toEqual(earnedCostumes(found, got))
      }
    }
  })

  it('the recorder takes a fixed name and nothing else: no data, no ids, no people, no times — unknown names record nothing', () => {
    expect(noteMilestone.length).toBe(1)
    expect(noteMilestoneOf.length).toBe(1)
    for (const bad of ['firststeps', 'scenes', 'reserve', 'psst', '', 'wish ', 'list:123', A]) noteMilestoneOf(bad as never)
    expect(window.localStorage.getItem(sammlungKey(A))).toBeNull()
    noteMilestone('received')
    noteMilestone('wish')
    noteMilestone('wish')
    const raw = JSON.parse(window.localStorage.getItem(sammlungKey(A)) ?? 'null') as Record<string, unknown>
    // exactly these fields: fixed names in a fixed order — no time, no date, no order of events, nothing about anyone
    expect(raw).toEqual({ v: 1, owner: A, found: [], wear: 'auto', seen: 0, got: ['wish', 'received'] })
  })

  it('the rules modules read nothing of the app: no API, no query cache, no reservations, no lists of other people', () => {
    for (const [name, source] of Object.entries({ milestones: milestonesSource, note: noteSource, store: storeSource })) {
      expect(source, name).not.toMatch(/lib\/api|queryClient|useQuery|getQueryData|supabase/)
      expect(source, name).not.toMatch(/from ['"][^'"]*reserv/i)
    }
    expect(milestonesSource).not.toMatch(/^import (?!type )/m)
  })

  // Every place that records a milestone (a dynamic import of the recorder + noteMilestone('<name>')): exactly these,
  // each the person's OWN write to their OWN thing after the server's yes. A new caller must be added here — and checked.
  const CALLERS: Record<string, readonly string[]> = {
    'features/lists/ListNewWishPage.tsx': ['wish'],
    'features/gifts/AddToWishlistSheet.tsx': ['wish', 'list'],
    'features/wishes/WishEditorPages.tsx': ['wish'],
    'features/occasions/extras/send.ts': ['wish'],
    'features/lists/CreateListSheet.tsx': ['list'],
    'features/nav/ListWishStep.tsx': ['list'],
    'features/occasions/actions.ts': ['occasion'],
    'features/occasions/InviteSection.tsx': ['invite'],
    'features/people/FollowLinkSheet.tsx': ['friends', 'friends'],
    'features/profilePhotos/photos.ts': [],
    'features/lists/BannerSheet.tsx': ['banner'],
    'features/calendarFeed/CalendarFeedSheet.tsx': ['calendar'],
    'features/comic/ComicBody.tsx': ['comic'],
    'features/wishes/OwnerWishlist.tsx': ['received'],
    'features/wishes/selection/bulk.ts': ['received'],
    'features/wishes/wishPhotos.ts': ['wishphoto'],
  }
  const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })
  // (vite writes this folder's own files as ./x.ts)
  const rel = (path: string) => path.replace(/^\.\//, 'features/sammlung/').replace(/^\.\.\//, 'features/')

  it('exactly the known callers record milestones — and none of them is about reservations', () => {
    const callers = Object.entries(sources).filter(([, s]) => /noteMilestone\(/.test(s)).map(([p]) => rel(p)).filter((p) => !p.startsWith('features/sammlung/'))
    expect(callers.sort()).toEqual(Object.keys(CALLERS).sort())
    for (const [path, ids] of Object.entries(CALLERS)) {
      const source = sources[`../${path.replace(/^features\//, '')}`] ?? ''
      // lazily, like the finds: the recorder never lands in a first screen
      expect(source, path).toMatch(/import\('\.\.\/(\.\.\/)?sammlung\/note'\)/)
      expect(source, path).not.toMatch(/^import[^;]*sammlung\/note/m)
      expect(source, path).not.toMatch(/^import[^;]*lib\/api\/reservations/m)
      const named = [...source.matchAll(/noteMilestone\('([a-z]+)'\)/g)].map((m) => m[1])
      expect(named, path).toEqual(ids)
    }
    // the photo: its kind decides (avatar → photo, banner photo → banner) — both their own pictures
    expect(sources['../profilePhotos/photos.ts']).toContain("noteMilestone(kind === 'avatar' ? 'photo' : 'banner')")
    // the invite link: only as the host of the occasion
    expect(sources['../occasions/InviteSection.tsx']).toContain("if (screen.viewer.role === 'host') void import('../sammlung/note')")
    // the reservation flows themselves never record anything
    for (const [path, source] of Object.entries(sources)) {
      if (/reserv|Reserv|Psst|potluck/i.test(path)) expect(source, path).not.toMatch(/noteMilestone/)
    }
  })
})

describe('the record and the Garderobe (store.ts, wear.ts)', () => {
  it('an older record without costumes is read as before; a milestone adds `got`, another account sees none of it', () => {
    window.localStorage.setItem(sammlungKey(A), JSON.stringify({ v: 1, owner: A, found: ['tower'], wear: 'auto', seen: 1 }))
    expect(readSammlung(A)).toEqual({ found: ['tower'], wear: 'auto', seen: 1 })
    noteMilestone('list')
    expect(readSammlung(A)).toEqual({ found: ['tower'], wear: 'auto', seen: 1, got: ['list'] })
    expect(readSammlung(B)).toEqual({ found: [], wear: 'auto', seen: 0 })
    setRenderedAccount(null)
    noteMilestone('wish')
    expect(readSammlung(A).got).toEqual(['list'])
  })

  it('never trusted: unknown names, derived names, another owner', () => {
    window.localStorage.setItem(sammlungKey(A), JSON.stringify({ v: 1, owner: A, found: [], wear: 'knight', seen: 0, got: ['nope', 'scenes', 'wish', 'firststeps'], saw: ['noodles', 'strawberry', 'laptop'] }))
    expect(readSammlung(A)).toEqual({ found: [], wear: 'knight', seen: 0, got: ['wish'], saw: ['laptop'] })
    window.localStorage.setItem(sammlungKey(A), JSON.stringify({ v: 1, owner: B, found: [], wear: 'auto', seen: 0, got: ['wish'] }))
    expect(costumesOf(readSammlung(A))).toEqual([])
  })

  it('Pompon wears a costume only when it is the person\'s AND chosen; otherwise the seasons as before', () => {
    const halloween = new Date(2026, 9, 31)
    setWear(A, 'laptop')
    expect(outfitToday(halloween)).toBeNull()
    noteMilestone('wish')
    expect(outfitToday(halloween)).toBe('laptop')
    setWear(A, 'auto')
    expect(outfitToday(halloween)).toBe('leaf')
    setWear(A, 'knight')
    for (const id of ['tower', 'speck', 'footing', 'chase', 'overfed-a'] as const) noteScene(id)
    noteScene('psst')
    expect(outfitToday(halloween)).toBeNull()
    noteScene('overfed-b')
    expect(outfitToday(halloween)).toBe('knight')
  })

  it('a new costume: the dot until the Garderobe showed it; demo «unlock everything» does nothing outside the demo', () => {
    expect(newCostumes(readSammlung(A))).toEqual([])
    noteMilestone('comic')
    expect(newCostumes(readSammlung(A))).toEqual(['samurai'])
    markCostumesSeen(A)
    expect(newCostumes(readSammlung(A))).toEqual([])
    expect(readSammlung(A).saw).toEqual(['samurai'])
    noteMilestone('photo')
    expect(newCostumes(readSammlung(A))).toEqual(['sunglasses'])
    demoUnlockAll(A)
    expect(costumesOf(readSammlung(A))).toEqual(['sunglasses', 'samurai'])
  })
})
