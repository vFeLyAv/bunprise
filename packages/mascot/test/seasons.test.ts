import { afterEach, describe, expect, it } from 'vitest';
import { driftKeys, leafOutline, leafStem, PROP_R, SCORES, SNEEZE, SeasonScene, type DriftSpec, type PropState, type Season } from '../demo/seasons/scene';
import { FLAKE_ARMS, flakeMarkup, LEAVES, MAPLE, OAK, pathD } from '../demo/seasons/props';
import { seasonsGallery } from '../demo/seasons/gallery';
import { rotate, type Vec } from '../src/welcome-actors';

// Seasons v2 (26.10, gallery-only prototype): «Листопад» — a few leaves (Norway maple + English oak) at different
// depths, the near maple leaf rocks about its long axis (foreshortened, its underside shows when it flips), lands
// on Pompon's forehead and slides off; «Снегопад» — a gentle snowfall, one six-armed flake lands on his nose, he
// goes cross-eyed and sneezes it away. Everything comes in over the top of the screen and leaves only behind the
// card edge (or melts); no leaf ever covers an eye; transform/opacity only, finite, deterministic; reduced motion =
// nothing at all.

const W = 358;
const H = 246; // the feed mock: the first card's top edge 230 px below the screen top, + the 16 px inset
const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];
const EYES = [-29, 29];
const EYE_Y = -93;

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  document.head.replaceChildren();
});

function sized(): HTMLDivElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: W });
  Object.defineProperty(host, 'clientHeight', { value: H });
  document.body.append(host);
  return host;
}

function scene(season: Season, end: 'duck' | 'stay' = 'duck'): SeasonScene {
  return new SeasonScene(sized(), { season, end, reducedMotion: 'off' });
}

const times = (t0: number, t1: number, step = 1 / 60): number[] => {
  const out: number[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += step) out.push(Math.round(t * 1e4) / 1e4);
  return out;
};

const root = (s: SeasonScene): ShadowRoot => (s as unknown as { stage: { root: ShadowRoot } }).stage.root;

/** A shape (bunny units around the prop's middle) placed like the prop at `t`: its scale / rotation / place, then the body tilt about the feet. */
function placed(s: SeasonScene, pts: readonly Vec[], st: PropState): Vec[] {
  return pts.map((q) => {
    const local = rotate({ x: q.x * st.sx, y: q.y * st.sy }, st.r);
    const p = rotate({ x: local.x + st.local.x, y: local.y + st.local.y }, st.tilt);
    return { x: s.geo.pivot.x + p.x * s.geo.u, y: s.geo.pivot.y + p.y * s.geo.u };
  });
}

/** Every edge of a polygon cut into 4 (a crossing edge cannot slip between two far vertices). */
function dense(poly: readonly Vec[]): Vec[] {
  const out: Vec[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    for (let k = 0; k < 4; k++) out.push({ x: a.x + ((b.x - a.x) * k) / 4, y: a.y + ((b.y - a.y) * k) / 4 });
  });
  return out;
}

function inside(poly: readonly Vec[], p: Vec): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const hero = (s: SeasonScene, t: number): PropState => s.propsAt(t).find((p) => p.name === 'leaf' || p.name === 'flake')!;

