/**
 * «Клубничка» (31.10) — GALLERY-ONLY prototype: the strawberry bush, the costume still and the scene.
 *
 * Felix, 2nd review: «Клубничку я бы перевернул … Типа деревце, он встаёт на задние лапки, чтобы дотянуться до
 * клубнички, и кушает её, вокруг рта чуть краснее становятся пятна или кусочки, типа он запачкался». Photo 14: the
 * berries grow on the plant, the bunny's nose is right at one of them.
 * 3rd review: «чтобы он именно вставал на лапки и ротиком ел с дерева, а не срывал клубнику … сделай пышнее»,
 * «на дыбы вставать лапками, а не растягиваться + убрать эту „лиану“».
 * 4th review: «я бы выбрал куст (Б) и убрал бы эту странную висящую клубнику и исправил бы поднятие, как ты сделал в
 * перископе».
 *
 * So here:
 *   - ONE plant: the wide bush (B) beside him on his right — leaf clusters in three greens, white flowers, berries;
 *   - HIS berry grows on the bush itself: on its leafy edge right beside his mouth, lying with its tip towards him,
 *     below his eye — nothing hangs over his head or his eye; it stays on the bush the whole time;
 *   - the costume still (costumes.ts): the bush, his half-eaten berry on it, juice round his mouth, content ^ ^;
 *   - the scene: ONE seekable timeline (drive.ts Driver over timeline.ts Tracks — transform / opacity only, no timers):
 *     he notices the berry → rises like the approved «Перископ» (demo/alive/moves.ts: his own hind feet stay planted
 *     exactly as when he sits, the body rises ~10 units from them and stays on them, front paws up at the chest, nose
 *     up, nothing squashed or stretched) → sniffs → settles a little lower, leans in and eats from the bush with his
 *     MOUTH: three bites from the tip, the berry gets smaller, the little leafy branch it grows on gives and bobs, his
 *     cheeks puff and chew, juice spots appear and stay → he comes back down, content, with a messy mouth.
 *
 * The puppet is the real Pompon (Bunny, 3/4 turn to the bush), dressed from outside through rig.ts like every costume;
 * packages/mascot/src is not touched. Built with reducedMotion 'force' so none of his own CSS loops runs: everything
 * that moves is on the one timeline, which ends (finite). Reduced motion: the end pose, still, no animate() call at all.
 * Pauses while off screen or in a hidden tab (drive.ts Watch). The bush stands on the floor (`cs-floor`): the carried
 * bunny of «Перенос» leaves it out (rig.ts).
 */

import { Bunny } from '../../src/bunny';
import { Driver, freezeAt, sampleTracks, Watch } from '../../src/drive';
import { Track, type Sampled, type StyleOut } from '../../src/timeline';
import { place } from '../wardrobe/items';
import { ell, f, flipX, outfit, type Kind, type Layer, type Look } from './rig';
import { MODELS } from './fur';

// ---- colours (flat, our palette) ----------------------------------------------------------------------------------

const RED = '#EF4B55';
const RED_D = '#D63A45';
const SEED = '#FFE3A0';
const FLESH = '#FCD3CF';
const LEAF = '#7DBB5E';
const STEM = '#A67C55';
const JUICE = '#EC5A69';
/** the bush's three greens: back, middle, light front */
const G1 = '#4E8C43';
const G2 = '#6FAE57';
const G3 = '#93CA72';

const O = 'class="cs-o"';
const p = (d: string, fill: string, o = false, extra = '') => `<path ${o ? `${O} ` : ''}d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const line = (d: string, color: string, w: number, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra ? ` ${extra}` : ''}/>`;
/** A group that moves about its own point (puppet units). */
const pivot = (cls: string, x: number, y: number, inner: string) => `<g class="${cls}" style="transform-box: view-box; transform-origin: ${f(x)}px ${f(y)}px">${inner}</g>`;
/** Every path of a drawing moved (and turned / scaled) in its own data (the costume tests read raw coordinates). */
const placed = (svg: string, x: number, y: number, deg = 0, k = 1) => svg.replace(/ d="([^"]+)"/g, (_m, d: string) => ` d="${place(d, x, y, deg, k)}"`);

// ---- the berry -------------------------------------------------------------------------------------------------
// Drawn TIP UP around (0, 0): the tip at -17, widest ±12.6 at y ≈ 2, the end with the green sepals at +11.4.

