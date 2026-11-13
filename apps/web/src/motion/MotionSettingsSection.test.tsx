import '../ui/test-shims-dom'
import { LazyMotion, domMax } from 'motion/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOTION_STORAGE_KEY, resetMotionLevelForTests, startMotionLevel } from './level'
import { MotionSettingsSection } from './MotionSettingsSection'
import { feedback, feedbackSettings } from '../lib/haptics'
import { nightSleep } from '../features/mascot-ui/nightSetting'

// Settings → "Bewegung" (K9): the three rows change the device's motion level at once.

function renderSection() {
  return render(
    <LazyMotion features={domMax} strict>
      <MotionSettingsSection />
    </LazyMotion>,
  )
}

beforeEach(() => {
  resetMotionLevelForTests()
  window.localStorage.clear()
  vi.stubGlobal('navigator', { ...navigator, getBattery: undefined })
  startMotionLevel()
})

afterEach(() => {
  resetMotionLevelForTests()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('MotionSettingsSection', () => {
  it('«Nachts schlafen» sits right under «Kaninchen zeigen», on by default; it is the mascots’ own setting (same key, live)', () => {
    renderSection()
    const switches = screen.getAllByRole('switch')
    const night = screen.getByRole('switch', { name: /Nachts schlafen/ })
    expect(switches.indexOf(night)).toBe(switches.indexOf(screen.getByRole('switch', { name: /Kaninchen zeigen/ })) + 1)
    expect(night.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Von 23 bis 7 Uhr schlafen Pompon und Tapsi. Antippen weckt sie.')).toBeTruthy()
    // a sleeping mascot on a mounted screen hears it at once (features/mascot-ui/nightSetting.ts)
    const heard = vi.fn()
    const off = nightSleep.subscribe(heard)
    fireEvent.click(night)
    expect(night.getAttribute('aria-checked')).toBe('false')
    expect(nightSleep.get()).toBe(false)
    expect(heard).toHaveBeenCalledTimes(1)
    fireEvent.click(night)
    expect(nightSleep.get()).toBe(true)
    off()
  })

  it('without mascots («Kaninchen zeigen» off or «Aus») there is nobody to put to bed: «Nachts schlafen» is off and disabled', () => {
    renderSection()
    fireEvent.click(screen.getByRole('switch', { name: /Kaninchen zeigen/ }))
    const night = screen.getByRole('switch', { name: /Nachts schlafen/ }) as HTMLButtonElement
    expect(night.getAttribute('aria-checked')).toBe('false')
    expect(night.disabled).toBe(true)
    // the stored choice stays (on) for when the mascots come back
    expect(nightSleep.get()).toBe(true)
  })

  it('shows Animationen (Voll · Weniger · Aus), Kaninchen zeigen and the battery saver', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Bewegung' })).toBeTruthy()
    const group = screen.getByRole('radiogroup', { name: 'Animationen' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Voll' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /Kaninchen zeigen/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /Bei wenig Akku sparen/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('"Weniger" and "Aus" change the level of the whole app and are stored on this device', () => {
    renderSection()
    fireEvent.click(screen.getByRole('radio', { name: 'Weniger' }))
    expect(document.documentElement.dataset['motion']).toBe('reduce')
    fireEvent.click(screen.getByRole('radio', { name: 'Aus' }))
    expect(document.documentElement.dataset['motion']).toBe('off')
    expect(document.documentElement.dataset['bunnies']).toBe('off')
    expect(JSON.parse(window.localStorage.getItem(MOTION_STORAGE_KEY) ?? '{}').level).toBe('off')
    // with "Aus" the bunnies rest too: the switch says so and cannot be turned on
    const bunnies = screen.getByRole('switch', { name: /Kaninchen zeigen/ })
    expect(bunnies.getAttribute('aria-checked')).toBe('false')
    expect((bunnies as HTMLButtonElement).disabled).toBe(true)
  })

  it('"Kaninchen zeigen" off hides the mascots but keeps the animations', () => {
    renderSection()
    fireEvent.click(screen.getByRole('switch', { name: /Kaninchen zeigen/ }))
    expect(document.documentElement.dataset['bunnies']).toBe('off')
    expect(document.documentElement.dataset['motion']).toBe('full')
  })

  it('says honestly when the browser has no Battery API', () => {
    renderSection()
    expect(screen.getByText(/verrät den Akkustand nicht/)).toBeTruthy()
  })

  it('the feedback switch disables both vibration and audio before the next result', () => {
    const vibrate = vi.fn()
    const audio = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    vi.stubGlobal('AudioContext', audio)
    renderSection()
    fireEvent.click(screen.getByRole('switch', { name: /Vibration & Ton/ }))
    expect(feedbackSettings.haptics.get()).toBe(false)
    expect(feedbackSettings.sounds.get()).toBe(false)
    vibrate.mockClear()
    feedback('success')
    expect(vibrate).not.toHaveBeenCalled()
    expect(audio).not.toHaveBeenCalled()
  })

  // «Bewegung erlauben» (31.10): the shake that makes Pompon dizzy needs the iPhone's permission, asked from a tap
  it('no motion permission API (Android, desktop): no «Schütteln» row', () => {
    renderSection()
    expect(screen.queryByText('Schütteln')).toBeNull()
  })

  it('an iPhone: «Schütteln · Erlauben» asks the browser from the tap and says the answer', async () => {
    const requestPermission = vi.fn(() => Promise.resolve('granted' as const))
    vi.stubGlobal('DeviceMotionEvent', Object.assign(function DeviceMotionEvent() {}, { requestPermission }))
    renderSection()
    expect(screen.getByText('Schütteln')).toBeTruthy()
    expect(screen.getByText(/Pompon wird kurz schwindelig/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Erlauben' }))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    const allowed = await screen.findByRole('button', { name: 'Erlaubt' })
    expect(allowed.hasAttribute('disabled')).toBe(true)
  })

  it('an iPhone that said no: an honest line; without mascots the button is off', async () => {
    vi.stubGlobal('DeviceMotionEvent', Object.assign(function DeviceMotionEvent() {}, { requestPermission: () => Promise.resolve('denied' as const) }))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Erlauben' }))
    expect(await screen.findByText(/Nicht erlaubt/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /Kaninchen zeigen/ }))
    expect(screen.getByRole('button', { name: 'Erlauben' }).hasAttribute('disabled')).toBe(true)
  })
})
