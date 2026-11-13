import { cn } from './cn';
// the scene's tokens and classes ship with the chunks that render it (start, onboarding), not globally
import '../styles/scene.css';

export interface SceneProps {
  className?: string;
}

/**
 * The scene screens' backdrop (ADR 2026-10-20-design-direction-glass): a warm, softly colourful light
 * (--scene-backdrop) behind the page — the backdrop that makes the glass card on top of it visible.
 * One static fixed layer behind the content (painted once, composited while scrolling); decorative.
 * Render it once, as the first child of the screen's <Page className="scene-page" flush>. The same file
 * brings the classes of the composition: `.scene-card` (the docked glass card the welcome bunnies peek
 * over), `.scene-bleed` (full width to the screen edges), and the glass continuation of the legal footer
 * after `main.scene-page`.
 */
export function Scene({ className }: SceneProps) {
  return <div aria-hidden="true" data-scene="" className={cn('scene', className)} />;
}
