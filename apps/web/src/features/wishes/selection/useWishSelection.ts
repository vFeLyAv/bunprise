import { useState } from 'react'
import { haptic } from '../../../ui'

// Selection mode of the owner's wish grid (Felix 30.10, request #4). State only; the chrome (header, action bar,
// pickers) is a lazy chunk (SelectionChrome.tsx) that loads with the first long press. Every change of the
// selection is one short tick through the app's single haptics wrapper (Android vibrates; an iPhone browser cannot —
// the tile's circle and ring always answer visibly).

export interface WishSelection {
  active: boolean
  ids: ReadonlySet<string>
  /** Long press: selection mode starts with this wish selected. */
  enter: (wishId: string) => void
  /** Tap in selection mode: select / deselect. */
  toggle: (wishId: string) => void
  /** "Alle" / "Keine". */
  setAll: (wishIds: readonly string[]) => void
  /** "Fertig", Escape, back, or an action was sent. */
  exit: () => void
}

const NONE: ReadonlySet<string> = new Set()

export function useWishSelection(): WishSelection {
  const [active, setActive] = useState(false)
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE)
  return {
    active,
    ids,
    enter(wishId) {
      haptic('select')
      setActive(true)
      setIds(new Set([wishId]))
    },
    toggle(wishId) {
      haptic('select')
      setIds((prev) => {
        const next = new Set(prev)
        if (!next.delete(wishId)) next.add(wishId)
        return next
      })
    },
    setAll(wishIds) {
      haptic('select')
      setIds(new Set(wishIds))
    },
    exit() {
      setActive(false)
      setIds(NONE)
    },
  }
}
