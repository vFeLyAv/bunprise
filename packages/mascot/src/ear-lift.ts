import { easing, type Compiled, type Sampled, type StyleOut } from './timeline';

// Align the raised contour with the resting ear before blending, then turn both together.
// Direct Cartesian morphing shrinks the ear halfway through; a shared turn keeps its volume.
const OUTER = [
  'M-24 -160 C-44 -170 -67 -155 -75 -128 C-81 -107 -77 -86 -66 -83 C-56 -81 -53 -96 -53 -111 C-53 -129 -44 -145 -29 -151 Z',
  'M-18.5 -158 C-15.5 -184 -22.5 -210 -35.5 -225 C-44.5 -236 -58.5 -231 -56.5 -219 C-54.5 -203 -45.5 -182 -40.5 -166 C-38.5 -158 -37.5 -154 -34.5 -153 Z',
] as const;
const INNER = [
  'M-29 -151 C-44 -145 -53 -129 -53 -111 C-53 -99 -55 -90 -61 -86 C-58 -95 -57.5 -108 -58 -118 C-58.5 -134 -50 -146 -37 -153 Z',
  'M-24.5 -161 C-22.5 -184 -28.5 -207 -39.5 -221 C-45.5 -229 -52.5 -225 -50.5 -217 C-48.5 -202 -40.5 -182 -35.5 -167 C-33.5 -161 -29.5 -158 -24.5 -161 Z',
] as const;
// The distal lobe curls over a broad, raised shaft; both surfaces bend together without a seam.
const SOFT_TIP = [
  'M-18.5 -158 C-10.5 -183 -12.5 -211 -27.5 -221 C-43.5 -237 -64.5 -222 -58.5 -207 C-53.5 -194 -43.5 -198 -44.5 -211 C-44.5 -198 -43.5 -174 -34.5 -153 Z',
  'M-24.5 -161 C-18.5 -185 -20.5 -207 -33.5 -216 C-45.5 -228 -57.5 -215 -53.5 -207 C-49.5 -201 -48.5 -201 -49.5 -213 C-45.5 -200 -36.5 -174 -24.5 -161 Z',
] as const;
const NUMBER = /-?\d+(?:\.\d+)?/g;
const TURN = 126 * Math.PI / 180;
const coordinates = [OUTER, INNER].map(shapes => shapes.map(d => d.match(NUMBER)!.map(Number)));
const softCoordinates = SOFT_TIP.map(d => d.match(NUMBER)!.map(Number));

export function liftedEarPath(progress: number, inner: boolean, right: boolean): string {
  const shapes = coordinates[inner ? 1 : 0]!;
  const from = shapes[0]!, to = shapes[1]!;
  const soft = softCoordinates[inner ? 1 : 0]!;
  const fold = right ? .78 : .7;
  const q = Math.max(0, Math.min(1, progress));
  const c = Math.cos(TURN * q), s = Math.sin(TURN * q);
  const backC = Math.cos(-TURN), backS = Math.sin(-TURN);
  const values: number[] = [];
  for (let i = 0; i < from.length; i += 2) {
    const x = from[i]! + 26.5, y = from[i + 1]! + 155.5;
    const tx = to[i]! + (soft[i]! - to[i]!) * fold + 26.5;
    const ty = to[i + 1]! + (soft[i + 1]! - to[i + 1]!) * fold + 155.5;
    const lx = x + (tx * backC - ty * backS - x) * q;
    const ly = y + (tx * backS + ty * backC - y) * q;
    values.push((-26.5 + lx * c - ly * s) * (right ? -1 : 1), -155.5 + lx * s + ly * c);
  }
  let index = 0;
  return (inner ? INNER : OUTER)[0].replace(NUMBER, () => String(Math.round(values[index++]! * 1000) / 1000));
}

const SCORE: ReadonlyArray<readonly [number, number, string]> = [
  [0, 0, 'linear'], [.055, 0, 'cubic-bezier(.2,.7,.3,1)'], [.39, 1, 'ease-in-out'],
  [.54, .95, 'ease-in-out'], [.69, .98, 'linear'], [1.03, .98, 'ease-in'], [1.38, .3, 'ease-out'],
  [1.64, 0, 'linear'], [1.76, 0, 'linear'],
];
const pathStyle = (d: string): string => `path("${d}")`;

/** Seekable path deformation, shared by the standalone bunny and welcome stage. */
export class EarLift implements Sampled {
  readonly els: readonly Element[];
  readonly end: number;
  constructor(readonly el: SVGPathElement, readonly name: string, readonly start: number, private readonly inner: boolean, private readonly right: boolean) {
    this.els = [el];
    this.end = start + 1.76;
  }
  private keys() {
    // One ear follows the other and stays a little softer instead of a perfectly mirrored salute.
    return SCORE.map(([t, p, ease]) => [t > 0 && t < 1.64 && this.right ? t + .045 : t, p * (this.right ? .94 : 1), ease] as const);
  }
  private progressAt(t: number): number {
    const keys = this.keys();
    const local = t - this.start;
    for (let i = 1; i < keys.length; i++) {
      const [a, p, ease] = keys[i - 1]!, [b, next] = keys[i]!;
      if (local <= b) {
        const fraction = easing(ease)(Math.max(0, Math.min(1, (local - a) / (b - a))));
        return p + (next - p) * fraction;
      }
    }
    return 0;
  }
  styleAt(t: number): StyleOut { return { d: pathStyle(liftedEarPath(this.progressAt(t), this.inner, this.right)) }; }
  baseStyle(): StyleOut { return { d: pathStyle(liftedEarPath(0, this.inner, this.right)) }; }
  compile(): Compiled[] {
    // Small angle steps preserve the curved lift between authored beats. The browser still runs
    // one finite Web Animation per path; no JavaScript writes geometry during playback.
    const times = new Set(this.keys().map(key => key[0]));
    const keys = this.keys();
    for (let i = 1; i < keys.length; i++) {
      const [a, p] = keys[i - 1]!, [b, next] = keys[i]!;
      if (p === next) continue;
      const count = Math.ceil((b - a) / .02);
      for (let step = 1; step < count; step++) times.add(a + (b - a) * step / count);
    }
    return [{ el: this.el, name: this.name, base: this.baseStyle(), end: this.end * 1000,
      timing: { delay: this.start * 1000, duration: 1760, fill: 'both' },
      frames: [...times].sort((a, b) => a - b).map(t => ({ offset: t / 1.76, easing: 'linear', d: pathStyle(liftedEarPath(this.progressAt(this.start + t), this.inner, this.right)) })),
    }];
  }
}

export function earLifts(left: Element, right: Element, start = 0, prefix = 'bunny'): EarLift[] {
  return [left, right].flatMap((ear, side) => [...ear.querySelectorAll<SVGPathElement>('path')].map((path, index) =>
    new EarLift(path, `${prefix}.earShape${side}${index}`, start, index === 1, side === 1)));
}
