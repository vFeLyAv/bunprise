import { useSyncExternalStore } from 'react'
import { COSTUME_IDS, isCostumeId, isOutfitId, type CostumeId, type WearChoice } from '@bunprise/mascot/wardrobe-rules'
import { onAccountEnded, renderedAccount } from '../../lib/accountBoundary'
import { DEMO_MODE } from '../../lib/app'
import { currentTheme } from '../../lib/theme'
import { SAMMLUNG_PREFIX, sammlungKey } from './key'
import { earnedCostumes, isNotedMilestone, MILESTONE_IDS, type MilestoneId, type NotedMilestone } from './milestones'
import { isSceneId, SCENE_IDS, type SceneId } from './scenes'

// «Pompons Sammlung» on this device (design §4–§6, Felix's decisions 28.10): which hidden scenes this account has
// found, what Pompon wears, and how many finds the person has already seen (the dot at the Profil row).
//   localStorage `bunprise-sammlung.<account id>` = { v: 1, owner, found: ["tower", …], wear: "auto" | "none" | <outfit> | <costume>, seen,
//                                                    got?: ["wish", …], saw?: ["laptop", …] }
// - only scene names from SCENE_IDS (in that fixed order — never the order or the time of the finds: the date of
//   «Psst» would be the date of a reservation), the wardrobe choice and a counter; nothing leaves the device;
// - 31.10, the costumes (./milestones.ts): `got` = the person's own milestones (fixed names, fixed order, no times),
//   `saw` = the costumes whose «new!» moment the person has seen; both left out while empty (older records unchanged);
// - only the signed-in account's own key is read, and its `owner` must match (another account on the same phone
//   never sees this one's collection); without an account there is no collection (the season outfit is everyone's);
// - kept on sign-out (key.ts), deleted with the account. Storage blocked: a copy in this tab's memory.

export interface Sammlung {
  readonly found: readonly SceneId[]
  readonly wear: WearChoice
  readonly seen: number
  /** the person's own recorded milestones (./milestones.ts), absent = none */
  readonly got?: readonly MilestoneId[]
  /** costumes already revealed in the Garderobe, absent = none */
  readonly saw?: readonly CostumeId[]
}

export const EMPTY_SAMMLUNG: Sammlung = Object.freeze({ found: Object.freeze([]) as readonly SceneId[], wear: 'auto', seen: 0 })

let memory: { owner: string; rec: Sammlung } | null = null
/** A write failed (storage blocked or full): this tab keeps going on its memory copy. */
let blocked = false
/** One stable snapshot per account while its stored text is unchanged (useSyncExternalStore). */
const cache = new Map<string, { raw: string | null; rec: Sammlung }>()
const listeners = new Set<() => void>()

function parse(owner: string, raw: string | null): Sammlung {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (typeof value !== 'object' || value === null) return EMPTY_SAMMLUNG
    const v = value as { v?: unknown; owner?: unknown; found?: unknown; wear?: unknown; seen?: unknown; got?: unknown; saw?: unknown }
    if (v.v !== 1 || v.owner !== owner) return EMPTY_SAMMLUNG
    const list = Array.isArray(v.found) ? v.found.filter(isSceneId) : []
    const found = SCENE_IDS.filter((id) => list.includes(id))
    const wear: WearChoice = v.wear === 'auto' || v.wear === 'none' || isOutfitId(v.wear) || isCostumeId(v.wear) ? v.wear : 'auto'
    const seen = typeof v.seen === 'number' && Number.isFinite(v.seen) ? Math.max(0, Math.min(found.length, Math.floor(v.seen))) : 0
    return withCostumes({ found, wear, seen }, Array.isArray(v.got) ? v.got : [], Array.isArray(v.saw) ? v.saw : [])
  } catch {
    return EMPTY_SAMMLUNG
  }
}

/** Adds `got` / `saw` (known names only, in their fixed order; left out while empty). */
function withCostumes(rec: Sammlung, got: readonly unknown[], saw: readonly unknown[]): Sammlung {
  const g = MILESTONE_IDS.filter((id) => isNotedMilestone(id) && got.includes(id))
  const s = COSTUME_IDS.filter((id) => saw.includes(id))
  return { ...rec, ...(g.length ? { got: g } : {}), ...(s.length ? { saw: s } : {}) }
}

/** The costumes that are this person's (./milestones.ts), in the Garderobe's order. */
export function costumesOf(rec: Sammlung): CostumeId[] {
  return earnedCostumes(rec.found, rec.got ?? [])
}

/** Costumes that are the person's but whose «new!» moment they have not seen yet. */
export function newCostumes(rec: Sammlung): CostumeId[] {
  const saw = rec.saw ?? []
  return costumesOf(rec).filter((id) => !saw.includes(id))
}

/** The collection of `owner` (EMPTY without an account). */
export function readSammlung(owner: string | null | undefined): Sammlung {
  if (!owner) return EMPTY_SAMMLUNG
  if (blocked && memory?.owner === owner) return memory.rec
  let raw: string | null
  try {
    raw = window.localStorage.getItem(sammlungKey(owner))
  } catch {
    return memory?.owner === owner ? memory.rec : EMPTY_SAMMLUNG
  }
  const hit = cache.get(owner)
  if (hit && hit.raw === raw) return hit.rec
  const rec = parse(owner, raw)
  cache.set(owner, { raw, rec })
  return rec
}

