/** Which mascot to build. */
export type MascotKind = 'bunny' | 'hamster';

/**
 * Scenes the bunny can play. `idle` only wakes him up (or does nothing).
 * 'surprise' (wave 3, Felix's idea 11 «Уши торчком»): the lop ears shoot up tall, the right tip folds over,
 * round eyes, a tiny hop — then the ears flop back down with a soft wobble (≈ 1.6 s; decoration: nothing
 * under reduced motion).
 */
export type BunnyScene = 'greet' | 'eat' | 'walk' | 'jump' | 'alert' | 'sleep' | 'angry' | 'surprise' | 'idle';
/**
 * Scenes the hamster can play. `idle` only wakes him up (or does nothing).
 * 27.10 (approved by Felix 26.10, tapsi-moments.ts, loaded lazily): 'secret' = the reservation moment with its
 * «Psst» ending (jump → eats the wish star → paws over his mouth, a head tilt, a nod; reduced: the still pose
 * pose('psst')); 'speck' = «Пылинка на линзе», only while he holds the binoculars (reduced / without them: nothing).
 */
export type HamsterScene = 'greet' | 'eat' | 'walk' | 'jump' | 'sleep' | 'angry' | 'secret' | 'speck' | 'idle';
export type Scene = BunnyScene | HamsterScene;

export type BunnyCoat = 'fawn' | 'choc' | 'blue' | 'himalayan' | 'broken';
export type HamsterCoat = 'golden' | 'cinnamon' | 'sable' | 'dwarf' | 'robo' | 'spot';
export type CoatId = BunnyCoat | HamsterCoat;

/** Bunny ears: lop (hanging, default) or upright. */
export type EarStyle = 'lop' | 'upright';

/** Eye mode: normal round eyes, stars, happy arcs or closed (sleeping). */
export type EyeMode = 'normal' | 'star' | 'happy' | 'sleep';

/**
 * 'auto'  — follow the OS setting (prefers-reduced-motion), live.
 * 'force' — always reduce (scenes snap to their end state, no idle motion).
 * 'off'   — never reduce.
 */
export type ReducedMotionMode = 'auto' | 'force' | 'off';

/** Static debug poses for the bunny (used by the demo's ?static=1 screenshots). 'surprise' = the ears-up peak (wave 3). */
export type BunnyPose = 'idle' | 'turn' | 'alert' | 'sleep' | 'angry' | 'wave' | 'eat' | 'surprise';
/** Static debug poses for the hamster (ported from the prototype's ?pose= param). */
export type HamsterPose = 'idle' | 'wave' | 'sleep' | 'eat' | 'angry' | 'turn' | 'drip' | 'psst';

/**
 * The seven coat colours, in this order:
 * base-top, base-bottom, belly, accent, accent-dark, paw, ear-in.
 */
export type CoatColors = readonly [string, string, string, string, string, string, string];

export interface Coat<Id extends string = string> {
  id: Id;
  /** Russian display name, as in the prototypes. */
  name: string;
  /** Marking pattern class suffix ('none' = plain coat). */
  pattern: string;
  colors: CoatColors;
}

export interface MascotOptions<C extends string = string> {
  /** Coat id; defaults to the first coat of the mascot. */
  coat?: C;
  /** Rendered width of the stage in CSS px (height follows the 400:260 / 400:250 viewBox). Default 160. */
  size?: number;
  /** Run the idle loop (breathing is CSS; blinks, glances, ear twitches are timers). Default true. */
  idle?: boolean;
  /** Reduced-motion policy. Default 'auto'. */
  reducedMotion?: ReducedMotionMode;
  /** Clicking/tapping the host calls tap() (jump; 5 taps in 2.5 s = angry). Default true. */
  interactive?: boolean;
  /**
   * The app's one vibration wrapper (wave 3, I-05). The package NEVER calls navigator.vibrate itself: it asks
   * this function for 'tap' when a person taps the mascot and 'warning' for the 5-taps anger. Scenes the app
   * plays never vibrate (the app gives the one haptic of its moment itself, mascot plan §3.10). Default: none.
   */
  haptics?: MascotHaptics;
  /**
   * Eyes while reduced motion holds the puppet still (the Weniger contract, mascot plan §3.4): 'happy' arcs or
   * 'sleep' — never open eyes "into the camera". Default: none (the eyes stay as they are).
   */
  calmEyes?: CalmEyes;
}

// ---------- wave 3 contracts (I-00): haptics, calm eyes, moment classes ----------

/** The app's haptic kinds (apps/web src/lib/haptics.ts HapticKind). */
export type MascotHapticKind = 'tap' | 'select' | 'success' | 'warning' | 'error';

/** The app's haptics wrapper, injected into the package (it never vibrates by itself). */
export type MascotHaptics = (kind: MascotHapticKind) => void;

