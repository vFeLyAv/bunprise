import type { Track } from './timeline';

/** One shared rabbit bound: hind-leg push, flight, front-paw landing, hind legs passing forward. */
export interface GallopParts {
  squash: Track; earL: Track; earR: Track; footL: Track; footR: Track; shadow: Track;
  pawL?: Track; pawR?: Track; tail?: Track;
}
export function gallop(parts: GallopParts, at: number, duration = 0.36, direction: 1 | -1 = 1): void {
  const d = duration;
  const path = (track: Track, values: ReadonlyArray<readonly [number, Parameters<Track['set']>[1]]>) =>
    track.path(Math.max(at, track.end), values.map(([fraction, value]) => [at + fraction * d, value, 'ease-in-out'] as const));
  path(parts.squash, [[0.12, { sx: 1.08, sy: 0.88 }], [0.38, { sx: 1.16, sy: 0.89 }], [0.67, { sx: 0.9, sy: 1.09 }], [0.85, { sx: 1.09, sy: 0.9 }], [1, { sx: 1, sy: 1 }]]);
  for (const [track, phase] of [[parts.footL, 0], [parts.footR, 0.035]] as const) {
    path(track, [[0.16 + phase, { x: direction * -10, y: 1, r: direction * -18, sx: 1.12, sy: 0.9 }], [0.43 + phase, { x: direction * -5, y: -9, r: direction * 15, sx: 0.9, sy: 0.9 }], [0.7 + phase, { x: direction * 13, y: -7, r: direction * 24, sx: 0.95, sy: 0.95 }], [1, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }]]);
  }
  for (const paw of [parts.pawL, parts.pawR]) if (paw) path(paw, [[0.23, { x: direction * 7, y: -3, r: direction * -18 }], [0.54, { x: direction * 14, y: 6, r: direction * -28 }], [0.73, { x: direction * -5, y: 9, r: direction * 12 }], [1, { x: 0, y: 0, r: 0 }]]);
  for (const ear of [parts.earL, parts.earR]) path(ear, [[0.18, { r: direction * 6 }], [0.46, { r: direction * -14 }], [0.78, { r: direction * 8 }], [1, { r: 0 }]]);
  if (parts.tail) path(parts.tail, [[0.3, { y: -3, r: direction * -10, s: 1.08 }], [0.72, { y: 1, r: direction * 8, s: 0.96 }], [1, { y: 0, r: 0, s: 1 }]]);
  path(parts.shadow, [[0.38, { sx: 0.62, sy: 0.68, o: 0.45 }], [0.72, { sx: 1.08, sy: 1, o: 1 }], [1, { sx: 1, sy: 1, o: 1 }]]);
}
