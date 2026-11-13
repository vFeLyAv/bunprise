import { storageKeys } from './app'

// The single place that vibrates or beeps (design-system-motion.md 2.7, CLAUDE.md "Motion").
// Android browsers vibrate; iPhone browsers cannot → visual response (done by the component)
// + a short synthesised sound for success / warning / error. Both have a switch in settings.
// The design agent may refine the implementation; the exported signatures are the contract.

export type HapticKind = 'tap' | 'select' | 'success' | 'warning' | 'error'
export type SoundKind = 'success' | 'warning' | 'error'

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  select: 6,
  success: [10, 40, 14],
  warning: [20, 40, 20], // like "angry" in the prototype
  error: [30, 50, 30, 50, 30],
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** Settings (localStorage now, profile later). Defaults: haptics on, sounds on. */
export const feedbackSettings = {
  haptics: {
    get: () => readFlag(storageKeys.haptics, true),
    set: (on: boolean) => writeFlag(storageKeys.haptics, on),
  },
  sounds: {
    get: () => readFlag(storageKeys.sounds, true),
    set: (on: boolean) => writeFlag(storageKeys.sounds, on),
  },
}

// Somewhere else to play haptics instead of navigator.vibrate: inside Telegram the bridge registers the
// client's HapticFeedback (lib/telegram/bridge.ts) — real haptics on the iPhone too. The switch still decides.
let sink: ((kind: HapticKind) => void) | null = null

/** Registers (or with null removes) the haptics sink. */
export function setHapticSink(next: ((kind: HapticKind) => void) | null): void {
  sink = next
}

/** True when the device can give haptic feedback at all (iPhone browsers: false; inside Telegram: true). */
export function canVibrate(): boolean {
  return sink !== null || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
}

export function haptic(kind: HapticKind): void {
  if (!feedbackSettings.haptics.get()) return
  try {
    if (sink) sink(kind)
    else navigator.vibrate?.(PATTERNS[kind])
  } catch {
    /* iPhone in the browser: no vibration */
  }
}

// ---- sound: Web Audio oscillators, no files, no third-party licences --------------------

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume() // only after a user gesture
    return audioContext
  } catch {
    return null
  }
}

function blip(ctx: AudioContext, type: OscillatorType, frequency: number, start: number, duration: number, gain: number): void {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.value = frequency
  amp.gain.setValueAtTime(0, start)
  amp.gain.linearRampToValueAtTime(gain, start + 0.005)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** Never for 'tap'; call only after a user gesture (AudioContext rule). */
export function sound(kind: SoundKind): void {
  if (!feedbackSettings.sounds.get()) return
  const ctx = getAudioContext()
  if (!ctx) return
  const t = ctx.currentTime
  switch (kind) {
    case 'success': // two sine blips C6 → E6
      blip(ctx, 'sine', 1046.5, t, 0.06, 0.15)
      blip(ctx, 'sine', 1318.5, t + 0.07, 0.06, 0.15)
      break
    case 'warning': // one triangle
      blip(ctx, 'triangle', 440, t, 0.08, 0.12)
      break
    case 'error': // low square
      blip(ctx, 'square', 220, t, 0.09, 0.08)
      break
  }
}

/** Convenience: vibration + sound for the three "result" moments; plain vibration otherwise. */
export function feedback(kind: HapticKind): void {
  haptic(kind)
  if (kind === 'success' || kind === 'warning' || kind === 'error') sound(kind)
}
