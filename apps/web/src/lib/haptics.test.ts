import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canVibrate, haptic, setHapticSink } from './haptics'

// The one haptics wrapper: an optional sink (the Telegram bridge registers one) replaces navigator.vibrate; the
// settings switch decides first either way.

let vibrate: ReturnType<typeof vi.fn>

beforeEach(() => {
  vibrate = vi.fn()
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
})

afterEach(() => {
  setHapticSink(null)
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'vibrate')
})

describe('haptics sink', () => {
  it('without a sink: the browser vibrates as before', () => {
    haptic('success')
    expect(vibrate).toHaveBeenCalledWith([10, 40, 14])
  })

  it('with a sink: every kind goes there instead of navigator.vibrate', () => {
    const sink = vi.fn()
    setHapticSink(sink)
    for (const kind of ['tap', 'select', 'success', 'warning', 'error'] as const) haptic(kind)
    expect(sink.mock.calls.map(([kind]) => kind)).toEqual(['tap', 'select', 'success', 'warning', 'error'])
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('the settings switch still wins over the sink', () => {
    const sink = vi.fn()
    setHapticSink(sink)
    localStorage.setItem('bunprise.haptics', '0')
    haptic('tap')
    expect(sink).not.toHaveBeenCalled()
  })

  it('a throwing sink never breaks the caller', () => {
    setHapticSink(() => {
      throw new Error('client gone')
    })
    expect(() => haptic('tap')).not.toThrow()
  })

  it('canVibrate: true with a sink even where the browser cannot vibrate (iPhone in Telegram)', () => {
    Reflect.deleteProperty(navigator, 'vibrate')
    expect(canVibrate()).toBe(false)
    setHapticSink(() => undefined)
    expect(canVibrate()).toBe(true)
  })
})
