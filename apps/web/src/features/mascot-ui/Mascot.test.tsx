/** @vitest-environment jsdom */
import './test-shims';
import { createRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mascot, type MascotHandle } from './Mascot';
import mascotSource from './Mascot.tsx?raw';
import { activeMascot, resetStage } from './stage';
import { momentBudget } from './budget';

afterEach(() => {
  vi.useRealTimers();
  resetStage();
  momentBudget.reset();
  document.body.innerHTML = '';
});

describe('Mascot', () => {
  it('keeps the supplied cheek size after an interrupted scene resets the puppet pose', async () => {
    const ref = createRef<MascotHandle>();
    const { container } = render(<Mascot kind="hamster" puff={1.3} idle={false} ref={ref} />);
    const host = container.firstElementChild as HTMLElement;
    await waitFor(() => expect(host.shadowRoot?.querySelector<SVGGElement>('.hm')?.style.getPropertyValue('--puff')).toBe('1.3'));
    vi.useFakeTimers();
    const scene = ref.current?.play('greet');
    await vi.advanceTimersByTimeAsync(100);
    await ref.current?.instance?.interrupt();
    await scene;
    expect(host.shadowRoot?.querySelector<SVGGElement>('.hm')?.style.getPropertyValue('--puff')).toBe('1.3');
  });
  it('reserves its final size before the lazy chunk arrives, then mounts the puppet and plays a scene', async () => {
    const ref = createRef<MascotHandle>();
    const onSceneEnd = vi.fn();
    const { container } = render(<Mascot kind="bunny" size="m" idle={false} ref={ref} onSceneEnd={onSceneEnd} />);

    const host = container.firstElementChild as HTMLElement;
    // Placeholder: same box as the puppet (size × --mascot-scale-m via .mascot-box + viewBox ratio),
    // invisible, decorative.
    expect(host.style.getPropertyValue('--mascot-w')).toBe('160px');
    expect(host.dataset['mascotSize']).toBe('m');
    expect(host.className).toContain('mascot-box');
    expect(host.style.aspectRatio).toBe('400 / 260');
    expect(host.shadowRoot).toBeNull();
    expect(host.className).toContain('opacity-0');
    expect(host.getAttribute('aria-hidden')).toBe('true');

    // The chunk arrives → Shadow DOM puppet, fade in.
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    expect(host.shadowRoot?.querySelector('svg')).not.toBeNull();
    // the fade-in class follows the mount in the next render; under a loaded test run that can be a tick later
    await waitFor(() => expect(host.className).toContain('opacity-100'));
    expect(ref.current?.instance?.idleRunning).toBe(false);

    vi.useFakeTimers();
    const handle = ref.current;
    expect(handle).not.toBeNull();
    const done = handle ? handle.play('jump') : Promise.resolve();
    expect(ref.current?.instance?.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(4000);
    await done;
    expect(ref.current?.instance?.busy).toBe(false);
    expect(onSceneEnd).toHaveBeenCalledWith('jump');
    expect(activeMascot()).toBeNull();
  });

  it('a numeric size has no size class (no scale token applies) and still reserves its box', () => {
    const { container } = render(<Mascot kind="hamster" size={120} idle={false} />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue('--mascot-w')).toBe('120px');
    expect(host.hasAttribute('data-mascot-size')).toBe(false);
    expect(host.style.aspectRatio).toBe('400 / 250');
  });

  it('stays a light lazy chunk: kit pieces by file (never the ui barrel), the package only via import()', () => {
    // The barrel would pull every kit component and motion into the bunny chunk of / and /i (perf audit §6.6).
    expect(mascotSource).not.toMatch(/from\s+['"]\.\.\/\.\.\/ui['"]/);
    expect(mascotSource).not.toMatch(/from\s+['"]\.\.\/\.\.\/ui\/(motion|index)['"]/);
    // Types only at module level; the code arrives through the dynamic import.
    expect(mascotSource).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]@bunprise\/mascot['"]/m);
    expect(mascotSource).toContain("import('@bunprise/mascot')");
  });

  it('lets only one mascot animate at a time: play() on a second mascot is skipped while the first is busy', async () => {
    const bunny = createRef<MascotHandle>();
    const hamster = createRef<MascotHandle>();
    const hamsterStarted = vi.fn();
    const { container } = render(
      <>
        <Mascot kind="bunny" idle={false} ref={bunny} />
        <Mascot kind="hamster" idle={false} ref={hamster} />
      </>,
    );
    const hosts = container.querySelectorAll<HTMLElement>('[data-mascot]');
    expect(hosts).toHaveLength(2);
    await waitFor(() => {
      expect(hosts[0]?.shadowRoot).not.toBeNull();
      expect(hosts[1]?.shadowRoot).not.toBeNull();
    });
    hosts[1]?.addEventListener('mascot-scene-start', hamsterStarted);

    vi.useFakeTimers();
    const first = bunny.current?.play('greet') ?? Promise.resolve();
    expect(bunny.current?.instance?.busy).toBe(true);

    // A second tap on the SAME puppet is skipped by its scene queue. Its immediately
    // resolved promise must not free the stage while the first greeting still runs.
    await bunny.current?.play('jump');
    expect(activeMascot()).not.toBeNull();

    const second = hamster.current?.play('jump') ?? Promise.resolve();
    await second; // resolves immediately: skipped
    expect(hamsterStarted).not.toHaveBeenCalled();
    expect(hamster.current?.instance?.busy).toBe(false);

    await vi.advanceTimersByTimeAsync(6000);
    await first;
    expect(bunny.current?.instance?.busy).toBe(false);
    expect(activeMascot()).toBeNull();

    // Stage is free again → the hamster may play now.
    const third = hamster.current?.play('jump') ?? Promise.resolve();
    expect(hamsterStarted).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    await third;
    expect(hamster.current?.instance?.busy).toBe(false);
  });

  it('tapScene: an interactive mascot answers a tap / Enter with that scene as a response — never by itself', async () => {
    const ref = createRef<MascotHandle>();
    const { container } = render(<Mascot kind="hamster" holding="binoculars" interactive tapScene="speck" label="Tapsi putzt sein Fernglas" idle={false} ref={ref} />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.getAttribute('role')).toBe('button');
    expect(host.getAttribute('aria-label')).toBe('Tapsi putzt sein Fernglas');
    await waitFor(() => expect(ref.current?.instance).not.toBeNull());
    const inst = ref.current!.instance!;
    const play = vi.spyOn(inst, 'play').mockResolvedValue(undefined);
    const tap = vi.spyOn(inst, 'tap');
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(host);
    await waitFor(() => expect(play).toHaveBeenCalledWith('speck'));
    fireEvent.keyDown(host, { key: 'Enter' });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(tap).not.toHaveBeenCalled();
    expect(activeMascot()).toBeNull();
  });
});
