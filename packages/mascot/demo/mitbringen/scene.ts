/**
 * One phone of the Mitbringen gallery: the mock + its UI reaction + one mascot moment, all on ONE timeline.
 * Timeline seconds T = PRE + moment seconds (moment 0 = the server confirmed "Ich bring's mit"; the PRE second before
 * it is the tap and the spinner). Every track runs on one Playhead (src/timeline.ts), so seek(t) gives the same frame
 * every time.
 *
 *   basket  «Корзинка»        authorBasket()                    the short carry (≈ 2.6 s)
 *   last    last free item    authorBasket({ finale: 'binky' })  the same carry; the basket melts in (the word shows)
 *                                                                while he turns to you, then one binky (≈ 2.9 s) —
 *                                                                "Alles ist verteilt. Danke!" shows with the binky
 *
 * Reduced motion ("Weniger"): no bunny — the item fades into "Du bringst" (0.35 s); for the last item "Alles ist
 * verteilt. Danke!" fades in with it.
 */

import { Playhead, type StyleOut, type Track } from '../../src/timeline';
import type { BunnyCoat } from '../../src/types';
import { authorBasket, type BasketShow } from './basket';
import { PRE, buildMock, measure, uiTracks, type MockGeometry, type MockRefs, type Theme, type Variant } from './mock';

export interface SceneOptions {
  variant: Variant;
  theme: Theme;
  reduced: boolean;
  coat?: BunnyCoat;
}

/** Moment seconds of the beats (for the gallery's notes and the tests). */
export interface SceneBeats {
  /** the bunny starts */
  start: number;
  /** the basket stands on the line / the top of the binky */
  key: number;
  /** the moment is over (the bunny is gone, the highlight faded) */
  end: number;
}

export class MitbringenScene {
  readonly refs: MockRefs;
  readonly geo: MockGeometry;
  readonly options: SceneOptions;
  readonly basket: BasketShow | null = null;
  readonly beats: SceneBeats;
  private readonly playhead = new Playhead();
  private readonly tracks: Track[];
  private readonly endT: number;
  private readonly endClock: Animation | null;
  private destroyed = false;

  constructor(parent: HTMLElement, options: SceneOptions) {
    this.options = options;
    const { variant, reduced } = options;
    const last = variant === 'last';
    this.refs = buildMock(variant, options.theme);
    parent.append(this.refs.phone);
    this.geo = measure(this.refs);
    const g = this.geo;
    const tracks: Track[] = [];
    let end = PRE;
    let beats: SceneBeats;

    if (reduced) {
      tracks.push(...uiTracks(this.refs, { word: PRE + 0.05, glow: null, done: last ? PRE + 0.05 : null }));
      beats = { start: 0.05, key: 0.05, end: 0.4 };
    } else {
      const holder = document.createElement('div');
      holder.className = 'mbx-layer';
      this.refs.layer.append(holder);
      const root = holder.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{position:absolute;inset:0;overflow:hidden;pointer-events:none;contain:layout paint}.frame{position:absolute;left:0;top:0}.lift,.calm,.actor{position:absolute;inset:0}</style>';
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;inset:0';
      root.append(box);
      const you = g.you;
      const show = authorBasket(box, {
        W: g.W,
        rowY: g.claim.top + g.claim.height - 10,
        ledge: g.card.top,
        // the text with the new word (already in its place, still invisible); the basket stands just after it
        line: { end: you.left + you.width, bottom: you.top + you.height + 1 },
        at: PRE + 0.1,
        ...(options.coat ? { coat: options.coat } : {}),
        ...(last ? { finale: 'binky' as const } : {}),
      });
      // the line's highlight reaches under the basket: it melts into it
      this.refs.hl.style.width = `${show.drop.x + show.basket.w / 2 + 6 - (you.left - 8)}px`;
      (this as { basket: BasketShow | null }).basket = show;
      tracks.push(...show.tracks);
      // the line lights up when the basket lands on it; the word appears as the basket melts into it;
      // "Alles ist verteilt. Danke!" as his feet leave the edge in the binky
      tracks.push(...uiTracks(this.refs, { word: show.meltedAt - 0.3, glow: [show.landedAt, show.meltedAt], done: show.binky?.up ?? null }));
      beats = { start: 0.1, key: (show.binky?.top ?? show.landedAt) - PRE, end: 0 };
      end = Math.max(end, show.goneAt);
    }

    for (const tr of tracks) end = Math.max(end, tr.end);
    this.tracks = tracks;
    this.endT = Math.round((end + 0.05) * 1000) / 1000;
    beats.end = this.endT - PRE;
    this.beats = beats;
    this.compile();
    const clockEl = this.refs.phone as HTMLElement & { animate?: HTMLElement['animate'] };
    this.endClock = typeof clockEl.animate === 'function' ? this.playhead.adopt(clockEl.animate([], { duration: this.endT * 1000 }), this.endT * 1000) : null;
    this.seek(-PRE);
  }

  /** Moment seconds from the server's "yes" to the end (the tap before it: PRE). */
  get duration(): number {
    return this.endT - PRE;
  }

  get animations(): readonly Animation[] {
    return this.playhead.animations;
  }

  /** Freezes the phone at moment second `t` (−PRE … duration): deterministic. */
  seek(t: number): void {
    if (this.destroyed) return;
    const T = Math.max(0, Math.min(this.endT, t + PRE));
    this.playhead.seek(T * 1000);
  }

  /** Plays from the tap; resolves when the moment is over. */
  play(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.playhead.playFrom(0);
    return this.endClock ? this.endClock.finished.then(() => undefined, () => undefined) : Promise.resolve();
  }

  /** Styles of our own tracks at moment second `t` (tests). */
  sample(t: number): Record<string, StyleOut> {
    const out: Record<string, StyleOut> = {};
    for (const tr of this.tracks) out[tr.name] = tr.styleAt(t + PRE);
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playhead.cancel();
    this.refs.phone.remove();
  }

  private compile(): void {
    for (const tr of this.tracks) {
      const base = tr.baseStyle();
      for (const el of tr.els) {
        const st = (el as HTMLElement).style;
        if (base.transform !== undefined) st.transform = base.transform;
        if (base.opacity !== undefined) st.opacity = base.opacity;
      }
      for (const c of tr.compile()) this.playhead.add(c, tr.name);
    }
  }
}

export { PRE };
