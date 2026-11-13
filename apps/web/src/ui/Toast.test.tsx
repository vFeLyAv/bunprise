import './test-shims-dom'
import { LazyMotion, domMax } from 'motion/react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastViewport } from './Toast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const item = { id: 'message', kind: 'info' as const, message: 'Gespeichert', duration: 4000 }
function show() {
  const dismiss = vi.fn()
  render(<LazyMotion features={domMax} strict><ToastViewport items={[item]} onDismiss={dismiss} /></LazyMotion>)
  return dismiss
}
describe('toast timer', () => {
  it('expires at four seconds even while the pointer remains over it', () => {
    const dismiss = show()
    fireEvent.pointerEnter(screen.getByRole('status'), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(4000))
    expect(dismiss).toHaveBeenCalledWith('message')
  })
  it('pauses while pressed, then resumes; pointer release does not clear keyboard focus', () => {
    const dismiss = show(); const status = screen.getByRole('status')
    fireEvent.pointerDown(status)
    act(() => vi.advanceTimersByTime(5000))
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.focus(status)
    fireEvent.pointerUp(status)
    act(() => vi.advanceTimersByTime(5000))
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.blur(status)
    act(() => vi.advanceTimersByTime(4000))
    expect(dismiss).toHaveBeenCalledWith('message')
  })
  it('a mouse press on the action does not capture the pointer, so its click reaches the button', () => {
    const capture = vi.fn()
    const original = HTMLElement.prototype.setPointerCapture
    HTMLElement.prototype.setPointerCapture = capture
    try {
      const dismiss = vi.fn(); const onClick = vi.fn()
      render(<LazyMotion features={domMax} strict><ToastViewport items={[{ ...item, action: { label: 'Rückgängig', onClick } }]} onDismiss={dismiss} /></LazyMotion>)
      const undo = screen.getByRole('button', { name: 'Rückgängig' })
      fireEvent.pointerDown(undo, { pointerId: 1, pointerType: 'mouse' })
      expect(capture).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(5000))
      expect(dismiss).not.toHaveBeenCalled()
      fireEvent.pointerUp(undo, { pointerId: 1, pointerType: 'mouse' })
      fireEvent.click(undo)
      expect(onClick).toHaveBeenCalledTimes(1)
      expect(dismiss).toHaveBeenCalledWith('message')
    } finally {
      HTMLElement.prototype.setPointerCapture = original
    }
  })
  it('a press released outside the toast does not keep it paused forever', () => {
    const dismiss = show()
    fireEvent.pointerDown(screen.getByRole('status'))
    fireEvent.pointerUp(document.body)
    act(() => vi.advanceTimersByTime(4000))
    expect(dismiss).toHaveBeenCalledWith('message')
  })
})
