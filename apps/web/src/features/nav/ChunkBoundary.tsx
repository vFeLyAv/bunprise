import { Component, type ReactNode } from 'react'

/**
 * A lazy chunk that could not load: offline before the service worker had it, or a deploy replaced it.
 * Chrome "Failed to fetch dynamically imported module", Safari "Importing a module script failed",
 * Firefox "error loading dynamically imported module".
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|module script failed|loading chunk/i.test(message)
}

interface ChunkBoundaryProps {
  /** shown instead of the chunk; `retry` tries to load it again */
  fallback: (retry: () => void) => ReactNode
  /** before a retry: give the lazy component a fresh import (React.lazy keeps a failed one) */
  onRetry?: () => void
  /** a function: a retry renders it again, so it picks up the fresh lazy component */
  children: () => ReactNode
}

/**
 * Catches only a lazy chunk that failed to load and shows `fallback` in its place, so one missing piece never
 * takes the whole app down to the router's error page; every other error goes on to that page as before.
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('unknown') }
  }

  retry = (): void => {
    this.props.onRetry?.()
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children()
    if (!isChunkLoadError(error)) throw error
    return this.props.fallback(this.retry)
  }
}
