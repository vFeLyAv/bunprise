/**
 * «Помпон в списке» (31.10, GALLERY-ONLY prototype) — one phone with Pompon: plays the moments, freezes a frame
 * (`&t=`), and in the live mode wires the real gestures:
 *
 *   on Pompon     rub (finger or mouse, also hovering) = stroke · tap = boop (5 taps in 2.5 s → the approved anger) ·
 *                 press on an ear tip and pull = pull the ear
 *   on the list   "+ Wunsch" = new wish · ⋯ → Als erhalten markieren / Löschen / Mehrere auswählen · long press on a
 *                 tile = selection mode (Alle, Fertig, Verschieben, Erhalten, Löschen) · scroll to the end = «Das war’s!»
 *                 · scrolling on at the end (wheel / pull) = a tiny bounce · the empty list's big "+" = he pops out
 *   the phone     shake (devicemotion, or the gallery's "Schütteln") = dizzy
 *
 * Rules kept: one mascot animates at a time (the Arbiter: while one phone plays a moment, the other Pompons' idle life
 * stops and they play nothing); a moment pauses while the phone is off screen or the tab is hidden (src/drive.ts Watch)
 * and goes on from the same frame; reduced motion = no animate() for Pompon (his still pose, calm eyes ^ ^; the list's
 * own change only fades); Pompon is aria-hidden, only his body catches the finger (≥ 44 px), never a button.
 * Nothing here depends on reservations — the owner's own actions only.
 */

import { IdleScheduler } from '../../src/core';
import { applyStyle, Watch } from '../../src/drive';
import type { Track } from '../../src/timeline';
import { mountGiftBox } from '../../src/listplay/box';
import { buildPhone, rectIn, TAB, toast, PHONE_W, type PhoneRefs, type Place, type Theme } from './mock';
import {
  authorBoop, authorBounce, authorBulk, authorDelete, authorDizzy, authorEnd, authorGrab, authorMove, authorPeek, authorPlain, authorPop, authorPull,
  authorReceived, authorRelax, authorRelease, authorSelect, authorStroke, authorWish, bodyRect, earFollow, LID_CRACK, NERVOUS,
  type Ctx, type GiftBox, type Haptic, type Moment, type Rect, type Shot, type Vec,
} from './moves';
import { Player, type Mark } from './player';
import { feetAt, mountPompon, NEUTRAL, type PartName, type Pose, type Rig } from './rig';

/** The moments the gallery can play / freeze by name. */
export const PLAYABLE = ['stroke', 'boop', 'pull', 'dizzy', 'wish', 'received', 'delete', 'select', 'relax', 'move', 'end', 'bounce', 'peek', 'pop'] as const;
export type Playable = (typeof PLAYABLE)[number];
const CARD_MOMENTS: ReadonlySet<Moment> = new Set(['wish', 'received', 'delete', 'move', 'bulk', 'plain']);

/** One mascot animates at a time, across every phone of the page. */
export class Arbiter {
  private owner: ListPlay | null = null;
  readonly all = new Set<ListPlay>();

  claim(p: ListPlay): boolean {
    if (this.owner && this.owner !== p) return false;
    if (this.owner !== p) for (const o of this.all) if (o !== p) o.quiet(true);
    this.owner = p;
    return true;
  }

  free(p: ListPlay): void {
    if (this.owner !== p) return;
    this.owner = null;
    for (const o of this.all) if (o !== p) o.quiet(false);
  }

  get busy(): ListPlay | null {
    return this.owner;
  }
}

export interface StageOptions {
  place: Place;
  theme: Theme;
  /** reduced motion ("Weniger"): Pompon never animates */
  still: boolean;
  /** the real gestures work (off: the mock only answers the gallery's buttons) */
  live: boolean;
  arbiter: Arbiter;
  log: (text: string) => void;
}

const SEL_DEFAULT = ['w2', 'w3'];
/** B: how far he slips down to hide — below the screen's edge (the gap under the floating tab bar would show him) */
const DUCK = 140;
const MOVE_TARGET = 'Weihnachten';

export class ListPlay {
  readonly refs: PhoneRefs;
  readonly rig: Rig;
  readonly place: Place;
  private still: boolean;
  private live: boolean;
  private run: { shot: Shot; player: Player; watch: Watch } | null = null;
  private side: Player[] = [];
  private frozen: { shot: Shot; player: Player } | null = null;
  /** what stays inline while he rests (selection: holding his ears; in the box) */
  private pose: Pose = {};
  private where: 'seat' | 'end' | 'box' | 'out' = 'seat';
  private selecting: string[] | null = null;
  private ducked = false;
  /** B: a moment starts and ends behind the tab bar (tiles were under his corner) */
  private hidden = false;
  private lastEnd = -Infinity;
  private lastBounce = -Infinity;
  private taps: number[] = [];
  private angryPending = false;
  private ownScene = false;
  private grab: { side: 'l' | 'r'; id: number } | null = null;
  private stroke = { on: false, held: false, len: 0, flips: 0, lastX: NaN, lastDx: 0, lastT: 0, idle: 0 };
  private press: { id: number; x: number; y: number; t: number; moved: boolean } | null = null;
  private long: { timer: number; id: string; x: number; y: number } | null = null;
  private eatClick = false;
  private sheetFor: string | null = null;
  private box: GiftBox | null = null;
  /** the empty list: now and then a peek out of the closed box (only while it can be seen, nothing else plays) */
  private peeks: IdleScheduler | null = null;
  private readonly off: Array<() => void> = [];
  private destroyed = false;

