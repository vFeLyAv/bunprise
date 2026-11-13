import { dayMonth, wearNow, type WearId } from '@bunprise/mascot/wardrobe-rules'
import { onThemeChange } from '../../lib/theme'
import { costumesOf, currentSammlung, subscribeSammlung, wearTheme } from './store'

// What Pompon wears in the app (design §5, Felix 28.10: variant B). «Nach Jahreszeit» (the default): the season's
// outfit for everyone — 22.9.–31.10. the maple leaf, 1.11.–5.12. the scarf, 6.12.–26.12. the Nikolaus hat, 27.12.–28.2.
// the winter hat, 1.3.–31.5. the daisy, summer nothing; each found scene unlocks one outfit to wear by hand all year;
// «Nichts anziehen» = nothing. 31.10: or one of the twelve costumes, once it is the person's (./milestones.ts) and
// chosen in the Garderobe. Only the date of THIS device, the person's own choice, the number of finds and their own
// milestones decide — never reservations or other people. Friends never see it: it is drawn on this device only.
// The drawings (@bunprise/mascot/wardrobe) load only when he really wears something.

type Wardrobe = typeof import('@bunprise/mascot/wardrobe')
let wardrobe: Promise<Wardrobe> | null = null
function loadWardrobe(): Promise<Wardrobe> {
  wardrobe ??= import('@bunprise/mascot/wardrobe').catch((err: unknown) => {
    wardrobe = null
    throw err
  })
  return wardrobe
}

/** What Pompon wears today, on this device, for the account this tab shows (no account: the season's outfit). */
export function outfitToday(now: Date = new Date()): WearId | null {
  const rec = currentSammlung()
  return wearNow(rec.wear, dayMonth(now), rec.found.length, costumesOf(rec))
}

export interface PuppetTarget {
  root: ShadowRoot
  host: HTMLElement
}

/**
 * Keeps one puppet dressed in today's outfit until the returned stop(): it changes with the choice, the finds, the
 * theme and the day (checked when the app comes back). No animation — the outfit is simply there (the put-on drop
 * plays only when the person picks one in the Garderobe).
 */
export function wearToday(target: () => PuppetTarget | null): () => void {
  let alive = true
  let shown: string | null = null
  const sync = () => {
    if (!alive) return
    const id = outfitToday()
    if ((id ? `${id}|${wearTheme()}` : null) === shown) return
    loadWardrobe().then((w) => {
      const t = alive ? target() : null
      if (!t) return
      const now = outfitToday()
      const theme = wearTheme()
      w.dress(t.root, t.host, now, theme)
      shown = now ? `${now}|${theme}` : null
    }, () => undefined)
  }
  sync()
  const offStore = subscribeSammlung(sync)
  const offTheme = onThemeChange(sync)
  const onVisible = () => {
    if (document.visibilityState === 'visible') sync()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    alive = false
    offStore()
    offTheme()
    document.removeEventListener('visibilitychange', onVisible)
  }
}
