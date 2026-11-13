import type { Clock } from './http'

export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expires: number }>()

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || ttlMs <= 0) {
      throw new RangeError('Invalid cache limits')
    }
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    if (entry.expires <= this.now()) return undefined
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    // Remove expired data on writes too; no background timers in an isolate.
    const now = this.now()
    for (const [existingKey, entry] of this.entries) {
      if (entry.expires <= now) this.entries.delete(existingKey)
    }
    this.entries.set(key, { value, expires: now + this.ttlMs })
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
  }
}
