import { describe, expect, it } from 'vitest'
import {
  COVER_FADE_PX,
  COVER_PILL_SURFACE,
  MAX_PHOTO_ALPHA_UNDER_PILL,
  MAX_PHOTO_ALPHA_UNDER_TITLE,
  TITLE_INTO_COVER_PX,
  photoAlphaAt,
} from './coverGeometry'

// The contrast proof of the hero over a cover photo ("AA on the hero text!"). The worst photo for dark ink is
// black; the page under the dissolving cover is at its darkest where the page backdrop's colour fields and the
// occasion's tint are strongest. The values come from the token files themselves (tokens.css, tints.css), the
// geometry from coverGeometry.ts — the same numbers the CSS uses (HeroCover sets them as custom properties).

type Rgba = [number, number, number, number]

// The token files as text. Vitest hands CSS imports in as empty modules (even `?raw`), and the app's tsconfig
// has no Node types — so Node's own fs comes through process.getBuiltinModule (the tests run in Node 24).
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string
  existsSync(path: string): boolean
}
const nodeProcess = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown } }).process
const fs = nodeProcess?.getBuiltinModule?.('node:fs') as NodeFs | undefined
if (!nodeProcess || !fs) throw new Error('coverContrast.test.ts needs Node (process.getBuiltinModule)')
// the web app's root: vitest runs in apps/web (npm test) — or from the repo root
const appRoot = [nodeProcess.cwd(), `${nodeProcess.cwd()}/apps/web`].find((dir) => fs.existsSync(`${dir}/src/styles/tokens.css`))
if (!appRoot) throw new Error('src/styles/tokens.css not found from the working directory')
const tokensCss = fs.readFileSync(`${appRoot}/src/styles/tokens.css`, 'utf8')
const tintsCss = fs.readFileSync(`${appRoot}/src/styles/tints.css`, 'utf8')

function hex(value: string): Rgba {
  const h = value.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
}

function rgba(value: string): Rgba {
  const [r, g, b, a] = value.replace(/rgba?\(|\)/g, '').split(',').map((part) => Number(part.trim()))
  return [r as number, g as number, b as number, a ?? 1]
}

/** The light value of a token like `--text: light-dark(#2A231C, #F5F5F7)` or `--accent-600: #984A14`. */
function token(css: string, name: string): Rgba {
  const match = new RegExp(`${name}:\\s*(?:light-dark\\()?\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))`).exec(css)
  if (!match?.[1]) throw new Error(`token ${name} not found`)
  return match[1].startsWith('#') ? hex(match[1]) : rgba(match[1])
}

/** a over b (b opaque), in sRGB like the browser composites */
function over(a: Rgba, b: Rgba): Rgba {
  const alpha = a[3]
  return [a[0] * alpha + b[0] * (1 - alpha), a[1] * alpha + b[1] * (1 - alpha), a[2] * alpha + b[2] * (1 - alpha), 1]
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Every colour the page under the cover can have: backdrop stops and fields over --bg, then each tint. */
function pagePoints(): Rgba[] {
  const backdrop = /--page-backdrop:([\s\S]*?);/.exec(tokensCss)?.[1] ?? ''
  // since the dark theme (25.10) the backdrop names its colours as tokens (--page-glow-N, --page-top …): their
  // light values count like literal ones
  const named = [...backdrop.matchAll(/var\((--[\w-]+)\)/g)].map((m) => token(tokensCss, m[1] as string))
  const bases = [token(tokensCss, '--bg'), ...(backdrop.match(/#[0-9A-Fa-f]{6}/g) ?? []).map(hex), ...named.filter((c) => c[3] === 1)]
  const fields = [...(backdrop.match(/rgba\([^)]*\)/g) ?? []).map(rgba), ...named.filter((c) => c[3] < 1)]
  const page = bases.flatMap((base) => [base, ...fields.map((field) => over(field, base))])
  const tints = [1, 2, 3, 4].map((n) => token(tintsCss, `--tint-${n}`))
  return page.flatMap((point) => [point, ...tints.map((tint) => over(tint, point))])
}

const BLACK: Rgba = [0, 0, 0, 1]
const withAlpha = (color: Rgba, alpha: number): Rgba => [color[0], color[1], color[2], alpha]

describe('the hero text over a cover photo keeps AA', () => {
  const page = pagePoints()
  const text = token(tokensCss, '--text')
  const text2 = token(tokensCss, '--text-2')
  const accent = token(tokensCss, '--accent-600') // --accent-text in the light theme
  const surface = token(tokensCss, '--surface')

  it('the page points were found (the proof is not vacuous)', () => {
    expect(page.length).toBeGreaterThan(20)
    expect(TITLE_INTO_COVER_PX).toBeGreaterThan(0) // the title does sit on the fading photo
    expect(MAX_PHOTO_ALPHA_UNDER_TITLE).toBeGreaterThan(0)
  })

  it('the title (--text) over the fading edge of a BLACK photo: ≥ 4.5 : 1 at its strongest point', () => {
    const worst = Math.min(...page.map((point) => contrast(text, over(withAlpha(BLACK, MAX_PHOTO_ALPHA_UNDER_TITLE), point))))
    expect(worst).toBeGreaterThanOrEqual(4.5) // large bold text would need 3 : 1
    // and the photo is really gone a little further down (the cover's last pixel)
    expect(photoAlphaAt(0)).toBe(0)
    expect(photoAlphaAt(COVER_FADE_PX)).toBe(1)
  })

  it('the day pill and the upload pill (nearly opaque glass) over a BLACK photo: accent and secondary text ≥ 4.5 : 1', () => {
    for (const point of page) {
      const underPill = over(withAlpha(BLACK, MAX_PHOTO_ALPHA_UNDER_PILL), point)
      const pill = over(withAlpha(surface, COVER_PILL_SURFACE), underPill)
      expect(contrast(accent, pill)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(text2, pill)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('even a pill over the fully opaque photo would pass (a margin for long day labels that wrap)', () => {
    const pill = over(withAlpha(surface, COVER_PILL_SURFACE), BLACK)
    expect(contrast(accent, pill)).toBeGreaterThanOrEqual(4.5)
  })
})