  constructor(
    parent: HTMLElement,
    private readonly o: StageOptions,
  ) {
    this.place = o.place;
    this.still = o.still;
    this.live = o.live;
    this.refs = buildPhone(parent, { place: o.place, theme: o.theme });
    this.rig = mountPompon(this.refs.layer, { still: o.still, label: 'Pompon' });
    if (o.place === 'empty') this.buildBox();
    if (o.place === 'b') this.refs.screen.scrollTop = this.refs.screen.scrollHeight;
    // «Das war’s!» only after a person scrolled there (not because the page opened at the end)
    this.lastEnd = performance.now();
    this.rest();
    this.wire();
    o.arbiter.all.add(this);
    if (o.place === 'empty') {
      this.peeks = new IdleScheduler(() => this.where === 'box' && !this.busy && !this.frozen && !this.still && this.live && !this.o.arbiter.busy);
      this.peeks.observe(this.refs.phone);
      this.peeks.add(() => void this.play('peek', undefined, false), 6500, 5500);
      this.peeks.start();
    }
  }

  // ------------------------------------------------------------------------------------------------ places

  /** His feet at rest, in px of his layer. */
  get seat(): Vec {
    const r = this.refs;
    if (this.place === 'empty') return this.where === 'out' && this.box ? this.box.land : (this.box?.inBox ?? { x: 0, y: 0 });
    // B: while tiles pass under his corner he waits behind the tab bar (a moment then starts and ends there)
    if (this.place === 'b') return { x: PHONE_W - 46, y: TAB.top - 4 + (this.hidden ? DUCK : 0) };
    if (this.where === 'end' && r.endSpot) {
      const e = rectIn(r.endSpot, r.layer);
      return { x: e.x + e.w / 2, y: e.y + e.h - 40 };
    }
    const row = r.seatRow ? rectIn(r.seatRow, r.layer) : { x: 0, y: 0, w: PHONE_W - 32, h: 56 };
    // A: on the right end of the list icon's row, feet on its baseline (next to the icon tile and the date chip)
    return { x: row.x + row.w - 30, y: row.y + row.h - 2 };
  }

  private rest(): void {
    this.rig.place(this.seat);
    if (this.place === 'empty' && this.where !== 'out') this.restInBox();
    if (this.place === 'b') this.checkDuck();
  }

  /**
   * The empty list at rest (recommended: closed): the box is closed, he waits inside, unseen (his idle life stops —
   * nothing of him shows); now and then a peek. Reduced motion: no peek — still, the lid lifted a crack with his eyes
   * (^ ^, the calm eyes) looking out of it.
   */
  private restInBox(): void {
    const box = this.box;
    if (!box) return;
    this.where = 'box';
    this.pose = {};
    this.rig.release();
    this.rig.puppet.stopIdle();
    box.lidInner.style.transform = this.still ? `translate(${LID_CRACK.x ?? 0}px, ${LID_CRACK.y ?? 0}px) rotate(${LID_CRACK.r ?? 0}deg)` : '';
    this.rig.place(this.still ? box.peekAt : box.inBox);
  }

  /**
   * The closed gift box of the empty list (Felix 31.10: box and lid clearly one box — the lid is the box's width plus
   * a 4 px overhang on each side, the ribbon runs on from the box over the lid, the bow sits on the lid). Layers in the
   * content: back wall + floor shadow (under him) < Pompon < front < lid (outer: shakes with the box; inner: flies).
   * Coordinates: one 180 × 110 px box per layer; the floor is at y 102.
   */
  private buildBox(): void {
    const r = this.refs;
    if (!r.emptySeat) return;
    const s = rectIn(r.emptySeat, r.content);
    // (the box itself is the package's: src/listplay/box.ts — the app shows the same one)
    this.box = mountGiftBox(r.content, { x: s.x + s.w / 2 - 12 - 82, y: s.y + s.h - 106 });
    this.where = 'box';
  }

  // ------------------------------------------------------------------------------------------------ state

  get busy(): boolean {
    return !!this.run || this.ownScene;
  }

  get moment(): Shot | null {
    return this.run?.shot ?? this.frozen?.shot ?? null;
  }

  get time(): number {
    return this.run?.player.time ?? (this.frozen ? this.frozenTime : 0);
  }

  private frozenTime = 0;

