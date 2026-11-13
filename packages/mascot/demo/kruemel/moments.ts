/**
 * Krümel's two little moments (GALLERY-ONLY prototype, 26.10): short, transform / opacity only, one Web
 * Animation per part over the whole moment (no timers), so seek(t) gives the same frame every time.
 *
 *  - «Плюх» (plop, 1.8 s): a baby's first big hop — he crouches, hops, lands too hard and plops onto his
 *    bottom, his hind feet pop out, the ears bounce (the floppy one more), a surprised "o", then a proud smile.
 *  - «Апчхи» (sneeze, 1.7 s): the nose tickles, eyes squeeze, a tiny sneeze that bounces him back, the ears
 *    fling and settle, a startled look and an ear twitch.
 *
 * They animate the puppet's own groups (the same ones its scenes use); the baby ears turn about their roots
 * (kit.ts sets the pivots). Under reduced motion the gallery does not play them at all.
 */

export type KitMoment = 'plop' | 'sneeze';

/** [seconds, value (transform string, or opacity), easing of the segment that starts here]. */
type Key = readonly [number, string | number, string?];
interface Track {
  name: string;
  sel: string;
  keys: readonly Key[];
}

export const KIT_MOMENTS: Readonly<Record<KitMoment, { duration: number; title: string; note: string }>> = {
  plop: { duration: 1.8, title: 'Плюх', note: 'первый большой прыжок: приземлился — и плюхнулся на попу, лапки вперёд, уши пружинят' },
  sneeze: { duration: 1.7, title: 'Апчхи', note: 'щекотно в носу — крошечный чих отбрасывает его назад, уши разлетаются, потом удивился и дёрнул ушком' },
};

const OUT = 'cubic-bezier(.2,.7,.3,1)';
const IN = 'cubic-bezier(.5,0,.85,.45)';
const IO = 'ease-in-out';

const tr = (x: number, y: number) => `translate(${x}px, ${y}px)`;
const rs = (r: number, sx = 1, sy = sx) => `rotate(${r}deg) scale(${sx}, ${sy})`;
const rot = (r: number) => `rotate(${r}deg)`;
const sc = (sx: number, sy = sx) => `scale(${sx}, ${sy})`;
const foot = (x: number, y: number, r: number, s: number) => `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`;

/** Ears bouncing after a jolt at `t0`: alternating, damped; `a` = the first swing (deg), `dt` = half period. */
function bounce(t0: number, a: number, dt: number, n = 5): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < n; i++) keys.push([t0 + i * dt, rot(a * (i % 2 ? -1 : 1) * 0.58 ** i), IO]);
  keys.push([t0 + n * dt, rot(0)]);
  return keys;
}

