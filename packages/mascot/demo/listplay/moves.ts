/**
 * «Помпон в открытом списке» — approved 31.10 («Мне все анимации нравятся»). Pompon's side of every moment moved into
 * the package (src/listplay/moves.ts, entry @bunprise/mascot/listplay); what stays here is the mock's own list in the
 * same timelines (the package's `list` hook): a new tile drops into the grid, a leaving tile shrinks away or flies to
 * the edge, the others glide into place (FLIP), the stamp's ✓ and «✓ Erhalten» on the card, the count of «Erhalten».
 * The app does none of this here — its list is React's (apps/web features/wishes).
 */

import {
  authorBulk as bulkOf, authorDelete as deleteOf, authorDizzy as dizzyOf, authorEnd as endOf, authorMove as moveOf,
  authorReceived as receivedOf, authorWish as wishOf, bodyRect, Builder, END_TEXT, EZ, type Ctx as PomponCtx, type Rect, type Shot, type Vec,
} from '../../src/listplay/moves';
import { cardEl, NEW_WISH, rectIn, TAB, type PhoneRefs } from './mock';
import type { Pose, Rig } from './rig';

export {
  authorBoop, authorBounce, authorGrab, authorPeek, authorPop, authorPull, authorRelax, authorRelease, authorSelect, authorStroke,
  bodyRect, Builder, DIZZY_S, earFollow, END_TEXT, EZ, LID_CRACK, NERVOUS, outward, STROKE_HOLD, union,
  type GiftBox, type Haptic, type Moment, type Rect, type Shot, type Vec,
} from '../../src/listplay/moves';

/** The gallery's context: Pompon's (rig, seat, ghost finger, haptics) + the phone mock. */
export interface Ctx extends PomponCtx {
  rig: Rig;
  refs: PhoneRefs;
}

/** The tiles' boxes (layer px), to glide them from where they were to where they are now (FLIP). */
function snapshot(refs: PhoneRefs): Map<HTMLElement, Rect> {
  return new Map(refs.cards().map((c) => [c, rectIn(c, refs.layer)]));
}

/** Takes tiles out of the grid's flow (each stays where it is, absolutely placed): the others close the gap. All are
 * measured first — a tile lifted earlier would let the next one move up before it is measured. */
function lift(refs: PhoneRefs, ...lis: HTMLElement[]): void {
  const grid = refs.grid;
  if (!grid) return;
  const rects = lis.map((li) => rectIn(li, grid));
  lis.forEach((li, i) => place(li, rects[i] ?? { x: 0, y: 0, w: 0, h: 0 }));
}

function place(li: HTMLElement, r: Rect): void {
  li.style.position = 'absolute';
  li.style.left = `${r.x}px`;
  li.style.top = `${r.y}px`;
  li.style.width = `${r.w}px`;
  li.style.zIndex = '1';
}

function clearCard(li: HTMLElement): void {
  for (const e of [li, ...li.querySelectorAll<HTMLElement>('.lpc-card, .lpc-seal, .lpc-badge')]) {
    e.style.transform = '';
    e.style.opacity = '';
  }
}

let wishSerial = 0;

/** The tiles that moved (layer px) glide from where they were to where they are now, between t0 and t1. */
function glide(b: Builder, before: Map<HTMLElement, Rect>, refs: PhoneRefs, t0: number, t1: number, skip: ReadonlySet<HTMLElement> = new Set()): HTMLElement[] {
  const moved: HTMLElement[] = [];
  for (const [li, r0] of before) {
    if (skip.has(li) || !li.isConnected) continue;
    const r1 = rectIn(li, refs.layer);
    const dx = r0.x - r1.x;
    const dy = r0.y - r1.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    b.dom(`glide.${li.dataset.id ?? ''}`, li, { x: dx, y: dy }).move(t0, t1, { x: 0, y: 0 }, EZ.soft);
    moved.push(li);
  }
  return moved;
}

