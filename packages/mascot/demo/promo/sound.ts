/**
 * The promo film's sound (Felix 25.10: «надо добавить звуки к видео») — GALLERY-ONLY.
 *
 * Everything is synthesized here with Web Audio: no sample files, no downloaded music, so there is nothing to
 * license. The same code plays live in the preview (AudioContext, in step with the playhead) and renders the
 * soundtrack for the video file (OfflineAudioContext, 48 kHz stereo → WAV). Soft and short, like a friendly
 * iOS app: little pops, a click, airy whooshes, bell dings, a quiet marimba bed in C major (~105 BPM).
 */
import type { Cue } from './film';

type Ctx = BaseAudioContext;
type Opts = Cue['opts'];

/** Every node a voice starts, so a live session can stop them. */
type Started = AudioScheduledSourceNode[];

// ---- small helpers ------------------------------------------------------------------------------------------

/** A deterministic 0..1 random for `seed` and `n` (sparkles sound the same in preview and file). */
function rnd(seed: number, n: number): number {
  const v = Math.sin(seed * 9301 + n * 49297) * 233280;
  return v - Math.floor(v);
}

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
/** One second of white noise per context (seeded, so renders are identical). */
function noise(ctx: Ctx): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x7fffffff) * 2 - 1;
  }
  noiseCache.set(ctx, buf);
  return buf;
}

/** A gain envelope: 0 → peak in `a` s, exponential decay to silence in `d` s. */
function env(ctx: Ctx, out: AudioNode, when: number, peak: number, a: number, d: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + a);
  g.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
  g.connect(out);
  return g;
}

function osc(ctx: Ctx, type: OscillatorType, freq: number, when: number, dur: number, into: AudioNode, started: Started): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  o.connect(into);
  o.start(when);
  o.stop(when + dur + 0.05);
  started.push(o);
  return o;
}

function noiseSrc(ctx: Ctx, when: number, dur: number, into: AudioNode, started: Started, offset = 0): AudioBufferSourceNode {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  n.loop = true;
  n.connect(into);
  n.start(when, offset % 0.9);
  n.stop(when + dur + 0.05);
  started.push(n);
  return n;
}

/** A soft marimba-ish note: a sine with a quick 4th partial (the wooden attack). */
function marimba(ctx: Ctx, out: AudioNode, when: number, freq: number, peak: number, decay: number, started: Started): void {
  osc(ctx, 'sine', freq, when, decay + 0.05, env(ctx, out, when, peak, 0.004, decay), started);
  osc(ctx, 'sine', freq * 4, when, 0.08, env(ctx, out, when, peak * 0.22, 0.002, 0.06), started);
}

/** A small bell: inharmonic partials with their own decays. */
function bell(ctx: Ctx, out: AudioNode, when: number, freq: number, peak: number, started: Started, length = 1): void {
  osc(ctx, 'sine', freq, when, 1.3 * length, env(ctx, out, when, peak, 0.003, 1.2 * length), started);
  osc(ctx, 'sine', freq * 2.76, when, 0.6 * length, env(ctx, out, when, peak * 0.35, 0.002, 0.55 * length), started);
  osc(ctx, 'sine', freq * 5.4, when, 0.3 * length, env(ctx, out, when, peak * 0.15, 0.002, 0.25 * length), started);
}

const NOTE = (n: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  if (!m) return 440;
  const idx = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1] as 'C'] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (idx / 12);
};

// ---- the voices ---------------------------------------------------------------------------------------------

type Voice = (ctx: Ctx, out: AudioNode, when: number, o: Opts, started: Started) => void;

