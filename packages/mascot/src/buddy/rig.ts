/**
 * Lists buddy — the shared rig: what the buddy adds to the existing puppets (hamster and bunny) at runtime, so
 * the approved puppet markup in hamster.ts / bunny.ts and every other scene stay untouched: an extra <style>
 * and a few extra SVG groups in the puppet's own shadow root (heart eyes, dizzy spirals, worried brows, a sweat
 * drop, a deeper blush, a tiny gift for the hamster's cheeks) plus the poses (dangling, flying, sitting,
 * sulking). Moved from the gallery prototype into the package when Felix approved it (25.10).
 *
 * Also the puppet's geometry in host px (feet, scruff, body centre, hit box) for a given width.
 */

import type { Bunny } from '../bunny';
import type { Hamster } from '../hamster';
import type { BuddyKind } from './brain';

export type Puppet = Bunny | Hamster;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Per-mascot numbers in the puppet's own units (mascot units: x = 0 centre line, y = 0 feet). */
interface KindSpec {
  viewH: number;
  /** y of the feet in the viewBox and the puppet's scale (from the `.hm` transform). */
  footY: number;
  scale: number;
  eyeX: number;
  eyeY: number;
  blushX: number;
  blushY: number;
  sweat: { x: number; y: number };
}

const SPEC: Record<BuddyKind, KindSpec> = {
  hamster: { viewH: 250, footY: 236, scale: 1.25, eyeX: 32, eyeY: -96, blushX: 47, blushY: -81, sweat: { x: 66, y: -146 } },
  bunny: { viewH: 260, footY: 246, scale: 1.2, eyeX: 29, eyeY: -93, blushX: 43, blushY: -77, sweat: { x: 66, y: -138 } },
};

export interface Point {
  x: number;
  y: number;
}

/** Where things are on the puppet, in px of its host box (top-left = 0,0). */
export interface Geometry {
  w: number;
  h: number;
  /** centre between the feet, on the floor */
  foot: Point;
  /** the scruff (top of the head) — he hangs from here when picked up */
  scruff: Point;
  /** middle of the body — he spins around it in the air and rolls on it */
  center: Point;
  /** radius of the body as a ball (rolling, collisions) */
  radius: number;
  /** his body's box: only this catches the finger, everything around him stays tappable */
  hit: { x: number; y: number; w: number; h: number };
}

export function geometry(kind: BuddyKind, width: number): Geometry {
  const s = SPEC[kind];
  const k = width / 400;
  const at = (ux: number, uy: number): Point => ({ x: (200 + ux * s.scale) * k, y: (s.footY + uy * s.scale) * k });
  const foot = at(0, 0);
  const top = at(-88, kind === 'bunny' ? -176 : -170);
  const right = at(88, 0);
  return {
    w: width,
    h: (width * s.viewH) / 400,
    foot,
    scruff: at(0, -150),
    center: at(0, -80),
    radius: 84 * s.scale * k,
    hit: { x: top.x, y: top.y, w: right.x - top.x, h: foot.y + 2 * k * 10 - top.y },
  };
}

const heart = (x: number, y: number) =>
  `<path d="M${x} ${y + 6.5} C${x - 9.5} ${y + 0.5} ${x - 7.5} ${y - 9} ${x} ${y - 3.6} C${x + 7.5} ${y - 9} ${x + 9.5} ${y + 0.5} ${x} ${y + 6.5} Z" fill="#F2546B"/><circle cx="${x - 3.4}" cy="${y - 3.4}" r="1.5" fill="#fff" opacity=".9"/>`;
const spiral = (x: number, y: number) =>
  `<g><path d="M${x} ${y} m-5.5 0 a5.5 5.5 0 1 1 11 0 a4.4 4.4 0 1 1 -8.8 0 a3.2 3.2 0 1 1 6.4 0 a2 2 0 1 1 -4 0" fill="none" stroke="var(--mascot-eye)" stroke-width="2" stroke-linecap="round"/></g>`;

