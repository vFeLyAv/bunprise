/**
 * «Помпон в открытом списке» (approved 31.10) — the closed gift box of the empty list (Felix 31.10: box and lid clearly
 * one box — the lid is the box's width plus a 4 px overhang on each side, the ribbon runs on from the box over the lid,
 * the bow sits on the lid). Moved here from the gallery prototype (demo/listplay/stage.ts built it).
 *
 * Layers in the host's content: back wall + floor shadow (under him) < Pompon (z 4) < front < lid (outer: shakes with
 * the box; inner: flies). Coordinates: one 180 × 110 px box per layer, its top left at `origin`; the floor is at y 102.
 * Decorative: aria-hidden, no pointer events (only Pompon's body or the host's own target catch a finger).
 */

import type { GiftBox } from './moves';

let serial = 0;

export interface MountedGiftBox extends GiftBox {
  /** the layers (back, front, lid) */
  readonly layers: readonly HTMLElement[];
  destroy(): void;
}

export const GIFT_BOX = { w: 180, h: 110, floor: 102 } as const;

export function mountGiftBox(parent: HTMLElement, origin: { x: number; y: number }): MountedGiftBox {
  const bx = Math.round(origin.x);
  const by = Math.round(origin.y);
  const id = `lpbx${++serial}`;
  const layer = (z: number, svg: string, transformOrigin: string): HTMLElement => {
    const d = document.createElement('div');
    d.className = 'lpp-boxlayer';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:${GIFT_BOX.w}px;height:${GIFT_BOX.h}px;z-index:${z};transform-origin:${transformOrigin};pointer-events:none;`;
    d.innerHTML = svg ? `<svg viewBox="0 0 180 110" aria-hidden="true" focusable="false" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${svg}</svg>` : '';
    return d;
  };
  const SHADE = `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></linearGradient>`;
  // the back wall: only seen through the crack when the lid lifts
  const back = layer(3, '<ellipse cx="82" cy="103.5" rx="54" ry="3.6" fill="var(--mascot-shadow)"/><rect x="43" y="44" width="78" height="16" rx="2" fill="#C47A47"/>', '82px 102px');
  const front = layer(5, `<defs>${SHADE}</defs><rect x="40" y="52" width="84" height="50" rx="5" fill="#F7B27A"/><rect x="40" y="52" width="84" height="50" rx="5" fill="url(#${id})"/>
      <rect x="40" y="53" width="84" height="3.5" fill="rgba(130,64,20,.13)"/><rect x="78" y="52" width="8" height="50" fill="#FFF7EC"/>`, '82px 102px');
  const lidOuter = layer(6, '', '82px 102px');
  const lidInner = layer(0, `<rect x="36" y="34" width="92" height="20" rx="5" fill="#F7B27A"/><rect x="36" y="34" width="92" height="20" rx="5" fill="url(#${id})"/>
      <rect x="37" y="50.5" width="90" height="3.5" rx="1.75" fill="rgba(130,64,20,.12)"/><path d="M39 35.6h86" stroke="rgba(255,255,255,.6)" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="78" y="34" width="8" height="20" fill="#FFF7EC"/>
      <path d="M82 34c-4-9.5-16-10.5-14.5-3.6S78 34 82 34zM82 34c4-9.5 16-10.5 14.5-3.6S86 34 82 34z" fill="#FFF7EC" stroke="rgba(150,90,40,.38)" stroke-width=".9"/>
      <circle cx="82" cy="34" r="2.8" fill="#FFF7EC" stroke="rgba(150,90,40,.38)" stroke-width=".9"/>`, '82px 44px');
  lidInner.style.left = '0';
  lidInner.style.top = '0';
  lidOuter.append(lidInner);
  parent.append(back, front, lidOuter);
  const layers = [back, front, lidOuter];
  // inside: all of him under the lid · peeking: his eyes in the crack (eye line ≈ 27 px over his feet) · landed: right
  // of the box, a gap from its wall · the lid: to the left of the box on the floor, tilted a little (its low corner on the floor)
  return {
    back,
    front,
    lidOuter,
    lidInner,
    layers,
    inBox: { x: bx + 82, y: by + 99 },
    peekAt: { x: bx + 82, y: by + 75 },
    land: { x: bx + 166, y: by + 102 },
    lidLand: { x: -100, y: 44, r: -5 },
    destroy() {
      for (const l of layers) {
        for (const a of l.getAnimations?.({ subtree: true }) ?? []) a.cancel();
        l.remove();
      }
    },
  };
}
