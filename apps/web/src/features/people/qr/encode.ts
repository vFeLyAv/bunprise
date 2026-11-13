// A small QR code encoder of our own (docs/spec/add-friends-design.md §2.1): no package, no third-party service —
// the QR of "Mein Code" is drawn on the device. ISO/IEC 18004 model 2, byte mode, error correction level M
// (≈ 15 % may be damaged), versions 1–10 (up to 213 bytes: our URLs are ~30–90), the mask with the lowest penalty.
// The structure follows the public-domain description of the standard (finder / timing / alignment patterns,
// format + version information with their BCH codes, Reed–Solomon over GF(256) with the polynomial 0x11D, the
// zig-zag placement); checked against an independent decoder (qr.test.ts: a reference matrix).
// Lazy: only the QR tab of the follow-link sheet imports it.

export interface QrMatrix {
  /** modules per side (21 for version 1 … 57 for version 10) */
  size: number
  /** row-major, true = dark */
  dark: boolean[]
}

/** EC codewords per block and number of blocks at level M, versions 1–10 (ISO 18004 table 9). */
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const MAX_VERSION = 10

// ---- GF(256) and Reed–Solomon ----------------------------------------------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** The generator polynomial of the given degree (coefficients, highest first, the leading 1 left out). */
function rsDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j] ?? 0, root) ^ (j + 1 < degree ? (result[j + 1] ?? 0) : 0)
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = Array.from({ length: divisor.length }, () => 0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0)
    result.push(0)
    for (let i = 0; i < divisor.length; i++) result[i] = (result[i] ?? 0) ^ gfMul(divisor[i] ?? 0, factor)
  }
  return result
}

// ---- sizes ---------------------------------------------------------------------------------------------------

/** Positions of the alignment patterns' centres in one dimension. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const positions = [6]
  for (let pos = version * 4 + 17 - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos)
  return positions
}

/** Data modules of a version (everything that is not a function pattern), in bits. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (version >= 7) result -= 36
  }
  return result
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - (EC_PER_BLOCK[version - 1] ?? 0) * (BLOCKS[version - 1] ?? 0)
}

// ---- the encoder ---------------------------------------------------------------------------------------------

/** The QR code of `text` (UTF-8, byte mode, level M). Throws when it does not fit version 10. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text)
  let version = 1
  for (; version <= MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break
  }
  if (version > MAX_VERSION) throw new RangeError('qr: text too long')

  // bit stream: mode 0100, the length, the bytes, a terminator, padding to whole bytes and with 0xEC / 0x11
  const bits: number[] = []
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) put(byte, 8)
  const capacity = dataCodewords(version) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0))

  const codewords = interleave(version, data)
  const size = version * 4 + 17
  const dark = Array.from({ length: size * size }, () => false)
  const fixed = Array.from({ length: size * size }, () => false)
  const set = (x: number, y: number, on: boolean) => {
    dark[y * size + x] = on
    fixed[y * size + x] = true
  }
  drawFunctionPatterns(version, size, set)
  drawCodewords(size, codewords, dark, fixed)

  let best: boolean[] = dark
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const candidate = dark.slice()
    applyMask(size, mask, candidate, fixed)
    drawFormatBits(size, mask, (x, y, on) => {
      candidate[y * size + x] = on
    })
    const score = penalty(size, candidate)
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return { size, dark: best }
}

/** Split into blocks, add each block's EC codewords, interleave (ISO 18004 §7.6). */
function interleave(version: number, data: readonly number[]): number[] {
  const blocks = BLOCKS[version - 1] ?? 1
  const ecLength = EC_PER_BLOCK[version - 1] ?? 0
  const raw = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blocks - (raw % blocks)
  const shortLength = Math.floor(raw / blocks)
  const divisor = rsDivisor(ecLength)
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const length = shortLength - ecLength + (i < shortBlocks ? 0 : 1)
    const block = data.slice(k, k + length)
    k += length
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, divisor))
  }
  const result: number[] = []
  const longest = shortLength - ecLength + 1
  for (let i = 0; i < longest; i++) for (const block of dataBlocks) if (i < block.length) result.push(block[i] ?? 0)
  for (let i = 0; i < ecLength; i++) for (const block of ecBlocks) result.push(block[i] ?? 0)
  return result
}

function drawFunctionPatterns(version: number, size: number, set: (x: number, y: number, on: boolean) => void): void {
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, distance !== 2 && distance !== 4)
      }
    }
  }
  const positions = alignmentPositions(version)
  const last = positions.length - 1
  positions.forEach((ax, i) => {
    positions.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return // the finder corners
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  })
  drawFormatBits(size, 0, set) // reserves the format areas (the real bits come with the mask)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const on = ((bits >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, on)
      set(b, a, on)
    }
  }
}

/** The 15 format bits (level M = 00, the mask, BCH, XOR 0x5412) in both copies, plus the always-dark module. */
function drawFormatBits(size: number, mask: number, set: (x: number, y: number, on: boolean) => void): void {
  const data = mask // level M's two bits are 00
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) !== 0
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)
}

/** The zig-zag: two columns at a time from the right, up and down, skipping the vertical timing column. */
function drawCodewords(size: number, codewords: readonly number[], dark: boolean[], fixed: readonly boolean[]): void {
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (fixed[y * size + x] || i >= codewords.length * 8) continue
        dark[y * size + x] = (((codewords[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) !== 0
        i++
      }
    }
  }
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function applyMask(size: number, mask: number, dark: boolean[], fixed: readonly boolean[]): void {
  const flip = MASKS[mask] ?? MASKS[0]!
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (!fixed[y * size + x] && flip(x, y)) dark[y * size + x] = !dark[y * size + x]
  }
}

/** The four penalty rules of ISO 18004 §7.8.3 (runs, 2×2 blocks, finder-like patterns, dark balance). */
function penalty(size: number, dark: readonly boolean[]): number {
  const at = (x: number, y: number) => dark[y * size + x] === true
  let score = 0
  const finderLike = [true, false, true, true, true, false, true]
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1
      const line: boolean[] = []
      for (let b = 0; b < size; b++) line.push(pass === 0 ? at(b, a) : at(a, b))
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) run++
        else {
          if (run >= 5) score += 3 + (run - 5)
          run = 1
        }
      }
      // 1:1:3:1:1 with four light modules on one side (inside the line, or the quiet zone beyond it)
      for (let b = 0; b + 7 <= size; b++) {
        if (!finderLike.every((on, k) => line[b + k] === on)) continue
        const lightBefore = [1, 2, 3, 4].every((k) => b - k < 0 || line[b - k] === false)
        const lightAfter = [0, 1, 2, 3].every((k) => b + 7 + k >= size || line[b + 7 + k] === false)
        if (lightBefore || lightAfter) score += 40
      }
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = at(x, y)
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3
    }
  }
  const darkCount = dark.reduce((n, on) => n + (on ? 1 : 0), 0)
  const total = size * size
  score += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10
  return score
}

/** One SVG path of every dark module (1 × 1 units, `quiet` modules of light margin around): crisp at any size. */
export function qrPath(matrix: QrMatrix, quiet = 4): string {
  let d = ''
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.dark[y * matrix.size + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`
    }
  }
  return d
}
