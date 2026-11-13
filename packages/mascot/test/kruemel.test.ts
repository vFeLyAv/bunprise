import { afterEach, describe, expect, it } from 'vitest';
import { Bunny } from '../src/index';
import { applyKit, KIT_BODY, KIT_BODY_PTS, KIT_EAR_L, KIT_EAR_R, kitEarPts, kitTop, smoothSample, type Pt } from '../demo/kruemel/kit';
import { KIT_COATS, KIT_EAR_SWING, kitInto, kitStage, kruemelGallery } from '../demo/kruemel/gallery';
import { KIT_MOMENTS, momentTracks, startMoment, type KitMoment } from '../demo/kruemel/moments';

// Krümel v2 (26.10, gallery-only prototype): the same puppet reshaped as a baby lop in the "airplane ears"
// phase (one ear up, one sideways with a flopping tip); his ears never change shape in motion (they only turn
// about their roots), he hides fully behind the edge before his peek, his two moments are short, seekable and
// transform / opacity only.

const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];
const MOMENTS: readonly KitMoment[] = ['plop', 'sneeze'];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  document.head.replaceChildren();
});

function puppet(): { bunny: Bunny; svg: SVGSVGElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const bunny = new Bunny(host, { idle: false, reducedMotion: 'force', interactive: false });
  const svg = bunny.root.querySelector('svg');
  if (!svg) throw new Error('no svg');
  return { bunny, svg };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('Krümel look (applyKit)', () => {
  it('reshapes the puppet with attributes only: one silhouette, big eyes, rabbit-ear paths', () => {
    const { svg } = puppet();
    applyKit(svg, 'upright');
    const hm = svg.querySelector('.hm');
    expect(hm?.classList.contains('ears-up')).toBe(true);
    expect(hm?.classList.contains('ears-lop')).toBe(false);
    expect(svg.querySelector('.breathe > path')?.getAttribute('d')).toBe(KIT_BODY);
    expect(svg.querySelector('clipPath path')?.getAttribute('d')).toBe(KIT_BODY);
    expect(Number(svg.querySelector('.eyes .eye ellipse')?.getAttribute('rx'))).toBeGreaterThan(6.2);
    // ears: outer shape first (it gets the contour) + the pink inside; the floppy one also its darker turned half
    expect(svg.querySelectorAll('.up .ear-l > path')).toHaveLength(2);
    expect(svg.querySelectorAll('.up .ear-r > path')).toHaveLength(3);
    for (const ear of svg.querySelectorAll('.up .ear-l, .up .ear-r')) expect((ear as SVGElement).style.transform).toBe('');
    // they turn about their roots (pivots in the puppet's own style, not inline)
    const css = svg.querySelector('style.kit-css')?.textContent ?? '';
    expect(css).toContain(`transform-origin: ${KIT_EAR_L.root[0]}px ${KIT_EAR_L.root[1]}px`);
    expect(css).toContain(`transform-origin: ${KIT_EAR_R.root[0]}px ${KIT_EAR_R.root[1]}px`);
  });

  it('is idempotent and the ears are chosen when drawn (lop = grown)', () => {
    const { svg } = puppet();
    applyKit(svg, 'upright');
    const once = svg.innerHTML;
    applyKit(svg, 'upright');
    expect(svg.innerHTML).toBe(once);
    applyKit(svg, 'lop');
    expect(svg.querySelector('.hm')?.classList.contains('ears-lop')).toBe(true);
  });

  it('rabbit ears, not cat ears: long spoon shapes (≥ 2 × their width), a round tip', () => {
    for (const [ear, pts] of [[KIT_EAR_L, kitEarPts().l], [KIT_EAR_R, kitEarPts().r]] as const) {
      const len = Math.max(...pts.map((p) => dist(p, ear.root)));
      expect(len / ear.w).toBeGreaterThanOrEqual(2);
    }
  });

  it('one soft silhouette: a head wider than the small body, and no pinched snowman waist', () => {
    const right = smoothSample(KIT_BODY_PTS).filter(([x]) => x > 0);
    const widest = (lo: number, hi: number) => Math.max(...right.filter(([, y]) => y >= lo && y <= hi).map(([x]) => x));
    const head = widest(-120, -80);
    const haunch = widest(-40, -10);
    expect(head - haunch).toBeGreaterThanOrEqual(6);
    // between the cheek fluff and the haunches the outline never dips more than 3 units under the haunches
    const narrowest = Math.min(...[-55, -50, -45, -40].map((y) => Math.max(...right.filter(([, yy]) => Math.abs(yy - y) < 2.5).map(([x]) => x))));
    expect(haunch - narrowest).toBeLessThanOrEqual(3);
  });

  it('his ears stay below the stage line that hides a peeking bunny (no ear tips before his climb)', () => {
    // welcome-actors: hidden = 12 units below the line for the lop hull top (-167), i.e. any point below y -179
    expect(kitTop('upright')).toBeGreaterThan(-177);
    expect(kitTop('lop')).toBeGreaterThan(-177);
  });

  it('his ears stay inside the stage frame and clear of the gripping paws (paws at ±24 units, 13 wide)', () => {
    const { l, r } = kitEarPts();
    const all = [...smoothSample(l), ...smoothSample(r)];
    // the actor frame crops the bunny at x ±100, y -205 (welcome-actors CROP)
    expect(Math.max(...all.map(([x]) => Math.abs(x)))).toBeLessThan(96);
    // the far ends of both ears are well outside the paws
    const far = (pts: Pt[], root: Pt) => pts.reduce((a, b) => (dist(b, root) > dist(a, root) ? b : a));
    expect(Math.abs(far(l, KIT_EAR_L.root)[0])).toBeGreaterThanOrEqual(24 + 13 + 4);
    expect(Math.abs(far(r, KIT_EAR_R.root)[0])).toBeGreaterThanOrEqual(24 + 13 + 4);
  });
});

describe('Krümel moments (gallery only)', () => {
  it('are short (≤ 2 s), transform / opacity only, in time order, and end in the resting pose', () => {
    for (const m of MOMENTS) {
      const D = KIT_MOMENTS[m].duration;
      expect(D).toBeLessThanOrEqual(2);
      for (const tr of momentTracks(m)) {
        const ts = tr.keys.map(([t]) => t);
        expect(ts[0]).toBe(0);
        expect(ts.at(-1)).toBeCloseTo(D, 5);
        for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1] ?? 0);
        const [, first] = tr.keys[0] ?? [];
        const [, last] = tr.keys.at(-1) ?? [];
        expect(last).toEqual(first);
      }
    }
  });

  it('every part they move exists on a Krümel puppet; seek(t) freezes every animation at t', () => {
    for (const m of MOMENTS) {
      const { svg } = puppet();
      applyKit(svg, 'upright');
      const anims = startMoment(svg, m, 0.8);
      for (const tr of momentTracks(m)) expect(svg.querySelectorAll(tr.sel).length, `${m} ${tr.name}`).toBeGreaterThan(0);
      expect(anims.length).toBeGreaterThan(0);
      for (const a of anims) {
        expect(a.playState).toBe('paused');
        expect(a.currentTime).toBe(800);
        expect((a.effect as KeyframeEffect).getTiming().duration).toBe(KIT_MOMENTS[m].duration * 1000);
        for (const k of (a.effect as KeyframeEffect).getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
      }
      // the ears only turn (never a shape change)
      for (const a of anims.filter((x) => ((x.effect as KeyframeEffect).target as Element).matches('.ear-l, .ear-r'))) {
        for (const k of (a.effect as KeyframeEffect).getKeyframes()) expect(String(k.transform)).toMatch(/^rotate\(-?[\d.]+deg\)$/);
      }
    }
  });

  it('the sneeze puffs are added to the puppet once (idempotent)', () => {
    const { svg } = puppet();
    applyKit(svg, 'upright');
    startMoment(svg, 'sneeze', 0.6).forEach((a) => a.cancel());
    startMoment(svg, 'sneeze', 0.6);
    expect(svg.querySelectorAll('.kit-puff-0')).toHaveLength(1);
  });
});

