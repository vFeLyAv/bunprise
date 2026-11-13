import { afterEach, describe, expect, it, vi } from 'vitest'
import { readBytes, withDeadline } from '../src/http'
import type { Fetch } from '../src/http'
import { createResolver } from '../src/net/ssrf'

afterEach(() => vi.useRealTimers())

describe('network deadlines', () => {
  it('cancels a hanging DNS family when its sibling fails early', async () => {
    let siblingSignal: AbortSignal | null | undefined
    const cancelled = vi.fn()
    const fetch: Fetch = vi.fn(async (input, init) => {
      if (new URL(String(input)).searchParams.get('type') === 'A') {
        return new Response('upstream failure', { status: 500 })
      }
      siblingSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        siblingSignal?.addEventListener('abort', () => {
          cancelled()
          reject(new Error('cancelled'))
        }, { once: true })
      })
    })
    await expect(createResolver(fetch)('shop.example', new AbortController().signal))
      .rejects.toMatchObject({ code: 'fetch_failed' })
    expect(siblingSignal?.aborted).toBe(true)
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('does not start an operation when its parent is already aborted', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    parent.abort()
    const operation = vi.fn(async () => 'should not run')
    await expect(withDeadline(3000, operation, parent.signal)).rejects.toMatchObject({ code: 'timeout' })
    expect(operation).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates parent cancellation even when a transport ignores its signal', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    let childSignal: AbortSignal | undefined
    const operation = withDeadline(3000, (signal) => {
      childSignal = signal
      return new Promise<Response>(() => {})
    }, parent.signal)
    const result = expect(operation).rejects.toMatchObject({ code: 'timeout' })
    parent.abort()
    await result
    expect(childSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a stalled body read at the deadline', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const pending = withDeadline(100, (signal) => readBytes(new Response(body), 10, signal))
    const result = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(100)
    await result
    expect(cancelled).toHaveBeenCalledOnce()
  })
})

describe('bounded response reading', () => {
  it('cancels oversized declared responses before consuming their content', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    await expect(readBytes(new Response(body, { headers: { 'Content-Length': '11' } }), 10))
      .rejects.toMatchObject({ code: 'too_large', status: 413 })
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('counts stream bytes independently of an absent or dishonest Content-Length', async () => {
    for (const headers of [{}, { 'Content-Length': '1' }]) {
      const cancelled = vi.fn()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6))
          controller.enqueue(new Uint8Array(5))
        },
        cancel: cancelled,
      })
      await expect(readBytes(new Response(body, { headers }), 10)).rejects.toMatchObject({ code: 'too_large' })
      expect(cancelled).toHaveBeenCalledOnce()
    }
  })

  it('preserves byte order at the exact size limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    })
    await expect(readBytes(new Response(body), 4)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('cancels without reading a body when its signal is already aborted', async () => {
    const parent = new AbortController()
    parent.abort()
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    await expect(readBytes(new Response(body), 10, parent.signal)).rejects.toMatchObject({ code: 'timeout' })
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