  /** Another phone's Pompon has the stage: no idle life here meanwhile. */
  quiet(on: boolean): void {
    if (this.destroyed || this.still || this.rig.driven || (this.place === 'empty' && this.where === 'box')) return;
    if (on) this.rig.puppet.stopIdle();
    else this.rig.puppet.startIdle();
  }

  private haptic = (kind: Haptic, what: string): void => {
    // the app would call its wrapper (lib/haptics: feedback / haptic); the gallery only writes it down
    this.o.log(`📳 ${kind} — ${what}`);
  };

  private ctx(ghost: boolean): Ctx {
    return { rig: this.rig, refs: this.refs, seat: this.seat, ghost, finger: this.refs.finger, haptic: this.haptic };
  }

  /** The pose on screen right now (the running moment's frame + what is inline). */
  private currentPose(): Pose {
    const out: Pose = { ...this.pose, box: feetAt(this.rig.at) };
    if (this.run) {
      const t = this.run.player.time;
      for (const tr of this.run.shot.tracks) {
        if (!tr.name.startsWith('lp.')) continue;
        const part = tr.name.slice(3) as PartName;
        out[part] = { ...NEUTRAL[part], ...(tr as Track).sample(t) };
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ playing

  /** Builds a moment from the pose on screen. */
  private author(name: Moment, ghost: boolean, arg?: string | readonly string[] | boolean): Shot | null {
    const c = this.ctx(ghost);
    const from = this.currentPose();
    const ids = Array.isArray(arg) ? (arg as readonly string[]) : typeof arg === 'string' ? [arg] : [];
    switch (name) {
      case 'stroke': return authorStroke(c, from);
      case 'boop': return authorBoop(c, from);
      case 'wish': return authorWish(c, from);
      case 'received': return authorReceived(c, from, ids[0] ?? '');
      case 'delete': return authorDelete(c, from, ids[0] ?? '');
      case 'select': return authorSelect(c, from);
      case 'relax': return authorRelax(c, from);
      case 'move': return authorMove(c, from, ids);
      case 'bulk': return authorBulk(c, from, ids, this.bulkKind === 'received');
      case 'end': return authorEnd(c, from);
      case 'bounce': return authorBounce(c, from);
      case 'pop': return this.box ? authorPop(c, from, this.box) : null;
      case 'peek': return this.box ? authorPeek(c, from, this.box) : null;
      case 'pull': return authorPull(c, from, 'r');
      case 'dizzy': return authorDizzy(c, from, arg === true);
      default: return null;
    }
  }

  /**
   * Plays a moment. A list change always happens (the app's own UI); Pompon only joins when he may: not under reduced
   * motion, not while another mascot has the stage, not while he is in the middle of something else.
   */
  play(name: Moment, arg?: string | readonly string[] | boolean, ghost = true): boolean {
    if (this.destroyed || this.frozen) return false;
    const card = CARD_MOMENTS.has(name);
    // B, hidden behind the tab bar: he only comes out to hop to a tile (new wish, Erhalten); the rest is the list's own
    const bHidden = this.place === 'b' && this.underTiles();
    if (bHidden && ['delete', 'move', 'bulk', 'select', 'relax'].includes(name)) {
      if (card) this.plain(name, arg);
      return false;
    }
    const can = !this.still && !this.busy && this.o.arbiter.claim(this);
    if (!can) {
      if (card) this.plain(name, arg);
      else if (this.still && name === 'select') this.holdStill(NERVOUS);
      else if (this.still && name === 'relax') this.holdStill({});
      else if (!this.still) this.o.log(`· ${name}: Помпон занят — не играет`);
      return false;
    }
    if ((name === 'pop' || name === 'peek') && this.where !== 'box') {
      this.o.arbiter.free(this);
      return false;
    }
    if (this.place === 'b') {
      if (bHidden) this.hideSeat();
      else this.duck(false);
    }
    this.rig.takeOver();
    this.rig.apply(this.currentPose());
    const shot = this.author(name, ghost, arg);
    if (!shot) {
      this.rig.release(this.pose);
      this.o.arbiter.free(this);
      return false;
    }
    this.start(shot);
    return true;
  }

  private start(shot: Shot): void {
    const marks: Mark[] = [...shot.marks];
    if (shot.hold !== undefined) marks.push({ t: shot.hold, fn: () => this.onHold() });
    const player = new Player(this.rig.box, shot.tracks, shot.duration, marks, () => this.ended());
    // pause while the phone cannot be seen (tab hidden, scrolled away) — and go on from the same frame
    const watch = new Watch(this.refs.phone, player);
    this.run = { shot, player, watch };
    this.o.log(`▶ ${shot.name} (${shot.duration.toFixed(2)} с)`);
    watch.start();
  }

  private ended(): void {
    const r = this.run;
    if (!r || this.destroyed) return;
    this.run = null;
    r.watch.destroy();
    // the end pose inline first, then the animations go: the same frame, nothing keeps ticking (the mock's parts too:
    // a knocked-off lid stays where it landed; the commit then tidies the tiles)
    this.rig.apply(r.shot.end);
    for (const tr of r.shot.tracks) {
      if (!tr.name.startsWith('dom.')) continue;
      const v = (tr as Track).styleAt(r.shot.duration);
      for (const e of tr.els) applyStyle(e, v);
    }
    r.player.destroy();
    r.shot.commit();
    if (r.shot.name === 'grab') {
      // the finger still holds the ear: he stays driven (and keeps the stage), the "ай" face stays
      this.pose = { ...this.pose, ...this.stripBox(r.shot.end) };
      return;
    } else if (r.shot.keep) {
      this.pose = this.stripBox(r.shot.end);
      this.rig.release(this.pose);
    } else {
      this.pose = {};
      this.rig.release();
    }
    if (this.hidden) {
      this.hidden = false;
      this.rig.place(this.seat);
      this.duck(true, true);
    }
    if (r.shot.name === 'pop') {
      this.where = 'out';
      toast(this.refs, '→ «Neuer Wunsch» öffnet sich');
    }
    // back inside the closed box after a peek: nothing of him shows, no idle life
    if (this.place === 'empty' && this.where === 'box') this.rig.puppet.stopIdle();
    this.o.arbiter.free(this);
    this.after();
  }

  private stripBox(p: Pose): Pose {
    const out: Pose = { ...p };
    delete out.box;
    return out;
  }

  /** After a moment: the queued anger, B's hiding place. */
  private after(): void {
    if (this.angryPending) {
      this.angryPending = false;
      void this.angry();
      return;
    }
    if (this.place === 'b') this.checkDuck();
  }

  /** The list's own change without Pompon (he is busy / reduced motion): the app's plain behaviour. */
  private plain(name: Moment, arg?: string | readonly string[] | boolean): void {
    const ids = Array.isArray(arg) ? (arg as readonly string[]) : typeof arg === 'string' ? [arg] : [];
    if (this.run && CARD_MOMENTS.has(this.run.shot.name)) {
      // the running moment moves tiles too: let it arrive first (its end frame), then the change
      this.run.player.seek(this.run.shot.duration);
      this.ended();
    }
    const kind = name === 'wish' ? 'wish' : 'leave';
    const shot = authorPlain(this.ctx(false), kind, ids, this.still, name === 'received' || (name === 'bulk' && this.bulkKind === 'received'));
    const p: Player = new Player(this.refs.phone, shot.tracks, shot.duration, [], () => {
      p.destroy();
      shot.commit();
      this.side = this.side.filter((x) => x !== p);
    });
    this.side.push(p);
    p.play();
  }

  /** Reduced motion: a still pose instead of a moment (no animate()). */
  private holdStill(p: Pose): void {
    this.pose = { ...p };
    this.rig.release(this.pose);
  }

  /**
   * Freezes moment `name` at `t` seconds (frames, `&t=`): the same frame every time. The mock changes as the moment
   * needs (it is built fresh for a frame); nothing is committed.
   */
  freeze(name: Playable, t: number): Shot | null {
    if (this.destroyed) return null;
    this.refs.phone.dataset.frozen = '';
    if (this.frozen) {
      this.frozen.player.seek(t);
      this.frozenTime = t;
      return this.frozen.shot;
    }
    this.prepFor(name);
    if (this.place === 'b') {
      if ((name === 'wish' || name === 'received') && this.underTiles()) this.hideSeat();
      else this.duck(false, true);
    }
    let arg = this.argFor(name);
    if (name === 'select') this.setSelecting([this.refs.cards()[1]?.dataset.id ?? '']);
    if (name === 'move' || name === 'relax') {
      // the selection bars go as the moment starts (the app: selection mode ends with the action)
      arg = name === 'move' ? [...(this.selecting ?? [])] : undefined;
      this.setSelecting(null);
    }
    this.rig.takeOver();
    this.rig.apply(this.currentPose());
    const shot = this.author(name, true, arg);
    if (!shot) return null;
    const player = new Player(this.rig.box, shot.tracks, shot.duration);
    player.seek(t);
    this.frozen = { shot, player };
    this.frozenTime = t;
    return shot;
  }

  /** The gallery's buttons: what a moment acts on (tiles of row 1: Pompon and the tile are both in view). */
  argFor(name: Playable): string | readonly string[] | boolean | undefined {
    const ids = this.refs.cards().map((c) => c.dataset.id ?? '');
    switch (name) {
      case 'received': return ids[1] ?? ids[0];
      case 'delete': return ids[0];
      case 'move': return this.selecting ?? SEL_DEFAULT.filter((id) => ids.includes(id));
      case 'dizzy': return true;
      default: return undefined;
    }
  }

  /** Before a played (not live) moment: the mock in the state the moment starts from. */
  prepFor(name: Playable): void {
    if (name === 'end' || name === 'bounce') {
      if (this.place === 'a') {
        this.refs.screen.scrollTop = this.refs.screen.scrollHeight;
        this.where = 'end';
        this.rig.place(this.seat);
      } else if (this.place === 'b') this.refs.screen.scrollTop = this.refs.screen.scrollHeight;
      return;
    }
    if (name === 'move' || name === 'relax') {
      if (!this.selecting) {
        this.setSelecting(SEL_DEFAULT.filter((id) => this.refs.card(id)));
        this.pose = { ...NERVOUS };
        this.rig.release(this.pose);
      }
    }
    if (['wish', 'received', 'delete', 'move', 'select', 'relax'].includes(name) && this.place !== 'empty') {
      // the tiles of rows 1–2 in view (the app scrolls a new tile into view too)
      this.refs.screen.scrollTop = this.place === 'b' ? 150 : 0;
      if (this.where === 'end') {
        this.where = 'seat';
        this.rig.place(this.seat);
      }
    }
  }

  /** The gallery's ▶: a moment as a person would trigger it. */
  playButton(name: Playable): void {
    if (this.busy || this.frozen) return;
    if ((name === 'pop' || name === 'peek') && this.place !== 'empty') return;
    this.prepFor(name);
    if (name === 'select') {
      this.enterSelection(this.refs.cards()[1]?.dataset.id ?? '');
      return;
    }
    if (name === 'relax') {
      this.exitSelection('relax');
      return;
    }
    if (name === 'move') {
      this.exitSelection('move');
      return;
    }
    if (name === 'delete') {
      const id = this.argFor('delete');
      if (typeof id === 'string') toast(this.refs, `„${this.titleOf(id)}“ gelöscht · Rückgängig`);
    }
    if (this.place === 'b') this.checkDuck();
    this.play(name, this.argFor(name));
  }

  private titleOf(id: string): string {
    return this.refs.card(id)?.querySelector('.lpc-title')?.textContent ?? '';
  }

  // ------------------------------------------------------------------------------------------------ the approved anger (5 taps)

  private async angry(): Promise<void> {
    if (this.busy || this.still || !this.o.arbiter.claim(this)) return;
    this.ownScene = true;
    this.rig.release();
    this.pose = {};
    this.haptic('warning', '5 касаний — злится (одобренная сцена angry)');
    try {
      await this.rig.puppet.play('angry');
    } finally {
      this.ownScene = false;
      this.o.arbiter.free(this);
      this.after();
    }
  }

  // ------------------------------------------------------------------------------------------------ selection mode

  private setSelecting(ids: string[] | null): void {
    this.selecting = ids;
    const ph = this.refs.phone;
    if (!ids) {
      delete ph.dataset.selecting;
      for (const c of this.refs.cards()) delete c.dataset.on;
      return;
    }
    ph.dataset.selecting = this.still ? 'calm' : 'jiggle';
    for (const c of this.refs.cards()) {
      if (ids.includes(c.dataset.id ?? '')) c.dataset.on = '';
      else delete c.dataset.on;
    }
    const count = ph.querySelector('[data-sel-count]');
    if (count) count.textContent = `${ids.length} ausgewählt`;
  }

  enterSelection(id: string): void {
    if (this.selecting || !id) return;
    this.setSelecting([id]);
    this.haptic('select', 'долгое нажатие — режим выбора (это уже есть в приложении)');
    this.play('select');
  }

  private exitSelection(kind: 'relax' | 'move' | 'received' | 'delete'): void {
    const ids = this.selecting ?? [];
    this.setSelecting(null);
    if (kind === 'move') {
      toast(this.refs, ids.length === 1 ? `In „${MOVE_TARGET}“ verschoben` : `${ids.length} Wünsche in „${MOVE_TARGET}“ verschoben`);
      this.play('move', ids);
    } else if (kind === 'relax') this.play('relax');
    else {
      toast(this.refs, kind === 'received' ? `${ids.length} als erhalten markiert` : `${ids.length} Wünsche gelöscht`);
      this.bulkKind = kind;
      this.play('bulk', ids, false);
    }
  }

  private bulkKind: 'received' | 'delete' = 'delete';

  // ------------------------------------------------------------------------------------------------ B: hiding behind the tab bar

  /** B: while a tile or a button is under him, he slips down behind the tab bar; free again → back up. */
  private checkDuck(): void {
    if (this.place !== 'b' || this.busy || this.frozen) return;
    const hit = this.underTiles();
    this.duck(hit);
    if (!hit && this.atBottom()) this.maybeEnd();
  }

  /** B: is a tile or a button under his corner right now? */
  private underTiles(): boolean {
    if (this.place !== 'b') return false;
    const me = bodyRect({ x: PHONE_W - 46, y: TAB.top - 4 });
    const r = this.refs;
    const things = [...r.cards(), ...(r.received ? [r.received] : []), ...(r.addBtn ? [r.addBtn] : [])];
    return things.some((el) => overlaps(me, rectIn(el, r.layer)));
  }

  /** B: the box moves behind the tab bar instead of the duck wrapper (the same picture) — a moment starts there. */
  private hideSeat(): void {
    this.hidden = true;
    this.duck(false, true);
    this.rig.hit.style.pointerEvents = 'none';
    this.rig.place(this.seat);
  }

  private duck(on: boolean, instant = false): void {
    if (this.ducked === on && !instant) return;
    this.ducked = on;
    const d = this.rig.duck;
    if (instant || this.still) d.style.transition = 'none';
    d.style.transform = on ? `translateY(${DUCK}px)` : '';
    this.rig.hit.style.pointerEvents = on ? 'none' : 'auto';
    if (instant || this.still) {
      void d.offsetWidth;
      d.style.transition = '';
    }
  }

  get isDucked(): boolean {
    return this.ducked;
  }

  // ------------------------------------------------------------------------------------------------ the end of the list

  private atBottom(): boolean {
    const s = this.refs.screen;
    return s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
  }

  private maybeEnd(): void {
    const now = performance.now();
    if (now - this.lastEnd < 8000 || this.busy || this.selecting) return;
    this.lastEnd = now;
    this.play('end');
  }

  /** A: when his seat in the header scrolled away and the end of the list is in view, he is found there. */
  private checkEnd(): void {
    if (this.place !== 'a' || this.busy || this.frozen || this.selecting) return;
    const r = this.refs;
    if (!r.seatRow || !r.endSpot) return;
    const s = r.screen.getBoundingClientRect();
    const top = s.top + 96;
    const bottom = s.top + TAB.top;
    const seat = r.seatRow.getBoundingClientRect();
    const end = r.endSpot.getBoundingClientRect();
    const seatSeen = seat.bottom > top && seat.top < bottom;
    const endSeen = end.top >= top - 10 && end.bottom - 30 <= bottom;
    if (this.where === 'seat' && !seatSeen && endSeen) {
      // unseen move: neither place is on screen at the same time
      this.where = 'end';
      this.rig.place(this.seat);
      this.maybeEnd();
    } else if (this.where === 'end' && seatSeen && !(end.top < bottom && end.bottom > top)) {
      this.where = 'seat';
      this.rig.place(this.seat);
    }
  }

  private bounce(): void {
    const now = performance.now();
    if (now - this.lastBounce < 700 || this.busy) return;
    const seen = this.place === 'b' ? !this.ducked : this.where === 'end';
    if (!seen) return;
    this.lastBounce = now;
    this.play('bounce');
  }

  // ------------------------------------------------------------------------------------------------ live gestures

  setLive(on: boolean): void {
    this.live = on;
  }

  /** The phone was shaken (devicemotion, or the gallery's "Schütteln"). */
  shake(simulated: boolean): void {
    if (!this.busy) this.play('dizzy', simulated);
  }

  private local(e: PointerEvent | MouseEvent): Vec {
    const b = this.refs.layer.getBoundingClientRect();
    return { x: e.clientX - b.left - this.refs.layer.clientLeft, y: e.clientY - b.top - this.refs.layer.clientTop };
  }

  private wire(): void {
    const r = this.refs;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const hit = this.rig.hit;
    on(hit, 'pointerdown', (e) => this.onDown(e));
    on(hit, 'pointermove', (e) => this.onMove(e));
    on(hit, 'pointerup', (e) => this.onUp(e));
    on(hit, 'pointercancel', () => this.onCancel());
    on(hit, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.grab) this.stopStroke();
    });
    on(hit, 'contextmenu', (e) => e.preventDefault());
    // the list
    if (r.addBtn) on(r.addBtn, 'click', () => {
      if (!this.live) return;
      if (this.place === 'b') this.checkDuck();
      this.play('wish', undefined, false);
    });
    if (r.bigAdd) on(r.bigAdd, 'click', () => {
      if (!this.live) return;
      if (!this.play('pop', undefined, false)) toast(this.refs, '→ «Neuer Wunsch» öffnet sich');
    });
    if (r.grid) {
      on(r.grid, 'click', (e) => this.onGridClick(e));
      on(r.grid, 'pointerdown', (e) => this.onGridDown(e));
      on(r.grid, 'pointermove', (e) => {
        if (this.long && Math.hypot(e.clientX - this.long.x, e.clientY - this.long.y) > 8) this.cancelLong();
      });
      on(r.grid, 'pointerup', () => this.cancelLong());
      on(r.grid, 'pointercancel', () => this.cancelLong());
      on(r.grid, 'contextmenu', (e) => e.preventDefault());
    }
    on(r.phone, 'click', (e) => this.onPhoneClick(e));
    on(r.screen, 'scroll', () => {
      if (this.place === 'b') this.checkDuck();
      if (this.place === 'a') this.checkEnd();
    }, { passive: true });
    on(r.screen, 'wheel', (e) => {
      if (this.live && e.deltaY > 0 && this.atBottom()) this.bounce();
    }, { passive: true });
    let ty = NaN;
    on(r.screen, 'touchstart', (e) => (ty = e.touches[0]?.clientY ?? NaN), { passive: true });
    on(r.screen, 'touchmove', (e) => {
      const y = e.touches[0]?.clientY ?? NaN;
      if (this.live && this.atBottom() && ty - y > 24) {
        ty = NaN;
        this.bounce();
      }
    }, { passive: true });
  }

  private onDown(e: PointerEvent): void {
    if (!this.live || this.destroyed) return;
    const p = this.local(e);
    const f = this.rig.at;
    const dx = p.x - f.x;
    const dy = p.y - f.y;
    const inBox = this.place === 'empty' && this.where === 'box';
    // an ear tip: the lop ears hang beside the head, 14–24 px from his middle, 27–50 px above his feet (at 96 px)
    if (!inBox && !this.busy && !this.still && Math.abs(dx) >= 14 && dy <= -27 && dy >= -50) {
      this.startGrab(dx > 0 ? 'r' : 'l', e);
      return;
    }
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    this.stroke.len = 0;
    this.stroke.flips = 0;
    this.stroke.lastX = e.clientX;
  }

  private onMove(e: PointerEvent): void {
    if (!this.live || this.destroyed) return;
    if (this.grab && e.pointerId === this.grab.id) {
      this.followEar(e);
      return;
    }
    const pressed = this.press && e.pointerId === this.press.id;
    if (pressed && this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 8) this.press.moved = true;
    // in the closed box there is nobody to stroke (a tap on the box: he peeks)
    if (this.place === 'empty' && this.where === 'box') return;
    // a mouse may stroke him without pressing (hovering over him); a finger strokes while it touches
    if (!pressed && e.pointerType !== 'mouse') return;
    const now = performance.now();
    const s = this.stroke;
    if (now - s.lastT > 450) {
      s.len = 0;
      s.flips = 0;
      s.lastX = e.clientX;
      s.lastDx = 0;
    }
    const dx = Number.isNaN(s.lastX) ? 0 : e.clientX - s.lastX;
    s.lastX = e.clientX;
    s.lastT = now;
    s.len += Math.abs(dx);
    if (Math.abs(dx) > 2) {
      if (s.lastDx && Math.sign(dx) !== Math.sign(s.lastDx)) s.flips += 1;
      s.lastDx = dx;
    }
    if (!s.on && ((s.len > 30 && s.flips >= 1) || s.len > 70)) this.startStroke();
    if (s.on) {
      // he leans into the hand: toward the side the finger is on (a CSS transition on transform)
      const k = Math.max(-1, Math.min(1, (this.local(e).x - this.rig.at.x) / 22));
      if (!this.still) this.rig.lean.style.transform = `rotate(${(k * 4).toFixed(2)}deg)`;
      window.clearTimeout(s.idle);
      s.idle = window.setTimeout(() => this.stopStroke(), 320);
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.live || this.destroyed) return;
    if (this.grab && e.pointerId === this.grab.id) {
      this.endGrab(false);
      return;
    }
    const p = this.press;
    this.press = null;
    if (this.stroke.on) {
      this.stopStroke();
      return;
    }
    if (!p || p.id !== e.pointerId || p.moved || performance.now() - p.t > 400) return;
    if (this.place === 'empty' && this.where === 'box') {
      // a tap on the closed box: he peeks out at once
      if (!this.busy) this.play('peek', undefined, false);
      return;
    }
    // a tap: a boop (5 taps within 2.5 s → the approved anger, after whatever plays)
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length >= 5) {
      this.taps = [];
      if (this.busy) this.angryPending = true;
      else void this.angry();
      return;
    }
    if (!this.busy) this.play('boop', undefined, false);
  }