const BERRY = 'M0 -17 C3.6 -16.6 12.4 -8 12.6 2.2 C12.6 8 7.6 11.4 0 11.4 C-7.6 11.4 -12.6 8 -12.6 2.2 C-12.4 -8 -3.6 -16.6 0 -17 Z';
const BERRY_SHADE = 'M5 -14.6 C9.6 -10.6 12.6 -4 12.6 2.2 C12.6 8 7.6 11.4 0 11.4 C5.4 9 8.4 5 8.6 0 C8.8 -5.4 7.4 -10.6 5 -14.6 Z';
/** the sepals (a soft green star at the stem end) — one path, so its outline never shows inside it */
const CALYX = [ell(0, 11.6, 5.2, 2.8), ...[150, 118, 90, 62, 30].map((a) => ell(5 * Math.cos((a * Math.PI) / 180), 11.6 + 4.6 * Math.sin((a * Math.PI) / 180), 5.4, 2.2, a))].join(' ');
const SEEDS: ReadonlyArray<readonly [number, number]> = [[-3, -10], [3, -10], [-7.2, -4], [0, -4.6], [7.2, -4], [-9.6, 2], [-3.2, 1.4], [3.2, 1.4], [9.6, 2], [-5.6, 7.4], [0.4, 7.8], [6, 7.2]];

/**
 * The bite stages (0 = whole … 3 = only its round end): the outline with the bites taken out of the tip end, the pale
 * flesh along the bite, from which y the seeds still show, and where the bitten edge is (tip-up y).
 */
const BITES: ReadonlyArray<{ d: string; flesh: string; from: number; edge: number }> = [
  { d: BERRY, flesh: '', from: -20, edge: -17 },
  {
    d: 'M-9.2 -7 C-8 -11.2 -3.6 -11.6 -1.4 -8.2 C0.4 -11.8 5.4 -12 7.6 -8.6 C8.4 -7.6 8.9 -7.4 9.4 -6.8 C11.6 -4 12.7 -1 12.6 2.2 C12.6 8 7.6 11.4 0 11.4 C-7.6 11.4 -12.6 8 -12.6 2.2 C-12.7 -1 -11.6 -4 -9.2 -7 Z',
    flesh: 'M-9.2 -7 C-8 -11.2 -3.6 -11.6 -1.4 -8.2 C0.4 -11.8 5.4 -12 7.6 -8.6 C8.4 -7.6 8.9 -7.4 9.4 -6.8 C8 -4.6 6 -4.8 4.4 -6 C2.6 -4.2 -0.4 -4 -2 -5.4 C-4.6 -3.8 -7.6 -4.4 -9.2 -7 Z',
    from: -4,
    edge: -9,
  },
  {
    d: 'M-12.4 0.4 C-11 -4.4 -6.4 -4.8 -4.2 -1.6 C-2.4 -5.6 3 -5.8 5 -2.4 C7 -5 11 -3.6 12.6 0.6 C12.7 6.6 7.6 11.4 0 11.4 C-7.6 11.4 -12.6 6.6 -12.4 0.4 Z',
    flesh: 'M-12.4 0.4 C-11 -4.4 -6.4 -4.8 -4.2 -1.6 C-2.4 -5.6 3 -5.8 5 -2.4 C7 -5 11 -3.6 12.6 0.6 C10.6 2.6 7.6 2 5.6 0.6 C3.4 2.6 -1.4 2.4 -3.4 0.8 C-6 3 -10 2.6 -12.4 0.4 Z',
    from: 3.4,
    edge: -3,
  },
  {
    d: 'M-11.6 6.4 C-9.6 2.6 -5 2.4 -2.8 5.2 C-0.6 2 4.6 2 6.6 4.8 C8.6 3 11.2 4.2 11.8 6.6 C11 9.8 6.6 11.4 0 11.4 C-6.6 11.4 -11 9.6 -11.6 6.4 Z',
    flesh: 'M-11.6 6.4 C-9.6 2.6 -5 2.4 -2.8 5.2 C-0.6 2 4.6 2 6.6 4.8 C8.6 3 11.2 4.2 11.8 6.6 C9.6 7.8 7.6 7.6 6 6.6 C3.6 8.2 -0.6 8 -2.4 7 C-5.4 8.6 -9.4 8.2 -11.6 6.4 Z',
    from: 9.5,
    edge: 3.2,
  },
];

