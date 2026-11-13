import '../../ui/test-shims-dom'
import { useEffect, useImperativeHandle, type Ref } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Scene } from '@bunprise/mascot'
import type { MascotHandle } from '../mascot-ui/Mascot'

const actor = vi.hoisted(() => ({
  ready: false, busy: false,
  play: vi.fn<(scene: Scene) => Promise<void>>(),
  mounted: () => {},
  ended: (_scene: Scene) => {},
}))
vi.mock('../mascot-ui/Mascot', () => ({ Mascot: ({ ref, onReady, onSceneEnd }: {
  ref: Ref<MascotHandle>; onReady?: () => void; onSceneEnd?: (scene: Scene) => void
}) => {
  useImperativeHandle(ref, () => ({
    play: actor.play, tap: () => {}, hop: async () => {},
    get instance() { return actor.ready ? { busy: actor.busy } as MascotHandle['instance'] : null },
  }))
  useEffect(() => {
    actor.mounted = () => { actor.ready = true; onReady?.() }
    return () => { actor.ready = false; actor.busy = false }
  }, [onReady])
  actor.ended = (scene) => { onSceneEnd?.(scene); actor.busy = false }
  return <span data-testid="bunny" />
} }))
vi.mock('../mascot-ui/MoveMoment', () => ({ default: () => <span data-testid="chase" /> }))
// the gallery list (inGallery.ts) with a switch: `approved` = as if Felix had approved every scene
const gallery = vi.hoisted(() => ({ approved: false }))
vi.mock('../mascot-ui/inGallery', async (importOriginal) => {
  const real = await importOriginal<typeof import('../mascot-ui/inGallery')>()
  return { playsInApp: (scene: string) => gallery.approved || real.playsInApp(scene) }
})
import { BunnyPeek } from './BunnyPeek'

beforeEach(() => {
  vi.useFakeTimers()
  actor.ready = false; actor.busy = false
  actor.play.mockReset().mockImplementation(async () => { actor.busy = true })
  document.documentElement.dataset.motion = 'full'
  document.documentElement.dataset.bunnies = 'on'
})
afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.removeAttribute('data-bunnies')
})

it('plays a queued success once after the greeting, without a second declarative scene request', () => {
  const view = render(<BunnyPeek mood="hello" />)
  act(() => actor.mounted())
  expect(actor.play.mock.calls).toEqual([['greet']])
  view.rerender(<BunnyPeek mood="joy" joyScene="surprise" />)
  expect(actor.play).toHaveBeenCalledTimes(1)
  act(() => { actor.ended('greet'); vi.advanceTimersByTime(0) })
  expect(actor.play.mock.calls).toEqual([['greet'], ['surprise']])
  act(() => { actor.ended('surprise'); vi.advanceTimersByTime(1000) })
  expect(actor.play).toHaveBeenCalledTimes(2)
})

it('cancels an obsolete queued success when the form becomes calm', () => {
  const view = render(<BunnyPeek mood="hello" />)
  act(() => actor.mounted())
  view.rerender(<BunnyPeek mood="joy" />)
  view.rerender(<BunnyPeek mood="calm" />)
  act(() => { actor.ended('greet'); vi.advanceTimersByTime(1000) })
  expect(actor.play.mock.calls).toEqual([['greet']])
})

it('starts sniffing again for a later request even when the initial mood was sniff', () => {
  const view = render(<BunnyPeek mood="sniff" />)
  act(() => actor.mounted())
  act(() => actor.ended('alert'))
  view.rerender(<BunnyPeek mood="calm" />)
  act(() => vi.advanceTimersByTime(450))
  expect(actor.play).toHaveBeenCalledTimes(1)
  view.rerender(<BunnyPeek mood="sniff" />)
  expect(actor.play.mock.calls).toEqual([['alert'], ['alert']])
})

it('hands long loading to chase (approved 24.10) and remounts only the current response afterwards', async () => {
  gallery.approved = true // also holds should the chase ever go back to the gallery (inGallery.ts)
  try {
    const view = render(<BunnyPeek mood="sniff" />)
    act(() => actor.mounted())
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByTestId('chase')).toBeTruthy()
    expect(screen.queryByTestId('bunny')).toBeNull()
    view.rerender(<BunnyPeek mood="joy" />)
    act(() => actor.mounted())
    expect(actor.play.mock.calls).toEqual([['alert'], ['jump']])
  } finally {
    gallery.approved = false
  }
})

it('"Weniger": Pompon\'s line is calm secondary text (an existing colour token), no bunny', () => {
  document.documentElement.dataset.motion = 'reduce'
  render(<BunnyPeek mood="hello" says="Hast du einen Link für mich?" />)
  const line = screen.getByText('Hast du einen Link für mich?')
  expect(line.className).toContain('text-text-2')
  expect(line.className).not.toContain('text-text-secondary')
  expect(screen.queryByTestId('bunny')).toBeNull()
})
