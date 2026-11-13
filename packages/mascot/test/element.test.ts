import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bunny, BunpriseMascotElement, Hamster, MASCOT_TAG } from '../src/index';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('<bunprise-mascot>', () => {
  it('is registered on import', () => {
    expect(customElements.get(MASCOT_TAG)).toBe(BunpriseMascotElement);
  });

  it('mounts from attributes and reflects attribute changes', () => {
    const el = document.createElement(MASCOT_TAG) as BunpriseMascotElement;
    el.setAttribute('kind', 'hamster');
    el.setAttribute('coat', 'robo');
    el.setAttribute('size', '200');
    el.setAttribute('idle', 'false');
    document.body.append(el);
    const m = el.mascot;
    expect(m).toBeInstanceOf(Hamster);
    expect(m?.coat).toBe('robo');
    expect(el.style.width).toBe('200px');
    expect(m?.idleRunning).toBe(false);

    el.setAttribute('coat', 'spot');
    expect(m?.coat).toBe('spot');
    el.setAttribute('size', '320');
    expect(el.style.width).toBe('320px');
    el.setAttribute('idle', 'true');
    expect(m?.idleRunning).toBe(true);
    el.setAttribute('scene', 'jump');
    expect(m?.busy).toBe(true);
    expect(m?.scene).toBe('jump');
    el.remove();
    expect(el.mascot).toBeNull();
    expect(m?.isDestroyed).toBe(true);
  });

  it('defaults to the bunny and supports ears + kind swapping', () => {
    const el = document.createElement(MASCOT_TAG) as BunpriseMascotElement;
    el.setAttribute('ears', 'up');
    document.body.append(el);
    expect(el.mascot).toBeInstanceOf(Bunny);
    expect((el.mascot as Bunny).ears).toBe('upright');
    el.setAttribute('ears', 'lop');
    expect((el.mascot as Bunny).ears).toBe('lop');
    const old = el.mascot;
    el.setAttribute('kind', 'hamster');
    expect(old?.isDestroyed).toBe(true);
    expect(el.mascot).toBeInstanceOf(Hamster);
    el.remove();
  });

  it('upgrades elements written as HTML', () => {
    document.body.innerHTML = `<${MASCOT_TAG} kind="bunny" coat="blue" scene="greet"></${MASCOT_TAG}>`;
    const el = document.querySelector(MASCOT_TAG) as BunpriseMascotElement;
    expect(el.mascot).toBeInstanceOf(Bunny);
    expect(el.mascot?.coat).toBe('blue');
    expect(el.mascot?.scene).toBe('greet');
  });
});