/** The berry at bite stage `stage` (0 whole … 3 the last bit), tip up, centred (0, 0). */
export function berry(stage: number): string {
  const b = BITES[Math.max(0, Math.min(BITES.length - 1, stage))] ?? BITES[0];
  if (!b) return '';
  const seeds = SEEDS.filter(([, y]) => y > b.from).map(([x, y]) => ell(x, y, 0.95, 1.5)).join(' ');
  return p(b.d, RED, true)
    + (stage === 0 ? p(BERRY_SHADE, RED_D, false, 'opacity=".45"') : '')
    + (seeds ? p(seeds, SEED) : '')
    + (b.flesh ? p(b.flesh, FLESH) : '')
    + (stage <= 1 ? p(ell(-6.6, -1.2, 1.9, 3.6, 18), '#FFFFFF', false, 'opacity=".55"') : '')
    + p(CALYX, LEAF, true);
}

/** A berry hanging from a point (tx, ty) under the leaves: turned over (tip down), on a short stem. */
function hanging(tx: number, ty: number, k = 1): string {
  const cy = ty + (4 + 12) * k;
  return line(`M${f(tx)} ${f(ty - 8)} L${f(tx)} ${f(ty + 5.4 * k)}`, '#6E9A47', 2 * k) + placed(berry(0), tx, cy, 180, k);
}

// ---- HIS berry: on the bush's leafy edge, right beside his mouth ----------------------------------------------------
// It grows on the end of a low leafy branch of the bush and lies with its tip towards him (like the berry at the
// bunny's nose in photo 14), at his mouth's height, below his eye (its top edge stays under the eye in every pose).

/** its centre, its turn (the tip points left and a little up) and its size */
const HIS = { x: 34.4, y: -76.2, deg: -70, k: 0.65 } as const;
/** where it grows from the bush (its green top; it bobs about this point) */
const HIS_TOP = { x: 44, y: -73 } as const;
/** His berry at bite stage `stage`, in place on the bush. */
const hisBerry = (stage: number) => placed(berry(stage), HIS.x, HIS.y, HIS.deg, HIS.k);

// ---- the bush (Felix's choice: B «широкий куст») ---------------------------------------------------------------------
// Beside him on his right (the 3/4 turn looks at it): a wide, full bush — round leaf clusters in three greens (back ·
// middle · light front), white flowers, berries hanging on short stems under the leaves — and one low leafy branch
// that ends right beside his mouth, where his berry grows. His feet stay free (the bush starts right of them at the
// ground), nothing of it reaches his eyes or his head. Within |x| ≤ 165 (the costume test allows the bush that much:
// Felix «сделай пышнее») and y ≥ -245.

type C3 = ReadonlyArray<readonly [number, number, number]>;
const BUSH = {
  /** low branches under the leaves (one up to his berry) */
  limbs: 'M84 -4 C80 -24 74 -44 66 -62 M150 -4 C152 -20 154 -34 152 -46',
  back: [[100, -22, 22], [134, -26, 24], [156, -16, 9], [96, -58, 20], [128, -62, 24], [150, -56, 12], [112, -96, 20], [140, -98, 18], [124, -126, 16], [70, -72, 13], [56, -70, 10]] as C3,
  mid: [[104, -40, 17], [134, -44, 18], [114, -80, 16], [140, -82, 13], [126, -112, 12], [82, -64, 10], [64, -74, 8]] as C3,
  light: [[108, -50, 7], [132, -70, 8], [118, -104, 6], [86, -72, 4.5]] as C3,
  flowers: [[92, -90, 5], [128, -130, 4.6], [152, -72, 4.4], [114, -30, 4.6], [76, -56, 4]] as C3,
  /** berries on short stems under the leaves: [point x, y, size] */
  berries: [[146, -112, 0.85], [154, -78, 0.75], [92, -40, 0.8]] as C3,
  shadow: [122, 40] as const,
};

const clusters = (cs: C3) => cs.map(([x, y, r]) => ell(x, y, r)).join(' ');

function flower(x: number, y: number, r: number): string {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    petals += `${ell(x + r * 0.58 * Math.cos(a), y + r * 0.58 * Math.sin(a), r * 0.5)} `;
  }
  return p(petals.trim(), '#FFFFFF', true) + p(ell(x, y, r * 0.36), '#F6C445');
}

/**
 * The bush. 'scene': his berry is its own group (it gives and bobs when he bites) and its bite stages are groups;
 * 'still': his berry half eaten. `side` -1 mirrors it to his left (Tapsi: his folded ear is right). Back to front:
 * shadow, branches, back leaves (with the low leafy branch), hanging berries, his berry's stem and berry, middle leaves
 * (they cover where it grows), light leaves, flowers.
 */