export const VOICES: Record<string, Voice> = {
  /** a soft click (finger on glass) */
  tap: (ctx, out, when, o, st) => {
    const g = o.gain ?? 1;
    osc(ctx, 'sine', 1900 * (o.pitch ?? 1), when, 0.03, env(ctx, out, when, 0.16 * g, 0.001, 0.025), st);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    hp.connect(env(ctx, out, when, 0.07 * g, 0.001, 0.018));
    noiseSrc(ctx, when, 0.03, hp, st);
  },
  /** a bubbly pop (pitch: 1 = about 520 Hz) */
  pop: (ctx, out, when, o, st) => {
    const g = o.gain ?? 1;
    const f = 520 * (o.pitch ?? 1);
    const s = osc(ctx, 'sine', f, when, 0.16, env(ctx, out, when, 0.26 * g, 0.003, 0.13), st);
    s.frequency.exponentialRampToValueAtTime(f * 2.1, when + 0.06);
    const t = osc(ctx, 'triangle', f * 0.5, when, 0.1, env(ctx, out, when, 0.08 * g, 0.002, 0.07), st);
    t.frequency.exponentialRampToValueAtTime(f, when + 0.05);
  },
  /** air: filtered noise that sweeps up (things slide or fly) */
  whoosh: (ctx, out, when, o, st) => {
    const g = o.gain ?? 1;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(380 * (o.pitch ?? 1), when);
    bp.frequency.exponentialRampToValueAtTime(2400 * (o.pitch ?? 1), when + 0.32);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, when);
    e.gain.linearRampToValueAtTime(0.2 * g, when + 0.13);
    e.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
    e.connect(out);
    bp.connect(e);
    noiseSrc(ctx, when, 0.45, bp, st, (o.seed ?? 0) * 0.13);
  },
  /** a soft, low landing */
  thump: (ctx, out, when, o, st) => {
    const g = o.gain ?? 1;
    const f = 120 * (o.pitch ?? 1);
    const s = osc(ctx, 'sine', f, when, 0.2, env(ctx, out, when, 0.3 * g, 0.004, 0.16), st);
    s.frequency.exponentialRampToValueAtTime(f * 0.5, when + 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(env(ctx, out, when, 0.06 * g, 0.002, 0.05));
    noiseSrc(ctx, when, 0.07, lp, st, 0.3);
  },
  /** a bell ding (pitch: 1 = A5) */
  chime: (ctx, out, when, o, st) => bell(ctx, out, when, 880 * (o.pitch ?? 1), 0.13 * (o.gain ?? 1), st),
  /** confetti: a few high, seeded pings from a pentatonic scale */
  sparkle: (ctx, out, when, o, st) => {
    const seed = o.seed ?? 1;
    const scale = ['C7', 'D7', 'E7', 'G7', 'A7', 'C8'].map(NOTE);
    for (let i = 0; i < 6; i++) {
      const at = when + rnd(seed, i) * 0.45;
      const f = scale[Math.floor(rnd(seed, i + 10) * scale.length)] ?? 2093;
      osc(ctx, 'sine', f, at, 0.12, env(ctx, out, at, 0.045 * (o.gain ?? 1) * (0.6 + rnd(seed, i + 20) * 0.4), 0.002, 0.1), st);
    }
  },
  /** a tiny typing tick */
  type: (ctx, out, when, o, st) => {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    hp.connect(env(ctx, out, when, 0.06 * (o.gain ?? 1), 0.001, 0.012));
    noiseSrc(ctx, when, 0.02, hp, st, (o.seed ?? 0) * 0.07);
    osc(ctx, 'sine', 2600 + rnd(o.seed ?? 0, 3) * 600, when, 0.02, env(ctx, out, when, 0.03 * (o.gain ?? 1), 0.001, 0.012), st);
  },
  /** a gulp (a wish star into Tapsi's cheeks; pitch rises per star) */
  gulp: (ctx, out, when, o, st) => {
    const f = 260 * (o.pitch ?? 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(out);
    const s = osc(ctx, 'sine', f * 1.6, when, 0.2, env(ctx, lp, when, 0.3 * (o.gain ?? 1), 0.005, 0.16), st);
    s.frequency.exponentialRampToValueAtTime(f, when + 0.06);
    s.frequency.exponentialRampToValueAtTime(f * 1.9, when + 0.15);
  },
  /** a short airy swish (paws, a gift going behind the back) */
  swish: (ctx, out, when, o, st) => {
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.Q.value = 1.2;
    hp.frequency.setValueAtTime(1600, when);
    hp.frequency.exponentialRampToValueAtTime(5200, when + 0.16);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, when);
    e.gain.linearRampToValueAtTime(0.16 * (o.gain ?? 1), when + 0.05);
    e.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
    e.connect(out);
    hp.connect(e);
    noiseSrc(ctx, when, 0.22, hp, st, 0.5);
  },
  /** the wink: two quick bright bells */
  bling: (ctx, out, when, o, st) => {
    bell(ctx, out, when, NOTE('E6'), 0.08 * (o.gain ?? 1), st, 0.5);
    bell(ctx, out, when + 0.07, NOTE('B6'), 0.08 * (o.gain ?? 1), st, 0.6);
  },
  /** "reserved": two rising marimba notes */
  success: (ctx, out, when, o, st) => {
    marimba(ctx, out, when, NOTE('E5'), 0.2 * (o.gain ?? 1), 0.5, st);
    marimba(ctx, out, when + 0.11, NOTE('B5'), 0.2 * (o.gain ?? 1), 0.7, st);
  },
  /** a little "oh no" (two falling notes, soft) */
  oops: (ctx, out, when, o, st) => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    lp.connect(out);
    osc(ctx, 'triangle', NOTE('E5'), when, 0.2, env(ctx, lp, when, 0.12 * (o.gain ?? 1), 0.01, 0.18), st);
    const s = osc(ctx, 'triangle', NOTE('C5'), when + 0.16, 0.45, env(ctx, lp, when + 0.16, 0.12 * (o.gain ?? 1), 0.01, 0.4), st);
    s.frequency.exponentialRampToValueAtTime(NOTE('B4'), when + 0.5);
  },
  /** "Dream big!": a quick rising arpeggio and a ringing chord */
  fanfare: (ctx, out, when, o, st) => {
    const g = o.gain ?? 1;
    ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => marimba(ctx, out, when + i * 0.085, NOTE(n), 0.18 * g, 0.45, st));
    ['C6', 'E6', 'G6'].forEach((n) => bell(ctx, out, when + 0.36, NOTE(n), 0.07 * g, st, 1.4));
  },
};

