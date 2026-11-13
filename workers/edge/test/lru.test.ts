import { expect, it } from 'vitest'
import { LruCache } from '../src/lru'

it('evicts least recently used entries without refreshing absolute expiry on hits', () => {
  let now = 0
  const cache = new LruCache<string, number>(2, 100, () => now)
  cache.set('a', 1)
  cache.set('b', 2)
  now = 50
  expect(cache.get('a')).toBe(1)
  cache.set('c', 3)
  expect(cache.get('b')).toBeUndefined()
  now = 100
  expect(cache.get('a')).toBeUndefined()
  expect(cache.get('c')).toBe(3)
})

it('replaces values and rejects invalid cache sizes', () => {
  const cache = new LruCache<string, number>(1, 100)
  cache.set('a', 1)
  cache.set('a', 2)
  expect(cache.get('a')).toBe(2)
  expect(() => new LruCache(0, 100)).toThrow(RangeError)
})
