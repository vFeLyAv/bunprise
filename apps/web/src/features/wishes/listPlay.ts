// «Помпон в открытом списке» in the app (Felix 31.10: «Мне все анимации нравятся»; design
// docs/design/2026-10-31-list-play.md, gallery ?screens=listplay). A lazy chunk (./ListPompon.tsx loads it with the
// owner's own list screen); the puppet and every moment are @bunprise/mascot/listplay.
//
// Where: place A — in the list header, on the right end of the row with the list's icon and date (96 px, fawn, the
// fluffy cheeks of mascot-ui/pompon.ts). At rest he covers nothing; only his body catches a finger (52 × 58 px), never
// a button. A long list: he is found again under its end (an unseen move while neither place is on screen — never two
// Pompons). The empty list: he waits in a closed gift box instead of the sleeping hamster.
//
// What he answers (each one finite timeline, transform / opacity only):
//   on him      rub = stroke (he leans into the hand, purrs, a sigh) · tap = boop (5 taps in 2.5 s → the approved
//               `angry`) · press an ear tip and pull = the ear («везде, где есть Помпон»: mascot-ui/pomponPlay.ts has it
//               for every other Pompon) · the phone shaken = dizzy (the one listener of pomponPlay.ts)
//   the list    a new wish (the owner's own, back from the new-wish screen): he hops over and pats it into place — this
//               replaces the carried gift (mascot-ui/carry.ts) in this list · «Erhalten» (the tile's ⋯): he stamps a ✓,
//               a mini binky, back; then the tile leaves for «Erhalten» · Löschen: he waves "bye", dusts off his paws ·
//               selection mode: a little startle, he holds his ears and trembles; «Verschieben»: he hops after the
//               tiles (they fly to the edge); «Fertig» / Erhalten / Löschen: he lets go · the end of a long list: he
//               looks up, waves «Das war’s!»; pulling on there: a tiny bounce
//   empty list  now and then (the first one ≈ 1 s after the screen opened, then every 7 – 12 s, only when he can be
//               seen and nothing else plays) the lid lifts a crack and he peeks; a tap on the box = a peek; the big "+"
//               = he knocks the lid off and jumps out, then the new-wish screen opens
// Rules: one mascot animates at a time (mascot-ui/stage.ts: user moments are 'response', the box's peeks
// 'decoration'); paused while off screen / the tab is hidden (the package's Watch); still poses («Weniger», battery
// saver, the system) = no moment at all — the calm poses of the gallery (^ ^, holding his ears in selection mode, the
// lid lifted a crack in the empty box); a sheet open = paused. Haptics only through lib/haptics, only the design's:
// rub 'select', nose / ear 'tap', the second pat 'select', the stamp the app's own «Erhalten» success.
//
// SECRECY: he only ever answers the owner's own actions on her own list (add, received, delete, select, scroll,
// touch). Nothing here reads, receives or could receive anything about reservations — listPlay.secrecy.test.ts.
import {
  authorBoop, authorBounce, authorBulk, authorDelete, authorDizzy, authorEnd, authorGrab, authorMove, authorPeek, authorPop,
  authorReceived, authorRelax, authorRelease, authorSelect, authorStroke, authorWish, earFollow, earTipAt, feetAt, LID_CRACK, mountGiftBox, mountPompon,
  NERVOUS, Player, poseAt, Watch,
  type Ctx, type Haptic, type Mark, type MountedGiftBox, type PartName, type Pose, type Rect, type Rig, type Shot, type Side, type Vec,
} from '@bunprise/mascot/listplay'
import type { MomentClass } from '@bunprise/mascot'
import { feedback, haptic } from '../../lib/haptics'
import { playsInApp } from '../mascot-ui/inGallery'
import { onScreen, onShake } from '../mascot-ui/pomponPlay'
import { registerMascot, releaseStage, requestStage, setMascotIdle, unregisterMascot, type StageMember } from '../mascot-ui/stage'

/** The empty box's first peek after the screen opened (ms) — then every 7 – 12 s. */
export const FIRST_PEEK_MS = 1000
export const PEEK_MIN_MS = 7000
export const PEEK_SPREAD_MS = 5000
/** «Das war’s!» at most this often (ms). */
export const END_GAP_MS = 8000
/** The new-wish screen opens this long after "+" (he has landed, the stars show). */
export const POP_NAVIGATE_S = 1.38
/** He can hop to a tile this far away (px) — farther, he cheers from his seat. */
export const REACH_PX = 520
/** The box's place in the empty list (the EmptyState's mascot slot): this wide, this high. */
export const BOX_SLOT = { w: 196, h: 118 } as const

/** The stamp's mark: a green ✓ in a round, slightly uneven ink ring (the gallery's SEAL_SVG). */
const SEAL_SVG = '<svg viewBox="-23 -23 46 46" width="46" height="46" aria-hidden="true" focusable="false"><circle r="19" fill="rgba(59,152,94,.12)" stroke="#3B985E" stroke-width="2.6" stroke-dasharray="20 2.4 9 1.8"/><path d="M-9 0.5l6 6 12-13" fill="none" stroke="#3B985E" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export type ListPomponMode = 'list' | 'empty'