// ---- the music bed: C – G – Am – F, one chord per bar, plucked eighths and a soft bass -----------------------

// Felix 25.10 after listening: «музыку на фоне … или исправить, или сделать тише, или убрать». The first bed
// (plucked eighths, a tune) was as loud as the effects (music alone ≈ −24 dBFS RMS). Now: a warm, quiet pad —
// one chord per bar, slow swells, a single soft pluck and a soft bass per bar, everything low-passed; about
// 12 dB quieter. The player and the render can leave it out entirely (🎵 / soundtrack({ music: false })).
const BPM = 105;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const CHORDS: readonly (readonly string[])[] = [
  ['C4', 'E4', 'G4'],
  ['B3', 'D4', 'G4'],
  ['C4', 'E4', 'A4'],
  ['C4', 'F4', 'A4'],
];
const PLUCK = ['G4', 'D4', 'E4', 'C4'];
const BASS = ['C3', 'G2', 'A2', 'F2'];
/** the bed's level (measured: music alone ≈ −36 dBFS RMS in the file, the effects ≈ −23) */
const MUSIC_LEVEL = 0.055;

/** One pad voice: two slightly detuned soft oscillators, a slow swell in, held, a long release. */
function padNote(ctx: Ctx, out: AudioNode, when: number, freq: number, hold: number, started: Started): void {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(0.05, when + 0.7);
  g.gain.setValueAtTime(0.05, when + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, when + hold + 1.2);
  g.connect(out);
  for (const cents of [-5, 5]) {
    const o = osc(ctx, 'triangle', freq, when, hold + 1.25, g, started);
    o.detune.setValueAtTime(cents, when);
  }
}

/** Schedules the bed from film time `from` (ctx time `at` = film time `from`); fades in at 0 and out at the end. */
function scheduleBed(ctx: Ctx, out: AudioNode, at: number, from: number, duration: number, started: Started): void {
  const bed = ctx.createGain();
  // level over film time: fade in 0 → 2 s, fade out over the last 2.2 s
  const level = (t: number) => MUSIC_LEVEL * Math.min(1, t / 2, Math.max(0, (duration - t) / 2.2));
  bed.gain.setValueAtTime(Math.max(0.0001, level(from)), at);
  for (const t of [2, duration - 2.2, duration]) {
    if (t > from) bed.gain.linearRampToValueAtTime(level(t), at + (t - from));
  }
  // warm: everything through a gentle low-pass (no bright attacks)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = 0.5;
  lp.connect(bed);
  bed.connect(out);
  for (let b = 0; b * BAR < duration - 0.5; b++) {
    const t = b * BAR;
    // a note already sounding at `from` is skipped: the bed comes back in with the next bar
    if (t < from - 0.01) continue;
    const when = at + (t - from);
    const i = b % CHORDS.length;
    for (const n of CHORDS[i] ?? []) padNote(ctx, lp, when, NOTE(n), BAR - 0.3, started);
    // one soft pluck per bar (gentle attack, long decay) and a soft bass
    const pluck = NOTE(PLUCK[i] ?? 'C4') * 2;
    osc(ctx, 'sine', pluck, when + BEAT * 0.5, 1.6, env(ctx, lp, when + BEAT * 0.5, 0.035, 0.03, 1.5), started);
    osc(ctx, 'triangle', NOTE(BASS[i] ?? 'C3'), when, BAR + 0.3, env(ctx, lp, when, 0.07, 0.12, BAR), started);
  }
}