function plop(): Track[] {
  const L = 0.68; // touch-down
  return [
    { name: 'hop', sel: '.hop', keys: [[0, tr(0, 0), OUT], [0.2, tr(0, 2), OUT], [0.46, tr(0, -30), IN], [L, tr(0, 0), OUT], [0.78, tr(0, -4.5), IN], [0.88, tr(0, 0)], [1.8, tr(0, 0)]] },
    {
      name: 'body', sel: '.body',
      keys: [[0, rs(0), IO], [0.2, rs(0, 1.08, 0.9), OUT], [0.34, rs(2, 0.93, 1.1), IO], [0.5, rs(-2, 0.97, 1.05), IN], [L, rs(-7, 1.15, 0.84), OUT],
        [0.82, rs(5, 0.96, 1.05), IO], [0.96, rs(-3, 1.04, 0.97), IO], [1.1, rs(1.5), IO], [1.26, rs(0)], [1.8, rs(0)]],
    },
    {
      name: 'shadow', sel: '.shadow',
      keys: [[0, sc(1), OUT], [0.2, sc(1.06), OUT], [0.46, sc(0.7), IN], [L, sc(1.14), OUT], [0.82, sc(0.97), IO], [0.96, sc(1.02), IO], [1.1, sc(1)], [1.8, sc(1)]],
    },
    // the hind feet: tucked in the air, popping out to the sides when he plops (sitting on his bottom)
    { name: 'footL', sel: '.foot-l', keys: [[0, foot(0, 0, 0, 1), IO], [0.3, foot(2, -3, 0, 0.9), IO], [0.6, foot(0, 0, 0, 1), OUT], [0.74, foot(-7, -5, -22, 1.1), IO], [1.3, foot(-6, -4.5, -20, 1.1), IO], [1.55, foot(0, 0, 0, 1)], [1.8, foot(0, 0, 0, 1)]] },
    { name: 'footR', sel: '.foot-r', keys: [[0, foot(0, 0, 0, 1), IO], [0.3, foot(-2, -3, 0, 0.9), IO], [0.6, foot(0, 0, 0, 1), OUT], [0.75, foot(7, -5, 22, 1.1), IO], [1.32, foot(6, -4.5, 20, 1.1), IO], [1.57, foot(0, 0, 0, 1)], [1.8, foot(0, 0, 0, 1)]] },
    // ears: pressed back in the crouch, trailing in the air, whipping on the plop, then bouncing out
    { name: 'earL', sel: '.up .ear-l', keys: [[0, rot(0), IO], [0.2, rot(7), IO], [0.38, rot(-9), IO], [0.54, rot(5), IN], ...bounce(L, -15, 0.12), [1.8, rot(0)]] },
    { name: 'earR', sel: '.up .ear-r', keys: [[0, rot(0), IO], [0.2, rot(-6), IO], [0.38, rot(11), IO], [0.54, rot(-7), IN], ...bounce(L + 0.03, 18, 0.13, 6), [1.8, rot(0)]] },
    // face: a determined squint, wide eyes in the air, squeezed shut on the plop, then "whoa" and a smile
    {
      name: 'eye', sel: '.eyes .eye',
      keys: [[0, sc(1), IO], [0.16, sc(1, 0.7), IO], [0.3, sc(1.12), IO], [0.64, sc(1.12), IO], [0.7, sc(1.06, 0.12), IO], [0.8, sc(1.06, 0.12), OUT], [0.9, sc(1.2), IO], [1.3, sc(1.2), IO], [1.42, sc(1)], [1.8, sc(1)]],
    },
    { name: 'eyes', sel: '.eyes', keys: [[0, 1], [1.4, 1, IO], [1.48, 0], [1.68, 0, IO], [1.76, 1], [1.8, 1]] },
    { name: 'happy', sel: '.eyes-happy', keys: [[0, 0], [1.4, 0, IO], [1.48, 1], [1.68, 1, IO], [1.76, 0], [1.8, 0]] },
    { name: 'mouth', sel: '.mouth', keys: [[0, 1], [0.66, 1], [0.7, 0], [1.12, 0], [1.18, 1], [1.8, 1]] },
    { name: 'mouthOpen', sel: '.mouth-open', keys: [[0, 0], [0.66, 0], [0.7, 1], [1.12, 1], [1.18, 0], [1.8, 0]] },
    { name: 'face', sel: '.face', keys: [[0, tr(0, 0), IO], [0.2, tr(0, 1), IO], [0.4, tr(0, -2.4), IO], [L, tr(0, 1.6), OUT], [0.9, tr(0, -0.6), IO], [1.1, tr(0, 0)], [1.8, tr(0, 0)]] },
  ];
}

