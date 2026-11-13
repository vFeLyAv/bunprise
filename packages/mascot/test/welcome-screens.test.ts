import { afterEach, describe, expect, it } from 'vitest';
import { confettiKeyframes, flightKeyframes, heartKeyframes, welcomeScreensGallery } from '../demo/welcome-screens';

// The gallery-only prototype of the new welcome screens (25.10): its motion stays transform/opacity, finite,
// deterministic; the calm version never throws a wish across the screen.

afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.replaceChildren(); document.head.replaceChildren(); });

const ALLOWED = ['transform', 'opacity', 'offset', 'easing'];

describe('welcome screens prototype (gallery only)', () => {
  it('animates only transform and opacity, from offset 0 to 1, and ends invisible where things fly away', () => {
    for (const frames of [flightKeyframes(120, -260), confettiKeyframes(3), heartKeyframes(1)]) {
      for (const key of frames) expect(Object.keys(key).every((k) => ALLOWED.includes(k))).toBe(true);
      expect(frames[0]?.offset).toBe(0);
      expect(frames.at(-1)?.offset).toBe(1);
      expect(frames.at(-1)?.opacity).toBe(0);
    }
  });

  it('throws the same confetti for the same seed (frames stay reproducible)', () => {
    expect(confettiKeyframes(7)).toEqual(confettiKeyframes(7));
    expect(confettiKeyframes(7)).not.toEqual(confettiKeyframes(8));
  });

  it('builds the three phones and, in the calm version, a wish just gets its check (no flying copy)', () => {
    const app = document.createElement('main');
    document.body.append(app);
    welcomeScreensGallery(app, new URLSearchParams('screens=welcome&reduced=1'));
    expect(app.querySelectorAll('.ws-phone')).toHaveLength(3);
    const chip = [...app.querySelectorAll<HTMLButtonElement>('.ws-chip')].find((c) => c.textContent?.includes('Bücher'));
    chip?.click();
    expect(chip?.classList.contains('done')).toBe(true);
    expect(app.querySelectorAll('.ws-fx .ws-chip')).toHaveLength(0);
    expect(app.querySelector('.ws-count')?.textContent).toContain('erster Wunsch');
  });
});