/** The photo of a tile (layer px) and the point his feet stand on it: on its lower edge (he covers only that tile). */
function onTile(refs: PhoneRefs, li: HTMLElement, at = 0.5): { photo: Rect; feet: Vec } {
  const media = li.querySelector('.lpc-media') ?? li;
  const photo = rectIn(media, refs.layer);
  return { photo, feet: { x: photo.x + photo.w * at, y: photo.y + photo.h - 3 } };
}

/**
 * Can he hop there? The spot (and he, standing on it) is on screen between the bars and not too far away — else he
 * answers from his seat (a trip half behind the tab bar, or across the whole list, looked wrong).
 */
function reachable(c: Ctx, feet: Vec): boolean {
  const r = c.refs;
  const scroll = r.layer === r.content ? r.screen.scrollTop : 0;
  const top = scroll + 100;
  const bottom = scroll + TAB.top - 6;
  return feet.y - 58 >= top && feet.y <= bottom && Math.hypot(feet.x - c.seat.x, feet.y - c.seat.y) <= 520;
}

/** Nothing to act on (the tile is gone): an empty moment. */
const nothing = (c: Ctx, from: Pose, name: Shot['name']): Shot => new Builder(c, from).shot(name, 0.1, { focus: bodyRect(c.seat) });

// ------------------------------------------------------------------------------------------------ 3. a new wish

export function authorWish(c: Ctx, from: Pose): Shot {
  const refs = c.refs;
  const before = snapshot(refs);
  wishSerial += 1;
  const li = cardEl({ ...NEW_WISH, id: `${NEW_WISH.id}-${wishSerial}` });
  refs.grid?.prepend(li);
  const inner = li.querySelector<HTMLElement>('.lpc-card') ?? li;
  const { photo, feet } = onTile(refs, li);
  return wishOf(c, from, {
    feet,
    photo,
    reach: reachable(c, feet),
    press: { el: inner, landAt: 0.52 },
    list: (b) => {
      glide(b, before, refs, 0.04, 0.42);
      // the new tile drops into its place from above, a little turned, and lands with a squash (WishGrid TileDrop, bigger)
      b.dom('new', li, { x: 0, y: -64, r: -7, s: 0.9, o: 0 }).path(0.16, [[0.3, { x: 0, y: -50, r: -6, s: 0.92, o: 1 }, 'ease-out'], [0.52, { x: 0, y: 0, r: 0, s: 1, o: 1 }, EZ.in]]);
    },
    commit: () => {
      for (const card of refs.cards()) clearCard(card);
      inner.style.transformOrigin = '';
    },
  });
}

// ------------------------------------------------------------------------------------------------ 4. received («Erhalten»)

export function authorReceived(c: Ctx, from: Pose, id: string): Shot {
  const refs = c.refs;
  const li = refs.card(id);
  if (!li) return nothing(c, from, 'received');
  const { photo, feet } = onTile(refs, li, 0.36);
  const reach = reachable(c, feet);
  const card = li.querySelector<HTMLElement>('.lpc-card') ?? li;
  const cardR = rectIn(card, refs.layer);
  const sealEl = li.querySelector<HTMLElement>('.lpc-seal');
  const badge = li.querySelector<HTMLElement>('.lpc-badge');
  if (badge) badge.style.transformOrigin = '0% 50%';
  // the tile leaves at the end: out of the grid's flow now (it stays where it is), the others glide later
  const before = snapshot(refs);
  lift(refs, li);
  return receivedOf(c, from, {
    feet,
    photo,
    reach,
    card,
    seal: (contact) => {
      if (!sealEl) return null;
      sealEl.style.left = `${contact.x - cardR.x}px`;
      sealEl.style.top = `${contact.y - cardR.y - 10}px`;
      return sealEl;
    },
    list: (b, at) => {
      const tc = at.contact ?? 0;
      const tl = at.leave ?? 0;
      if (badge) b.dom('badge', badge, { o: 0, s: 0.6 }).path(tc + 0.2, [[tc + 0.44, { o: 1, s: 1 }, EZ.spring]]);
      // back on his seat: the tile leaves for «Erhalten», the others close the gap, the count goes up
      b.dom('leave', li, { x: 0, y: 0, s: 1, o: 1 }).path(tl, [[tl + 0.38, { x: 0, y: 0, s: 0.86, o: 0 }, EZ.soft]]);
      glide(b, before, refs, tl + 0.18, tl + 0.58, new Set([li]));
      if (refs.countOld && refs.countNew) {
        b.dom('countOld', refs.countOld, { o: 1, y: 0 }).path(tl + 0.22, [[tl + 0.36, { o: 0, y: -6 }, EZ.ease]]);
        b.dom('countNew', refs.countNew, { o: 0, y: 6 }).path(tl + 0.26, [[tl + 0.42, { o: 1, y: 0 }, EZ.out]]);
      }
      return tl + 0.62;
    },
    commit: () => {
      li.remove();
      for (const cd of refs.cards()) clearCard(cd);
      bumpCount(refs);
    },
  });
}

