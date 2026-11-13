import { describe, expect, it } from 'vitest'
import { playsInApp } from './inGallery'
import { createDirector } from './director'

// Felix 23.10: scenes that are still being worked on live only in the mascot gallery (port 5180); 24.10 he approved
// the reworked chase and the «Переел» variants (C waits for its eye fix) and sent the nibble to the gallery.
describe('scenes still in the gallery never play in the app', () => {
  it('the nibble is gallery-only; the chase and «Переел» A/B/C play', () => {
    expect(playsInApp('nibble')).toBe(false)
    expect(playsInApp('overfed', 'c')).toBe(true)
    expect(playsInApp('chase')).toBe(true)
    expect(playsInApp('overfed')).toBe(true)
    expect(playsInApp('overfed', 'a')).toBe(true)
    expect(playsInApp('overfed', 'b')).toBe(true)
    expect(playsInApp('hamster')).toBe(true)
  })

  it('the five approved 27.10 play in the app: Psst, the speck, the tower, the home icon, firm ground', () => {
    for (const name of ['secret', 'speck', 'tower', 'homeicon', 'footing']) expect(playsInApp(name), name).toBe(true)
  })

  it('the "loading" family hands over to the (approved) chase again', () => {
    const pick = createDirector()
    expect(pick('loading')?.special).toBe('chase')
  })
})
