import { useEffect, useState } from 'react'
import type { DetectCover } from './choice'

// The title → motif detection (./detect.ts) as a lazy chunk of the occasion form: loaded once the form shows the
// motif choice, then kept for the tab (the module cache). Until it is there the form shows the photo row as before.

type DetectModule = typeof import('./detect')

let loaded: DetectCover | null = null
let loading: Promise<DetectCover> | null = null

function wrap(module: DetectModule): DetectCover {
  return (title, date) => module.themeOf(title, date ? { date } : {})
}

/** Loads the detection (once per tab). */
export function loadCoverDetect(): Promise<DetectCover> {
  loading ??= import('./detect').then(
    (module) => {
      loaded = wrap(module)
      return loaded
    },
    (err: unknown) => {
      loading = null // a failed chunk (offline) is asked for again next time
      throw err
    },
  )
  return loading
}

/** The detection, or null while its chunk loads (or when `enabled` is false: nothing is loaded). */
export function useCoverDetect(enabled: boolean): DetectCover | null {
  // a function in state: through initialiser/updater functions (React would call it otherwise)
  const [detect, setDetect] = useState<DetectCover | null>(() => loaded)
  useEffect(() => {
    if (!enabled || detect) return
    let live = true
    loadCoverDetect().then(
      (next) => {
        if (live) setDetect(() => next)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [enabled, detect])
  return enabled ? detect : null
}