/**
 * Each moment can go back to the mascot gallery by name (mascot-ui/inGallery.ts; design §3): a moment held back there
 * simply does not play — the list changes by itself.
 */
export const GALLERY_NAME: Readonly<Partial<Record<Shot['name'], string>>> = {
  stroke: 'list-stroke', boop: 'list-boop', grab: 'list-ear', dizzy: 'shake',
  wish: 'list-wish', received: 'list-received', delete: 'list-delete',
  select: 'list-select', relax: 'list-select', move: 'list-select', bulk: 'list-select',
  end: 'list-end', bounce: 'list-end', peek: 'list-empty', pop: 'list-empty',
}

export interface ListPomponOptions {
  mode: ListPomponMode
  /** where his box lives (position: relative; it scrolls with the list): the list screen's content / the box slot */
  layer: HTMLElement
  /** list: the header's row with the icon and the date — he sits on its right end (the title block's width) */
  seatRow?: () => HTMLElement | null
  /** list: the spot under a long list where he is found again */
  endSpot?: () => HTMLElement | null
  /** what scrolls (the page) */
  scroller: HTMLElement | Window
  still: boolean
  /** «Das war’s!» in the person's language */
  endText: string
  /** the bars' insets (px) — a tile under them is out of his reach */
  insets?: () => { top: number; bottom: number }
  /** a moment really played (tests) */
  onMoment?: (name: Shot['name']) => void
}

export interface ReceivedCues {
  /** the stamp touches the tile: «✓ Erhalten» shows now */
  onStamp(): void
  /** he is back on his seat: the tile may leave for «Erhalten» */
  onBack(): void
}

export interface ListPompon {
  /** a moment plays (or a finger holds him) */
  readonly busy: boolean
  /** on screen now (he can be seen: a moment would be seen) */
  readonly seen: boolean
  setStill(still: boolean): void
  /** a sheet is open: nothing plays, his idle stops */
  setPaused(paused: boolean): void
  /** the new wish's tile ([data-wish-id]) — he pats it into place. False: not now (the tile simply shows). */
  wish(tile: HTMLElement): boolean
  /** «Erhalten» from the tile's ⋯. False: not now (the app's plain change). */
  received(tile: HTMLElement, cues: ReceivedCues): boolean
  /** a tile is deleted / leaves this list (its box on screen before it goes, client px) */
  remove(rect: DOMRectReadOnly): boolean
  /** selection mode on (he holds his ears) / off: «Fertig», «Verschieben» (the tiles' boxes) or Erhalten / Löschen */
  selection(on: boolean, ending?: { kind: 'move' | 'bulk'; rects: readonly DOMRectReadOnly[] }): void
  /** the empty list's "+": he jumps out of the box, then `then()` (the new-wish screen). False: `then` is the caller's. */
  pop(then: () => void): boolean
  /** at night (mascot-ui/night.ts): the box's peeks wait until a tap woke him (10 min) */
  setNight(sleeps: boolean, awakeUntil: number): void
  destroy(): void
}

interface Run {
  shot: Shot
  player: Player
  watch: Watch
  away: boolean
}

/** `el`'s box in px of `layer` (its padding box: what an absolutely positioned child of `layer` sees). */
export function rectIn(el: Element | DOMRectReadOnly, layer: HTMLElement): Rect {
  const a = el instanceof Element ? el.getBoundingClientRect() : el
  const b = layer.getBoundingClientRect()
  return { x: a.left - b.left - layer.clientLeft, y: a.top - b.top - layer.clientTop, w: a.width, h: a.height }
}

function cssPx(name: string): number {
  if (typeof getComputedStyle !== 'function') return 0
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
}

/**
 * The bars over the list — px from the viewport's edges: the top bar; at the bottom the tab bar (only where it shows:
 * <html data-tabbar>, nav/TabBar.tsx — a list screen has none) or selection mode's action bar.
 */
export function barInsets(): { top: number; bottom: number } {
  const html = document.documentElement
  const bar = html.hasAttribute('data-tabbar') || html.hasAttribute('data-wish-selecting') ? cssPx('--tabbar-h') || 56 : 0
  return { top: (cssPx('--topbar-h') || 52) + cssPx('--sa-top'), bottom: bar + cssPx('--sa-bottom') + 8 }
}

export function createListPompon(o: ListPomponOptions): ListPompon {
  return new ListPomponImpl(o)
}

