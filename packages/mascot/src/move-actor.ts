import { Track, type ChannelInput } from './timeline';
import { applyCoat, frameBox, mountBunny } from './welcome-actors';
import type { BunnyCoat } from './types';
import { gallop } from './gallop';

/** Shared puppet and track registry for the small authored move stages. */
export function movingBunny(parent: HTMLElement, coat: BunnyCoat, width: number, direction: 1 | -1 = 1) {
  const u = width / 200;
  const box = frameBox(u);
  const puppet = mountBunny(parent, box, 'run');
  applyCoat(puppet.host, puppet.q('.hm'), coat);
  puppet.q('.hm').classList.add(direction === 1 ? 'turn-r' : 'turn-l');
  const registry = new Map<string, Track>();
  const track = (name: string, element: Element, base: ChannelInput = {}) => {
    let value = registry.get(name);
    if (!value) { value = new Track(element, name, base); registry.set(name, value); }
    return value;
  };
  const part = (name: string, selector: string, base: ChannelInput = {}) => track(name, puppet.q(selector), base);
  const travel = track('bunny.travel', puppet.frame, { o: 0 });
  const lift = track('bunny.lift', puppet.lift);
  const feet = (x: number, y: number) => ({ x: x - box.ox, y: y - box.oy });
  const bound = (at: number, from: number, to: number, ground: number, duration = 0.36) => {
    // Author the origin explicitly so the actor never jumps from the previous scene's coordinates.
    travel.set(at, { ...feet(from, ground), o: 1 });
    travel.path(at, [[at + duration, { ...feet(to, ground), o: 1 }, 'linear']]);
    lift.path(at, [[at + duration * 0.36, { y: -28 * u }, 'ease-out'], [at + duration * 0.72, { y: 0 }, 'ease-in'], [at + duration, { y: 0 }]]);
    gallop({ squash: part('squash', '.squash'), earL: part('earL', '.lop .ear-l'), earR: part('earR', '.lop .ear-r'), footL: part('footL', '.foot-l'), footR: part('footR', '.foot-r'), shadow: part('shadow', '.shadow'), pawL: part('pawL', '.paw-l'), pawR: part('pawR', '.paw-r'), tail: part('tail', direction === 1 ? '.tail-l' : '.tail-r') }, at, duration, direction);
  };
  return { puppet, u, box, track, part, travel, lift, feet, bound, tracks: () => [...registry.values()] };
}
