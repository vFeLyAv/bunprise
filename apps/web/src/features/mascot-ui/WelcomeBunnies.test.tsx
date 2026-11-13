/** @vitest-environment jsdom */
import '../../ui/test-shims-dom';
import { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WelcomeOptions } from '@bunprise/mascot';
import welcomeSource from './WelcomeBunnies.tsx?raw';

// The stage itself (geometry, timeline, reduced motion) is tested in packages/mascot. Here: what the
// wrapper asks of it — when it is built, with which edge, once per visit, the one-animating-mascot rule.
const stages = vi.hoisted(() => [] as Array<{ options: WelcomeOptions; calls: string[] } & Record<string, unknown>>);

vi.mock('@bunprise/mascot', () => {
  class WelcomeStage {
    readonly options: WelcomeOptions;
    readonly calls: string[] = [];
    readonly duration = 8.05;
    playing = false;
    ended = false;
    isDestroyed = false;
    constructor(_host: HTMLElement, options: WelcomeOptions) {
      this.options = options;
      stages.push(this as never);
    }
    playWhenIdle() {
      this.calls.push('playWhenIdle');
      // The real method schedules requestIdleCallback and is not playing yet.
    }
    play() {
      this.calls.push('play');
      this.playing = true;
    }
    seek(t: number) {
      this.calls.push(`seek:${t.toFixed(2)}`);
      this.playing = false;
    }
    setReducedMotion(mode: string) {
      this.calls.push(`reduced:${mode}`);
    }
    pause() {
      this.calls.push('pause');
      this.playing = false;
    }
    resumeCalm() {
      this.calls.push('resumeCalm');
    }
    destroy() {
      this.calls.push('destroy');
      this.isDestroyed = true;
    }
  }
  return { WelcomeStage };
});

import WelcomeBunnies, { welcomeSeenKey } from './WelcomeBunnies';
import { activeMascot, registerMascot, resetStage } from './stage';
import { momentBudget } from './budget';

beforeEach(() => {
  stages.length = 0;
  momentBudget.reset();
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.removeAttribute('data-bunnies');
});

afterEach(() => {
  resetStage();
  document.body.innerHTML = '';
});

function Stage({ name, card = true }: { name?: string; card?: boolean }) {
  const ref = createRef<HTMLDivElement>();
  return (
    <>
      <WelcomeBunnies choreography="welcome" bunnies={['fawn', 'choc']} cardRef={card ? ref : undefined} edgeInset={16} oncePerVisit={name} minSize={150} />
      <div ref={ref} style={{ borderTopLeftRadius: '40px' }} />
    </>
  );
}