class ListPomponImpl implements ListPompon, StageMember {
  private readonly rig: Rig
  private readonly id = Symbol('list-pompon')
  private still: boolean
  private paused = false
  private run: Run | null = null
  /** what stays inline while he rests (selection: holding his ears) */
  private pose: Pose = {}
  private where: 'seat' | 'end' | 'box' | 'out' = 'seat'
  private selecting = false
  private claimed = false
  private lastEnd: number
  private lastBounce = -Infinity
  private taps: number[] = []
  private angryPending = false
  private ownScene = false
  private grab: { side: Side; id: number } | null = null
  private stroke = { on: false, held: false, len: 0, flips: 0, lastX: Number.NaN, lastDx: 0, lastT: 0, idle: undefined as ReturnType<typeof setTimeout> | undefined }
  private press: { id: number; x: number; y: number; t: number; moved: boolean } | null = null
  private box: MountedGiftBox | null = null
  private bubble: HTMLElement | null = null
  private seal: HTMLElement | null = null
  private peekTimer: ReturnType<typeof setTimeout> | undefined
  private firstPeek = true
  private night = { sleeps: false, awakeUntil: -Infinity }
  private afterPop: (() => void) | null = null
  private readonly off: Array<() => void> = []
  private destroyed = false

  constructor(private readonly o: ListPomponOptions) {
    this.still = o.still
    this.rig = mountPompon(o.layer, { still: o.still })
    this.rig.box.style.zIndex = '4'
    if (o.mode === 'empty') this.buildBox()
    // «Das war’s!» only after a person scrolled there (not because the screen opened at the end)
    this.lastEnd = performance.now()
    // he is a member of the app's stage himself (one mascot animates at a time)
    registerMascot(this.id, this, !this.still)
    this.rest()
    this.wire()
    this.off.push(onShake({ visible: () => this.where !== 'box' && this.seen, shake: () => this.play('dizzy', (c, from) => authorDizzy(c, from)) }))
    if (this.box) this.armPeek()
  }

  // ------------------------------------------------------------------------------------------------ places

  /** His feet at rest, in px of his layer. */
  private get seat(): Vec {
    if (this.box) return this.where === 'out' ? this.box.land : this.box.inBox
    const layer = this.o.layer
    const endSpot = this.o.endSpot?.()
    if (this.where === 'end' && endSpot?.isConnected) {
      const e = rectIn(endSpot, layer)
      return { x: e.x + e.w - 46, y: e.y + e.h - 14 }
    }
    const row = this.o.seatRow?.()
    if (!row) return { x: layer.clientWidth - 30, y: 56 }
    const r = rectIn(row, layer)
    const block = rectIn(row.parentElement ?? row, layer)
    // A: on the right end of the icon row, feet on its baseline (the row ends where the title block ends)
    return { x: block.x + block.w - 30, y: r.y + r.h - 2 }
  }

  private rest(): void {
    if (this.destroyed) return
    if (this.box && this.where === 'box') {
      this.restInBox()
      return
    }
    this.rig.place(this.seat)
  }

  /**
   * The empty list at rest: the box is closed, he waits inside, unseen (his idle life stops — nothing of him shows);
   * now and then a peek. Still poses: no peek — the lid lifted a crack with his calm eyes (^ ^) looking out of it.
   */
  private restInBox(): void {
    const box = this.box
    if (!box) return
    this.where = 'box'
    this.pose = {}
    this.rig.release()
    this.rig.puppet.stopIdle()
    box.lidInner.style.transform = this.still ? `translate(${LID_CRACK.x ?? 0}px, ${LID_CRACK.y ?? 0}px) rotate(${LID_CRACK.r ?? 0}deg)` : ''
    this.rig.place(this.still ? box.peekAt : box.inBox)
  }

  private buildBox(): void {
    const layer = this.o.layer
    // the box (180 × 110) sits in the middle of the slot, its floor on the slot's bottom; he lands right of it
    const x = Math.round((layer.clientWidth || BOX_SLOT.w) / 2 - 12 - 82)
    const y = Math.round((layer.clientHeight || BOX_SLOT.h) - 106)
    this.box = mountGiftBox(layer, { x, y })
    this.where = 'box'
  }

  // ------------------------------------------------------------------------------------------------ state

