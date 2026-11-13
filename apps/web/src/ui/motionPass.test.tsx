/** @vitest-environment jsdom */
import './test-shims-dom';
import { LazyMotion, domMax } from 'motion/react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Segmented } from './index';
import { Sheet } from './Sheet';

// Screens + motion pass (phase 2): kit behaviour that the screens rely on — the RSVP question that never
// looks disabled (blocker 12), the accent-glass action of the start screen, and sheets that glide to a new
// height instead of jumping (the reservation moment).

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--dur-smooth');
  document.documentElement.style.removeProperty('--ease-smooth');
});

const OPTIONS = [
  { value: 'going', label: 'Zusage' },
  { value: 'maybe', label: 'Vielleicht' },
  { value: 'declined', label: 'Absage' },
] as const;

describe('Segmented without an answer (blocker 12)', () => {
  it('asks: a stronger track and every label in full ink — never the look of a disabled control', () => {
    const { rerender } = render(<Segmented label="Deine Antwort" value={'none' as string} options={OPTIONS} onChange={() => undefined} />);
    const group = screen.getByRole('radiogroup', { name: 'Deine Antwort' });
    expect(group.dataset['selection']).toBe('none');
    expect(group.className).toContain('bg-fill-2');
    for (const radio of screen.getAllByRole('radio')) expect(radio.className.split(' ')).toContain('text-text');

    rerender(<Segmented label="Deine Antwort" value="maybe" options={OPTIONS} onChange={() => undefined} />);
    expect(group.hasAttribute('data-selection')).toBe(false);
    expect(group.className.split(' ')).toContain('bg-fill');
    expect(screen.getByRole('radio', { name: 'Zusage' }).className).toContain('text-text-2');
    expect(screen.getByRole('radio', { name: 'Vielleicht' }).className).not.toContain('text-text-2');
  });
});

describe('Button glass-accent', () => {
  it('is the accent glass of the "+" FAB as a text button (solid under reduced transparency via the class)', () => {
    render(<Button variant="glass-accent">Mit E-Mail fortfahren</Button>);
    const button = screen.getByRole('button', { name: 'Mit E-Mail fortfahren' });
    expect(button.className).toContain('glass-float');
    expect(button.className).toContain('glass-accent');
    expect(button.className).toContain('rounded-button');
  });
});

describe('Sheet glides to a new content height', () => {
  it('offsets the panel by the difference and lets the smooth spring take it back (transform only)', async () => {
    let observe: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observe = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const glides: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
    const animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      glides.push({ keyframes, options });
      return { cancel() {}, finish() {} } as unknown as Animation;
    });
    // on HTMLElement only: motion checks Element.prototype for WAAPI and keeps its own (JS) slide-in
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate });
    document.documentElement.style.setProperty('--dur-smooth', '350ms');
    document.documentElement.style.setProperty('--ease-smooth', 'linear(0, 1)');
    let height = 200;
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? height : 0;
    });

    render(
      <LazyMotion features={domMax} strict>
        <Sheet open onClose={() => undefined} title="Kinogutschein" closeLabel="Schließen">
          <p>Inhalt</p>
        </Sheet>
      </LazyMotion>,
    );
    const panel = screen.getByRole('dialog');
    // jsdom does not inherit custom properties into computed styles: give the panel the spring tokens
    panel.style.setProperty('--dur-smooth', '350ms');
    panel.style.setProperty('--ease-smooth', 'linear(0, 1)');
    // the slide-in (the smooth spring, ≈ 0.35 s) ends at rest (y = 0); only then does a height change glide
    await new Promise((resolve) => setTimeout(resolve, 900));
    await waitFor(() => expect(['none', '', 'translateY(0px)', 'translateY(0%)']).toContain(panel.style.transform));
    expect(observe).toBeDefined();

    height = 316; // the reward moment adds the hamster: the panel grows by 116 px
    observe?.([], {} as ResizeObserver);
    expect(glides).toHaveLength(1);
    expect(glides[0]?.keyframes).toEqual([{ transform: 'translateY(116px)' }, { transform: 'translateY(0px)' }]);
    expect(glides[0]?.options).toMatchObject({ duration: 350, easing: 'linear(0, 1)' });

    height = 316; // no change → no glide
    observe?.([], {} as ResizeObserver);
    expect(glides).toHaveLength(1);
  });
});