const CSS = `
/* ---- lists buddy (gallery prototype, demo/lists-buddy) ---- */
.bd-hearts, .bd-dizzy, .bd-worry, .bd-sweat, .bd-blush, .bd-gift { opacity: 0; }
.bd-m-heart .eyes, .bd-m-heart .eyes-star, .bd-m-heart .eyes-happy, .bd-m-heart .eyes-sleep,
.bd-m-dizzy .eyes, .bd-m-dizzy .eyes-star, .bd-m-dizzy .eyes-happy, .bd-m-dizzy .eyes-sleep { opacity: 0; }
.bd-m-heart .bd-hearts { opacity: 1; }
.bd-hearts > g { transform-box: fill-box; transform-origin: center; }
.bd-m-heart .bd-hearts > g { animation: bd-beat .42s ease-in-out infinite alternate; }
@keyframes bd-beat { from { transform: scale(.9); } to { transform: scale(1.14); } }
.bd-m-dizzy .bd-dizzy { opacity: 1; }
.bd-dizzy > g { transform-box: fill-box; transform-origin: center; animation: bd-spin .6s linear infinite; }
@keyframes bd-spin { to { transform: rotate(360deg); } }
.bd-m-worry .bd-worry { opacity: 1; }
.bd-m-worry .bd-sweat { opacity: 1; }
.bd-sweat { transform-box: fill-box; transform-origin: 50% 0%; transition: opacity .18s; }
.bd-m-worry .bd-sweat { animation: bd-sweat .9s ease-in infinite; }
@keyframes bd-sweat { 0% { transform: translateY(-2px) scale(.8); } 70% { transform: translateY(5px) scale(1); } 100% { transform: translateY(9px) scale(1); opacity: 0; } }
.bd-blush { transition: opacity .35s ease; }
.bd-blushing .bd-blush { opacity: .6; }
.bd-gift { transform-box: fill-box; transform-origin: 50% 50%; }

/* held by the scruff: feet hang down and kick with the swing, front paws hang, ears flop with it */
.bd-held .tfoot-l { transform: translate(-4px, 18px) rotate(calc(16deg + var(--bd-kick, 0deg))); }
.bd-held .tfoot-r { transform: translate(4px, 18px) rotate(calc(-16deg - var(--bd-kick, 0deg))); }
.bd-held .tp { transform: translateY(10px) rotate(calc(var(--bd-kick, 0deg) * -.6)); }
.bd-held .ear-l { transform: rotate(calc(-10deg + var(--bd-ear, 0deg))); }
.bd-held .ear-r { transform: rotate(calc(10deg + var(--bd-ear, 0deg))); }
.bd-held .breathe { animation-duration: 1.1s; }
.bd-held .shadow, .bd-air .shadow { opacity: 0; }
/* in the air after a throw: tucked into a ball */
.bd-tuck .tfoot-l { transform: translate(8px, -16px) scale(.86); }
.bd-tuck .tfoot-r { transform: translate(-8px, -16px) scale(.86); }
.bd-tuck .tp { transform: translateY(-8px) scale(.94); }
/* offended: arms crossed, brows down and a pout, but no anger mark (he is not furious, he is hurt) */
.bd-crossed .paw-l { transform: translate(11px, -5px) rotate(52deg); }
.bd-crossed .paw-r { transform: translate(-11px, -1px) rotate(-52deg); }
.bd-pout .angry-brows, .bd-pout .pout { opacity: 1; }
.bd-pout .mouth { opacity: 0; }
/* «Твёрдая почва» (footing.ts): the "oh!" near a card's end — eyes a little wider than the puppet's own startle */
.bd-oh .eye { transform: scale(1.4); }
/* sitting: feet stretched out a little */
.bd-sit .tfoot-l { transform: translateX(-7px) scaleX(1.14); }
.bd-sit .tfoot-r { transform: translateX(7px) scaleX(1.14); }
.rm .bd-m-heart .bd-hearts > g, .rm .bd-dizzy > g, .rm .bd-m-worry .bd-sweat { animation: none; }
`;

/** The extra parts and pose classes, bound to one puppet. */
export class BuddyRig {
  readonly hm: SVGGElement;
  readonly face: SVGGElement;
  readonly paws: SVGGElement;
  readonly pawR: SVGGElement;
  readonly gift: SVGGElement;
  readonly spec: KindSpec;
  private readonly host: HTMLElement;