export function bush(mode: 'scene' | 'still', side: 1 | -1 = 1): string {
  const stem = line(`M${HIS_TOP.x} ${HIS_TOP.y} L52 -71`, '#6E9A47', 2);
  const his = mode === 'scene'
    ? pivot('sb-twig', HIS_TOP.x, HIS_TOP.y, stem + [0, 1, 2, 3].map((i) => `<g class="sb-st sb-st-${i}">${hisBerry(i)}</g>`).join(''))
    : stem + hisBerry(2);
  const body = `<ellipse cx="${BUSH.shadow[0]}" cy="1.4" rx="${BUSH.shadow[1]}" ry="3.8" fill="var(--mascot-shadow, rgba(70,40,15,.12))"/>`
    + line(BUSH.limbs, STEM, 3.2)
    + p(clusters(BUSH.back), G1, true)
    + BUSH.berries.map(([x, y, k]) => hanging(x, y, k)).join('')
    + his
    + p(clusters(BUSH.mid), G2, true) + p(clusters(BUSH.light), G3)
    + BUSH.flowers.map(([x, y, r]) => flower(x, y, r)).join('');
  return `<g class="cs-floor">${side === 1 ? body : mirrored(body)}</g>`;
}

/** The same markup mirrored to the left in its coordinates (paths, ellipse centres). */
function mirrored(svg: string): string {
  return svg
    .replace(/ d="([^"]+)"/g, (_m, d: string) => ` d="${flipX(d)}"`)
    .replace(/ cx="(-?[\d.]+)"/g, (_m, x: string) => ` cx="${f(-Number(x))}"`);
}

// ---- juice round his mouth ------------------------------------------------------------------------------------
// Little strawberry-red spots on his muzzle and one tiny bit on the cheek — they come bite by bite and stay.

const SPOTS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [-8, -72.2, 3.6, 2.4, 18], [7.8, -71, 2.6, 1.8, -14], [-13.8, -77.4, 1.5, 1.3, 0], [1.6, -68.2, 2.1, 1.5, 6],
];
const MOUTH_DY: Record<Kind, number> = { bunny: 0, hamster: -7.6 };

/** Juice spot `i` (0…3) round the mouth of this kind of mascot (the face slot follows every glance and turn). */
export function juice(kind: Kind, i: number): string {
  const s = SPOTS[i];
  if (!s) return '';
  const [x, y, rx, ry, r] = s;
  return p(ell(x, y + MOUTH_DY[kind], rx, ry, r), i === 2 ? RED : JUICE, false, `opacity="${i === 2 ? '.9' : '.72'}"`);
}

/** The still look for the costume grid: the bush, his half-eaten berry on it, a messy mouth. */
export function strawberryStill(kind: Kind): Layer[] {
  return [
    { slot: 'front', draw: () => bush('still', kind === 'hamster' ? -1 : 1) },
    { slot: 'face', draw: (c) => [0, 1, 2, 3].map((i) => juice(c.kind, i)).join('') },
  ];
}

// ---- the scene ---------------------------------------------------------------------------------------------------

/** Seconds the scene takes (then he stays content). */
export const SCENE_S = 6;
/** The three bites (s). A little round end stays on the bush — he is full. */
const BITE_AT = [2.2, 2.9, 3.6] as const;
type Pose = { x: number; y: number; r: number };
const SIT: Pose = { x: 0, y: 0, r: 0 };
/** «Перископ» (demo/alive, approved): the body rises this much from his planted feet — they still reach up into it */
const PERISCOPE_H = 10;
/** while he eats: a little risen, leaning in towards the bush a bit more before each bite (r ≤ 5°, about his feet) */
const EAT_POSES: readonly Pose[] = [
  { x: 0, y: -3, r: 2.5 },
  { x: 0, y: -3, r: 3.5 },
  { x: 0, y: -3, r: 5 },
];
/** his face while he eats (looking into the berry; within the puppet's own glance range, ≤ 5) */
const EAT_FACES: ReadonlyArray<{ x: number; y: number }> = [{ x: 3.4, y: -1 }, { x: 4.4, y: -1 }, { x: 5, y: -1 }];
/** before each bite the little branch gives towards his mouth (x, units): the bitten tip recedes */
const TUGS = [0, -3, -5] as const;
/** the periscope's front paws at the chest */
const PAW_L = { x: 3, y: -12, r: 24 } as const;
const PAW_R = { x: -3, y: -12, r: -24 } as const;

export interface StrawberryOptions {
  /** width of the puppet in px (the stage is a bit wider and taller) */
  size?: number;
  /** reduced motion: the end pose, still (no animate() at all) */
  reduced?: boolean;
  onEnd?: () => void;
}

