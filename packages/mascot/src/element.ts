/**
 * <bunprise-mascot kind="bunny|hamster" coat ears size scene idle reduced-motion>
 * A thin custom-element wrapper around Bunny / Hamster. Attributes map to
 * options; changing `scene` plays that scene; `idle="false"` stops the idle loop.
 */

import { Bunny, BUNNY_SCENES } from './bunny';
import { Hamster, HAMSTER_SCENES } from './hamster';
import type { BunnyCoat, BunnyScene, EarStyle, HamsterCoat, HamsterScene, MascotKind, ReducedMotionMode } from './types';

export type AnyMascot = Bunny | Hamster;

export const MASCOT_TAG = 'bunprise-mascot';

function parseSize(value: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 160;
}

function parseEars(value: string | null): EarStyle {
  return value === 'up' || value === 'upright' ? 'upright' : 'lop';
}

/** Absent = idle on; idle="false" / "0" / "off" = off. */
function parseIdle(value: string | null): boolean {
  return !(value === 'false' || value === '0' || value === 'off');
}

function parseReduced(value: string | null): ReducedMotionMode {
  return value === 'force' || value === 'off' ? value : 'auto';
}

// Keep the module importable where HTMLElement does not exist (SSR, plain Node).
const ElementBase = (typeof HTMLElement === 'function' ? HTMLElement : class {}) as typeof HTMLElement;

export class BunpriseMascotElement extends ElementBase {
  static readonly observedAttributes = ['kind', 'coat', 'ears', 'size', 'scene', 'idle', 'reduced-motion'];

  private instance: AnyMascot | null = null;

  /** The underlying Bunny / Hamster, or null while disconnected. */
  get mascot(): AnyMascot | null {
    return this.instance;
  }

  get kind(): MascotKind {
    return this.getAttribute('kind') === 'hamster' ? 'hamster' : 'bunny';
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.unmount();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    const m = this.instance;
    if (!m) return;
    switch (name) {
      case 'kind':
        if (this.kind !== m.kind) {
          this.unmount();
          this.mount();
        }
        break;
      case 'coat':
        if (value) this.applyCoat(m, value);
        break;
      case 'ears':
        if (m instanceof Bunny) m.setEars(parseEars(value));
        break;
      case 'size':
        m.setSize(parseSize(value));
        break;
      case 'scene':
        if (value) void this.playScene(m, value);
        break;
      case 'idle':
        if (parseIdle(value)) m.startIdle();
        else m.stopIdle();
        break;
      case 'reduced-motion':
        m.setReducedMotion(parseReduced(value));
        break;
      default:
        break;
    }
  }

  /** Plays a scene by name; unknown names are ignored. */
  play(scene: string): Promise<void> {
    return this.instance ? this.playScene(this.instance, scene) : Promise.resolve();
  }

  private mount(): void {
    if (this.instance) return;
    const common = {
      size: parseSize(this.getAttribute('size')),
      idle: parseIdle(this.getAttribute('idle')),
      reducedMotion: parseReduced(this.getAttribute('reduced-motion')),
    };
    const coat = this.getAttribute('coat');
    if (this.kind === 'hamster') {
      this.instance = new Hamster(this, { ...common, ...(coat ? { coat: coat as HamsterCoat } : {}) });
    } else {
      this.instance = new Bunny(this, {
        ...common,
        ears: parseEars(this.getAttribute('ears')),
        ...(coat ? { coat: coat as BunnyCoat } : {}),
      });
    }
    const scene = this.getAttribute('scene');
    if (scene) void this.playScene(this.instance, scene);
  }

  private unmount(): void {
    this.instance?.destroy();
    this.instance = null;
  }

  private applyCoat(m: AnyMascot, coat: string): void {
    if (m instanceof Bunny) m.setCoat(coat as BunnyCoat);
    else m.setCoat(coat as HamsterCoat);
  }

  private playScene(m: AnyMascot, scene: string): Promise<void> {
    if (m instanceof Bunny) {
      return (BUNNY_SCENES as readonly string[]).includes(scene) ? m.play(scene as BunnyScene) : Promise.resolve();
    }
    return (HAMSTER_SCENES as readonly string[]).includes(scene) ? m.play(scene as HamsterScene) : Promise.resolve();
  }
}

let defined = false;

/** Registers <bunprise-mascot>; safe to call more than once and outside a browser. */
export function defineMascotElement(): void {
  if (defined || typeof customElements === 'undefined') return;
  if (!customElements.get(MASCOT_TAG)) customElements.define(MASCOT_TAG, BunpriseMascotElement);
  defined = true;
}
