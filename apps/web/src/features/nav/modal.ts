import { useEffect, useRef, type RefObject } from 'react'
import { registerOpenSheet } from '../../ui/layers'
import { registerSheetLayer } from '../../ui/sheetLayer'

// Modal behaviour of the create menu, the same contract as the kit's Sheet (ui/Sheet.tsx): while open the
// rest of the layer is inert and does not scroll, Esc closes, Tab stays inside the dialog, and on close
// the focus returns to where it was (the "+"). Registers as an open sheet, so toasts move to the top.

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function useModal(open: boolean, containerRef: RefObject<HTMLElement | null>, dialogRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const container = containerRef.current
    const dialog = dialogRef.current
    const layer = container?.parentElement
    if (!open || !container || !dialog || !layer) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const release = registerOpenSheet()

    const releaseLayer = registerSheetLayer(container, layer)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || container.closest('[inert]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const list = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      release()
      document.removeEventListener('keydown', onKeyDown)
      releaseLayer()
      // back to the trigger: the bar's "+" when it is still there, else where the focus was
      const trigger = layer.querySelector<HTMLElement>('[data-create-trigger]')
      ;(trigger ?? previouslyFocused)?.focus({ preventScroll: true })
    }
  }, [open, containerRef, dialogRef])
}