describe('WelcomeBunnies', () => {
  it('uses the current motion setting when bunnies are enabled again after settings changed', async () => {
    render(<Stage />);
    await waitFor(() => expect(stages).toHaveLength(1));
    await act(async () => { document.documentElement.dataset['bunnies'] = 'off'; });
    await waitFor(() => expect(stages[0]?.isDestroyed).toBe(true));
    await act(async () => { document.documentElement.dataset['motion'] = 'reduce'; });
    await act(async () => { document.documentElement.dataset['bunnies'] = 'on'; });
    await waitFor(() => expect(stages).toHaveLength(2));
    expect(stages[1]?.options.reducedMotion).toBe('force');
  });
  it('can show only the calm end pose on the second auth step, even before the first step played', async () => {
    render(<WelcomeBunnies choreography="peek-once" still oncePerVisit="auth-entry" />);
    await waitFor(() => expect(stages).toHaveLength(1));
    expect(stages[0]?.calls).toEqual(['seek:9.05']);
    expect(activeMascot()).toBeNull();
  });
  it('reserves a decorative host, builds the stage after the first paint with the card edge, plays when idle', async () => {
    const { container } = render(<Stage name="start" />);
    const host = container.querySelector<HTMLElement>('[data-welcome]');
    expect(host?.getAttribute('aria-hidden')).toBe('true');
    expect(host?.dataset['welcome']).toBe('welcome');
    expect(host?.className).toContain('opacity-0');
    expect(stages).toHaveLength(0); // not on mount: after the first paint, from the lazy package

    await waitFor(() => expect(stages).toHaveLength(1));
    const stage = stages[0];
    expect(stage?.options).toMatchObject({
      choreography: 'welcome',
      bunnies: ['fawn', 'choc'],
      reducedMotion: 'auto',
      edgeInset: { bottom: 16 },
      edgeRadius: { bottom: 40 },
      minSize: 150,
    });
    expect(stage?.calls).toEqual(['playWhenIdle']);
    await waitFor(() => expect(host?.className).toContain('opacity-100'));
    // it holds the stage while it plays (one animating mascot) and the visit is noted
    expect(activeMascot()).not.toBeNull();
    expect(sessionStorage.getItem(welcomeSeenKey('start'))).toBe('1');
  });

  it('a later visit in the same tab starts at the calm end pose (seek just before the end, then breathe)', async () => {
    sessionStorage.setItem(welcomeSeenKey('start'), '1');
    render(<Stage name="start" />);
    await waitFor(() => expect(stages).toHaveLength(1));
    expect(stages[0]?.calls).toEqual(['seek:9.05']);
  });

  it('holds its priority while waiting for browser idle, and cancels the pending show when interrupted', async () => {
    render(<WelcomeBunnies choreography="welcome" momentClass="illustration" />);
    await waitFor(() => expect(stages).toHaveLength(1));
    const { requestStage } = await import('./stage');
    const other = Symbol('other');
    registerMascot(other, { busy: true, isDestroyed: false, stopIdle: vi.fn(), startIdle: vi.fn() }, false);
    expect(requestStage(other, 'decoration')).toBe(false);
    expect(requestStage(other, 'response')).toBe(true);
    expect(stages[0]?.calls).toContain('seek:9.05');
    expect(activeMascot()).toBe(other);
  });

  it('the staying bunny breathes on after its own show; it pauses only while another mascot plays, then breathes on', async () => {
    // 23.10 (Felix: "кролик застыл" on the legal pages): releasing its own stage at the end froze it for good
    render(<WelcomeBunnies choreography="sleepy" momentClass="illustration" />);
    await waitFor(() => expect(stages).toHaveLength(1));
    const stage = stages[0] as unknown as { calls: string[]; ended: boolean; options: WelcomeOptions };
    await waitFor(() => expect(stage.calls).toContain('playWhenIdle'));
    act(() => {
      stage.ended = true;
      stage.options.onEnd?.();
    });
    expect(stage.calls).not.toContain('pause');
    const { requestStage, releaseStage } = await import('./stage');
    const other = Symbol('other');
    const otherMember = { busy: true, isDestroyed: false, stopIdle: vi.fn(), startIdle: vi.fn() };
    registerMascot(other, otherMember, false);
    expect(requestStage(other, 'response')).toBe(true);
    expect(stage.calls.at(-1)).toBe('pause');
    otherMember.busy = false;
    releaseStage(other);
    expect(stage.calls.at(-1)).toBe('resumeCalm');
  });

  it('starts at the end pose when another mascot is mid-scene (never two animating mascots)', async () => {
    const busy = { busy: true, isDestroyed: false, stopIdle: vi.fn(), startIdle: vi.fn() };
    const other = Symbol('other');
    registerMascot(other, busy, true);
    const { requestStage } = await import('./stage');
    expect(requestStage(other)).toBe(true);
    render(<Stage />);
    await waitFor(() => expect(stages).toHaveLength(1));
    expect(stages[0]?.calls).toEqual(['seek:9.05']);
    expect(activeMascot()).toBe(other);
  });

  it('follows the app motion setting (reduce → the static composition) and cleans up on unmount', async () => {
    document.documentElement.dataset['motion'] = 'reduce';
    const { unmount } = render(<Stage card={false} />);
    await waitFor(() => expect(stages).toHaveLength(1));
    expect(stages[0]?.options).toMatchObject({ reducedMotion: 'force', edgeRadius: { bottom: 0 } });
    await act(async () => {
      document.documentElement.dataset['motion'] = 'full';
      await Promise.resolve();
    });
    await waitFor(() => expect(stages[0]?.calls).toContain('reduced:off'));
    unmount();
    expect(stages[0]?.calls.at(-1)).toBe('destroy');
    expect(activeMascot()).toBeNull();
  });

  it('stays a light lazy chunk: kit pieces by file, the package only via import()', () => {
    expect(welcomeSource).not.toMatch(/from\s+['"]\.\.\/\.\.\/ui['"]/);
    expect(welcomeSource).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@bunprise\/mascot['"]/m);
    expect(welcomeSource).toContain("import('@bunprise/mascot')");
  });
});
