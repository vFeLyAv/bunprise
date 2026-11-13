import { describe, expect, it } from 'vitest'
import { encodeQr, qrPath } from './encode'

// Our own QR encoder (add-friends-design §2.1). The reference matrix below was decoded by an independent decoder
// (jsQR 1.4.0, outside the repo, 27.10.2026) back to exactly this URL — together with versions 1–10, UTF-8 text and
// codes with damaged data modules that error correction repaired (60 / 60). The test pins that output.

const REFERENCE_URL = 'https://bunprise.de/f#K7M4QX2P'
const REFERENCE = [
  '#######.#.##...##.##..#######',
  '#.....#..#..###.##..#.#.....#',
  '#.###.#.#...#.####..#.#.###.#',
  '#.###.#...#.#.#..#....#.###.#',
  '#.###.#..#...###.#..#.#.###.#',
  '#.....#.#..##..#.##...#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '.........#.#..###.###........',
  '#.#...##..#####..#.##..#..#.#',
  '#..###.....#.##..#.#####...##',
  '#.##..#..#.....#.#.#.######.#',
  '#....#...#.###....###.#..#...',
  '###.###.#.####.##.#.#.#.....#',
  '.#.###..##.##...#.##..##...##',
  '.##.#.##...#.##.##.#.#.#....#',
  '.##.#...#..#..###...##.##....',
  '.#..####.....##..#.##.##....#',
  '...#.......#.##...######..###',
  '#####.##.##....#.######.##..#',
  '..#.....#....#....#.####.....',
  '########.#...#.###.#######.#.',
  '........#.###...###.#...###.#',
  '#######.####.##.###.#.#.#...#',
  '#.....#..#.##.###..##...#...#',
  '#.###.#....#.##.#.########...',
  '#.###.#..##...#...#.##.#####.',
  '#.###.#.#...#.###.#..#..#..##',
  '#.....#..###........##..##...',
  '#######.##.##.##.#.##.####..#',
]

function rows(text: string): string[] {
  const { size, dark } = encodeQr(text)
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (dark[y * size + x] ? '#' : '.')).join(''))
}

describe('encodeQr', () => {
  it('the friend-code URL: exactly the reference matrix (version 3, 29 × 29)', () => {
    expect(rows(REFERENCE_URL)).toEqual(REFERENCE)
  })

  it('picks the smallest version that holds the bytes at level M (14 / 26 / 42 / … / 213 bytes)', () => {
    const sizes = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213].map((n) => encodeQr('x'.repeat(n)).size)
    expect(sizes).toEqual([21, 25, 29, 33, 37, 41, 45, 49, 53, 57])
    expect(encodeQr('x'.repeat(15)).size).toBe(25)
    // a follow link (64 hex) fits version 6
    expect(encodeQr(`https://bunprise.de/f#${'7e'.repeat(32)}`).size).toBe(41)
    expect(() => encodeQr('x'.repeat(214))).toThrow(RangeError)
  })

  it('the three finder patterns sit in their corners, the timing lines alternate', () => {
    const grid = rows('https://bunprise.de/f#ANNA2026')
    const size = grid.length
    const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######']
    for (const [x0, y0] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      expect(finder.map((_, dy) => grid[y0 + dy]?.slice(x0, x0 + 7))).toEqual(finder)
    }
    for (let i = 8; i < size - 8; i++) {
      expect(grid[6]?.[i]).toBe(i % 2 === 0 ? '#' : '.')
      expect(grid[i]?.[6]).toBe(i % 2 === 0 ? '#' : '.')
    }
    expect(grid[size - 8]?.[8]).toBe('#') // the always-dark module
  })

  it('the SVG path draws every dark module once, inside the quiet zone', () => {
    const matrix = encodeQr(REFERENCE_URL)
    const path = qrPath(matrix)
    expect(path.match(/M/g)).toHaveLength(matrix.dark.filter(Boolean).length)
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true)
  })
})
