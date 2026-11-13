import { describe, expect, it } from 'vitest'
import { classifyPhoto } from './photoFit'

type Rgb = [number, number, number]

/** A width × height picture: `edge` around, `inside` within (or a function per pixel). */
function picture(width: number, height: number, paint: (x: number, y: number) => Rgb, alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y)
      data.set([r, g, b, alpha], (y * width + x) * 4)
    }
  }
  return data
}
/** the product in the middle (x 4…19, y 2…5), the background around it on every edge */
const framed = (edge: Rgb, inside: Rgb) => (x: number, y: number): Rgb => (x > 3 && x < 20 && y > 1 && y < 6 ? inside : edge)

describe('classifyPhoto (Felix 30.10: no white boxes of different sizes on the tiles)', () => {
  it('a product on white → the tile takes white', () => {
    expect(classifyPhoto(picture(24, 8, framed([255, 255, 255], [40, 44, 50])), 24, 8)).toEqual({ fit: 'plate', plate: '#ffffff' })
  })

  it('a product on light grey or on black → the tile takes that colour (JPEG noise included)', () => {
    const grey = classifyPhoto(picture(24, 24, (x, y) => (x + y) % 3 === 0 ? [242, 242, 244] : [238, 239, 240]), 24, 24)
    expect(grey?.fit).toBe('plate')
    const black = classifyPhoto(picture(24, 18, framed([8, 8, 8], [200, 30, 30])), 24, 18)
    expect(black).toEqual({ fit: 'plate', plate: '#080808' })
  })

  it('a picture that runs to its edges (an album cover, a camera photo) → fills the tile', () => {
    const photo = classifyPhoto(picture(24, 24, (x, y) => [x * 10, y * 10, (x * y) % 255]), 24, 24)
    expect(photo).toEqual({ fit: 'fill' })
  })

  it('a long or tall picture without a plain edge is not cut to a square; a see-through edge is left as before', () => {
    expect(classifyPhoto(picture(24, 8, (x, y) => [x * 10, y * 30, 90]), 24, 8)).toBeNull()
    expect(classifyPhoto(picture(24, 24, () => [255, 255, 255], 0), 24, 24)).toBeNull()
    expect(classifyPhoto(new Uint8ClampedArray(8), 2, 1)).toBeNull()
  })
})