  private onCancel(): void {
    if (this.grab) this.endGrab(false);
    this.press = null;
    this.stopStroke();
  }

  private startStroke(): void {
    const s = this.stroke;
    if (s.on) return;
    if (this.busy && this.run?.shot.name !== 'stroke') return;
    s.on = true;
    s.held = false;
    if (!this.run) this.play('stroke', undefined, false);
  }

  private onHold(): void {
    // the finger still strokes: the moment waits at its "content" frame (he keeps leaning into the hand)
    if (this.stroke.on && this.run?.shot.name === 'stroke') {
      this.run.player.pause();
      this.stroke.held = true;
    }
  }

  private stopStroke(): void {
    const s = this.stroke;
    window.clearTimeout(s.idle);
    if (!s.on) return;
    s.on = false;
    this.rig.lean.style.transform = '';
    if (s.held && this.run?.shot.name === 'stroke') {
      s.held = false;
      // the hand is gone: the sigh
      this.run.player.play();
    }
  }

  /** A finger takes an ear tip: "ай" plays (0.2 s), the ear itself follows the finger from now on (inline). */
  private startGrab(side: 'l' | 'r', e: PointerEvent): void {
    if (this.busy || this.still || !this.o.arbiter.claim(this)) return;
    this.grab = { side, id: e.pointerId };
    try {
      this.rig.hit.setPointerCapture(e.pointerId);
    } catch {
      /* no capture (synthetic events) */
    }
    if (this.place === 'b') this.duck(false);
    this.rig.takeOver();
    const from = this.currentPose();
    this.rig.apply(from);
    this.start(authorGrab(this.ctx(false), from, side));
    this.followEar(e);
  }

