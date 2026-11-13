/**
 * The ONE motion level of the app (Felix's K9, 2026-10-20): 'full' | 'reduced' | 'off'.
 *
 * It combines three inputs:
 *   1. the person's setting on this device (Settings → "Animationen": Voll · Weniger · Aus, plus "Kaninchen
 *      zeigen" and "Bei wenig Akku sparen"), stored in localStorage `bunprise.reduceMotion` (JSON; the key
 *      is kept on sign-out like every device preference, docs/storage-registry.md);
 *   2. the system's prefers-reduced-motion: then the level is ALWAYS at least 'reduced';
 *   3. the battery saver: Battery Status API where it exists (not charging and level ≤ 20 % → 'reduced');
 *      iPhone/Safari and Firefox have no Battery API — `battery.supported` is false and the setting says so.
 *      The battery is read only while "Bei wenig Akku sparen" is on (levelWatch.ts; privacy, pilot-4).
 *
 * The resolved level is written to <html data-motion="full|reduce|off"> (CSS: tokens.css zeroes the spring
 * durations for reduce/off) and <html data-bunnies="on|off"> (mascot code renders nothing when off). Lazy
 * chunks read those attributes (ui/motionMode.ts) without importing this store. React: useMotionLevel().
 * This module is part of the boot shell (src/main.tsx starts it), so it stays small: the battery and the
 * other-tab watchers arrive in their own small chunk (levelWatch.ts) right after boot.
 */
import { storageKeys } from '../lib/app'

export type MotionLevel = 'full' | 'reduced' | 'off'

export interface MotionPrefs {
  /** what the person chose in Settings → "Animationen" */
  level: MotionLevel
  /** "Kaninchen zeigen": the mascots appear at all */
  bunnies: boolean
  /** "Bei wenig Akku sparen": low battery → at most 'reduced' */
  batterySaver: boolean
}

export interface BatteryState {
  /** the browser has the Battery Status API (Chromium; not Safari/iPhone, not Firefox) */
  supported: boolean
  /** not charging and ≤ 20 % */
  low: boolean
}

export interface MotionState {
  /** the resolved level every animation follows */
  level: MotionLevel
  /** mascots are shown (setting on and the level is not 'off') */
  bunnies: boolean
  /** the stored setting */
  prefs: MotionPrefs
  /** the system asks for reduced motion */
  systemReduced: boolean
  battery: BatteryState
}

export const DEFAULT_MOTION_PREFS: MotionPrefs = { level: 'full', bunnies: true, batterySaver: true }

/** Battery at or below this share (and not charging) counts as low. */
export const LOW_BATTERY = 0.2

export const MOTION_STORAGE_KEY = storageKeys.reduceMotion

const RANK: Record<MotionLevel, number> = { off: 0, reduced: 1, full: 2 }

/** Pure: the level every animation follows (the system and a low battery only ever make it calmer). */
export function resolveMotionLevel(prefs: MotionPrefs, systemReduced: boolean, battery: BatteryState): MotionLevel {
  const calm = systemReduced || (prefs.batterySaver && battery.supported && battery.low)
  return calm && RANK[prefs.level] > RANK.reduced ? 'reduced' : prefs.level
}

/** Reads the stored setting; the earlier reserved values of the key ('auto' | 'reduce' | 'full') still work. */
export function parseMotionPrefs(raw: string | null): MotionPrefs {
  const out = { ...DEFAULT_MOTION_PREFS }
  if (raw === 'reduce') out.level = 'reduced'
  if (!raw?.startsWith('{')) return out
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof MotionPrefs, unknown>>
    if (v.level === 'full' || v.level === 'reduced' || v.level === 'off') out.level = v.level
    if (typeof v.bunnies === 'boolean') out.bunnies = v.bunnies
    if (typeof v.batterySaver === 'boolean') out.batterySaver = v.batterySaver
  } catch {
    /* broken: the defaults */
  }
  return out
}

/** The stored setting (defaults when storage is blocked). */
export function readStoredMotionPrefs(): MotionPrefs {
  try {
    return parseMotionPrefs(window.localStorage.getItem(MOTION_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_MOTION_PREFS }
  }
}

// ---------- the store ----------

const listeners = new Set<() => void>()
let prefs: MotionPrefs = { ...DEFAULT_MOTION_PREFS }
let systemReduced = false
let battery: BatteryState = { supported: false, low: false }
let snapshot: MotionState = build()
let snapshotKey = ''
let stopWatch: (() => void) | null = null
let started = false

function build(): MotionState {
  const level = resolveMotionLevel(prefs, systemReduced, battery)
  return { level, bunnies: prefs.bunnies && level !== 'off', prefs, systemReduced, battery }
}

function apply(): void {
  const next = build()
  const key = JSON.stringify(next)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.dataset['motion'] = next.level === 'reduced' ? 'reduce' : next.level
    root.dataset['bunnies'] = next.bunnies ? 'on' : 'off'
  }
  if (key === snapshotKey) return
  snapshot = next
  snapshotKey = key
  for (const l of listeners) l()
}

/** levelWatch.ts: the battery saw a change. */
export function setBatteryState(next: BatteryState): void {
  battery = next
  apply()
}

/** levelWatch.ts: another tab changed the stored setting. */
export function reloadMotionPrefs(): void {
  prefs = readStoredMotionPrefs()
  apply()
}

/**
 * Starts the store once (src/main.tsx, before the first render): reads the setting, follows the system
 * setting, keeps the <html> attributes current; the battery and other-tab watchers load right after.
 */
export function startMotionLevel(): void {
  if (started || typeof window === 'undefined') return
  started = true
  prefs = readStoredMotionPrefs()
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  systemReduced = mq?.matches ?? false
  mq?.addEventListener?.('change', (e: MediaQueryListEvent) => {
    systemReduced = e.matches
    apply()
  })
  apply()
  void import('./levelWatch').then(
    (mod) => {
      if (started) stopWatch = mod.watchMotionInputs()
    },
    () => undefined,
  )
}

/** Changes and stores the setting (Settings → MotionSettingsSection). */
export function setMotionPrefs(patch: Partial<MotionPrefs>): void {
  prefs = { ...prefs, ...patch }
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* storage blocked: the choice holds for this visit */
  }
  apply()
}

export function getMotionState(): MotionState {
  return snapshot
}

export function subscribeMotionState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only: back to a fresh, stopped store. */
export function resetMotionLevelForTests(): void {
  stopWatch?.()
  stopWatch = null
  started = false
  prefs = { ...DEFAULT_MOTION_PREFS }
  systemReduced = false
  battery = { supported: false, low: false }
  snapshot = build()
  snapshotKey = ''
  listeners.clear()
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset['motion']
    delete document.documentElement.dataset['bunnies']
  }
}