/** Eyes of a still pose that must not look at the viewer: happy arcs (default in the app) or closed (asleep). */
export type CalmEyes = 'happy' | 'sleep';

/**
 * The four moment classes of the mascot plan §3.2, from the most to the least important:
 * 'work' (a mascot does a job for you: carry, letter) > 'response' (answers your action or the server) >
 * 'illustration' (the mascot is part of the screen: empty states, 404, welcome) > 'decoration' (lives next
 * to the content: peeks, hop-across, its own sniff). A higher class interrupts a lower one; a lower one
 * never starts while a higher one plays.
 */
export type MomentClass = 'work' | 'response' | 'illustration' | 'decoration';

export interface BunnyOptions extends MascotOptions<BunnyCoat> {
  /** Ear style; default 'lop'. */
  ears?: EarStyle;
}

/**
 * Something the hamster holds up in both front paws instead of resting them on his belly (2026-10-22, the
 * empty "Freunde" card). 'binoculars': he holds a pair of binoculars to his eyes — his own paws on the
 * barrels — and, while his idle loop runs, slowly looks left and right through them, a glint crosses the
 * lenses, and once a round he lowers them to blink. Reduced motion: the same pose, still.
 */
export type HamsterHolding = 'binoculars';

export interface HamsterOptions extends MascotOptions<HamsterCoat> {
  /** What he holds up (default none: paws on the belly). See HamsterHolding. */
  holding?: HamsterHolding | null;
}

/** Options accepted by createMascot(). */
export type CreateMascotOptions =
  | ({ kind: 'bunny' } & BunnyOptions)
  | ({ kind: 'hamster' } & HamsterOptions);

/** Detail of the `mascot-scene-start` / `mascot-scene-end` events dispatched on the host. */
export interface MascotSceneEventDetail {
  kind: MascotKind;
  scene: Scene;
}

// ---------- welcome stage ----------

/** An edge of the welcome stage. The stage host's own edges are the "screen edges". */
export type StageEdge = 'bottom' | 'left' | 'right' | 'top';

/**
 * Where a peeking bunny glances, in SCREEN directions (the stage converts them
 * for bunnies peeking in from the side): 'viewer' = straight at you,
 * 'in' = toward the middle of the stage, 'at:N' = at bunny N (`bunnies[N]`):
 * its head while it is on stage or about to come up, the runner where it is
 * at that moment (otherwise like 'in'). 'pt:X,Y' (wave 3) = a point of the stage as fractions of its width
 * and height — also outside it, e.g. a button under the card: 'pt:0.25,1.6'.
 */
export type LookDir = 'left' | 'right' | 'up' | 'down' | 'viewer' | 'in' | `at:${number}` | `pt:${number},${number}`;

/** One glance: a direction, or a direction plus how long it is held (s, default 0.5). */
export type LookStep = LookDir | readonly [LookDir, number];

