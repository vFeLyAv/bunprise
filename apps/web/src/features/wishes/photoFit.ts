// How a wish photo sits in its tile (Felix 30.10: «у всех разные обрубки белого фона» — shop photos on white became
// white boxes of different sizes on the dark tiles). Decided from the photo's own edge, once per picture, on the
// device (a 24 px copy drawn on a canvas; our own blob: URL, so the canvas is readable; nothing leaves the device):
// - "plate": the edge is one colour (a product on white, on light grey, on black) → the whole tile takes that colour
//   and the whole product sits in it with a little air: no seam, every tile the same calm square;
// - "fill": the picture runs to its edges (an album cover, the owner's own camera photo) → it fills the tile; only
//   the picture's own edges are cut, never a product on a background;
// - null (cannot tell: no canvas, a see-through edge, a very long picture) → contained on the theme's plate, as before.

export type PhotoFit = { fit: 'plate'; plate: string } | { fit: 'fill' }

const SAMPLE = 24
/** a border pixel counts as "the plate" when no channel differs from the plate colour by more than this */
const NEAR = 16
/** share of the border that must be the plate colour */
const UNIFORM = 0.9
/** a non-uniform picture this long or tall is not cut to a square (too much would be lost) */
const MAX_FILL_RATIO = 1.6

/** Classifies a picture from its RGBA pixels (row by row, `width` × `height`). Pure, for tests. */
export function classifyPhoto(data: ArrayLike<number>, width: number, height: number): PhotoFit | null {
  if (width < 3 || height < 3) return null
  const border: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue
      border.push((y * width + x) * 4)
    }
  }
  if (border.some((i) => (data[i + 3] ?? 0) < 250)) return null
  // the plate candidate: the most frequent colour of the border, coarsely bucketed
  const buckets = new Map<number, number[]>()
  for (const i of border) {
    const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4)
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  }
  let top: number[] = []
  for (const list of buckets.values()) if (list.length > top.length) top = list
  const mean = [0, 1, 2].map((c) => Math.round(top.reduce((sum, i) => sum + data[i + c]!, 0) / top.length))
  const near = border.filter((i) => [0, 1, 2].every((c) => Math.abs(data[i + c]! - mean[c]!) <= NEAR)).length
  if (near / border.length >= UNIFORM) {
    return { fit: 'plate', plate: `#${mean.map((v) => v.toString(16).padStart(2, '0')).join('')}` }
  }
  const ratio = width / height
  return ratio > MAX_FILL_RATIO || ratio < 1 / MAX_FILL_RATIO ? null : { fit: 'fill' }
}

const fits = new Map<string, PhotoFit | null>()

/** The fit already known for this picture (a tile that comes back shows it in its first frame). */
export function knownPhotoFit(url: string): PhotoFit | null | undefined {
  return fits.get(url)
}

/** Measures a loaded <img> once per URL (a later call returns the stored answer). */
export function measurePhotoFit(img: HTMLImageElement, url: string): PhotoFit | null {
  if (fits.has(url)) return fits.get(url) ?? null
  let fit: PhotoFit | null = null
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w > 0 && h > 0) {
      const scale = SAMPLE / Math.max(w, h)
      const cw = Math.max(3, Math.round(w * scale))
      const ch = Math.max(3, Math.round(h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) {
        context.drawImage(img, 0, 0, cw, ch)
        fit = classifyPhoto(context.getImageData(0, 0, cw, ch).data, cw, ch)
      }
    }
  } catch {
    fit = null // a canvas we may not read: the calm default
  }
  if (fits.size > 200) fits.clear() // URLs of this page session only; a few bytes each
  fits.set(url, fit)
  return fit
}