  // ---- the stage (mascot-ui/stage.ts): he is busy while a moment plays or a finger holds his ear
  get busy(): boolean {
    return !!this.run || this.ownScene || !!this.grab
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  /** a moment waits unseen (off screen, the tab hidden) */
  get suspended(): boolean {
    return this.run?.watch.suspended ?? false
  }

  stopIdle(): void {
    this.idle(false)
  }

  startIdle(): void {
    this.idle(true)
  }

  /** The stage needs him elsewhere (a 'work' moment): his moment jumps to its end. */
  interrupt(): void {
    this.cutShort()
  }

  get seen(): boolean {
    if (this.destroyed) return false
    const target = this.where === 'box' && this.box ? this.box.front : this.rig.hit
    if (!onScreen(target)) return false
    const r = target.getBoundingClientRect()
    const bars = (this.o.insets ?? barInsets)()
    return r.bottom > bars.top && r.top < window.innerHeight - bars.bottom
  }

  /** His own idle life (blink, glance) — the stage's turn for him; in the closed box the peeks are his idle. */
  private idle(on: boolean): void {
    if (this.destroyed) return
    // (in the closed box nothing of him shows: the peeks ask the stage themselves, as a 'decoration')
    if (this.where === 'box') return
    if (this.still || this.rig.driven || this.paused) return
    if (on) this.rig.puppet.startIdle()
    else this.rig.puppet.stopIdle()
  }

  private haptic = (kind: Haptic): void => {
    // the app's own «Erhalten» success (with its sound on an iPhone), everything else a plain tick
    if (kind === 'success' || kind === 'warning') feedback(kind)
    else haptic(kind)
  }

  private ctx(): Ctx {
    return { rig: this.rig, seat: this.seat, ghost: false, haptic: this.haptic }
  }

  /** The pose on screen right now (the running moment's frame + what is inline). */
  private currentPose(): Pose {
    const base: Pose = { ...this.pose, box: feetAt(this.rig.at) }
    return this.run ? poseAt(this.run.shot, this.run.player.time, base) : base
  }

  // ------------------------------------------------------------------------------------------------ playing

  /**
   * Plays a moment — only when he may: not under still poses, not mid-something, and the stage is his; not while a
   * sheet is open — unless it is the owner's own action on the list (`own`: the menu's sheet is just closing).
   * `away` = he leaves his seat (a tile moment): his body lets every touch through meanwhile (the tile stays tappable).
   */
  private play(name: Shot['name'], author: (c: Ctx, from: Pose) => Shot | null, cls: MomentClass = 'response', away = false, own = false): boolean {
    if (this.destroyed || this.still || (this.paused && !own) || this.busy || !playsInApp(GALLERY_NAME[name] ?? name)) return false
    if (!requestStage(this.id, cls)) return false
    this.claimed = true
    this.rig.takeOver()
    const from = this.currentPose()
    this.rig.apply(from)
    const shot = author(this.ctx(), from)
    if (!shot) {
      this.rig.release(this.pose)
      this.free()
      return false
    }
    this.start(shot, away)
    this.o.onMoment?.(name)
    return true
  }

  private start(shot: Shot, away = false): void {
    const marks: Mark[] = [...shot.marks]
    if (shot.hold !== undefined) marks.push({ t: shot.hold, fn: () => this.onHold() })
    if (shot.name === 'pop') marks.push({ t: Math.min(shot.duration, POP_NAVIGATE_S), fn: () => this.popDone() })
    const player = new Player(this.rig.box, shot.tracks, shot.duration, marks, () => this.ended())
    // pause while he cannot be seen (tab hidden, scrolled away) — and go on from the same frame
    const watch = new Watch(this.rig.box, player)
    this.run = { shot, player, watch, away }
    if (away) this.rig.hit.style.pointerEvents = 'none'
    watch.start()
  }

  private stopRun(): Run | null {
    const r = this.run
    this.run = null
    if (!r) return null
    r.watch.destroy()
    r.player.destroy()
    if (r.away) this.rig.hit.style.pointerEvents = ''
    return r
  }

  private ended(): void {
    const r = this.run
    if (!r || this.destroyed) return
    // the end pose inline first, then the animations go: the same frame, nothing keeps ticking (a knocked-off lid
    // stays where it landed; the stamp's mark is faded out)
    this.rig.apply(r.shot.end)
    for (const tr of r.shot.tracks) {
      if (!tr.name.startsWith('dom.')) continue
      const v = tr.styleAt(r.shot.duration)
      for (const e of tr.els) {
        const st = (e as HTMLElement).style
        if (v.transform !== undefined) st.transform = v.transform
        if (v.opacity !== undefined) st.opacity = v.opacity
      }
    }
    this.stopRun()
    r.shot.commit()
    if (r.shot.name === 'grab') {
      // the finger still holds the ear: he stays driven (and keeps the stage), the "ай" face stays
      this.pose = { ...this.pose, ...this.stripBox(r.shot.end) }
      return
    }
    if (r.shot.keep) {
      this.pose = this.stripBox(r.shot.end)
      this.rig.release(this.pose)
    } else {
      this.pose = {}
      this.rig.release()
    }
    if (r.shot.name === 'pop') {
      this.where = 'out'
      this.popDone()
    }
    // back inside the closed box after a peek: nothing of him shows, no idle life
    if (this.where === 'box') this.rig.puppet.stopIdle()
    this.free()
    this.after()
  }

  /** The stage needs him elsewhere (a 'work' moment), or he must stop: the moment jumps to its end. */
  private cutShort(): void {
    if (this.grab) this.endGrab(true)
    const r = this.run
    if (!r) return
    r.player.seek(r.shot.duration)
    this.ended()
  }

  private free(): void {
    if (!this.claimed) return
    this.claimed = false
    releaseStage(this.id)
  }

  private stripBox(p: Pose): Pose {
    const out: Pose = { ...p }
    delete out.box
    return out
  }

  private after(): void {
    if (this.angryPending) {
      this.angryPending = false
      void this.angry()
      return
    }
    if (this.box && this.where === 'box') this.armPeek()
  }

  /** Still poses: a pose instead of a moment (not one animate() call). */
  private holdStill(p: Pose): void {
    this.pose = { ...p }
    this.rig.release(this.pose)
  }

  // ------------------------------------------------------------------------------------------------ the list's moments

  /** Can he hop to a spot? It and he (standing there) between the bars, not too far — else he answers from his seat. */
  private reachable(feet: Vec): boolean {
    const layer = this.o.layer.getBoundingClientRect()
    const y = layer.top + this.o.layer.clientTop + feet.y
    const bars = (this.o.insets ?? barInsets)()
    return y - 58 >= bars.top + 4 && y <= window.innerHeight - bars.bottom - 6 && Math.hypot(feet.x - this.seat.x, feet.y - this.seat.y) <= REACH_PX
  }

  private onTile(tile: HTMLElement, at: number): { photo: Rect; feet: Vec; media: HTMLElement } {
    const media = tile.querySelector<HTMLElement>('.wt-media') ?? tile
    const photo = rectIn(media, this.o.layer)
    return { photo, feet: { x: photo.x + photo.w * at, y: photo.y + photo.h - 3 }, media }
  }

  /** On his seat in the header, on screen — only then does a list moment show him (else the list changes by itself). */
  private ready(): boolean {
    return !this.box && this.where !== 'box' && !this.selecting && this.seen
  }

  wish(tile: HTMLElement): boolean {
    if (!this.ready() || !tile.isConnected) return false
    const { photo, feet, media } = this.onTile(tile, 0.5)
    const reach = this.reachable(feet)
    return this.play('wish', (c, from) => authorWish(c, from, {
      feet,
      photo,
      reach,
      press: { el: media },
      commit: () => {
        media.style.transform = ''
        media.style.transformOrigin = ''
      },
    }), 'response', reach, true)
  }

  received(tile: HTMLElement, cues: ReceivedCues): boolean {
    if (!this.ready() || !tile.isConnected) return false
    const { photo, feet, media } = this.onTile(tile, 0.36)
    const reach = this.reachable(feet)
    const seal = this.sealEl()
    return this.play('received', (c, from) => authorReceived(c, from, {
      feet,
      photo,
      reach,
      card: media,
      seal: (contact) => {
        seal.style.left = `${contact.x}px`
        seal.style.top = `${contact.y - 10}px`
        return seal
      },
      onStamp: cues.onStamp,
      onBack: cues.onBack,
      commit: () => {
        media.style.transform = ''
        media.style.transformOrigin = ''
      },
    }), 'response', reach, true)
  }

  remove(rect: DOMRectReadOnly): boolean {
    if (!this.ready()) return false
    const target = rectIn(rect, this.o.layer)
    return this.play('delete', (c, from) => authorDelete(c, from, { target }), 'response', false, true)
  }

  selection(on: boolean, ending?: { kind: 'move' | 'bulk'; rects: readonly DOMRectReadOnly[] }): void {
    if (this.destroyed || this.box) return
    if (on === this.selecting) return
    this.selecting = on
    if (on) {
      // still poses: the calm pose of the gallery (holding his ears); else the startle — or, not now, he stays as he is
      if (this.still) this.holdStill(NERVOUS)
      else this.play('select', (c, from) => authorSelect(c, from), 'response', false, true)
      return
    }
    // a moment that runs (the startle) arrives first: its end pose
    if (this.run) this.cutShort()
    const rects = (ending?.rects ?? []).map((r) => rectIn(r, this.o.layer))
    const played = !this.still && this.seen && (
      ending?.kind === 'move'
        ? this.play('move', (c, from) => authorMove(c, from, { rects, width: this.o.layer.clientWidth || window.innerWidth }), 'response', false, true)
        : ending?.kind === 'bulk'
          ? this.play('bulk', (c, from) => authorBulk(c, from, { rects }), 'response', false, true)
          : this.play('relax', (c, from) => authorRelax(c, from), 'response', false, true)
    )
    if (!played) this.holdStill({})
  }

  pop(then: () => void): boolean {
    if (!this.box || this.where !== 'box' || !this.seen) return false
    clearTimeout(this.peekTimer)
    // a peek that runs: cut short (from its frame), then the pop
    if (this.run?.shot.name === 'peek') this.cutShort()
    const box = this.box
    this.afterPop = then
    if (!this.play('pop', (c, from) => authorPop(c, from, box), 'response', false, true)) {
      this.afterPop = null
      return false
    }
    return true
  }

  private popDone(): void {
    const then = this.afterPop
    this.afterPop = null
    then?.()
  }

  private sealEl(): HTMLElement {
    if (!this.seal) {
      const s = document.createElement('span')
      s.className = 'lp-seal'
      s.setAttribute('aria-hidden', 'true')
      s.style.cssText = 'position:absolute;left:0;top:0;z-index:5;width:46px;height:46px;margin:-23px 0 0 -23px;opacity:0;pointer-events:none;'
      s.innerHTML = SEAL_SVG
      this.o.layer.append(s)
      this.seal = s
    }
    return this.seal
  }

  private bubbleEl(): HTMLElement {
    if (!this.bubble) {
      const b = document.createElement('div')
      // the app's glass and type (classes the shell already has: no new CSS)
      b.className = 'lp-bubble glass-panel t-subhead font-semibold text-text'
      b.setAttribute('aria-hidden', 'true')
      b.style.cssText = 'position:absolute;left:0;top:0;z-index:5;padding:7px 12px;border-radius:16px;white-space:nowrap;pointer-events:none;opacity:0;transform-origin:0 100%;'
      this.o.layer.append(b)
      this.bubble = b
    }
    return this.bubble
  }

  // ------------------------------------------------------------------------------------------------ the empty box

  setNight(sleeps: boolean, awakeUntil: number): void {
    this.night = { sleeps, awakeUntil }
    if (this.box && this.where === 'box') this.armPeek()
  }

  private armPeek(): void {
    clearTimeout(this.peekTimer)
    if (this.destroyed || !this.box || this.where !== 'box' || this.still) return
    const wait = this.firstPeek ? FIRST_PEEK_MS : PEEK_MIN_MS + Math.random() * PEEK_SPREAD_MS
    this.peekTimer = setTimeout(() => this.autoPeek(), wait)
  }

  /** Now and then: only when the box can be seen, nothing else plays, and (at night) a tap woke him. */
  private autoPeek(): void {
    if (this.destroyed || !this.box || this.where !== 'box') return
    const asleep = this.night.sleeps && Date.now() > this.night.awakeUntil
    if (asleep || this.paused || !this.seen || document.hidden) {
      // not now: ask again in a moment (the first peek stays the first one)
      this.peekTimer = setTimeout(() => this.autoPeek(), 1500)
      return
    }
    const box = this.box
    if (this.play('peek', (c, from) => authorPeek(c, from, box), 'decoration')) this.firstPeek = false
    else this.peekTimer = setTimeout(() => this.autoPeek(), 1500)
  }

  // ------------------------------------------------------------------------------------------------ the end of the list

  private atBottom(): boolean {
    const s = this.o.scroller
    if (s instanceof Window) return s.innerHeight + s.scrollY >= document.documentElement.scrollHeight - 2
    return s.scrollTop + s.clientHeight >= s.scrollHeight - 2
  }

  /** A: when his seat scrolled away and the end of the list is in view, he is found there (and back again). */
  private checkEnd(): void {
    const seatRow = this.o.seatRow?.()
    const endSpot = this.o.endSpot?.()
    if (this.box || this.busy || this.selecting || !seatRow) return
    if (!endSpot?.isConnected) {
      // the list got short (no end spot any more): back on his seat, unseen
      if (this.where === 'end') {
        this.where = 'seat'
        this.rig.place(this.seat)
      }
      return
    }
    const bars = (this.o.insets ?? barInsets)()
    const top = bars.top
    const bottom = window.innerHeight - bars.bottom
    const seat = seatRow.getBoundingClientRect()
    const end = endSpot.getBoundingClientRect()
    const seatSeen = seat.bottom > top && seat.top < bottom
    const endSeen = end.top >= top - 10 && end.bottom - 30 <= bottom
    if (this.where === 'seat' && !seatSeen && endSeen) {
      // an unseen move: neither place is on screen at the same time
      this.where = 'end'
      this.rig.place(this.seat)
      this.maybeEnd()
    } else if (this.where === 'end' && seatSeen && !(end.top < bottom && end.bottom > top)) {
      this.where = 'seat'
      this.rig.place(this.seat)
    }
  }

  private maybeEnd(): void {
    const now = performance.now()
    if (now - this.lastEnd < END_GAP_MS || this.busy || this.selecting) return
    this.lastEnd = now
    const el = this.bubbleEl()
    el.textContent = this.o.endText
    el.style.width = 'auto'
    const width = Math.max(64, Math.ceil(el.offsetWidth || this.o.endText.length * 8 + 24))
    this.play('end', (c, from) => authorEnd(c, from, { el, text: this.o.endText, width, layerWidth: this.o.layer.clientWidth || window.innerWidth }))
  }

  private bounce(): void {
    const now = performance.now()
    if (now - this.lastBounce < 700 || this.busy || this.where !== 'end') return
    this.lastBounce = now
    this.play('bounce', (c, from) => authorBounce(c, from))
  }

  // ------------------------------------------------------------------------------------------------ the approved anger (5 taps)

  private async angry(): Promise<void> {
    if (this.busy || this.still || this.paused || !requestStage(this.id, 'response')) return
    this.claimed = true
    this.ownScene = true
    this.rig.release()
    this.pose = {}
    this.haptic('warning')
    try {
      await this.rig.puppet.play('angry')
    } finally {
      this.ownScene = false
      this.free()
      this.after()
    }
  }

  // ------------------------------------------------------------------------------------------------ live gestures

  private local(e: PointerEvent | MouseEvent): Vec {
    const b = this.o.layer.getBoundingClientRect()
    return { x: e.clientX - b.left - this.o.layer.clientLeft, y: e.clientY - b.top - this.o.layer.clientTop }
  }

  private wire(): void {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts))
    }
    const hit = this.rig.hit
    on(hit, 'pointerdown', (e) => this.onDown(e))
    on(hit, 'pointermove', (e) => this.onMove(e))
    on(hit, 'pointerup', (e) => this.onUp(e))
    on(hit, 'pointercancel', () => this.onCancel())
    on(hit, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.grab) this.stopStroke()
    })
    on(hit, 'contextmenu', (e) => e.preventDefault())
    // a touch on him is his own (the app's swipe between tabs leaves it alone, like the Lists buddy)
    hit.setAttribute('data-drag-own', '')
    // the empty box: a tap on it makes him peek (the box's own target: its front, ≥ 44 px)
    if (this.box) {
      const front = this.box.front
      front.style.pointerEvents = 'auto'
      front.style.cursor = 'pointer'
      on(front, 'click', () => {
        if (this.where !== 'box' || this.busy) return
        this.night.awakeUntil = this.night.sleeps ? Date.now() + 10 * 60_000 : this.night.awakeUntil
        haptic('tap')
        const box = this.box
        if (box) this.play('peek', (c, from) => authorPeek(c, from, box))
      })
    }
    const sc = this.o.scroller
    const onScroll = () => this.checkEnd()
    sc.addEventListener('scroll', onScroll, { passive: true })
    this.off.push(() => sc.removeEventListener('scroll', onScroll))
    const onWheel = (e: Event) => {
      if ((e as WheelEvent).deltaY > 0 && this.atBottom()) this.bounce()
    }
    sc.addEventListener('wheel', onWheel, { passive: true })
    this.off.push(() => sc.removeEventListener('wheel', onWheel))
    let ty = Number.NaN
    const onTouchStart = (e: Event) => {
      ty = (e as TouchEvent).touches[0]?.clientY ?? Number.NaN
    }
    const onTouchMove = (e: Event) => {
      const y = (e as TouchEvent).touches[0]?.clientY ?? Number.NaN
      if (this.atBottom() && ty - y > 24) {
        ty = Number.NaN
        this.bounce()
      }
    }
    sc.addEventListener('touchstart', onTouchStart, { passive: true })
    sc.addEventListener('touchmove', onTouchMove, { passive: true })
    this.off.push(() => sc.removeEventListener('touchstart', onTouchStart), () => sc.removeEventListener('touchmove', onTouchMove))
    // the header moves (a cover photo arrives, the width changes): his seat follows while he rests
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (!this.busy && this.where !== 'box' && this.where !== 'out') this.rig.place(this.seat)
      })
      ro.observe(this.o.layer)
      this.off.push(() => ro.disconnect())
    }
  }

  private onDown(e: PointerEvent): void {
    if (this.destroyed || (e.pointerType === 'mouse' && e.button !== 0)) return
    const p = this.local(e)
    const f = this.rig.at
    if (this.where !== 'box' && !this.busy && !this.still && !this.paused) {
      const side = earTipAt(p.x - f.x, p.y - f.y)
      if (side) {
        this.startGrab(side, e)
        return
      }
    }
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false }
    this.stroke.len = 0
    this.stroke.flips = 0
    this.stroke.lastX = e.clientX
  }

  private onMove(e: PointerEvent): void {
    if (this.destroyed) return
    if (this.grab && e.pointerId === this.grab.id) {
      this.followEar(e)
      return
    }
    const pressed = !!this.press && e.pointerId === this.press.id
    if (pressed && this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 8) this.press.moved = true
    if (this.where === 'box') return
    // a mouse may stroke him without pressing (hovering over him); a finger strokes while it touches
    if (!pressed && e.pointerType !== 'mouse') return
    const now = performance.now()
    const s = this.stroke
    if (now - s.lastT > 450) {
      s.len = 0
      s.flips = 0
      s.lastX = e.clientX
      s.lastDx = 0
    }
    const dx = Number.isNaN(s.lastX) ? 0 : e.clientX - s.lastX
    s.lastX = e.clientX
    s.lastT = now
    s.len += Math.abs(dx)
    if (Math.abs(dx) > 2) {
      if (s.lastDx && Math.sign(dx) !== Math.sign(s.lastDx)) s.flips += 1
      s.lastDx = dx
    }
    if (!s.on && ((s.len > 30 && s.flips >= 1) || s.len > 70)) this.startStroke()
    if (s.on) {
      // he leans into the hand: toward the side the finger is on (a CSS transition on transform)
      const k = Math.max(-1, Math.min(1, (this.local(e).x - this.rig.at.x) / 22))
      if (!this.still) this.rig.lean.style.transform = `rotate(${(k * 4).toFixed(2)}deg)`
      clearTimeout(s.idle)
      s.idle = setTimeout(() => this.stopStroke(), 320)
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.destroyed) return
    if (this.grab && e.pointerId === this.grab.id) {
      this.endGrab()
      return
    }
    const p = this.press
    this.press = null
    if (this.stroke.on) {
      this.stopStroke()
      return
    }
    if (!p || p.id !== e.pointerId || p.moved || performance.now() - p.t > 400) return
    // a tap: a boop (5 taps within 2.5 s → the approved anger, after whatever plays)
    const now = performance.now()
    this.taps = this.taps.filter((t) => now - t < 2500)
    this.taps.push(now)
    if (this.taps.length >= 5) {
      this.taps = []
      if (this.busy) this.angryPending = true
      else void this.angry()
      return
    }
    if (!this.busy) this.play('boop', (c, from) => authorBoop(c, from))
  }

  private onCancel(): void {
    if (this.grab) this.endGrab()
    this.press = null
    this.stopStroke()
  }

  private startStroke(): void {
    const s = this.stroke
    if (s.on) return
    if (this.busy && this.run?.shot.name !== 'stroke') return
    s.on = true
    s.held = false
    if (!this.run) this.play('stroke', (c, from) => authorStroke(c, from))
  }

  private onHold(): void {
    // the finger still strokes: the moment waits at its "content" frame (he keeps leaning into the hand)
    if (this.stroke.on && this.run?.shot.name === 'stroke') {
      this.run.player.pause()
      this.stroke.held = true
    }
  }

  private stopStroke(): void {
    const s = this.stroke
    clearTimeout(s.idle)
    if (!s.on) return
    s.on = false
    this.rig.lean.style.transform = ''
    if (s.held && this.run?.shot.name === 'stroke') {
      s.held = false
      // the hand is gone: the sigh
      this.run.player.play()
    }
  }

  /** A finger takes an ear tip: "ай" plays (0.2 s), the ear itself follows the finger from now on (inline). */
  private startGrab(side: Side, e: PointerEvent): void {
    if (this.busy || this.still || !playsInApp('list-ear') || !requestStage(this.id, 'response')) return
    this.claimed = true
    this.grab = { side, id: e.pointerId }
    try {
      this.rig.hit.setPointerCapture(e.pointerId)
    } catch {
      /* no capture (synthetic events) */
    }
    this.rig.takeOver()
    const from = this.currentPose()
    this.rig.apply(from)
    this.start(authorGrab(this.ctx(), from, side))
    this.o.onMoment?.('grab')
    this.followEar(e)
  }

  private followEar(e: PointerEvent): void {
    const g = this.grab
    if (!g) return
    const { pose, slip } = earFollow(g.side, this.local(e), this.rig.at)
    const part: PartName = g.side === 'r' ? 'earR' : 'earL'
    this.rig.apply({ [part]: pose })
    this.pose = { ...this.pose, [part]: pose }
    if (slip) {
      // pulled too far: the ear slips out by itself
      haptic('tap')
      this.endGrab()
    }
  }

  private endGrab(now = false): void {
    const g = this.grab
    if (!g) return
    this.grab = null
    try {
      this.rig.hit.releasePointerCapture(g.id)
    } catch {
      /* already released */
    }
    // the grab's "ай" may still be on its way: from the frame on screen
    const from = this.currentPose()
    this.stopRun()
    this.rig.apply(from)
    if (now) {
      // cut short (the stage is needed elsewhere): at rest at once
      this.pose = {}
      this.rig.release()
      this.free()
      return
    }
    this.start(authorRelease(this.ctx(), from, g.side))
  }

  // ------------------------------------------------------------------------------------------------ settings

  setStill(still: boolean): void {
    if (this.still === still || this.destroyed) return
    this.still = still
    this.cutShort()
    this.rig.setStill(still)
    setMascotIdle(this.id, !still)
    if (this.box && this.where === 'box') {
      this.restInBox()
      this.armPeek()
    } else if (this.selecting) this.holdStill(NERVOUS)
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused || this.destroyed) return
    this.paused = paused
    if (paused) {
      this.stopStroke()
      this.rig.puppet.stopIdle()
      this.run?.player.pause()
    } else {
      this.run?.player.play()
      setMascotIdle(this.id, !this.still)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    clearTimeout(this.peekTimer)
    clearTimeout(this.stroke.idle)
    for (const f of this.off) f()
    this.stopRun()
    this.claimed = false
    this.grab = null
    this.ownScene = false
    unregisterMascot(this.id)
    this.box?.destroy()
    this.seal?.remove()
    this.bubble?.remove()
    this.rig.destroy()
  }
}