describe('Krümel peeks (the approved peek-once)', () => {
  function stage(reducedMotion: 'off' | 'force') {
    const host = document.createElement('div');
    document.body.append(host);
    return kitStage(host, { coat: 'fawn', ears: 'upright', scale: 0.72, reducedMotion });
  }

  it('his baby ears swing with the stage ear physics: rotation only, a little stiffer, never a shape change', () => {
    const s = stage('off');
    const kit = s.animations.filter((a) => a.id.startsWith('kit.'));
    expect(kit.length).toBeGreaterThan(0);
    for (const a of s.animations) {
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
    }
    for (const a of kit) {
      const target = (a.effect as KeyframeEffect).target as Element;
      expect(target.closest('.up')).not.toBeNull();
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) {
        const m = /^rotate\((-?[\d.]+)deg\)$/.exec(String(k.transform));
        expect(m).not.toBeNull();
        // the approved follow-through is ≤ ±14° (the idle twitch +9°): his answer is KIT_EAR_SWING of it
        expect(Math.abs(Number(m?.[1]))).toBeLessThanOrEqual(14 * KIT_EAR_SWING + 1e-6);
      }
    }
  });

  it('hides behind the card edge like the app (the 16 px edge inset), not behind the host bottom', () => {
    const s = stage('off');
    // the clip box = the host minus a 16 px strip at the bottom (browsers shorten "0px 0px 16px 0px", jsdom does not)
    expect((s.root.querySelector('.clip') as HTMLElement | null)?.style.inset).toMatch(/^0px 0px 16px( 0px)?$/);
  });

  it('after the stage rebuilds itself (a new size), Krümel goes back in, ears and all', () => {
    const s = stage('off');
    s.seek(1.2);
    (s as unknown as { rebuild(): void }).rebuild();
    const hm = () => s.root.querySelector('.actor')?.shadowRoot?.querySelector('.hm');
    expect(hm()?.classList.contains('kit')).toBe(false);
    kitInto(s, 'upright');
    expect(hm()?.classList.contains('kit')).toBe(true);
    const ears = s.animations.filter((a) => a.id.startsWith('kit.'));
    expect(ears.length).toBeGreaterThan(0);
    for (const a of ears) expect(a.currentTime).toBe(1200);
  });

  it('reduced motion: the static composition, no animation at all', () => {
    const s = stage('force');
    expect(s.reducedMotion).toBe(true);
    expect(s.animations).toHaveLength(0);
    expect(s.root.querySelector('.actor')?.shadowRoot?.querySelector('.hm')?.classList.contains('kit')).toBe(true);
  });
});