  constructor(readonly puppet: Puppet, readonly kind: BuddyKind) {
    this.spec = SPEC[kind];
    this.host = puppet.host;
    const root = puppet.root;
    const q = <T extends Element>(sel: string): T => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`[lists-buddy] missing ${sel}`);
      return el;
    };
    this.hm = q<SVGGElement>('.hm');
    this.face = q<SVGGElement>('.face');
    this.paws = q<SVGGElement>('.paws');
    this.pawR = q<SVGGElement>('.paw-r');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);

    const { eyeX: ex, eyeY: ey, blushX: bx, blushY: by, sweat } = this.spec;
    const add = (parent: Element, markup: string, cls: string): SVGGElement => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', cls);
      g.innerHTML = markup;
      parent.append(g);
      return g;
    };
    add(this.face, `<g>${heart(-ex, ey)}</g><g>${heart(ex, ey)}</g>`, 'bd-hearts');
    add(this.face, `${spiral(-ex, ey)}${spiral(ex, ey)}`, 'bd-dizzy');
    add(
      this.face,
      `<path d="M${-ex - 9} ${ey - 9} L${-ex + 7} ${ey - 16}"/><path d="M${ex - 7} ${ey - 16} L${ex + 9} ${ey - 9}"/>`,
      'bd-worry',
    ).setAttribute('style', 'fill:none;stroke:var(--mascot-eye);stroke-width:2.4;stroke-linecap:round');
    const tf = q<SVGGElement>('.tf');
    add(tf, `<ellipse cx="${-bx}" cy="${by}" rx="11" ry="6.5" fill="#FF7F86"/><ellipse cx="${bx}" cy="${by}" rx="11" ry="6.5" fill="#FF7F86"/>`, 'bd-blush');
    add(
      tf,
      `<path d="M${sweat.x} ${sweat.y} C${sweat.x - 4.5} ${sweat.y + 7} ${sweat.x - 4.5} ${sweat.y + 11} ${sweat.x} ${sweat.y + 12} C${sweat.x + 4.5} ${sweat.y + 11} ${sweat.x + 4.5} ${sweat.y + 7} ${sweat.x} ${sweat.y} Z" fill="#A9D8FF" stroke="#6FB4EA" stroke-width=".7"/><circle cx="${sweat.x - 1.4}" cy="${sweat.y + 8}" r="1.1" fill="#fff"/>`,
      'bd-sweat',
    );
    this.gift = add(
      this.paws,
      `<rect x="-10" y="-66" width="20" height="15" rx="3.2" fill="#F28C7A"/><rect x="-2.2" y="-66" width="4.4" height="15" fill="#FFE08A"/><rect x="-11" y="-69" width="22" height="5" rx="2" fill="#F6A291"/><path d="M0 -69 C-4 -76 -12 -76 -10 -71.5 C-9 -69 -4 -69 0 -69 Z M0 -69 C4 -76 12 -76 10 -71.5 C9 -69 4 -69 0 -69 Z" fill="#FFD166"/>`,
      'bd-gift',
    );
  }

  /** A pose / mood class on the puppet (`.hm`). */
  set(cls: string, on: boolean): void {
    this.hm.classList.toggle(cls, on);
  }

  has(cls: string): boolean {
    return this.hm.classList.contains(cls);
  }

  /**
   * Eyes: the puppet's own modes (normal, happy, star, sleep) or the buddy's extras (heart, dizzy). Worried
   * brows + sweat are a separate layer (`worry`), they go with any eyes.
   */
  eyes(mode: 'normal' | 'happy' | 'star' | 'sleep' | 'heart' | 'dizzy'): void {
    this.set('bd-m-heart', mode === 'heart');
    this.set('bd-m-dizzy', mode === 'dizzy');
    this.puppet.setEyes(mode === 'heart' || mode === 'dizzy' ? 'normal' : mode);
  }

  worry(on: boolean): void {
    this.set('bd-m-worry', on);
    this.set('startle', on);
  }

  blush(on: boolean): void {
    this.set('bd-blushing', on);
  }

  /** Face direction: -1 = his left side to the viewer's left (walks left), 1 = right, 0 = towards you. */
  turn(dir: -1 | 0 | 1): void {
    this.set('turn-l', dir < 0);
    this.set('turn-r', dir > 0);
  }

  walking(on: boolean): void {
    this.set('walking', on);
  }

  /** Eyes/face shifted towards a point (mascot units, ±3); null = back to the middle. */
  look(dx: number | null, dy = 0): void {
    if (dx === null) {
      this.face.style.transform = '';
      return;
    }
    const cx = Math.max(-3.2, Math.min(3.2, dx));
    const cy = Math.max(-3, Math.min(3.4, dy));
    this.face.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
  }

  angry(on: boolean): void {
    this.set('m-angry', on);
    this.puppet.setPuff(on ? 1.28 : this.kind === 'hamster' ? 1.15 : 1);
  }

  /** The swing while dangling: how far the feet kick and the ears flop (deg). */
  swing(kickDeg: number, earDeg: number): void {
    this.host.style.setProperty('--bd-kick', `${kickDeg.toFixed(1)}deg`);
    this.host.style.setProperty('--bd-ear', `${earDeg.toFixed(1)}deg`);
  }

  /** Clears every buddy pose class (not the puppet's lasting ones). */
  clearPose(): void {
    for (const c of ['bd-oh', 'bd-held', 'bd-air', 'bd-tuck', 'bd-sit', 'bd-crossed', 'bd-pout', 'bd-m-heart', 'bd-m-dizzy', 'bd-m-worry', 'bd-blushing', 'startle', 'm-angry', 'm-open', 'look-up', 'walking', 'chewing', 'perk', 'twitch']) {
      this.hm.classList.remove(c);
    }
    this.swing(0, 0);
    this.look(null);
  }
}
