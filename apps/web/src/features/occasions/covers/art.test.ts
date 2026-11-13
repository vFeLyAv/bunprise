import { describe, expect, it } from 'vitest'
import { CROPS, cachedCoverMarkup, loadCoverMarkup } from './art'
import { PALETTE_KEYS } from './art/kit'
import { THEME_IDS, type ThemeId } from './themes'

// The cover pictures (ported from the gallery prototype): our own drawings in code, one lazy chunk per motif.
// Safe to put into the DOM as markup, coloured only through the palette (light AND dark), small.

// covers.css as text: Vitest hands CSS imports in as empty modules (even `?raw`) and the app's tsconfig has no Node
// types — Node's fs comes through process.getBuiltinModule (like photo/coverContrast.test.ts).
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string
  existsSync(path: string): boolean
}
const nodeProcess = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown } }).process
const fs = nodeProcess?.getBuiltinModule?.('node:fs') as NodeFs | undefined
if (!nodeProcess || !fs) throw new Error('art.test.ts needs Node (process.getBuiltinModule)')
const CSS_PATH = 'src/features/occasions/covers/covers.css'
const appRoot = [nodeProcess.cwd(), `${nodeProcess.cwd()}/apps/web`].find((dir) => fs.existsSync(`${dir}/${CSS_PATH}`))
if (!appRoot) throw new Error(`${CSS_PATH} not found from the working directory`)
const css = fs.readFileSync(`${appRoot}/${CSS_PATH}`, 'utf8')

/** which motifs carry a small guest (docs/design/2026-10-26-occasion-covers.md, the table) */
const GUESTS: Partial<Record<ThemeId, 'pompon' | 'tapsi'>> = { birthday: 'pompon', gamenight: 'tapsi', picnic: 'tapsi', christmas: 'pompon', easter: 'pompon' }

async function all(): Promise<[ThemeId, string][]> {
  return Promise.all(THEME_IDS.map(async (id) => [id, await loadCoverMarkup(id)] as [ThemeId, string]))
}

/** gzip size through the platform's CompressionStream (null when the environment has none). */
async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream !== 'function' || typeof Response !== 'function') return null
  const stream = new Response(text).body?.pipeThrough(new CompressionStream('gzip'))
  return stream ? (await new Response(stream).arrayBuffer()).byteLength : null
}

describe('the pictures', () => {
  it('every motif has its own picture, drawn once and the same every time', async () => {
    const seen = new Set<string>()
    for (const [id, markup] of await all()) {
      expect(markup.length, id).toBeGreaterThan(400)
      expect(cachedCoverMarkup(id)).toBe(markup)
      expect(await loadCoverMarkup(id)).toBe(markup)
      seen.add(markup)
    }
    expect(seen.size).toBe(THEME_IDS.length)
  })

  it('colours only through the palette (var(--cv-…)), every key defined light AND dark in covers.css', async () => {
    const used = new Set<string>()
    for (const [id, markup] of await all()) {
      expect(markup, id).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i)
      for (const m of markup.matchAll(/\s(fill|stroke|stop-color)="([^"]*)"/g)) {
        const value = m[2] ?? ''
        if (value === 'none') continue
        const token = /^var\(--cv-([a-zA-Z0-9]+)\)$/.exec(value)
        expect(token, `${id}: ${m[0]}`).not.toBeNull()
        if (token?.[1]) used.add(token[1])
      }
    }
    for (const key of used) expect(PALETTE_KEYS as readonly string[], key).toContain(key)
    for (const key of PALETTE_KEYS) {
      // a light and a dark value (the dark one also serves "Blau" and "Ozean")
      const line = new RegExp(`--cv-${key}: light-dark\\((#[0-9A-F]{6}|rgba\\([\\d,.]+\\)), (#[0-9A-F]{6}|rgba\\([\\d,.]+\\))\\);`).exec(css)
      expect(line, key).not.toBeNull()
    }
    expect(css.match(/--cv-[a-zA-Z0-9]+:/g)?.length).toBe(PALETTE_KEYS.length)
  })

  it('safe to put anywhere: no text, no links, no ids, no scripts, no handlers, nothing loaded', async () => {
    for (const [id, markup] of await all()) {
      expect(markup, id).not.toMatch(/<text|<image|<script|<foreignObject|<style|href|url\(|\sid=|\son[a-z]+=/i)
    }
  })

  it('the small guests: Pompon or Tapsi exactly where the list says', async () => {
    for (const [id, markup] of await all()) {
      expect(markup.includes('var(--cv-fur)'), `${id} Pompon`).toBe(GUESTS[id] === 'pompon')
      expect(markup.includes('var(--cv-ham)'), `${id} Tapsi`).toBe(GUESTS[id] === 'tapsi')
    }
  })

  it('small: ≤ 14 KB raw and ≤ 3.5 KB gzip each', async () => {
    let total = 0
    for (const [id, markup] of await all()) {
      expect(markup.length, id).toBeLessThanOrEqual(14 * 1024)
      const gz = await gzipSize(markup)
      if (gz !== null) {
        expect(gz, id).toBeLessThanOrEqual(3.5 * 1024)
        total += gz
      }
    }
    if (total) expect(total).toBeLessThanOrEqual(40 * 1024)
  })

  it('two crops of one canvas: the whole cover and the zoomed middle for the picker', () => {
    expect(CROPS.cover).toBe('0 0 480 320')
    expect(CROPS.thumb).toBe('130 44 220 180')
  })
})
