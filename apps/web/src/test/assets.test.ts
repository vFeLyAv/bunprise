import { describe, expect, it } from 'vitest'
import iconSvg from '../../public/icons/icon.svg?raw'
import ogPngDataUrl from '../../public/og.png?inline'

// Static brand assets (docs/mascot/icon.md): the link-preview image and the icon master.
// scripts/og.mjs reuses the bunny from icon.svg, and the SVG doubles as the favicon.
// (Read through Vite's ?raw / ?inline imports: the app's tsconfig has no Node types.)

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

describe('brand assets', () => {
  it('og.png is a 1200×630 PNG within the 150 KB budget (performance-plan §7.3)', () => {
    const png = bytesOf(ogPngDataUrl)
    const view = new DataView(png.buffer)
    const ascii = (from: number, to: number) => String.fromCharCode(...png.subarray(from, to))
    expect(ascii(1, 4)).toBe('PNG')
    expect(ascii(12, 16)).toBe('IHDR')
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630])
    expect(png.length).toBeLessThanOrEqual(150 * 1024)
  })

  it('icon.svg keeps the 1024 viewBox and the defs og.mjs needs, and stays valid XML for the favicon', () => {
    expect(iconSvg).toMatch(/viewBox="0 0 1024 1024"/)
    expect(iconSvg).toContain('id="bunny-head"')
    expect(iconSvg).toContain('id="bunny-paws"')
    // "--" inside an XML comment makes the whole file invalid (resvg and browsers reject it)
    for (const comment of iconSvg.match(/<!--([\s\S]*?)-->/g) ?? []) {
      expect(comment.slice(4, -3)).not.toContain('--')
    }
  })
})