describe('the props: botany and crystals', () => {
  it('the Norway maple leaf is palmate: five main veins from ONE point (the top of the petiole), one into each lobe tip', () => {
    expect(MAPLE.main).toHaveLength(5);
    for (const v of MAPLE.main) expect(v.from).toEqual(MAPLE.base);
    const tips = MAPLE.vertices.filter((v) => v.kind === 'tip').map((v) => v.p);
    for (const v of MAPLE.main) expect(tips.some((p) => Math.hypot(p.x - v.to.x, p.y - v.to.y) < 1e-9)).toBe(true);
    // every side vein runs into a tooth from a main vein (none from the margin)
    expect(MAPLE.side.length).toBeGreaterThanOrEqual(6);
  });

  it('the maple outline is smooth curves (no straight polygon), broader than long, slightly asymmetric; long petiole', () => {
    const d = pathD(MAPLE.segs);
    expect(d).not.toMatch(/L/);
    expect(d.match(/C/g)?.length).toBe(MAPLE.vertices.length);
    const xs = MAPLE.outline.map((p) => p.x);
    const ys = MAPLE.outline.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeGreaterThan(1.1);
    // it turns about the middle of its blade
    expect(Math.abs(Math.max(...xs) + Math.min(...xs))).toBeLessThan(0.01);
    // not a mirror copy: the lobe and tooth tips of one half are not those of the other, mirrored
    const tips = MAPLE.vertices.filter((v) => v.kind === 'tip');
    const mirrored = tips.every((t) => tips.some((o) => Math.hypot(o.p.x + t.p.x, o.p.y - t.p.y) < 0.2));
    expect(mirrored).toBe(false);
    const [base, , end] = MAPLE.petiole;
    expect(Math.hypot(end.x - base.x, end.y - base.y)).toBeGreaterThan(h * 0.45);
  });

  it('the oak leaf is pinnate (one midrib, a side vein into each lobe), with a very short petiole', () => {
    expect(OAK.main).toHaveLength(1);
    expect(OAK.side.length).toBeGreaterThanOrEqual(8);
    const [base, , end] = OAK.petiole;
    const [mb, , me] = MAPLE.petiole;
    expect(Math.hypot(end.x - base.x, end.y - base.y)).toBeLessThan(Math.hypot(me.x - mb.x, me.y - mb.y) / 3);
    expect(pathD(OAK.segs)).not.toMatch(/L/);
  });

  it('every snowflake with arms has exactly six, 60° apart (ice is hexagonal)', () => {
    expect(FLAKE_ARMS).toHaveLength(6);
    FLAKE_ARMS.forEach((a, i) => expect(a).toBe(i * 60));
    for (const kind of ['hero', 'star'] as const) {
      const box = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      box.innerHTML = flakeMarkup(kind, 'x');
      const arms = [...box.querySelectorAll('.arm')];
      expect(arms).toHaveLength(6);
      expect(arms.map((a) => a.getAttribute('transform'))).toEqual(FLAKE_ARMS.map((a) => `rotate(${a})`));
    }
  });
});

describe('drift path', () => {
  const spec: DriftSpec = {
    t0: 0.6, t1: 2, from: { x: 200, y: -20 }, to: { x: 200, y: 150 }, swing: 36, halves: 2, phase: Math.PI / 2,
    hover: 0.78, rock: 24, rest: -12, settle: true, roll: 150, rollPhase: 0, pitch: 0.2,
  };

  it('starts above the screen, never rises, lands on its target at rest, face up', () => {
    const keys = driftKeys(spec);
    expect(keys[0]?.p.y).toBe(-20);
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.p.y).toBeGreaterThanOrEqual(keys[i - 1]!.p.y - 1e-9);
    const last = keys[keys.length - 1]!;
    expect(last.p.x).toBeCloseTo(200, 6);
    expect(last.p.y).toBeCloseTo(150, 6);
    expect(last.r).toBeCloseTo(-12, 6);
    expect(last.sx).toBeCloseTo(1, 6);
    expect(last.sy).toBeCloseTo(1, 6);
    expect(last.under).toBe(0);
    expect(driftKeys(spec)).toEqual(keys);
  });

  it('rocks with its swing in the plane, never spins (no propeller)', () => {
    const rs = driftKeys(spec).map((k) => k.r);
    expect(Math.max(...rs.map(Math.abs))).toBeLessThanOrEqual(30);
    for (let i = 1; i < rs.length; i++) expect(Math.abs(rs[i]! - rs[i - 1]!)).toBeLessThan(6);
  });

  it('turns about its long axis like a thin sheet: foreshortened, and its underside shows exactly while it is flipped', () => {
    const keys = driftKeys(spec);
    expect(Math.min(...keys.map((k) => Math.abs(k.sx)))).toBeLessThan(0.25);
    expect(keys.some((k) => k.sx < -0.5 && k.under === 1)).toBe(true);
    for (const k of keys) {
      if (k.sx <= -0.25) expect(k.under).toBe(1);
      if (k.sx >= 0.25) expect(k.under).toBe(0);
      // never a zero-width line: a leaf seen edge-on is still a thin sliver
      expect(Math.abs(k.sx)).toBeGreaterThanOrEqual(0.06);
    }
  });
});

