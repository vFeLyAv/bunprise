import type { TileTone } from './tile';
import { cn } from './cn';
// the tint's classes ship with the screens that render it (occasion screens), not globally
import '../styles/tint.css';

export interface AmbientTintProps {
  /** The occasion's colour: tileTone(occasion.id) — the same stable hash as its feed card and tiles. */
  tone: TileTone;
  className?: string;
}

/**
 * The per-occasion tint of the ambient scene (wave 1, like Apple Invites' per-event backdrop): a large soft
 * glow in the occasion's colour (--tint-1…4) at the top of the screen, on its own fixed layer right above
 * the page backdrop (body::before) and below the content. Static, decorative, no blur filter; it fades in
 * (--dur-m) when the screen opens. Render it once as the first child of the screen's <Page>.
 */
export function AmbientTint({ tone, className }: AmbientTintProps) {
  return <div aria-hidden="true" data-tint={tone} className={cn('ambient-tint', className)} />;
}