/** «Erhalten (n)» + 1 (the two stacked numbers: the old one shows, the new one waits hidden). */
function bumpCount(refs: PhoneRefs): void {
  const o = refs.countOld;
  const n = refs.countNew;
  if (!o || !n) return;
  const next = Number(o.textContent ?? '1') + 1;
  o.textContent = String(next);
  n.textContent = String(next + 1);
  for (const e of [o, n]) {
    e.style.transform = '';
    e.style.opacity = '';
  }
  n.style.opacity = '0';
  refs.received?.setAttribute('aria-label', `Erhalten, ${next} Wünsche`);
}

// ------------------------------------------------------------------------------------------------ 5. delete

export function authorDelete(c: Ctx, from: Pose, id: string): Shot {
  const refs = c.refs;
  const li = refs.card(id);
  if (!li) return nothing(c, from, 'delete');
  const cr = rectIn(li, refs.layer);
  const before = snapshot(refs);
  lift(refs, li);
  return deleteOf(c, from, {
    target: cr,
    list: (b) => {
      b.dom('leave', li, { s: 1, o: 1 }).path(0.3, [[0.7, { s: 0.86, o: 0 }, EZ.soft]]);
      glide(b, before, refs, 0.66, 1.06, new Set([li]));
    },
    commit: () => {
      li.remove();
      for (const cd of refs.cards()) clearCard(cd);
    },
  });
}

// ------------------------------------------------------------------------------------------------ 6. selection mode

/** «Verschieben»: the chosen tiles fly off to the edge (the app would let them shrink away), he hops after them. */
export function authorMove(c: Ctx, from: Pose, ids: readonly string[]): Shot {
  const refs = c.refs;
  const lis = ids.map((id) => refs.card(id)).filter((e): e is HTMLElement => !!e);
  const before = snapshot(refs);
  const rects = lis.map((li) => rectIn(li, refs.layer));
  lift(refs, ...lis);
  const W = refs.layer.clientWidth || 390;
  return moveOf(c, from, {
    rects,
    width: W,
    list: (b) => {
      lis.forEach((li, i) => {
        const r = rects[i] ?? { x: 0, y: 0, w: 0, h: 0 };
        const t0 = 0.16 + i * 0.08;
        const dx = W - r.x + 24;
        b.dom(`fly.${li.dataset.id ?? i}`, li, { x: 0, y: 0, r: 0, s: 1, o: 1 }).path(t0, [
          [t0 + 0.12, { x: -6, y: -4, r: -2, s: 1.02, o: 1 }, EZ.out],
          [t0 + 0.4, { x: dx * 0.7, y: -14, r: 7, s: 0.86, o: 0.9 }, EZ.in],
          [t0 + 0.52, { x: dx, y: -18, r: 9, s: 0.82, o: 0 }, 'linear'],
        ]);
      });
      glide(b, before, refs, 1.0, 1.42, new Set(lis));
    },
    commit: () => {
      for (const li of lis) li.remove();
      for (const cd of refs.cards()) clearCard(cd);
    },
  });
}

