import { MoveStage, type MoveOptions, type MoveShow } from './props';
import { OVERFED_CSS, OverfedRig } from './overfed-rig';
import { OVERFED_SHOWS, type OverfedVariant } from './overfed-shows';
import type { BunnyCoat } from './types';

/**
 * «Переел» — the end of the ideas deck ("Für heute war's das") and the 5th own wish in a row. Third drawing
 * (23.10.2026): Felix rejected both lying versions ("the lying pose looks like a human — ridiculous, not our
 * style, crooked"), so the bunny now SITS, exactly as the app mascot: the same puppet (bunny.ts), the same
 * parts, front view. Three variants for Felix to choose from in the gallery (overfed-shows.ts):
 *
 *  - 'a' «Хватит»: one more carrot drops next to him; he looks at it and slowly shakes his head, sighs.
 *  - 'b' «Последний кусочек»: one more nibble of his carrot, too full; lowers it into his lap, yawns, dozes off.
 *  - 'c' «Ик!»: stuffed and content; hiccups (hop, round eyes, paws to the mouth), giggles, sighs.
 *
 * One SVG in the mascot's own 400 × 260 viewBox (preserveAspectRatio xMidYMax meet) fills the host: it scales
 * with the card and always stands on the host's bottom edge. Only transform and opacity animate (MoveStage /
 * timeline.ts: one Web Animations timeline, seekable); after the show an illustration keeps breathing (and
 * 'b' sleeps: a slow nod and a floating "z"); a decoration fades out. Reduced motion: an illustration is the
 * calm end pose (no animate() call), fading in; a decoration is nothing.
 */

export type { OverfedVariant } from './overfed-shows';
export { OVERFED_VIEWBOX } from './overfed-rig';

export interface OverfedOptions extends MoveOptions {
  coat?: BunnyCoat;
  /**
   * true = a content illustration (the end of the deck): it stays and breathes; under reduced motion the
   * still end pose fades in. false = a decoration: it fades out after the show; under reduced motion nothing.
   */
  illustration?: boolean;
  /** Which of the three drawings (23.10, Felix chooses in the gallery); default OVERFED_DEFAULT. */
  variant?: OverfedVariant;
}

export const OVERFED_VARIANTS: readonly OverfedVariant[] = ['a', 'b', 'c'];
/** The recommended variant (used when `variant` is not given). */
export const OVERFED_DEFAULT: OverfedVariant = 'b';
/** Russian titles for the gallery. */
export const OVERFED_TITLES: Readonly<Record<OverfedVariant, string>> = {
  a: 'Хватит: ещё морковка — «нет-нет», вздох',
  b: 'Последний кусочек: морковку на колени — и уснул',
  c: 'Ик!: икает от сытости, хихикает, вздыхает',
};

/** A decoration fades out over the end of the show (s). */
const FADE_FROM = 0.3;
const FADE_TO = 0.15;

let seq = 0;

/** The stuffed bunny (the same sitting puppet as the app mascot), in one of three variants. */
export class OverfedStage extends MoveStage {
  constructor(
    host: HTMLElement,
    private readonly options: OverfedOptions = {},
  ) {
    super(host, options, ':host{display:block;position:relative;overflow:hidden;pointer-events:none;min-height:120px}', OVERFED_CSS);
    this.setup();
  }

  /** The variant this stage shows. */
  get variant(): OverfedVariant {
    const v = this.options.variant;
    return v && OVERFED_VARIANTS.includes(v) ? v : OVERFED_DEFAULT;
  }

  protected author(reduced: boolean): MoveShow {
    const illustration = this.options.illustration ?? false;
    if (reduced && !illustration) return { tracks: [], duration: 0, empty: true };
    const show = OVERFED_SHOWS[this.variant];
    const rig = new OverfedRig(this.stage, `bp-overfed-${++seq}`, this.options.coat ?? 'fawn', show.props);
    const end = show.author(rig);
    // the still (reduced motion) is the calm end pose: the tracks' values at `end`, written inline, no animate()
    if (reduced) return { tracks: rig.tracks, duration: 0.45, staticAt: end, isStatic: true };
    if (!illustration) {
      // a decoration leaves after the show (no loop)
      rig.part('fig').path(end - FADE_FROM, [[end + FADE_TO, { o: 0 }, 'ease-in']]);
      return { tracks: rig.tracks, duration: end + FADE_TO };
    }
    show.rest(rig, end);
    return { tracks: rig.tracks, duration: end };
  }
}