const STAGE_CSS = `
.sb-stage { position: relative; overflow: hidden; border-radius: 14px; background: var(--cs-card, #FFFDF8); box-shadow: inset 0 0 0 1px var(--cs-line, rgba(0,0,0,.08)); }
.sb-stage > .sb-host { position: absolute; left: 0; }
`;

export class StrawberryScene {
  readonly duration = SCENE_S;
  readonly tracks: Sampled[] = [];
  readonly bunny: Bunny;
  readonly el: HTMLElement;
  private readonly driver: Driver | null = null;
  private readonly watch: Watch | null = null;
  private readonly reduced: boolean;
  private still = 0;

  constructor(host: HTMLElement, o: StrawberryOptions = {}) {
    const size = o.size ?? 240;
    this.reduced = !!o.reduced;
    if (!document.getElementById('sb-stage-css')) {
      const st = document.createElement('style');
      st.id = 'sb-stage-css';
      st.textContent = STAGE_CSS;
      document.head.append(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'sb-stage';
    this.el.style.width = `${Math.round(size * 1.06)}px`;
    this.el.style.height = `${Math.round(size * 0.78)}px`;
    const ph = document.createElement('div');
    ph.className = 'sb-host';
    ph.style.bottom = `${Math.round(size * 0.04)}px`;
    this.el.append(ph);
    host.append(this.el);
    // the real Pompon, still on his own (reducedMotion 'force': none of his CSS loops), turned 3/4 to the bush
    this.bunny = new Bunny(ph, { size, coat: 'fawn', ears: 'lop', idle: false, interactive: false, reducedMotion: 'force' });
    const root = this.bunny.root;
    outfit(root, MODELS.pompon, this.look());
    root.querySelector('.hm')?.classList.add('turn-r');
    this.author(root);
    if (this.reduced) {
      freezeAt(this.tracks, SCENE_S);
      this.still = SCENE_S;
      return;
    }
    this.driver = new Driver(this.el, this.tracks, SCENE_S, o.onEnd);
    this.watch = new Watch(this.el, this.driver);
  }

  /** The scene's look on the rig: the bush with his berry (front) and the juice (face). */
  private look(): Look {
    return {
      id: 'strawberry-scene',
      layers: [
        { slot: 'front', draw: () => bush('scene') },
        { slot: 'face', draw: (c) => [0, 1, 2, 3].map((i) => `<g class="sb-j sb-j-${i}">${juice(c.kind, i)}</g>`).join('') },
      ],
    };
  }

  private author(root: ShadowRoot): void {
    const q = (sel: string) => root.querySelector(sel) as SVGElement | null;
    const qa = (sel: string) => Array.from(root.querySelectorAll(sel));
    const add = (t: Track | null) => {
      if (t) this.tracks.push(t);
      return t;
    };
    const track = (sel: string | Element[], name: string, base: Record<string, number>) => {
      const els = typeof sel === 'string' ? qa(sel) : sel;
      return els.length ? add(new Track(els, name, base)) : null;
    };
    // his body rises from and leans about his feet (it keeps its shape); his hind feet are never moved
    const body = q('.body');
    if (body) {
      body.style.transformBox = 'view-box';
      body.style.transformOrigin = '0px -1px';
    }

    const OUT = 'cubic-bezier(.2,.7,.3,1)';
    const last = BITE_AT[BITE_AT.length - 1] ?? 3.6;
    const DOWN = last + 0.55;

    // ---- body: notices → a little dip → the periscope rise → sniffs up there → settles a little lower and leans in to
    // eat (a small nudge with each bite) → back down onto his feet with a tiny settle
    const bodyT = track('.body', 'body', { ...SIT });
    bodyT?.move(0.7, 0.86, { y: 1.5 }, OUT)
      .move(0.86, 1.12, { y: -PERISCOPE_H - 1.5 }, OUT).move(1.12, 1.26, { y: -PERISCOPE_H }, 'ease-in-out');
    BITE_AT.forEach((b, i) => {
      const s = EAT_POSES[i] ?? SIT;
      bodyT?.move(i === 0 ? 1.8 : b - 0.3, b - 0.06, s, 'ease-in-out')
        .move(b - 0.06, b + 0.05, { ...s, r: s.r + 1 }, 'ease-out').move(b + 0.05, b + 0.22, s, 'ease-in-out');
    });
    bodyT?.move(DOWN, DOWN + 0.2, { x: 0, y: 0.8, r: 0 }, 'ease-in').move(DOWN + 0.2, DOWN + 0.36, SIT, 'ease-out');
    track('.shadow', 'shadow', { sx: 1, sy: 1 })?.move(0.86, 1.12, { sx: 0.93, sy: 0.96 }, OUT).move(1.8, 2.1, { sx: 0.98, sy: 0.99 }).move(DOWN, DOWN + 0.2, { sx: 1.03, sy: 1 }, 'ease-in').move(DOWN + 0.2, DOWN + 0.4, { sx: 1, sy: 1 }, 'ease-out');

    // ---- face: looks at the berry, nose up while he is up, into the berry while he eats, at the end looks at you
    const faceT = track('.face', 'face', { x: 0, y: 0 });
    faceT?.move(0.35, 0.7, { x: 2.5, y: -0.5 }).move(0.86, 1.12, { x: 2.5, y: -2 }, OUT);
    BITE_AT.forEach((b, i) => faceT?.move(i === 0 ? 1.8 : b - 0.3, b - 0.06, EAT_FACES[i] ?? { x: 0, y: 0 }, 'ease-in-out'));
    faceT?.move(DOWN, DOWN + 0.4, { x: -1.5, y: 0.5 });

    // ---- eyes: a blink while he sniffs; happy ^ ^ from the first bite on
    track('.eyes .eye', 'blink', { sx: 1, sy: 1 })?.move(1.58, 1.65, { sy: 0.12 }, 'ease-in').move(1.65, 1.74, { sy: 1 }, 'ease-out');
    const first = BITE_AT[0] ?? 2.2;
    track('.eyes', 'eyes', { o: 1 })?.set(first + 0.02, { o: 0 });
    track('.eyes-happy', 'happy', { o: 0 })?.set(first + 0.02, { o: 1 });

    // ---- nose: sniffs at the berry while he is up
    const nose = track('.nose', 'nose', { sx: 1, sy: 1 });
    const wiggle = (t: Track | null, from: number, n: number, v: Record<string, number>, half = 0.06) => {
      for (let i = 0; i < n; i++) t?.move(from + i * 2 * half, from + i * 2 * half + half, v, 'ease-in-out').move(from + i * 2 * half + half, from + (i + 1) * 2 * half, { sx: 1, sy: 1 }, 'ease-in-out');
    };
    wiggle(nose, 1.3, 4, { sx: 1.1, sy: 0.82 }, 0.055);

    // ---- lop ears: the periscope's soft answers (≤ 7°) to the rise and to sitting down
    const ears = (sel: string, s: 1 | -1) => track(sel, `ear${s}`, { r: 0 })
      ?.move(0.88, 1.0, { r: 7 * s }, OUT).move(1.0, 1.2, { r: -3 * s }).move(1.2, 1.32, { r: s }).move(1.32, 1.42, { r: 0 })
      .move(DOWN + 0.2, DOWN + 0.26, { r: 7 * s }, OUT).move(DOWN + 0.26, DOWN + 0.38, { r: -3 * s }).move(DOWN + 0.38, DOWN + 0.5, { r: s }).move(DOWN + 0.5, DOWN + 0.6, { r: 0 });
    ears('.lop .ear-l', 1);
    ears('.lop .ear-r', -1);

    // ---- front paws: up at his chest (the periscope's), down again when he sits
    track('.paw-l', 'pawL', { x: 0, y: 0, r: 0 })?.move(0.89, 1.12, PAW_L, OUT).move(DOWN, DOWN + 0.2, { x: 0, y: 0, r: 0 }, 'ease-in');
    track('.paw-r', 'pawR', { x: 0, y: 0, r: 0 })?.move(0.91, 1.14, PAW_R, OUT).move(DOWN, DOWN + 0.2, { x: 0, y: 0, r: 0 }, 'ease-in');

    // ---- his berry on its little branch: before each bite it gives towards his mouth (the bitten tip recedes), with
    // the bite it bobs; when he sits back it springs back (the little round end stays on the bush)
    const twig = track('.sb-twig', 'twig', { x: 0, y: 0, r: 0 });
    BITE_AT.forEach((b, i) => {
      const x = TUGS[i] ?? 0;
      twig?.move(b - 0.3, b - 0.04, { x, y: 0, r: 0 }, 'ease-in-out').move(b + 0.02, b + 0.12, { x, y: 1.2, r: -4 }, 'ease-out').move(b + 0.12, b + 0.32, { x, y: 0, r: 1.5 }, 'ease-in-out').move(b + 0.32, b + 0.46, { x, y: 0, r: 0 }, 'ease-in-out');
    });
    twig?.move(DOWN, DOWN + 0.22, { x: 1.5, y: 0, r: 2 }, 'ease-out').move(DOWN + 0.22, DOWN + 0.5, { x: 0, y: 0, r: -1 }, 'ease-in-out').move(DOWN + 0.5, DOWN + 0.7, { x: 0, y: 0, r: 0 }, 'ease-in-out');

    // ---- eating: the mouth opens, a piece goes, he chews (only his cheeks: they puff a bit more each time), a juice
    // spot appears round his mouth and stays
    const mouthOpen = track('.mouth-open', 'mouthOpen', { o: 0 });
    const mouth = track('.mouth', 'mouth', { o: 1 });
    const chew = track(qa('.cheek-j'), 'chew', { sx: 1, sy: 1 });
    const puff = track(qa('.cheek'), 'puff', { s: 1 });
    for (let i = 0; i < BITES.length; i++) {
      const st = track(`.sb-st-${i}`, `stage${i}`, { o: i === 0 ? 1 : 0 });
      const on = i === 0 ? undefined : BITE_AT[i - 1];
      const off = BITE_AT[i];
      if (on !== undefined) st?.set(on + 0.06, { o: 1 });
      if (off !== undefined) st?.set(off + 0.06, { o: 0 });
    }
    BITE_AT.forEach((b, i) => {
      mouthOpen?.set(b - 0.04, { o: 1 }).set(b + 0.12, { o: 0 });
      mouth?.set(b - 0.04, { o: 0 }).set(b + 0.12, { o: 1 });
      wiggle(chew, b + 0.14, 3, { sx: 1.07, sy: 0.95 }, 0.085);
      wiggle(nose, b + 0.14, 3, { sx: 1.08, sy: 0.86 }, 0.085);
      puff?.move(b + 0.12, b + 0.38, { s: 1 + 0.06 * (i + 1) }, 'ease-out');
      track(`.sb-j-${i}`, `juice${i}`, { o: 0 })?.move(b + 0.1, b + 0.28, { o: 1 }, 'ease-out');
    });
    // the fourth spot (a tiny bit on his chin) comes with the last chewing
    track('.sb-j-3', 'juice3', { o: 0 })?.move(last + 0.42, last + 0.6, { o: 1 }, 'ease-out');
    puff?.move(DOWN + 0.6, SCENE_S, { s: 1.1 }, 'ease-in-out');
  }

  get time(): number {
    return this.driver?.time ?? this.still;
  }

  get playing(): boolean {
    return this.driver?.playing ?? false;
  }

  get animations(): readonly Animation[] {
    return this.driver?.animations ?? [];
  }

  /** Styles of every moving part at `t` (from the same keys as the animations). */
  sample(t: number): Record<string, StyleOut> {
    return sampleTracks(this.tracks, t);
  }

  play(): void {
    if (!this.driver || !this.watch) return;
    if (this.driver.hasEnded) this.driver.seek(0);
    this.watch.start();
  }

  pause(): void {
    this.watch?.stop();
    this.driver?.pause();
  }

  /** Freeze the exact frame at `t` seconds (screenshots, the slider). */
  seek(t: number): void {
    this.watch?.stop();
    if (this.driver) this.driver.seek(t);
    else {
      this.still = Math.max(0, Math.min(SCENE_S, t));
      freezeAt(this.tracks, this.reduced ? SCENE_S : this.still);
    }
  }

  destroy(): void {
    this.watch?.destroy();
    this.driver?.destroy();
    this.bunny.destroy();
    this.el.remove();
  }
}

// ---- the gallery blocks (the costume page) -------------------------------------------------------------------------

/** Key moments for the contact sheet: [t, what happens]. */
export const SCENE_KEYS: ReadonlyArray<readonly [number, string]> = [
  [0, 'сидит у куста, ягодка рядом'], [0.6, 'заметил'], [1.2, 'поднимается, как «Перископ»'], [1.5, 'нюхает'],
  [2.22, '1-й укус — ротиком'], [2.55, 'жуёт, щёчки полнее'], [2.92, '2-й укус (веточка качнулась)'], [3.62, '3-й укус'],
  [4.0, 'наелся — кусочек остался'], [4.4, 'опускается'], [SCENE_S, 'сидит довольный, мордочка в соке'],
];

function elx<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The scene on the costume page: a stage with ▶ / ⏸ / ↺ and a time slider (seeks the one timeline). `t` (the
 * page's &t=) shows that frame frozen. Under reduced motion: the end pose, the controls off.
 */
export function strawberrySection(parent: HTMLElement, o: { vars: Readonly<Record<string, string>>; reduced: boolean; t: number | null; size?: number }): StrawberryScene {
  const panel = elx('section', 'cs-panel sb-panel');
  for (const [k, v] of Object.entries(o.vars)) panel.style.setProperty(k, v);
  panel.append(elx('h2', undefined, 'Клубничка — сцена у куста: поднимается, как «Перископ», и ест ротиком прямо с куста (4-й отзыв, 31.10)'));
  parent.append(panel);
  const row = elx('div', 'cs-row');
  row.style.alignItems = 'flex-start';
  row.style.gap = '16px';
  panel.append(row);
  const scene = new StrawberryScene(row, { size: o.size ?? 300, reduced: o.reduced });
  const side = elx('div');
  side.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-width:420px;font-size:13px;line-height:1.45';
  row.append(side);
  side.append(elx('div', undefined, o.reduced
    ? 'Меньше движения: только конечная поза — сидит довольный у куста, вокруг рта пятнышки сока, от ягодки остался кусочек.'
    : 'Он сидит у широкого куста; одна ягодка растёт на самом краю куста, прямо у его ротика (над головой и у глаз ничего не висит). Он замечает её и поднимается, как в «Перископе»: задние лапки стоят на месте, как когда он сидит, тело приподнимается от них, передние лапки у груди, носик вверх, нюхает. Потом чуть опускается, тянется к ягодке и ест её ротиком прямо с куста: три укуса, веточка с ягодкой немного поддаётся и качается, щёчки надуваются, вокруг рта остаются пятнышки сока. Потом садится, довольный. ≈ 6 с, один раз.'));
  const bar = elx('div', 'cs-bar');
  bar.style.margin = '0';
  const playB = elx('button', undefined, '▶ Играть');
  const pauseB = elx('button', undefined, '⏸ Пауза');
  const zeroB = elx('button', undefined, '↺ Сначала');
  for (const b of [playB, pauseB, zeroB]) {
    b.type = 'button';
    b.disabled = o.reduced;
  }
  bar.append(playB, pauseB, zeroB);
  side.append(bar);
  const slider = elx('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(SCENE_S);
  slider.step = '0.01';
  slider.disabled = o.reduced;
  slider.setAttribute('aria-label', 'Кадр сцены, секунды');
  const label = elx('div', undefined, '');
  side.append(slider, label);
  const show = () => {
    label.textContent = `t = ${scene.time.toFixed(2)} с из ${SCENE_S.toFixed(1)}`;
    slider.value = String(scene.time);
  };
  playB.addEventListener('click', () => {
    scene.play();
    label.textContent = 'играет…';
  });
  pauseB.addEventListener('click', () => {
    scene.pause();
    show();
  });
  zeroB.addEventListener('click', () => {
    scene.seek(0);
    show();
  });
  slider.addEventListener('input', () => {
    scene.seek(Number(slider.value));
    show();
  });
  if (o.t !== null && Number.isFinite(o.t)) scene.seek(o.t);
  else if (!o.reduced) scene.seek(0);
  show();
  return scene;
}

/** The contact sheet: the key moments, each its own scene frozen at its time (deterministic). */
export function strawberrySheet(parent: HTMLElement, o: { vars: Readonly<Record<string, string>>; size: number; reduced: boolean; title?: string }): void {
  const panel = elx('section', 'cs-panel sb-sheet');
  for (const [k, v] of Object.entries(o.vars)) panel.style.setProperty(k, v);
  panel.append(elx('h2', undefined, o.title ?? `Клубничка — сцена по кадрам · ${o.size} px`));
  parent.append(panel);
  const grid = elx('div', 'cs-sheet');
  grid.style.gridTemplateColumns = `repeat(auto-fill, ${Math.round(o.size * 1.06) + 6}px)`;
  panel.append(grid);
  for (const [t, what] of o.reduced ? [[SCENE_S, 'меньше движения: конечная поза'] as const] : SCENE_KEYS) {
    const fig = elx('figure');
    fig.dataset['t'] = String(t);
    grid.append(fig);
    const s = new StrawberryScene(fig, { size: o.size, reduced: o.reduced });
    s.seek(t);
    const cap = elx('figcaption');
    cap.append(elx('b', undefined, `t = ${t.toFixed(2)} с`), document.createTextNode(what));
    fig.append(cap);
  }
}