describe('the gallery page', () => {
  const kitsOf = (app: HTMLElement) => [...app.querySelectorAll('.kr-floor')].map((f) => f.shadowRoot?.querySelector('.hm'));

  it('shows the comparison, both moments, the card in light and dark, the coats without blue, before / after', () => {
    const app = document.createElement('main');
    document.body.append(app);
    kruemelGallery(app, new URLSearchParams('screens=kruemel&frames=3&t=1.2'));
    expect(KIT_COATS).not.toContain('blue');
    const kits = kitsOf(app);
    // 2 (next to Pompon) + 2 moments × 2 sizes + 2 × 3 moment frames + 4 coats + 2 (before / after)
    expect(kits).toHaveLength(2 + 4 + 6 + 4 + 2);
    expect(kits.filter((hm) => !hm?.classList.contains('kit'))).toHaveLength(1); // Pompon
    expect(kits.filter((hm) => hm?.classList.contains('kit') && hm.classList.contains('ears-lop'))).toHaveLength(1);
    // Pompon today + Krümel on the card, light and dark, and 3 frozen peek frames
    expect(app.querySelectorAll('.kr-host')).toHaveLength(4 + 3);
    for (const shot of ['compare', 'moment-plop', 'moment-sneeze', 'card-light', 'card-dark', 'coats', 'grown', 'sheet-plop', 'sheet-sneeze', 'sheet-peek']) {
      expect(app.querySelector(`[data-shot="${shot}"]`), shot).not.toBeNull();
    }
  });

  it('reduced motion: nobody moves (no moments, no contact sheets)', () => {
    const app = document.createElement('main');
    document.body.append(app);
    kruemelGallery(app, new URLSearchParams('screens=kruemel&reduced=1'));
    for (const f of app.querySelectorAll('.kr-floor')) expect(f.shadowRoot?.querySelector('svg')?.getAnimations?.({ subtree: true }) ?? []).toHaveLength(0);
    expect(app.querySelectorAll('.kr-cell')).toHaveLength(0);
  });
});
