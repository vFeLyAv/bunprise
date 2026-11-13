import { describe, expect, it } from 'vitest'
import { cut, sanitize } from '../src/text'

describe('display text hygiene', () => {
  it('replaces NUL with the replacement character and every other C0, DEL and C1 control with a space', () => {
    expect(sanitize('a\u0000b')).toBe('a\ufffdb')
    for (let code = 1; code <= 0x1f; code++) {
      expect(sanitize(`a${String.fromCharCode(code)}b`), `C0 U+${code.toString(16)}`).toBe('a b')
    }
    for (let code = 0x7f; code <= 0x9f; code++) {
      expect(sanitize(`a${String.fromCharCode(code)}b`), `DEL/C1 U+${code.toString(16)}`).toBe('a b')
    }
  })

  it('removes every bidi embedding, override, isolate and directional mark', () => {
    const codes = [
      0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
      0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c,
    ]
    for (const code of codes) {
      expect(sanitize(`a${String.fromCharCode(code)}b`), `Bidi U+${code.toString(16)}`).toBe('ab')
    }
  })

  it('replaces lone high and low surrogates wherever they appear and preserves valid pairs', () => {
    for (const code of [0xd800, 0xdbff, 0xdc00, 0xdfff]) {
      const surrogate = String.fromCharCode(code)
      expect(sanitize(`${surrogate}a${surrogate}b${surrogate}`)).toBe('\ufffda\ufffdb\ufffd')
    }
    expect(sanitize('\ud800\ud800\udc00\udfff')).toBe('\ufffd\ud800\udc00\ufffd')
    expect(sanitize('Gift 🎁 𠮷 \ud800\udc00 \udbff\udfff')).toBe('Gift 🎁 𠮷 \ud800\udc00 \udbff\udfff')
  })

  it('collapses Unicode whitespace and trims after controls and marks are removed', () => {
    expect(sanitize('\u200e \t A\u0001 \u0085\u00a0\u2003B \n\u202e')).toBe('A B')
    expect(sanitize('Café—東京')).toBe('Café—東京')
  })
})

describe('display text limits', () => {
  it('keeps every cut on a code-point boundary within the UTF-16 limit', () => {
    const value = 'a🎁𠮷z'
    const expected = ['', 'a', 'a', 'a🎁', 'a🎁', 'a🎁𠮷', value]
    for (let limit = 0; limit <= value.length; limit++) {
      const result = cut(value, limit)
      expect(result).toBe(expected[limit])
      expect(result.length).toBeLessThanOrEqual(limit)
    }
  })

  it('can cut at words, keeps a complete word at the boundary, and caps a single long word', () => {
    expect(cut('Gift for someone', 10, true)).toBe('Gift for')
    expect(cut('Gift for someone', 8, true)).toBe('Gift for')
    expect(cut('abcdefgh', 4, true)).toBe('abcd')
    expect(cut('Gift 🎁🎁', 6, true)).toBe('Gift')
    expect(cut('Gift 🎁🎁', 6)).toBe('Gift')
    expect(cut('Gift', 4, true)).toBe('Gift')
  })
})