/** Selection «Erhalten» / «Löschen»: he lets go of his ears, the chosen tiles leave (the app's exit), the gap closes. */
export function authorBulk(c: Ctx, from: Pose, ids: readonly string[], received: boolean): Shot {
  const refs = c.refs;
  const lis = ids.map((id) => refs.card(id)).filter((e): e is HTMLElement => !!e);
  const before = snapshot(refs);
  const rects = lis.map((li) => rectIn(li, refs.layer));
  lift(refs, ...lis);
  return bulkOf(c, from, {
    rects,
    list: (b) => {
      lis.forEach((li, i) => b.dom(`leave.${i}`, li, { s: 1, o: 1 }).path(0.1 + i * 0.05, [[0.48 + i * 0.05, { s: 0.86, o: 0 }, EZ.soft]]));
      glide(b, before, refs, 0.42, 0.82, new Set(lis));
    },
    commit: () => {
      for (const li of lis) li.remove();
      for (const cd of refs.cards()) clearCard(cd);
      if (received) for (let i = 0; i < lis.length; i++) bumpCount(refs);
    },
  });
}

// ------------------------------------------------------------------------------------------------ 7. the end of the list

export function authorEnd(c: Ctx, from: Pose): Shot {
  return endOf(c, from, { el: c.refs.bubble, text: END_TEXT, width: 96, layerWidth: c.refs.layer.clientWidth || 390 });
}

// ------------------------------------------------------------------------------------------------ 10. shaken: dizzy

export function authorDizzy(c: Ctx, from: Pose, simulated: boolean): Shot {
  // the gallery's "Schütteln": the phone mock itself shakes (on a real phone the hand does it)
  return dizzyOf(c, from, simulated ? c.refs.phone : null);
}

// ------------------------------------------------------------------------------------------------ without Pompon

/**
 * The list's own change without Pompon (another mascot is on stage, reduced motion, he is busy): exactly the app's
 * behaviour — a new tile fades in, a leaving tile shrinks away (reduced: fades), the others glide (reduced: jump).
 */
export function authorPlain(c: Ctx, kind: 'wish' | 'leave', ids: readonly string[], reduced: boolean, received = false): Shot {
  const b = new Builder(c, {});
  const refs = c.refs;
  const before = snapshot(refs);
  const lis: HTMLElement[] = [];
  if (kind === 'wish') {
    wishSerial += 1;
    const li = cardEl({ ...NEW_WISH, id: `${NEW_WISH.id}-${wishSerial}` });
    refs.grid?.prepend(li);
    b.dom('new', li, reduced ? { o: 0 } : { y: 10, s: 0.98, o: 0 }).path(0.02, [[0.3, reduced ? { o: 1 } : { y: 0, s: 1, o: 1 }, EZ.soft]]);
    if (!reduced) glide(b, before, refs, 0.02, 0.36, new Set([li]));
  } else {
    for (const id of ids) {
      const li = refs.card(id);
      if (li) lis.push(li);
    }
    lift(refs, ...lis);
    lis.forEach((li, i) => b.dom(`leave.${i}`, li, reduced ? { o: 1 } : { s: 1, o: 1 }).path(0.02, [[0.32, reduced ? { o: 0 } : { s: 0.86, o: 0 }, EZ.soft]]));
    if (!reduced) glide(b, before, refs, 0.24, 0.6, new Set(lis));
  }
  return b.shot('plain', reduced ? 0.34 : 0.62, {
    focus: bodyRect(c.seat),
    commit: () => {
      for (const li of lis) li.remove();
      for (const cd of refs.cards()) clearCard(cd);
      if (received) for (let i = 0; i < lis.length; i++) bumpCount(refs);
    },
  });
}
