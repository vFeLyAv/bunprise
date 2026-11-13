// «Ночью маскоты спят» on the Lists tab (Tapsi in "Freunde", the Lists buddy): has the night begun for this screen?
// mascot-ui/night.ts is loaded with import() — never statically: its chunk would join the preload list of the first
// screens (bundle budget of /soon, see there). Only this tab's chunk uses this hook (mascot-ui/StartSurprise.tsx has
// the same few lines of its own, for the same reason). Callers show the day while it is not known yet (null): the
// day's mascot is still loading its own chunk then, so nothing of it shows before the night one takes over.
import { useEffect, useState } from 'react'

/**
 * null = not known yet (the module is on its way) · false = day · { live } = the mascots sleep — latched until the
 * screen goes (07:00: they wake up in front of you); live = the night began while the screen was open.
 */
export type NightLatch = { live: boolean } | false | null

export function useNightLatch(): NightLatch {
  const [night, setNight] = useState<NightLatch>(null)
  useEffect(() => {
    let alive = true
    let off: (() => void) | undefined
    let first = true
    import('../mascot-ui/night').then((n) => {
      if (!alive) return
      off = n.watchSleeps((sleeps) => {
        const live = !first
        first = false
        setNight((cur) => cur || (sleeps ? { live } : false))
      })
    }, () => {
      if (alive) setNight((cur) => cur ?? false)
    })
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return night
}
