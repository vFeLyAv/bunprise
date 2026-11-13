/** @vitest-environment jsdom */
import './test-shims-dom';
import { LazyMotion, domMax } from 'motion/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Avatar, Button, IconButton, Page, TopBar } from './index';
import { Sheet } from './Sheet';
import { ToastProvider, useToast } from './Toast';

// The visible-glass contract of the kit (ADR 2026-10-20-design-direction-glass, blockers 2–4, 6, 19, 20):
// which component wears which material class and which token-driven shape. The look itself is CSS
// (app.css + tokens.css); screenshots: docs/design/pass/system/.

/** IntersectionObserver whose callback the test fires by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  readonly targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  fire(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentinel(name: 'edge' | 'title'): Element {
  const el = document.querySelector(`[data-sentinel="${name}"]`);
  if (!el) throw new Error(`no ${name} sentinel`);
  return el;
}

describe('TopBar scroll edge (blocker 4)', () => {
  it('has no material at the top of a page and gets it (data-scrolled) as soon as content is under it', () => {
    render(
      <Page topBar={<TopBar large title="Bald" />}>
        <p>Inhalt</p>
      </Page>,
    );
    const header = document.querySelector('header');
    expect(header?.classList.contains('glass-bar')).toBe(true);
    expect(header?.hasAttribute('data-scrolled')).toBe(false);
    const io = FakeIntersectionObserver.instances.at(-1);
    expect(io?.targets).toHaveLength(2);
    const small = header?.querySelector('.t-headline');

    // the first scrolled pixel: the edge sentinel leaves → material on; the small title still waits
    act(() => io?.fire(sentinel('edge'), false));
    expect(header?.hasAttribute('data-scrolled')).toBe(true);
    expect(small?.hasAttribute('data-hidden')).toBe(true);
    expect(small?.getAttribute('aria-hidden')).toBe('true');

    // 32 px: the large title is under the bar → the small title fades in (and rises: .bar-title)
    act(() => io?.fire(sentinel('title'), false));
    expect(small?.hasAttribute('data-hidden')).toBe(false);
    expect(small?.hasAttribute('aria-hidden')).toBe(false);

    // back at the top: no material again
    act(() => {
      io?.fire(sentinel('title'), true);
      io?.fire(sentinel('edge'), true);
    });
    expect(header?.hasAttribute('data-scrolled')).toBe(false);
  });
});

describe('Sheet material and shape (blockers 2, 3, 19)', () => {
  it('floats (inset, --r-sheet on every corner) as glass over the --scrim', async () => {
    render(
      <LazyMotion features={domMax} strict>
        <Sheet open onClose={() => undefined} title="Kinogutschein" closeLabel="Schließen">
          <p>Inhalt</p>
        </Sheet>
      </LazyMotion>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('data-detent')).toBe('content');
    for (const cls of ['glass-sheet', 'rounded-sheet', 'inset-x-(--sheet-inset)', 'bottom-(--sheet-inset)']) {
      expect(dialog.classList.contains(cls), cls).toBe(true);
    }
    expect(dialog.className).not.toMatch(/(^|\s)glass(\s|$)/);
    expect(document.querySelector('.bg-scrim')).not.toBeNull();
  });

  it("the 'full' detent stays edge to edge", async () => {
    render(
      <LazyMotion features={domMax} strict>
        <Sheet open detent="full" onClose={() => undefined} title="Bearbeiten" closeLabel="Schließen">
          <p>Inhalt</p>
        </Sheet>
      </LazyMotion>,
    );
    const dialog = await screen.findByRole('dialog');
    for (const cls of ['glass-sheet', 'inset-x-0', 'bottom-0', 'rounded-t-sheet', 'h-[90dvh]']) {
      expect(dialog.classList.contains(cls), cls).toBe(true);
    }
  });
});

describe('floating controls, toast, buttons, tiles', () => {
  it('the FAB is accent glass, a glass IconButton/Button is neutral glass; text buttons follow --r-button', () => {
    render(
      <>
        <IconButton size={56} variant="accent" label="Anlass anlegen">
          +
        </IconButton>
        <IconButton variant="glass" label="Schließen">
          ×
        </IconButton>
        <Button variant="glass">Anmelden</Button>
        <Button>Speichern</Button>
      </>,
    );
    const fab = screen.getByRole('button', { name: 'Anlass anlegen' });
    expect(fab.classList.contains('glass-float')).toBe(true);
    expect(fab.classList.contains('glass-accent')).toBe(true);
    const close = screen.getByRole('button', { name: 'Schließen' });
    expect(close.classList.contains('glass-float')).toBe(true);
    expect(close.classList.contains('glass-accent')).toBe(false);
    expect(screen.getByRole('button', { name: 'Anmelden' }).classList.contains('glass-float')).toBe(true);
    const save = screen.getByRole('button', { name: 'Speichern' });
    expect(save.classList.contains('rounded-button')).toBe(true);
    expect(save.classList.contains('rounded-full')).toBe(false);
  });

  it('a toast is a glass capsule', async () => {
    function Demo() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.success('Gespeichert')}>
          go
        </button>
      );
    }
    render(
      <LazyMotion features={domMax} strict>
        <ToastProvider>
          <Demo />
        </ToastProvider>
      </LazyMotion>,
    );
    fireEvent.click(screen.getByText('go'));
    const status = await screen.findByRole('status');
    expect(status.classList.contains('glass-toast')).toBe(true);
    expect(status.classList.contains('rounded-toast')).toBe(true);
  });

  it('an avatar keeps the tint of its seed (the person), whatever the name shows', () => {
    const { container } = render(
      <>
        <Avatar name="Anna Beispiel" seed="profile-1" />
        <Avatar name="Anna" seed="profile-1" />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll('.tile'));
    expect(a?.getAttribute('data-tile')).toMatch(/^[1-4]$/);
    expect(b?.getAttribute('data-tile')).toBe(a?.getAttribute('data-tile'));
  });
});