/** A bunny climbs out from behind an edge with its paws, looks around and ducks back (or stays). */
export interface PeekStep {
  type: 'peek';
  /** Index into `bunnies` (0 = the main bunny). */
  actor: number;
  edge: StageEdge;
  /** Start time in seconds (the first ear tip shows a moment later). */
  at: number;
  /** Position along the edge, 0..1 (bottom/top: from the left; left/right: from the top). Default 0.5. */
  pos?: number;
  /**
   * Extra clockwise tilt in degrees. Default: bottom 0, left -12, right 12, top 0
   * (side bunnies lie almost sideways, their ears hang with gravity). With `floor`
   * the default is ±80: the bunny stands upright behind the side edge and leans out.
   */
  tilt?: number;
  /** Side edges only: stand on the bottom edge behind the side edge and lean out ("around the door frame"). */
  floor?: boolean;
  /** How far (bunny units) the bunny comes out past its usual peek line. Default 0 (with `floor` + turn: the near eye and the nose show, the far eye stays behind the edge). */
  reveal?: number;
  /** Side peeks with `floor`: the approved 3/4 turn toward the stage (the face looks into the stage). Default true. */
  turn?: boolean;
  /** Seconds from the first glance to the duck, at least (stretched to fit the glances / sniff / greeting). Default 1.4. */
  hold?: number;
  /** Where the face already points while the bunny climbs up (turned while still hidden), e.g. 'right' to watch a runner go. */
  face?: LookDir;
  /** Seconds after `at` when the glances start. Default 1.4 (climbed up and settled; earlier = it looks around while still settling). */
  lookFrom?: number;
  /** Glances while peeking. */
  look?: readonly LookStep[];
  /** Lifts an ear and sniffs, like the approved `alert` scene. */
  sniff?: boolean;
  /** Star eyes, open mouth and a wave with one paw, like the approved `greet` scene. */
  greet?: boolean;
  /** Stays on the edge instead of ducking; the stage ends with this bunny breathing and blinking. */
  stay?: boolean;
  /** Shrugs: both paws come up off the edge, the head tilts, the ears flare — "no idea" (error screens). */
  shrug?: boolean;
  /** Yawns and nods off on the edge (eyes closed, deep breathing, a floating "z"; with `stay`). */
  doze?: boolean;
  /**
   * Wave 3, Felix's idea 11 «Уши торчком»: a surprise — the lop ears shoot up tall (≈ 180 ms, a bouncy
   * stretch), the right ear's tip folds over, the eyes go round, a tiny hop; held ≈ 0.6 s, then the ears flop
   * back down with a soft wobble (≈ 0.7 s). Comes after the glances / sniff, before a greeting.
   */
  surprise?: boolean;
  /** Wave 3: after everything else, a small nod toward this direction ("there!"), e.g. 'pt:0.25,1.6' = a button. */
  nod?: LookDir;
  /** Tiny calendar held in the mouth (the Start tab's create-menu variant). */
  item?: 'calendar';
  /**
   * Wave 3 «Только уши»: only the ear tips come up over the edge (no paws, no face), wiggle a few times and
   * go down again. `look` / `sniff` / `greet` are ignored.
   */
  earsOnly?: boolean;
  /**
   * Wave 3 «Лифт»: already up on the edge at `at` (no climb-out) — it rides along with its container (the
   * "+" menu's sheet carries it up on its spring); the ears and the body answer the ride when it stops.
   */
  seated?: boolean;
  /** With `seated`: seconds after `at` when the container stops (its spring settles). Default 0.35 (`smooth`). */
  rideStop?: number;
  /** Size relative to the main bunny (default 1 for actor 0, 0.8 for the others). */
  scale?: number;
}

/** A bunny hops across the bottom edge, from off-stage to off-stage, with the approved hop cycle. */
export interface RunStep {
  type: 'run';
  actor: number;
  /** Start time in seconds. */
  at: number;
  /** Where it comes in. Default 'left'. */
  from?: 'left' | 'right';
  /** Where it sits for a moment, 0..1 of the stage width; `null` = no stop. Default 0.38. */
  pause?: number | null;
  /** Speed multiplier (1 = default rhythm: 2 hops of ~0.46 s before the stop, 3 quicker ones after). */
  speed?: number;
  /** Size relative to the main bunny. Default 0.62. */
  scale?: number;
}

export type WelcomeStep = PeekStep | RunStep;

/**
 * Built-in choreographies. 'welcome' ≈ 8 s; 'peek-once' = one bunny peeks from the bottom and stays (empty
 * states). The short "moments" (wave 1): 'hop-across' (hops across the bottom edge without a stop),
 * 'peek-side' (from behind the right edge, looks in, ducks), 'pop-up' (pops up from behind the card, looks
 * at you, ducks back), 'wave' (peeks up and waves, stays), 'lost' (looks left and right, puzzled, sniffs,
 * stays), 'shrug' (shrugs with its paws, stays), 'sleepy' (yawns and nods off on the edge, stays).
 * Wave 3 (Felix's "not always the same climb from the bottom"): 'corner-left' / 'corner-right' (peeks
 * around the card's top-left / top-right corner, sniffs toward the middle, ducks), 'meet' (two bunnies from
 * behind the left and the right edge notice each other, greet, then each nods toward one point), 'ears-only'
 * (only the ear tips show over the edge and wiggle), 'lift' (already sitting on the edge: it rides up with
 * its container, the ears answer the stop), 'surprise' (peeks up, sees you — the ears shoot up, flop back,
 * ducks), 'peek-sniff' (peeks up, sniffs down at what lies under the edge, looks at you, ducks).
 * 2026-10-22 (the app's "+" menu, Felix: "not out of nothing"): 'climb-left' / 'climb-right' — climbs out over
 * the card's top edge near its left / right end (on the straight part, clear of the rounded corner: the card
 * clips it, the paws rest on it), leaning toward the middle; looks in, sniffs, looks at you, ducks.
 */
export type WelcomePreset =
  | 'welcome'
  | 'peek-once'
  | 'peek-bottom'
  | 'peek-left'
  | 'peek-right'
  | 'run'
  | 'hop-across'
  | 'peek-side'
  | 'pop-up'
  | 'wave'
  | 'lost'
  | 'shrug'
  | 'sleepy'
  | 'corner-left'
  | 'corner-right'
  | 'meet'
  | 'ears-only'
  | 'lift'
  | 'surprise'
  | 'peek-sniff'
  | 'climb-left'
  | 'climb-right';

