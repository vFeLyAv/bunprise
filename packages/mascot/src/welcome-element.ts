/**
 * <bunprise-welcome bunnies="fawn,himalayan,choc,broken" choreography="welcome"
 *                   loop autoplay="idle" reduced-motion="auto" edge-inset="0 0 16 0" edge-radius="0 0 30 0">
 * A thin custom-element wrapper around WelcomeStage. It plays on connect
 * (autoplay="idle" = once the page is idle, autoplay="false" = wait for el.play()),
 * fires `welcome-end` on itself (bubbles) and rebuilds when bunnies / choreography /
 * loop / edge-inset / edge-radius change. Not registered on import (keeps the
 * welcome code tree-shakable): call defineWelcomeElement() once.
 */

import { BUNNY_COATS } from './bunny';
import type { BunnyCoat, ReducedMotionMode, WelcomePreset } from './types';
import { WELCOME_PRESETS, WelcomeStage } from './welcome';

export const WELCOME_TAG = 'bunprise-welcome';

const ElementBase = (typeof HTMLElement === 'function' ? HTMLElement : class {}) as typeof HTMLElement;

function parseBunnies(v: string | null): BunnyCoat[] | undefined {
  if (!v) return undefined;
  const ids = BUNNY_COATS.map((c) => c.id as string);
  const list = v
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => ids.includes(s)) as BunnyCoat[];
  return list.length ? list : undefined;
}

function parsePreset(v: string | null): WelcomePreset {
  return (WELCOME_PRESETS as readonly string[]).includes(v ?? '') ? (v as WelcomePreset) : 'welcome';
}

function parseReduced(v: string | null): ReducedMotionMode {
  return v === 'force' || v === 'off' ? v : 'auto';
}

/** Present = on, except loop="false" / "0" / "off". */
function parseFlag(v: string | null): boolean {
  return v !== null && !(v === 'false' || v === '0' || v === 'off');
}

/** edge-inset like CSS margin: "16" (all), "0 16" (top/bottom, left/right), "0 0 16 0" (top right bottom left). */
export function parseInset(v: string | null): { top: number; right: number; bottom: number; left: number } {
  const n = (v ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => {
      const x = Number.parseFloat(s);
      return Number.isFinite(x) && x > 0 ? x : 0;
    });
  const [a = 0, b = a, c = a, d = b] = n;
  return { top: a, right: b, bottom: c, left: d };
}

export class BunpriseWelcomeElement extends ElementBase {
  static readonly observedAttributes = ['bunnies', 'choreography', 'loop', 'reduced-motion', 'edge-inset', 'edge-radius', 'autoplay'];

  private instance: WelcomeStage | null = null;

  /** The underlying WelcomeStage, or null while disconnected. */
  get stage(): WelcomeStage | null {
    return this.instance;
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.instance?.destroy();
    this.instance = null;
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (!this.instance || old === value) return;
    if (name === 'reduced-motion') {
      this.instance.setReducedMotion(parseReduced(value));
      return;
    }
    if (name === 'autoplay') return;
    this.instance.destroy();
    this.instance = null;
    this.mount();
  }

  play(): void {
    this.instance?.play();
  }

  pause(): void {
    this.instance?.pause();
  }

  stop(): void {
    this.instance?.stop();
  }

  seek(seconds: number): void {
    this.instance?.seek(seconds);
  }

  private mount(): void {
    if (this.instance) return;
    const bunnies = parseBunnies(this.getAttribute('bunnies'));
    const autoplay = this.getAttribute('autoplay');
    this.instance = new WelcomeStage(this, {
      ...(bunnies ? { bunnies } : {}),
      choreography: parsePreset(this.getAttribute('choreography')),
      loop: parseFlag(this.getAttribute('loop')),
      reducedMotion: parseReduced(this.getAttribute('reduced-motion')),
      edgeInset: parseInset(this.getAttribute('edge-inset')),
      edgeRadius: parseInset(this.getAttribute('edge-radius')),
      autoplay: autoplay === 'idle' ? 'idle' : autoplay !== 'false',
    });
  }
}

let defined = false;

/** Registers <bunprise-welcome>; safe to call more than once and outside a browser. */
export function defineWelcomeElement(): void {
  if (defined || typeof customElements === 'undefined') return;
  if (!customElements.get(WELCOME_TAG)) customElements.define(WELCOME_TAG, BunpriseWelcomeElement);
  defined = true;
}
