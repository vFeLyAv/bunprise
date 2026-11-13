import '../../ui/test-shims-dom'
import { useEffect, useRef } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('./MoveMoment', () => ({ default: ({ kind, onStart }: { kind: string; onStart: () => void }) => {
  useEffect(onStart, [onStart]);return <div data-surprise={kind} />
} }))
vi.mock('./BunnyMoment', () => ({ BunnyMoment: () => <div data-friend-hop="" /> }))
// «Ночью маскоты спят»: the sleeping Pompon (NightSleeper.tsx; the rules: night.test.ts)
vi.mock('./NightSleeper', () => ({ default: ({ kind, coat, size, live }: { kind: string; coat?: string; size: number; live?: boolean }) => <div data-night={kind} data-coat={coat} data-size={size} data-live={String(!!live)} /> }))
// the gallery list (inGallery.ts) with a switch: `approved` = as if Felix had approved every scene
const gallery = vi.hoisted(() => ({ approved: false }))
vi.mock('./inGallery', async (importOriginal) => {
  const real = await importOriginal<typeof import('./inGallery')>()
  return { playsInApp: (scene: string) => gallery.approved || real.playsInApp(scene) }
})
import StartSurprise, { START_SURPRISE_KEY, startSurpriseDay, startSurpriseKind } from './StartSurprise'
function Screen() { const ref = useRef<HTMLDivElement>(null);return <div ref={ref}><StartSurprise targetRef={ref} /></div> }
beforeEach(() => { vi.useFakeTimers();localStorage.clear();document.documentElement.dataset.motion = 'full' })
afterEach(() => { vi.useRealTimers();document.documentElement.removeAttribute('data-motion') })
it('waits four calm seconds, notes only a day, and replaces the friend hop', async () => {
  vi.setSystemTime(new Date(2026, 9, 23));const view = render(<Screen />)
  await act(() => vi.advanceTimersByTimeAsync(3999));expect(view.container.querySelector('[data-surprise]')).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(1));expect(view.container.querySelector('[data-surprise]')).not.toBeNull()
  expect(view.container.querySelector('[data-friend-hop]')).toBeNull()
  expect(localStorage.getItem(START_SURPRISE_KEY)).toBe(startSurpriseDay())
  // the nibble is in the gallery (24.10): every rare day is the (approved) chase …
  expect(startSurpriseKind(new Date(2026, 9, 23))).toBe('chase')
  expect(startSurpriseKind(new Date(2026, 9, 24))).toBe('chase')
  // … once the nibble is approved too, the days alternate again
  gallery.approved = true
  try {
    expect(startSurpriseKind(new Date(2026, 9, 23))).not.toBe(startSurpriseKind(new Date(2026, 9, 24)))
  } finally {
    gallery.approved = false
  }
})
it('drops an interrupted decoration instead of waiting behind typing or scrolling', async () => {
  vi.setSystemTime(new Date(2026, 9, 25));const view = render(<Screen />)
  fireEvent.scroll(document);await act(() => vi.advanceTimersByTimeAsync(9000))
  expect(view.container.querySelector('[data-surprise]')).toBeNull();expect(localStorage.getItem(START_SURPRISE_KEY)).toBeNull()
})

it('23:00 – 07:00 Pompon sleeps on the first card’s right corner instead of the friend hop and the surprise', async () => {
  vi.setSystemTime(new Date(2026, 9, 23, 23, 30));globalThis.__bunpriseNightClock = () => Date.now()
  const view = render(<Screen />)
  await act(() => vi.advanceTimersByTimeAsync(5000))
  const sleeper = view.container.querySelector<HTMLElement>('[data-night]')
  expect(sleeper?.dataset.night).toBe('bunny');expect(sleeper?.dataset.coat).toBe('fawn');expect(sleeper?.dataset.size).toBe('96')
  // opened at night: he already sleeps (no falling-asleep moment)
  expect(sleeper?.dataset.live).toBe('false')
  expect(view.container.querySelector('[data-friend-hop]')).toBeNull();expect(view.container.querySelector('[data-surprise]')).toBeNull()
  expect(localStorage.getItem(START_SURPRISE_KEY)).toBeNull()
})
it('under Weniger he sleeps there too (the still pose: closed eyes do not stare at you); 07:00 on screen: he stays', async () => {
  document.documentElement.dataset.motion = 'reduce'
  vi.setSystemTime(new Date(2026, 9, 24, 6, 59, 50));globalThis.__bunpriseNightClock = () => Date.now()
  const view = render(<Screen />)
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(view.container.querySelector('[data-night]')).not.toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(20000))
  expect(view.container.querySelector('[data-night]')).not.toBeNull()
})
it('the night begins while Start is open: he comes and falls asleep in front of you (live)', async () => {
  vi.setSystemTime(new Date(2026, 9, 25, 22, 59, 58));globalThis.__bunpriseNightClock = () => Date.now()
  localStorage.setItem(START_SURPRISE_KEY, startSurpriseDay())
  const view = render(<Screen />)
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(view.container.querySelector('[data-friend-hop]')).not.toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(view.container.querySelector('[data-friend-hop]')).toBeNull()
  expect(view.container.querySelector<HTMLElement>('[data-night]')?.dataset.live).toBe('true')
})
it('«Nachts schlafen» off: the night is a day here', async () => {
  vi.setSystemTime(new Date(2026, 9, 26, 23, 30));globalThis.__bunpriseNightClock = () => Date.now()
  localStorage.setItem('bunprise.nightSleep', '0');localStorage.setItem(START_SURPRISE_KEY, startSurpriseDay())
  const view = render(<Screen />)
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(view.container.querySelector('[data-night]')).toBeNull();expect(view.container.querySelector('[data-friend-hop]')).not.toBeNull()
})
