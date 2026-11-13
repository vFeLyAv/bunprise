/**
 * Stable tint of gift tiles and avatars (blocker 20, docs/design/directions.md).
 *
 * A hash of the wish / person id picks one of the four tints --tile-1…4 (tokens.css): the same id
 * gets the same colour on every screen, in every list position and on every device. Owner and guest
 * views hash the same wish id, so a tint never says anything about reservations.
 *
 * Usage: `<span className="tile …" data-tile={tileTone(wish.id)} />` — the `.tile` class and the tint
 * tokens live in src/styles/tiles.css, which this module brings along (so they ship only with the
 * screens that show tiles).
 */
import '../styles/tiles.css';

export type TileTone = 1 | 2 | 3 | 4;

/** FNV-1a (32 bit) over the UTF-16 code units → 1…4. Pure and cheap (ids are 36 characters). */
export function tileTone(id: string): TileTone {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (((hash >>> 0) % 4) + 1) as TileTone;
}