function sneeze(): Track[] {
  const A = 0.58; // "Apчхи!"
  return [
    {
      name: 'nose', sel: '.nose',
      keys: [[0, sc(1), IO], [0.08, sc(1.16, 0.8), IO], [0.16, sc(1), IO], [0.25, sc(1.16, 0.8), IO], [0.33, sc(1), IO], [0.44, sc(1.22, 0.78), IO], [0.54, sc(1.28, 0.72), OUT], [A + 0.04, sc(0.88, 1.12), IO], [0.76, sc(1)], [1.7, sc(1)]],
    },
    { name: 'face', sel: '.face', keys: [[0, tr(0, 0), IO], [0.52, tr(0, -2.6), IN], [A, tr(0, 3), OUT], [0.82, tr(0, 0)], [1.7, tr(0, 0)]] },
    { name: 'body', sel: '.body', keys: [[0, rs(0), IO], [0.52, rs(-3, 0.97, 1.05), IN], [A, rs(2.5, 1.09, 0.9), OUT], [0.68, rs(-1.5, 0.98, 1.03), IO], [0.8, rs(1, 1.02, 0.98), IO], [0.94, rs(0)], [1.7, rs(0)]] },
    { name: 'hop', sel: '.hop', keys: [[0, tr(0, 0)], [A, tr(0, 0), OUT], [0.7, tr(0, -9), IN], [0.82, tr(0, 0), OUT], [0.88, tr(0, -1.6), IN], [0.94, tr(0, 0)], [1.7, tr(0, 0)]] },
    { name: 'shadow', sel: '.shadow', keys: [[0, sc(1)], [A, sc(1.04), OUT], [0.7, sc(0.86), IN], [0.82, sc(1.04), IO], [0.94, sc(1)], [1.7, sc(1)]] },
    {
      name: 'eye', sel: '.eyes .eye',
      keys: [[0, sc(1), IO], [0.34, sc(1, 0.72), IO], [0.52, sc(1, 0.42), IN], [0.57, sc(1.05, 0.1), IO], [0.72, sc(1.05, 0.1), OUT], [0.8, sc(1.22), IO], [1.2, sc(1.22), IO], [1.3, sc(1), IO], [1.42, sc(1, 0.12), IO], [1.5, sc(1)], [1.7, sc(1)]],
    },
    { name: 'mouth', sel: '.mouth', keys: [[0, 1], [0.54, 1], [0.57, 0], [0.7, 0], [0.74, 1], [1.7, 1]] },
    { name: 'mouthOpen', sel: '.mouth-open', keys: [[0, 0], [0.54, 0], [0.57, 1], [0.7, 1], [0.74, 0], [1.7, 0]] },
    // ears: a little perk while it tickles, flung by the sneeze, bouncing; later the startled twitch
    { name: 'earL', sel: '.up .ear-l', keys: [[0, rot(0), IO], [0.5, rot(-4), IN], ...bounce(A, 16, 0.11, 4).filter(([t]) => t < 1.2), [1.2, rot(0), IO], [1.28, rot(-7), IO], [1.4, rot(0)], [1.7, rot(0)]] },
    { name: 'earR', sel: '.up .ear-r', keys: [[0, rot(0), IO], [0.5, rot(-5), IN], ...bounce(A + 0.02, -20, 0.12, 5).filter(([t]) => t < 1.22), [1.22, rot(0), IO], [1.27, rot(-13), IO], [1.34, rot(5), IO], [1.42, rot(-2), IO], [1.5, rot(0)], [1.7, rot(0)]] },
    // a tiny burst of four "pff" strokes around the nose (they move with the face)
    ...PUFFS.map((_, i): Track => ({ name: `puff${i}`, sel: `.kit-puff-${i}`, keys: [[0, 0], [A - 0.01, 0], [A + 0.04, 1, OUT], [A + 0.3, 0], [1.7, 0]] })),
    ...PUFFS.map(([dx, dy], i): Track => ({ name: `puffMove${i}`, sel: `.kit-puff-${i} > path`, keys: [[0, tr(0, 0)], [A - 0.01, tr(0, 0), OUT], [A + 0.3, tr(dx * 0.6, dy * 0.6)], [A + 0.31, tr(0, 0)], [1.7, tr(0, 0)]] })),
  ];
}

/** The tracks of a moment (pure data: the tests check them). */
export function momentTracks(m: KitMoment): Track[] {
  return m === 'plop' ? plop() : sneeze();
}

/** The sneeze burst: four short rays around the nose (direction × 5 units), starting 9 units out. */
const PUFFS: ReadonlyArray<readonly [number, number]> = [[-4.6, -1.9], [-4.3, 2.5], [4.6, -1.9], [4.3, 2.5]];
const NOSE: readonly [number, number] = [0, -72.4];

/** The sneeze puffs: tiny strokes in the face group (so they nod and hop with it), invisible until the sneeze. Idempotent. */
function ensurePuffs(svg: SVGSVGElement): void {
  const face = svg.querySelector('.face');
  if (!face || face.querySelector('.kit-puff-0')) return;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  face.insertAdjacentHTML('beforeend', PUFFS.map(([dx, dy], i) => {
    const k = 9 / Math.hypot(dx, dy);
    return `<g class="kit-puff-${i}" opacity="0"><path d="M${n(NOSE[0] + dx * k)} ${n(NOSE[1] + dy * k)} l${n(dx)} ${n(dy)}" fill="none" stroke="var(--mascot-accent-dark)" stroke-width="1.8" stroke-linecap="round"/></g>`;
  }).join(''));
}

/**
 * Builds a moment on a mounted Krümel puppet (its <svg>, after applyKit): one Web Animation per part over the
 * whole moment. `at` = null plays it; a number freezes it at that second (deterministic frames).
 */
export function startMoment(svg: SVGSVGElement, m: KitMoment, at: number | null = null): Animation[] {
  ensurePuffs(svg);
  const D = KIT_MOMENTS[m].duration;
  const anims: Animation[] = [];
  for (const track of momentTracks(m)) {
    const frames: Keyframe[] = track.keys.map(([t, v, e]) => {
      const k: Keyframe = { offset: Math.min(1, Math.max(0, t / D)) };
      if (typeof v === 'number') k['opacity'] = String(v);
      else k['transform'] = v;
      if (e) k['easing'] = e;
      return k;
    });
    for (const el of svg.querySelectorAll(track.sel)) {
      if (typeof el.animate !== 'function') continue;
      const a = el.animate(frames, { duration: D * 1000, fill: 'both', id: `kit.${m}.${track.name}` });
      if (at !== null) {
        a.pause();
        a.currentTime = Math.min(D, Math.max(0, at)) * 1000;
      }
      anims.push(a);
    }
  }
  return anims;
}
