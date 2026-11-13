/**
 * The motion level's slower inputs (src/motion/level.ts loads this right after boot, as its own small chunk —
 * the boot shell stays small): the battery saver (Battery Status API where it exists: not charging and
 * ≤ 20 % counts as low) and the setting changed in another tab of this device (the storage event).
 *
 * Privacy (pilot-4, 26.10): the battery is read ONLY while "Bei wenig Akku sparen" is on. With the setting off
 * the app never calls navigator.getBattery(); switching it off stops listening and forgets the last reading;
 * switching it on (here or in another tab) reads it again.
 */
import {
  LOW_BATTERY,
  MOTION_STORAGE_KEY,
  getMotionState,
  reloadMotionPrefs,
  setBatteryState,
  subscribeMotionState,
} from './level'

interface BatteryLike extends EventTarget {
  charging: boolean
  level: number
}

/** Reads the battery and follows its changes until the returned stop function runs. */
function watchBattery(getBattery: () => Promise<BatteryLike>): () => void {
  let stopped = false
  let detach: () => void = () => undefined
  getBattery().then(
    (b) => {
      if (stopped) return
      const read = () => setBatteryState({ supported: true, low: !b.charging && b.level <= LOW_BATTERY })
      read()
      b.addEventListener('levelchange', read)
      b.addEventListener('chargingchange', read)
      detach = () => {
        b.removeEventListener('levelchange', read)
        b.removeEventListener('chargingchange', read)
      }
    },
    () => {
      // blocked by a permissions policy: like unsupported
      if (!stopped) setBatteryState({ supported: false, low: false })
    },
  )
  return () => {
    stopped = true
    detach()
  }
}

/** Starts both watchers; returns the stop function. */
export function watchMotionInputs(): () => void {
  const stops: Array<() => void> = []
  const onStorage = (e: StorageEvent) => {
    if (e.key === MOTION_STORAGE_KEY || e.key === null) reloadMotionPrefs()
  }
  window.addEventListener('storage', onStorage)
  stops.push(() => window.removeEventListener('storage', onStorage))

  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
  if (typeof nav.getBattery === 'function') {
    const getBattery = nav.getBattery.bind(nav)
    let stopBattery: (() => void) | null = null
    // The API exists (the settings row needs no "not supported" hint); nothing is read yet.
    setBatteryState({ supported: true, low: false })
    const sync = () => {
      const wanted = getMotionState().prefs.batterySaver
      if (wanted && !stopBattery) {
        stopBattery = watchBattery(getBattery)
      } else if (!wanted && stopBattery) {
        stopBattery()
        stopBattery = null
        // forget the last reading: with the setting off the app knows nothing about the battery
        setBatteryState({ supported: getMotionState().battery.supported, low: false })
      }
    }
    sync()
    const unsubscribe = subscribeMotionState(sync)
    stops.push(() => {
      unsubscribe()
      stopBattery?.()
      stopBattery = null
    })
  }
  return () => {
    for (const stop of stops) stop()
  }
}