/** The collection of the account this tab shows (renderedAccount: set by the session watcher). */
export function currentSammlung(): Sammlung {
  const owner = renderedAccount()
  return readSammlung(typeof owner === 'string' ? owner : null)
}

function notify(): void {
  for (const l of Array.from(listeners)) l()
}

function write(owner: string, rec: Sammlung): void {
  const found = SCENE_IDS.filter((id) => rec.found.includes(id))
  const next = withCostumes({ found, wear: rec.wear, seen: Math.max(0, Math.min(found.length, rec.seen)) }, rec.got ?? [], rec.saw ?? [])
  memory = { owner, rec: next }
  try {
    window.localStorage.setItem(sammlungKey(owner), JSON.stringify({
      v: 1, owner, found, wear: next.wear, seen: next.seen, ...(next.got ? { got: next.got } : {}), ...(next.saw ? { saw: next.saw } : {}),
    }))
  } catch {
    blocked = true // the memory copy keeps it for this tab
  }
  cache.delete(owner)
  notify()
}

/**
 * THE hook of the collection: a hidden scene really started playing for this person (design §4) — the places that
 * start one call it through ./note.ts. Counted once; replays inside the collection never come here.
 */
export function noteScene(id: SceneId): void {
  const owner = renderedAccount()
  if (typeof owner !== 'string' || !owner) return
  const rec = readSammlung(owner)
  if (rec.found.includes(id)) return
  write(owner, { ...rec, found: [...rec.found, id] })
}

/**
 * The person did one of their milestones (./milestones.ts) — the places that do them call it through ./note.ts, after
 * the server said yes. Only a fixed name comes in: nothing about what, for whom, or when. Counted once.
 */
export function noteMilestoneOf(id: NotedMilestone): void {
  if (!isNotedMilestone(id)) return
  const owner = renderedAccount()
  if (typeof owner !== 'string' || !owner) return
  const rec = readSammlung(owner)
  if (rec.got?.includes(id)) return
  write(owner, { ...rec, got: [...(rec.got ?? []), id] })
}

/** The person looked at the collection: the dot at the Profil row goes away. */
export function markSeen(owner: string): void {
  const rec = readSammlung(owner)
  if (rec.seen < rec.found.length) write(owner, { ...rec, seen: rec.found.length })
}

/** The Garderobe showed the new costumes' moment: they are not new any more (the dot goes away). */
export function markCostumesSeen(owner: string): void {
  const rec = readSammlung(owner)
  if (newCostumes(rec).length) write(owner, { ...rec, saw: costumesOf(rec) })
}

/** One new costume's tile «opened» on screen: that one is not new any more. */
export function markCostumeSeen(owner: string, id: CostumeId): void {
  const rec = readSammlung(owner)
  if (newCostumes(rec).includes(id)) write(owner, { ...rec, saw: [...(rec.saw ?? []), id] })
}

/**
 * DEMO ONLY (http://localhost:5173, VITE_DEMO=1; does nothing anywhere else): every milestone and every scene except
 * «Psst» at once, so Felix can look at all outfits and costumes in a minute (the Garderobe's demo button).
 */
export function demoUnlockAll(owner: string): void {
  if (!DEMO_MODE) return
  const rec = readSammlung(owner)
  write(owner, { ...rec, found: SCENE_IDS.filter((id) => id !== 'psst'), got: MILESTONE_IDS.filter(isNotedMilestone) })
}

/** «Nach Jahreszeit» (auto), «Nichts anziehen» (none) or one outfit / costume chosen by hand. */
export function setWear(owner: string, wear: WearChoice): void {
  const rec = readSammlung(owner)
  if (rec.wear !== wear) write(owner, { ...rec, wear })
}

let watching = false
export function subscribeSammlung(listener: () => void): () => void {
  listeners.add(listener)
  if (!watching && typeof window !== 'undefined') {
    watching = true
    // another tab of this device found something or changed the outfit
    window.addEventListener('storage', (e) => {
      if (e.key === null || e.key.startsWith(SAMMLUNG_PREFIX)) {
        cache.clear()
        notify()
      }
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

export function useSammlung(owner: string | null | undefined): Sammlung {
  return useSyncExternalStore(subscribeSammlung, () => readSammlung(owner), () => EMPTY_SAMMLUNG)
}

/** iPhone / iPad (also an iPad in desktop mode): the only devices where «Hier wohne ich» can play (design §0 #6). */
export function onIphone(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /\b(?:iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

/** The scenes that count on this device: «Hier wohne ich» only on an iPhone, or once it was found. */
export function countedScenes(found: readonly SceneId[], iphone = onIphone()): readonly SceneId[] {
  return iphone || found.includes('homeicon') ? SCENE_IDS : SCENE_IDS.filter((id) => id !== 'homeicon')
}

/** The outfit colours of the shown theme: the warm night for Dunkel / Schwarz, the blue one for Blau / Ozean. */
export function wearTheme(): 'light' | 'dark' | 'navy' {
  const t = currentTheme()
  return t === 'light' ? 'light' : t === 'navy' || t === 'ocean' ? 'navy' : 'dark'
}

onAccountEnded(() => {
  memory = null
  blocked = false
  cache.clear()
  notify()
})