  private followEar(e: PointerEvent): void {
    const g = this.grab;
    if (!g) return;
    const { pose, slip } = earFollow(g.side, this.local(e), this.rig.at);
    const part: PartName = g.side === 'r' ? 'earR' : 'earL';
    this.rig.apply({ [part]: pose });
    this.pose = { ...this.pose, [part]: pose };
    if (slip) {
      this.haptic('tap', 'ушко выскользнуло само');
      this.endGrab(true);
    }
  }

  private endGrab(slipped: boolean): void {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    try {
      this.rig.hit.releasePointerCapture(g.id);
    } catch {
      /* already released */
    }
    // the grab's "ай" may still be on its way: from the frame on screen
    const from = this.currentPose();
    if (this.run) {
      const r = this.run;
      this.run = null;
      r.watch.destroy();
      r.player.destroy();
    }
    this.rig.apply(from);
    const shot = authorRelease(this.ctx(false), from, g.side);
    this.o.log(slipped ? '· потянул слишком сильно — ушко выскользнуло' : '· отпустил ушко');
    this.start(shot);
  }

  // the grid: ⋯, long press, selection
  private onGridDown(e: PointerEvent): void {
    if (!this.live) return;
    const open = (e.target as Element).closest('.lpc-open');
    const li = open?.closest<HTMLElement>('.lpc');
    if (!open || !li || this.selecting) return;
    this.cancelLong();
    const id = li.dataset.id ?? '';
    this.long = {
      id,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        this.long = null;
        this.eatClick = true;
        this.enterSelection(id);
      }, 450),
    };
  }

  private cancelLong(): void {
    if (this.long) window.clearTimeout(this.long.timer);
    this.long = null;
  }

  private onGridClick(e: MouseEvent): void {
    if (!this.live) return;
    const t = e.target as Element;
    const li = t.closest<HTMLElement>('.lpc');
    if (!li) return;
    if (this.eatClick) {
      this.eatClick = false;
      return;
    }
    const id = li.dataset.id ?? '';
    if (t.closest('.lpc-more')) {
      this.openSheet(id);
      return;
    }
    if (this.selecting) {
      const next = this.selecting.includes(id) ? this.selecting.filter((x) => x !== id) : [...this.selecting, id];
      this.haptic('select', 'выбор');
      this.setSelecting(next);
    }
  }

  private openSheet(id: string): void {
    this.sheetFor = id;
    const h = this.refs.sheet.querySelector('h5');
    if (h) h.textContent = this.titleOf(id);
    this.refs.phone.dataset.sheet = '';
  }

  private closeSheet(): void {
    delete this.refs.phone.dataset.sheet;
  }

  private onPhoneClick(e: MouseEvent): void {
    if (!this.live) return;
    const t = e.target as Element;
    if (t.closest('.lpp-dim')) {
      this.closeSheet();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act && this.sheetFor) {
      const id = this.sheetFor;
      this.sheetFor = null;
      this.closeSheet();
      if (act === 'received') {
        toast(this.refs, `„${this.titleOf(id)}“ ist erhalten – schön!`);
        this.play('received', id, false);
      } else if (act === 'delete') {
        toast(this.refs, `„${this.titleOf(id)}“ gelöscht · Rückgängig`);
        this.play('delete', id, false);
      } else if (act === 'select') this.enterSelection(id);
      return;
    }
    if (!this.selecting) return;
    if (t.closest('[data-sel-done]')) this.exitSelection('relax');
    else if (t.closest('[data-sel-all]')) this.setSelecting(this.refs.cards().map((c) => c.dataset.id ?? ''));
    else if (t.closest('[data-sel-move]')) this.exitSelection('move');
    else if (t.closest('[data-sel-received]')) this.exitSelection('received');
    else if (t.closest('[data-sel-delete]')) this.exitSelection('delete');
  }

  // ------------------------------------------------------------------------------------------------ settings

  setStill(still: boolean): void {
    if (this.still === still) return;
    this.still = still;
    if (this.run) {
      this.run.player.seek(this.run.shot.duration);
      this.ended();
    }
    this.rig.setStill(still);
    if (this.place === 'empty' && this.where === 'box') this.restInBox();
    if (this.selecting) this.refs.phone.dataset.selecting = still ? 'calm' : 'jiggle';
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelLong();
    window.clearTimeout(this.stroke.idle);
    for (const f of this.off) f();
    this.run?.watch.destroy();
    this.run?.player.destroy();
    this.frozen?.player.destroy();
    for (const p of this.side) p.destroy();
    this.peeks?.destroy();
    this.o.arbiter.free(this);
    this.o.arbiter.all.delete(this);
    this.rig.destroy();
    this.refs.phone.remove();
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