export interface WelcomeOptions {
  item?: 'calendar';
  /**
   * Coats of the bunnies taking part, in the order they appear in 'welcome': [0] is the main bunny
   * (ends the show and greets), [1] peeks from the bottom left, [2] from the right edge, [3] runs across.
   * Default ['fawn', 'himalayan', 'choc', 'broken'].
   */
  bunnies?: readonly BunnyCoat[];
  /** A preset name or your own steps. Default 'welcome'. */
  choreography?: WelcomePreset | readonly WelcomeStep[];
  /** Repeat forever (the staying bunny ducks away before each restart). Default false. */
  loop?: boolean;
  /** Reduced-motion policy (see ReducedMotionMode). Default 'auto'. */
  reducedMotion?: ReducedMotionMode;
  /** Called once per run when the choreography is over (not for loop repeats, not on stop/destroy). */
  onEnd?: () => void;
  /**
   * Start by itself: true = right away, 'idle' = once the page is idle (requestIdleCallback, at most
   * 600 ms) — recommended on app start, so start-up work does not make the SVG parts stutter.
   * Default false (call play() / playWhenIdle()).
   */
  autoplay?: boolean | 'idle';
  /**
   * px between a host edge and the line the bunnies hide behind. Default 0 (the host edge itself).
   * Use it when a card / sheet starts at the bottom of the host: the paws then rest IN FRONT of the
   * edge line (over the card), the body stays behind it — like the app icon.
   */
  edgeInset?: number | Partial<Record<StageEdge, number>>;
  /**
   * Corner radius (px) of that card: the bottom edge follows the card's rounded top corners (top:
   * a header's rounded bottom corners), so a bunny near a corner hides behind the curve, not behind
   * an invisible straight line. Only where `edgeInset` > 0. Default 0.
   */
  edgeRadius?: number | Partial<Record<StageEdge, number>>;
  /** Width of the main bunny in px is clamped to [minSize, maxSize]. Defaults 96 / 300. */
  minSize?: number;
  maxSize?: number;
  /**
   * Wave 3 (I-02, the Weniger contract): eyes of the static composition under reduced motion — 'happy' arcs
   * or 'sleep'. Default: none = open eyes as before (the app passes 'happy'; 'sleepy' always sleeps).
   */
  calmEyes?: CalmEyes;
  /**
   * Wave 3: px above the host the bunnies may still draw into (the surprised ears stand tall). The host
   * then clips only its left, right and bottom (clip-path instead of overflow), so whatever is above it in
   * the page must allow that. Default 0 (everything is clipped to the host, as before).
   */
  headroom?: number;
}

/** Sampled styles of one animated part (what seek() shows), for tests and frame checks. */
export interface WelcomePartStyle {
  transform?: string;
  opacity?: string;
  d?: string;
}

// ---------- carry (wave 1: "the bunnies WORK", Felix's K10) ----------

/**
 * What the bunny carries: a mini occasion card (in the occasion's colour), a small gift box, (wave 3) a small
 * cream envelope with a heart seal in the accent colour (N01 «Письмо»: the invite link into the chat), or
 * nothing — 'none': the same hops without an item (it jumps out of the "+" and lands on the sheet's edge).
 */
export type CarryItem = 'card' | 'gift' | 'letter' | 'none';

/**
 * Wave 3, "carry it off the edge" (N01 «Письмо»): no target to land on — the bunny pops up out of `from`
 * with the item and hops off this edge of the layer, the item goes with it.
 */
export type CarryAway = 'left' | 'right';

/** A box in the carry layer's own CSS px (e.g. a DOMRect relative to that layer). */
export interface CarryBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CarryOptions {
  /** Where the item starts (the button that created it, the closing sheet …). */
  from: CarryBox;
  /** Where it lands (the calendar day, the list row …). */
  to: CarryBox;
  /** Default 'card'. */
  item?: CarryItem;
  /** CSS colour of the card / of the gift box. Default a warm apricot. */
  tint?: string;
  /** The carrying bunny's coat. Default 'fawn'. */
  coat?: BunnyCoat;
  /**
   * 'force' (reduced motion): no bunny — the item simply glides from `from` to `to` and fades in place.
   * 'off': never reduce. 'auto' (default): the OS setting decides.
   */
  reducedMotion?: ReducedMotionMode;
  /** Height of the bunny in px (feet to ear tips). Default: from the target's size, 64–110. */
  size?: number;
  /**
   * Wave 3: carry it OFF this edge of the layer instead of onto `to` (≈ 1.8 s: pops up, three hops, out over
   * the edge). `to` is then not a landing place — only its height sizes the bunny (pass `from` when there is
   * nothing else). `landed` resolves when the item is out of sight. Reduced motion: nothing moves at all.
   */
  away?: CarryAway;
}