// ---- the chain: everything → bus → compressor (limiter) → master ------------------------------------------

/** Loudness into the limiter (measured 25.10: drive 1 left the mix at RMS ≈ −29 dBFS, too quiet for a phone). */
const DRIVE = 2;

function chain(ctx: Ctx, volume: number): { bus: GainNode; master: GainNode } {
  const bus = ctx.createGain();
  bus.gain.value = DRIVE;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = volume;
  bus.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);
  return { bus, master };
}

/** One cue into `out`, panned when it asks for it. */
function playCue(ctx: Ctx, out: AudioNode, when: number, cue: Cue, started: Started): void {
  const voice = VOICES[cue.name];
  if (!voice) return;
  let into: AudioNode = out;
  if (cue.opts.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, cue.opts.pan));
    p.connect(out);
    into = p;
  }
  voice(ctx, into, when, cue.opts, started);
}

// ---- live: the preview ------------------------------------------------------------------------------------

/** Plays the film's sound in step with the preview. One session per ▶; stop() ends it at once. */
export class FilmSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private session: { gain: GainNode; started: Started; ctxAt: number; filmAt: number } | null = null;
  private vol = 0.8;
  private token = 0;
  /** the music bed on or off (Felix compares with and without); takes effect at the next start() */
  music = true;

  constructor(private readonly cues: readonly Cue[], private readonly duration: number) {}

  set volume(v: number) {
    this.vol = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get playing(): boolean {
    return this.session !== null;
  }

  /** The film time the sound is at (the preview follows this clock while sound plays). */
  time(): number | null {
    if (!this.session || !this.ctx) return null;
    return this.session.filmAt + (this.ctx.currentTime - this.session.ctxAt);
  }

  /**
   * Starts at the playhead (call from a click: browsers only allow sound after a gesture). `playhead` is read
   * again once the audio is unlocked, so the picture never jumps back by the time the browser took.
   */
  async start(playhead: () => number): Promise<void> {
    this.stop();
    const mine = ++this.token;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const c = chain(this.ctx, this.vol);
      this.bus = c.bus;
      this.master = c.master;
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') await ctx.resume();
    // a pause, a jump or a newer start while the browser was still unlocking audio: this start is stale
    if (mine !== this.token || !this.bus) return;
    const gain = ctx.createGain();
    gain.connect(this.bus);
    const started: Started = [];
    const from = playhead();
    if (from >= this.duration) return;
    const ctxAt = ctx.currentTime + 0.06;
    this.session = { gain, started, ctxAt, filmAt: from };
    if (this.music) scheduleBed(ctx, gain, ctxAt, from, this.duration, started);
    for (const cue of this.cues) {
      if (cue.t < from - 0.005) continue;
      playCue(ctx, gain, ctxAt + (cue.t - from), cue, started);
    }
  }

  stop(): void {
    this.token++;
    const s = this.session;
    this.session = null;
    if (!s || !this.ctx) return;
    const now = this.ctx.currentTime;
    s.gain.gain.setTargetAtTime(0, now, 0.015);
    setTimeout(() => {
      for (const n of s.started) { try { n.stop(); } catch { /* not started yet or done */ } }
      s.gain.disconnect();
    }, 120);
  }

  close(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

// ---- offline: the soundtrack for the video file ----------------------------------------------------------

/** What goes into a render: the music bed, the sound effects (both by default). */
export interface MixParts { music?: boolean; sfx?: boolean }

export async function renderSoundtrack(cues: readonly Cue[], duration: number, parts: MixParts = {}, rate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  const { bus } = chain(ctx, 1.25);
  const started: Started = [];
  if (parts.music !== false) scheduleBed(ctx, bus, 0, 0, duration, started);
  if (parts.sfx !== false) for (const cue of cues) playCue(ctx, bus, cue.t, cue, started);
  return ctx.startRendering();
}

/** 16-bit PCM WAV of an AudioBuffer, as base64 (the renderer writes it to a file). */
export function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const bytes = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  bytes.setUint32(4, 36 + len * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, ch, true);
  bytes.setUint32(24, buf.sampleRate, true);
  bytes.setUint32(28, buf.sampleRate * ch * 2, true);
  bytes.setUint16(32, ch * 2, true);
  bytes.setUint16(34, 16, true);
  str(36, 'data');
  bytes.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c]?.[i] ?? 0));
      bytes.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  let bin = '';
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