describe('«Листопад» (autumn)', () => {
  it('animates only transform and opacity, every animation finite', () => {
    const s = scene('autumn');
    expect(s.off).toBe(false);
    expect(s.animations.length).toBeGreaterThan(10);
    for (const a of s.animations) {
      const effect = a.effect as KeyframeEffect;
      for (const k of effect.getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
      expect(Number.isFinite(Number(effect.getTiming().iterations ?? 1))).toBe(true);
    }
  });

  it('is not alone: four leaves of two species, the far ones smaller, softer and behind him', () => {
    const s = scene('autumn');
    const r = root(s);
    const leaves = [...r.querySelectorAll('.s-prop.s-leaf')];
    expect(leaves).toHaveLength(4);
    expect(r.querySelectorAll('.s-prop.s-oak')).toHaveLength(1);
    expect(r.querySelectorAll('.s-prop.s-maple')).toHaveLength(3);
    // the far layer comes before the climbing bunny in the frame (behind him), the near one after
    const frame = r.querySelector('.clip .frame')!;
    const kids = [...frame.children];
    const lift = kids.findIndex((k) => k.classList.contains('lift'));
    expect(kids.findIndex((k) => k.classList.contains('s-far'))).toBeLessThan(lift);
    expect(kids.findIndex((k) => k.classList.contains('s-near'))).toBeGreaterThan(lift);
    expect(r.querySelectorAll('.s-far .s-leaf')).toHaveLength(3);
    const props = s.propsAt(1);
    const near = props.find((p) => p.name === 'leaf')!;
    for (const p of props.filter((q) => q.layer === 'far')) expect(p.radius).toBeLessThan(near.radius);
    for (const g of r.querySelectorAll('.s-far .s-leaf > g')) expect(Number(g.getAttribute('opacity'))).toBeLessThan(0.95);
  });

  it('the near leaf flips once on its way down: we see its underside (mirrored), then it lands face up', () => {
    const s = scene('autumn');
    const sc = SCORES.autumn;
    const ts = times(sc.enter, sc.land);
    const flipped = ts.filter((t) => hero(s, t).sx < -0.25);
    expect(flipped.length).toBeGreaterThan(5);
    for (const t of flipped) expect(hero(s, t).under).toBeGreaterThan(0.99);
    for (const t of ts) if (hero(s, t).sx > 0.25) expect(hero(s, t).under).toBeLessThan(0.01);
    for (const t of times(sc.land, sc.gone)) {
      expect(hero(s, t).under).toBe(0);
      expect(hero(s, t).sx).toBeGreaterThan(0.9);
    }
    // the far leaves turn over too, each at its own moment
    for (const name of ['far0', 'far1', 'far2']) {
      expect(times(0, s.duration).some((t) => (s.propsAt(t).find((p) => p.name === name)?.under ?? 0) > 0.99)).toBe(true);
    }
  });

  it('is a short moment: the near leaf ≈ 2.5–3 s, the whole show ≤ 4.5 s, everything over before he is gone', () => {
    const s = scene('autumn');
    const sc = SCORES.autumn;
    expect(sc.gone - sc.enter).toBeGreaterThanOrEqual(2.5);
    expect(sc.gone - sc.enter).toBeLessThanOrEqual(3);
    expect(s.duration).toBeLessThanOrEqual(4.5);
    for (const t of s.seasonTracks) expect(t.end).toBeLessThanOrEqual(s.duration - 0.1);
  });

  it('every leaf comes in over the top edge of the screen and leaves only behind the card edge', () => {
    const s = scene('autumn');
    const sc = SCORES.autumn;
    const { edgeY } = s.geo;
    for (const name of ['leaf', 'far0', 'far1', 'far2']) {
      const track = s.seasonTracks.find((k) => k.name === `season.${name}`)!;
      const shape = (st: PropState) => {
        const kind = name === 'far0' ? 'oak' : 'maple';
        const k = st.radius / LEAVES[kind].radius;
        return dense(placed(s, [...leafOutline(kind, k), ...leafStem(kind, k)], st));
      };
      const at = (t: number) => shape(s.propsAt(t).find((p) => p.name === name)!);
      expect(Math.max(...at(track.start).map((p) => p.y))).toBeLessThan(0);
      let inView = false;
      for (const t of times(track.start, track.end)) {
        const pts = at(t);
        const xs = pts.map((p) => p.x);
        const top = Math.min(...pts.map((p) => p.y));
        const bottom = Math.max(...pts.map((p) => p.y));
        // never cut by the host's side edges (they are not real edges on the screen)
        expect(Math.min(...xs)).toBeGreaterThan(0);
        expect(Math.max(...xs)).toBeLessThan(W);
        // once in, it never touches the screen's top edge again
        if (top >= 0) inView = true;
        if (inView) expect(top).toBeGreaterThanOrEqual(0);
        // it reaches the card edge only where the edge is straight (the near one: only after it has landed on him)
        if (bottom > edgeY) {
          if (name === 'leaf') expect(t).toBeGreaterThan(sc.land + 0.3);
          expect(Math.min(...xs)).toBeGreaterThan(24);
          expect(Math.max(...xs)).toBeLessThan(W - 24);
        }
      }
      // gone: fully behind the card
      expect(Math.min(...at(track.end).map((p) => p.y))).toBeGreaterThan(edgeY);
    }
  });

  it('the near leaf never covers an eye — not even a part of it, nor with its petiole', () => {
    const s = scene('autumn');
    const sc = SCORES.autumn;
    for (const t of times(sc.enter, sc.gone)) {
      const st = hero(s, t);
      const leaf = placed(s, dense(leafOutline()), st);
      const stem = placed(s, leafStem(), st);
      const face = s.faceAt(t);
      const eyes = s.eyesAt(t);
      const tilt = s.tiltAt(t) + s.bodyAt(t);
      for (const ex of EYES) {
        const c = rotate({ x: ex + face.x + eyes.x, y: EYE_Y + face.y + eyes.y }, tilt);
        const centre = { x: s.geo.pivot.x + c.x * s.geo.u, y: s.geo.pivot.y + c.y * s.geo.u };
        const rx = (6.2 + 1) * s.geo.u;
        const ry = (7.4 + 1) * s.geo.u;
        expect(inside(leaf, centre)).toBe(false);
        for (const p of [...leaf, ...stem]) expect(((p.x - centre.x) / rx) ** 2 + ((p.y - centre.y) / ry) ** 2).toBeGreaterThan(1);
      }
    }
  }, 20_000); // exhaustive: every frame at 60 fps; under a full parallel run it needs more than the 5 s default

  it('the leaf rides his head only through the season tilt: the stage itself does not lean him meanwhile', () => {
    const s = scene('autumn');
    const sc = SCORES.autumn;
    for (const t of times(sc.land - 0.4, sc.gone)) expect(Math.abs(s.bodyAt(t))).toBeLessThan(0.01);
    const tilts = times(0, s.duration).map((t) => s.tiltAt(t));
    expect(Math.max(...tilts)).toBeCloseTo(SCORES.autumn.tiltDeg, 6);
    expect(Math.max(...tilts)).toBeLessThanOrEqual(6);
    expect(s.tiltAt(s.duration)).toBe(0);
  });

  it('blinks twice once it lands', () => {
    const s = scene('autumn');
    const sc = SCORES.autumn;
    let blinks = 0;
    let shut = false;
    for (const t of times(sc.land, sc.land + 0.5, 1 / 120)) {
      const now = s.eyesAt(t).sy < 0.5;
      if (now && !shut) blinks += 1;
      shut = now;
    }
    expect(blinks).toBe(2);
  });

  it('is deterministic: two scenes give the same frames', () => {
    const a = scene('autumn');
    const b = scene('autumn');
    for (const t of [0.4, 0.7, 1.4, 2.1, 2.9, 3.2, 3.9]) expect(a.propsAt(t)).toEqual(b.propsAt(t));
  });
});

describe('«Снегопад» (winter)', () => {
  it('is a gentle snowfall: 6–10 flakes of different sizes at two depths, one of them lands on his nose', () => {
    const s = scene('winter');
    const r = root(s);
    const flakes = [...r.querySelectorAll('.s-prop.s-flake')];
    expect(flakes.length).toBeGreaterThanOrEqual(6);
    expect(flakes.length).toBeLessThanOrEqual(10);
    expect(r.querySelectorAll('.s-far .s-flake').length).toBeGreaterThanOrEqual(3);
    expect(r.querySelectorAll('.s-near .s-flake').length).toBeGreaterThanOrEqual(2);
    const radii = new Set(s.propsAt(1).filter((p) => p.kind !== 'puff').map((p) => Math.round(p.radius * 10)));
    expect(radii.size).toBeGreaterThanOrEqual(4);
    // the arms: six on every flake that has arms
    for (const f of flakes) {
      const arms = f.querySelectorAll('.arm').length;
      expect([0, 6]).toContain(arms);
    }
    expect(r.querySelectorAll('.s-hero .arm')).toHaveLength(6);
  });

  it('lands on his nose and rides it (face, twitches, his nod) until the sneeze', () => {
    const s = scene('winter');
    const sc = SCORES.winter;
    expect(sc.land - sc.enter).toBeLessThanOrEqual(1.4);
    for (const t of times(sc.land, SNEEZE.choo)) {
      const p = s.propAt(t)!;
      const f = s.faceAt(t);
      expect(Math.abs(p.local.x - (1.2 + f.x))).toBeLessThan(0.01);
      expect(Math.abs(p.local.y - (-87.4 + f.y + s.sneezeAt(t)))).toBeLessThan(1.2);
      expect(p.o).toBe(1);
    }
  });

  it('goes cross-eyed at it, "ah… ah…" (eyes squeeze), "choo!" (a nod down, eyes shut, three puffs)', () => {
    const s = scene('winter');
    const z = SNEEZE;
    for (const t of times(z.cross + 0.25, z.choo)) expect(s.eyesAt(t).cross).toBeGreaterThan(2);
    expect(s.eyesAt(z.choo + 0.4).cross).toBe(0);
    expect(Math.min(...times(z.ah, z.choo).map((t) => s.eyesAt(t).sy))).toBeLessThan(0.5);
    expect(Math.min(...times(z.choo, z.choo + 0.2).map((t) => s.eyesAt(t).sy))).toBeLessThanOrEqual(0.12);
    expect(s.eyesAt(z.choo + 0.4).sy).toBe(1);
    expect(Math.min(...times(z.ah, z.choo).map((t) => s.sneezeAt(t)))).toBeLessThan(-2);
    expect(Math.max(...times(z.choo, z.choo + 0.2).map((t) => s.sneezeAt(t)))).toBeGreaterThan(3);
    expect(s.sneezeAt(s.duration)).toBeCloseTo(0, 3);
    const puffs = s.propsAt(z.choo + 0.12).filter((p) => p.kind === 'puff');
    expect(puffs).toHaveLength(3);
    for (const p of puffs) expect(p.o).toBeGreaterThan(0.5);
    for (const p of s.propsAt(z.choo + 0.6).filter((q) => q.kind === 'puff')) expect(p.o).toBe(0);
  });

  it('the sneeze blows the flake up and away; it melts in the air (opacity only), never cut by an edge', () => {
    const s = scene('winter');
    const sc = SCORES.winter;
    const start = s.propAt(SNEEZE.choo)!;
    const gone = s.propAt(sc.gone)!;
    expect(gone.p.y).toBeLessThan(start.p.y - 20);
    expect(gone.o).toBe(0);
    let last = 1;
    for (const t of times(SNEEZE.choo, sc.gone)) {
      const p = s.propAt(t)!;
      expect(p.o).toBeLessThanOrEqual(last + 1e-9);
      last = p.o;
      const r = PROP_R.winter * p.sx * s.geo.u;
      if (p.o > 0) {
        expect(p.p.y - r).toBeGreaterThan(0);
        expect(p.p.x + r).toBeLessThan(W);
      }
    }
  });

  it('flakes over him stay clear of his eyes (the one on his nose too)', () => {
    const s = scene('winter');
    for (const t of times(0, s.duration)) {
      const f = s.faceAt(t);
      for (const p of s.propsAt(t).filter((q) => q.layer === 'near' && q.kind !== 'puff')) {
        for (const ex of EYES) expect(Math.hypot(p.local.x - (ex + f.x), p.local.y - (EYE_Y + f.y))).toBeGreaterThan(p.radius * Math.max(1, p.sx) + 7.4);
      }
    }
  });

  it('every falling flake comes in over the top and leaves only behind the card edge, all before he is gone', () => {
    const s = scene('winter');
    const { edgeY } = s.geo;
    expect(s.duration).toBeLessThanOrEqual(4.5);
    for (const t of s.seasonTracks) expect(t.end).toBeLessThanOrEqual(s.duration - 0.1);
    for (const prop of s.propsAt(0).filter((p) => p.name.startsWith('snow'))) {
      const track = s.seasonTracks.find((k) => k.name === `season.${prop.name}`)!;
      const at = (t: number) => s.propsAt(t).find((p) => p.name === prop.name)!;
      const r = prop.radius * s.geo.u;
      expect(at(track.start).p.y + r).toBeLessThan(0);
      for (const t of times(track.start, track.end)) {
        const p = at(t).p;
        expect(p.x - r).toBeGreaterThan(0);
        expect(p.x + r).toBeLessThan(W);
        if (p.y + r > edgeY) {
          expect(p.x - r).toBeGreaterThan(24);
          expect(p.x + r).toBeLessThan(W - 24);
        }
      }
      expect(at(track.end).p.y - r).toBeGreaterThan(edgeY);
    }
  });

  it('is deterministic: two scenes give the same frames', () => {
    const a = scene('winter');
    const b = scene('winter');
    for (const t of [0.3, 1.2, 1.9, 2.5, 2.9, 3.2, 3.7]) expect(a.propsAt(t)).toEqual(b.propsAt(t));
  });
});

describe('reduced motion and the gallery page', () => {
  it('reduced motion: nothing at all (a decoration)', () => {
    const host = sized();
    const s = new SeasonScene(host, { season: 'autumn', reducedMotion: 'force' });
    expect(s.off).toBe(true);
    expect(s.duration).toBe(0);
    expect(s.animations).toHaveLength(0);
    expect(host.shadowRoot).toBeNull();
  });

  it('every season track is ONE animation per part (no holds that split it): a seek back after the stage settled finished animations cannot reorder them', () => {
    for (const season of ['autumn', 'winter'] as const) {
      const s = scene(season);
      for (const t of s.seasonTracks) {
        const n = t.compile().length;
        // a track that never changes (a far leaf that is never edge-on enough to shade, say) has none
        expect(n === t.els.length || n === 0).toBe(true);
      }
    }
  });

  it('after the stage rebuilds itself (a new size), the season goes back in at the same moment', () => {
    const s = scene('autumn');
    const internals = s as unknown as { stage: { rebuild(): void; root: ShadowRoot }; install(): void };
    s.seek(2.6);
    internals.stage.rebuild();
    expect(internals.stage.root.querySelector('.s-prop')).toBeNull();
    internals.install();
    expect(internals.stage.root.querySelectorAll('.s-prop')).toHaveLength(4);
    const leaf = s.animations.filter((a) => a.id === 'season.leaf');
    expect(leaf).toHaveLength(1);
    expect(leaf[0]?.currentTime).toBe(2600);
  });

  it('destroy lets go of everything', () => {
    const s = scene('winter');
    const host = s.host;
    s.destroy();
    expect(s.seasonTracks).toHaveLength(0);
    expect(s.propAt(2)).toBeNull();
    expect(s.propsAt(2)).toHaveLength(0);
    expect(host.shadowRoot?.childNodes.length ?? 0).toBe(0);
  });

  it('staying instead of ducking keeps the season tracks finite', () => {
    for (const season of ['autumn', 'winter'] as const) {
      const s = scene(season, 'stay');
      for (const t of s.seasonTracks) for (const c of t.compile()) expect(Number.isFinite(c.end)).toBe(true);
    }
  });

  it('builds the phone and a contact sheet; reduced shows the empty card with a note', () => {
    const app = document.createElement('main');
    document.body.append(app);
    seasonsGallery(app, new URLSearchParams('screens=seasons&season=winter&frames=3&t=2'));
    expect(app.querySelectorAll('.sz-phone')).toHaveLength(4);
    expect(app.querySelectorAll('.sz-cell')).toHaveLength(3);
    window.dispatchEvent(new Event('pagehide'));
    app.replaceChildren();
    seasonsGallery(app, new URLSearchParams('screens=seasons&reduced=1'));
    expect(app.querySelectorAll('.sz-phone')).toHaveLength(1);
    expect(app.querySelector('.sz-caption')?.textContent).toContain('ничего не играет');
    expect(app.querySelector('.sz-host')?.shadowRoot).toBeNull();
  });
});
