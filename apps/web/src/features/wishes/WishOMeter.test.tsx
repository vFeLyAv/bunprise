import { useState } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WishPriority } from '../../lib/api/types'

const feel = vi.hoisted(() => ({ haptic: vi.fn<(kind: string) => void>() }))
vi.mock('../../ui/haptics', () => ({ haptic: feel.haptic, setHaptics: () => undefined }))

import { WishOMeter } from './WishOMeter'

// The wish-o-meter ("Wie sehr?", K7): priority 1 = Kann, 2 = Gern (default), 3 = Unbedingt. A real range input
// carries keyboard and screen-reader use; pointer taps and drags work on the track (detent ticks).

/** The track's geometry in jsdom (no layout): 356 px wide at x = 0; the detents sit 28 px in → 28 · 178 · 328. */
const TRACK = { left: 0, width: 356 }

function Harness({ initial = 2, onChange }: { initial?: WishPriority; onChange?: (value: WishPriority) => void }) {
  const [value, setValue] = useState<WishPriority>(initial)
  return (
    <LazyMotion features={domMax} strict>
      <h3 id="meter-label">Wie sehr?</h3>
      <WishOMeter
        value={value}
        labelledBy="meter-label"
        onChange={(next) => {
          onChange?.(next)
          setValue(next)
        }}
      />
    </LazyMotion>
  )
}

function setup(initial?: WishPriority) {
  const onChange = vi.fn<(value: WishPriority) => void>()
  const view = render(<Harness initial={initial} onChange={onChange} />)
  const track = view.container.querySelector<HTMLElement>('[data-meter-track]')
  if (!track) throw new Error('no track')
  track.getBoundingClientRect = () => ({ ...TRACK, right: TRACK.width, top: 0, bottom: 56, height: 56, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(track, 'offsetWidth', { configurable: true, value: TRACK.width })
  const meter = track.parentElement as HTMLElement
  const slider = screen.getByRole('slider', { name: 'Wie sehr?' }) as HTMLInputElement
  return { ...view, onChange, track, meter, slider }
}

const pointer = (clientX: number, extra: Record<string, unknown> = {}) => ({ clientX, pointerId: 1, button: 0, ...extra })

beforeEach(() => {
  feel.haptic.mockReset()
})
afterEach(() => {
  delete document.documentElement.dataset.motion
})

describe('WishOMeter — semantics and keyboard', () => {
  it('is a slider named by the visible heading; the value text is the word, the description its meaning', () => {
    const { slider } = setup()
    expect(slider.getAttribute('type')).toBe('range')
    expect(slider.min).toBe('1')
    expect(slider.max).toBe('3')
    expect(slider.value).toBe('2')
    expect(slider.getAttribute('aria-valuetext')).toBe('Gern')
    const description = document.getElementById(slider.getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toBe('Darüber würde ich mich freuen.')
  })

  it('arrows step one level (and stop at the ends), Home / End and Page Down / Up jump; every change ticks once', () => {
    const { slider, onChange } = setup()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Unbedingt')
    fireEvent.keyDown(slider, { key: 'ArrowUp' }) // already at the end: nothing
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Kann')
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.keyDown(slider, { key: 'Home' })
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([3, 2, 1, 3, 1, 3])
    expect(feel.haptic).toHaveBeenCalledTimes(6)
    expect(feel.haptic).toHaveBeenCalledWith('select')
  })

  it('a screen reader’s own adjustment (the input’s change) sets the level', () => {
    const { slider, onChange } = setup()
    fireEvent.change(slider, { target: { value: '1' } })
    expect(onChange).toHaveBeenLastCalledWith(1)
    expect(slider.getAttribute('aria-valuetext')).toBe('Kann')
    expect(screen.getByText('Wäre nett – muss aber nicht.')).toBeTruthy()
  })
})

describe('WishOMeter — finger and mouse', () => {
  it('a tap on the track picks the nearest detent', () => {
    const { meter, slider, onChange } = setup()
    fireEvent.pointerDown(meter, pointer(320))
    fireEvent.pointerUp(meter, pointer(320))
    expect(slider.getAttribute('aria-valuetext')).toBe('Unbedingt')
    fireEvent.pointerDown(meter, pointer(40))
    fireEvent.pointerUp(meter, pointer(40))
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([3, 1])
  })

  it('dragging follows the finger: the level changes at each detent with one tick each, and stays where it is let go', () => {
    const { meter, slider, onChange } = setup()
    fireEvent.pointerDown(meter, pointer(178))
    fireEvent.pointerMove(meter, pointer(176)) // within the slop: still a tap
    expect(meter.hasAttribute('data-dragging')).toBe(false)
    fireEvent.pointerMove(meter, pointer(60))
    expect(meter.hasAttribute('data-dragging')).toBe(true)
    expect(slider.getAttribute('aria-valuetext')).toBe('Kann')
    fireEvent.pointerMove(meter, pointer(70)) // same detent: no second tick
    fireEvent.pointerMove(meter, pointer(200))
    fireEvent.pointerMove(meter, pointer(345))
    fireEvent.pointerUp(meter, pointer(345))
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([1, 2, 3])
    expect(feel.haptic).toHaveBeenCalledTimes(3)
    expect(meter.hasAttribute('data-dragging')).toBe(false)
    expect(slider.getAttribute('aria-valuetext')).toBe('Unbedingt')
  })

  it('a gesture the browser takes over (pointercancel: a scroll) puts the level back', () => {
    const { meter, slider } = setup()
    fireEvent.pointerDown(meter, pointer(178))
    fireEvent.pointerMove(meter, pointer(330))
    expect(slider.getAttribute('aria-valuetext')).toBe('Unbedingt')
    fireEvent.pointerCancel(meter, pointer(330))
    expect(slider.getAttribute('aria-valuetext')).toBe('Gern')
  })

  it('the words under the track can be tapped too', () => {
    const { container, slider } = setup()
    fireEvent.click(container.querySelector('[data-meter-label="1"]') as HTMLElement)
    expect(slider.getAttribute('aria-valuetext')).toBe('Kann')
  })
})

describe('WishOMeter — the heart', () => {
  it('reaching "Unbedingt" bursts into tiny hearts; opening a wish that already is "Unbedingt" does not', () => {
    const first = setup(3)
    expect(first.container.querySelector('[data-burst]')).toBeNull()
    first.unmount()
    const { container, slider } = setup(2)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(container.querySelector('[data-burst]')).not.toBeNull()
  })

  it('under reduced motion there is no burst (the level still changes)', () => {
    document.documentElement.dataset.motion = 'reduce'
    const { container, slider } = setup(2)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Unbedingt')
    expect(container.querySelector('[data-burst]')).toBeNull()
  })
})
