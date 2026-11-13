import { describe, expect, it } from 'vitest';
import { tileTone } from './tile';

describe('tileTone (stable tint of gift tiles and avatars, blocker 20)', () => {
  it('gives the same id the same tint, always', () => {
    const id = '7b0c5d8e-1f2a-4b3c-9d4e-5f6a7b8c9d0e';
    expect(tileTone(id)).toBe(tileTone(id));
    expect(tileTone(id)).toBe(tileTone(`${id}`.slice(0)));
  });

  it('only returns 1–4 and uses all four tints over many ids', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const tone = tileTone(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      expect([1, 2, 3, 4]).toContain(tone);
      seen.add(tone);
    }
    expect(seen.size).toBe(4);
  });

  it('does not depend on the list position: neighbours are hashed independently', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].map((x) => `wish-${x}`);
    const forward = ids.map(tileTone);
    const backward = [...ids].reverse().map(tileTone).reverse();
    expect(backward).toEqual(forward);
  });
});
