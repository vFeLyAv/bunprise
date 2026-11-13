import { useSyncExternalStore } from 'react'

// Tiny toast store. Features call toast.success(t('invite.copied_hint')); the host component in
// the root shell renders whatever is in the queue (one at a time, design-system-motion.md "Toast").
// Texts are passed already translated.

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
  /** optional single action, e.g. "Rückgängig" */
  actionLabel?: string
  onAction?: () => void
  /** ms; 4000 by default, 8000 with an action */
  duration: number
}

export interface ToastOptions {
  kind?: ToastKind
  actionLabel?: string
  onAction?: () => void
  duration?: number
}

type Listener = () => void

let queue: readonly ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function show(text: string, options: ToastOptions = {}): number {
  const id = nextId++
  const item: ToastItem = {
    id,
    kind: options.kind ?? 'info',
    text,
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    duration: options.duration ?? (options.actionLabel ? 8000 : 4000),
  }
  queue = [...queue, item]
  emit()
  return id
}

function dismiss(id: number): void {
  if (!queue.some((t) => t.id === id)) return
  queue = queue.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  show,
  dismiss,
  info: (text: string, options?: Omit<ToastOptions, 'kind'>) => show(text, { ...options, kind: 'info' }),
  success: (text: string, options?: Omit<ToastOptions, 'kind'>) => show(text, { ...options, kind: 'success' }),
  error: (text: string, options?: Omit<ToastOptions, 'kind'>) => show(text, { ...options, kind: 'error' }),
  clear: () => {
    queue = []
    emit()
  },
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToasts(): readonly ToastItem[] {
  return queue
}

/** React hook: the current toast queue (first item = the visible toast). */
export function useToasts(): readonly ToastItem[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts)
}
