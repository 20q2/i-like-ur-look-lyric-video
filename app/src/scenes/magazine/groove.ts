// The groove: the camera moves with the beat. A punch in
// on every beat (the downbeats harder) with a dip and a nod, a rock on the backbeat, a sway with the bar — the approved
// animatic's amounts (bounce 1.0) whenever the drums play at a normal level and nobody is singing. While a lyric is
// sung it calms to `reading` (a faint pulse): bouncing type is hard to read (the user's note, 2026-10-01), so the
// full bounce is kept for the gaps — the instrumental breaks, the bridge's ad-lib stutters, the bars between lines.
// It fades toward still once the drums drop out (a breakdown, a stop) — gated, not scaled, so a merely quiet verse
// doesn't half-punch. Off through the cover: it starts with the first inside spread. Added after the spread's pose
// and before the hand (view.ts). A pure function of t: data/audio.json's beats, downbeats and drum envelope, and the
// sung lines' spans.
import type { AudioData } from '../../engine/audio';
import { clamp, mod, smoothstep } from '../../engine/util';
import type { CameraPose } from '../../spreads/spread';

export interface Groove {
  /** Scales everything (0: off). */
  amount: number;
  /** dist x (1 - punch * hits); `downbeat` weights a downbeat's hit. */
  punch: number; downbeat: number;
  /** World units the view dips down the page per hit; radians it nods (tilts) per hit. */
  drop: number; nod: number;
  /** Radians of roll per backbeat hit (+ on beat 2, - on beat 4). */
  rock: number;
  /** One sway per bar: world units sideways, radians of roll. */
  sway: number; swayRoll: number;
  /** A hit's envelope (s): up in `attack`, then e^(-t/decay); hits older than `window` are ignored. */
  attack: number; decay: number; window: number;
  /** The drums' normalised level (a beat-wide window centred on t, roughly 0..1) is gated through
   *  smoothstep(gate[0], gate[1], level): full groove strength as soon as the drums play at a normal level, fading
   *  toward still only below that — a gate, not a volume knob, so an ordinary verse isn't a half-strength bounce. */
  gate: readonly [number, number];
  /** The groove's strength while a lyric line is sung (1: no calming). */
  reading: number;
  /** Beats: sung lines closer than this stay calm through the gap between them (no bounce flashing up mid-verse). */
  merge: number;
  /** Beats: the calm eases in over this before a line starts (so it's calm by the first word) and out after it ends. */
  ease: number;
}
/** Frozen, as the other look constants are — `gate` too (lamp.ts's pattern): a `{ ...GROOVE, ... }` variant still
 *  shares the same frozen tuple unless it overrides `gate` itself. */
export const GROOVE = Object.freeze<Groove>({
  amount: 1, punch: 0.035, downbeat: 1.5, drop: 0.006, nod: 0.035, rock: 0.015, sway: 0.004, swayRoll: 0.008,
  attack: 0.035, decay: 0.14, window: 0.8, gate: Object.freeze([0.05, 0.3] as const),
  reading: 0.15, merge: 4, ease: 1,
});

/** A sung span (a lyric line's start and end, s). */
export interface Sung { readonly start: number; readonly end: number }

/** One hit's envelope at tau s after it. */
export const hitEnv = (tau: number, g: Readonly<Groove> = GROOVE) =>
  tau < 0 ? 0 : Math.min(1, tau / g.attack) * Math.exp(-Math.max(0, tau - g.attack) / g.decay);

/** The drum energy's sample rate (Hz). */
const RATE = 60;

export class GrooveTrack {
  /** Each beat and its place in its bar (0 = a downbeat). */
  private readonly beats: readonly { readonly t: number; readonly k: number }[];
  /** Prefix sums of the drums' energy over their 95th percentile (clamped to 1), at RATE. */
  private readonly cum: Float64Array;
  private readonly beatS: number;
  /** The sung lines' spans, sorted, those closer than `merge` beats joined. */
  private readonly calm: readonly Sung[];

  /** `from`: when it starts (the first inside spread's start), fading in over a beat. `sung`: the lyric lines' spans,
   *  where it calms to `reading`. */
  constructor(private readonly audio: AudioData, private readonly from: number, private readonly g: Readonly<Groove> = GROOVE,
    sung: readonly Sung[] = []) {
    this.beatS = 60 / audio.bpm;
    const calm: { start: number; end: number }[] = [];
    for (const s of [...sung].sort((a, b) => a.start - b.start)) {
      const last = calm[calm.length - 1];
      if (last && s.start - last.end < g.merge * this.beatS) last.end = Math.max(last.end, s.end);
      else calm.push({ start: s.start, end: s.end });
    }
    this.calm = calm;
    // a beat's place in its bar (0 = downbeat): its index from the first downbeat, mod 4. The downbeats are every 4th
    // beat of analyze.py's constant-tempo grid (analysis/tests/test_data_contract.py checks they are beats); a pickup
    // before the first is beats 3 and 4 of the bar before it, not 1 and 2
    const f = Math.max(0, audio.beats.indexOf(audio.downbeats[0]!));
    this.beats = audio.beats.map((t, i) => Object.freeze({ t, k: mod(i - f, 4) }));
    const n = Math.ceil(audio.duration * RATE) + 1, e = new Float64Array(n);
    for (let i = 0; i < n; i++) e[i] = audio.env('drums', i / RATE);
    const p95 = Float64Array.from(e).sort()[Math.floor(0.95 * (n - 1))]! || 1;
    this.cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) this.cum[i + 1] = this.cum[i]! + Math.min(1, e[i]! / p95);
  }

  /** `cum`, linearly interpolated at a fractional sample index x: so the level below is continuous in t rather than
   *  stepping at each 1/60 s sample, which would otherwise make a motion-blurred frame average two discrete levels. */
  private cumAt(x: number): number {
    const n = this.cum.length - 1;
    const xc = clamp(x, 0, n);
    const i = Math.min(n - 1, Math.floor(xc));
    return this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * (xc - i);
  }

  /** The drums' normalised level in a window exactly one beat wide, centred on t. One beat wide so the window always
   *  spans a full cycle of the beat's own hits and doesn't ripple with them (a shorter, trailing window — the spec's
   *  first cut — came out lowest right at each punch's peak). Centred, not trailing: the render is offline and pure in
   *  t, so looking a half beat ahead is free to compute; its one visible cost is that the camera can anticipate a
   *  drum's return by up to half a beat — accepted because a centred window tracks a change (a build, a drop) the same
   *  on either side of it, instead of lagging a half-window behind it. */
  private level(t: number): number {
    const half = (this.beatS * RATE) / 2;
    const x = t * RATE;
    return (this.cumAt(x + half) - this.cumAt(x - half)) / (2 * half);
  }

  /** 0..1: how calm the groove is at t: 1 while a line is sung, easing in over `ease` beats before it and out after. */
  quiet(t: number): number {
    const e = this.g.ease * this.beatS;
    let q = 0;
    for (const s of this.calm) {
      if (s.start - e > t) break;
      q = Math.max(q, t < s.start ? smoothstep(s.start - e, s.start, t) : t <= s.end ? 1 : 1 - smoothstep(s.end, s.end + e, t));
    }
    return q;
  }

  /** 0..1: the groove's strength at t. Gated, not scaled, from the drums' level (see `gate`), faded in over a beat
   *  after `from`, and calmed to `reading` while a line is sung. */
  energy(t: number): number {
    if (t < this.from) return 0;
    const gate = smoothstep(this.g.gate[0], this.g.gate[1], this.level(t));
    return gate * clamp((t - this.from) / this.beatS) * (1 - (1 - this.g.reading) * this.quiet(t));
  }

  apply(p: CameraPose, t: number): CameraPose {
    const g = this.g, e = g.amount * this.energy(t);
    if (e <= 0) return p;
    let lo = 0, hi = this.beats.length; // the first beat after t
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.beats[m]!.t <= t) lo = m + 1; else hi = m; }
    let punch = 0, rock = 0;
    for (let i = lo - 1; i >= 0; i--) {
      const b = this.beats[i]!, tau = t - b.t;
      if (tau > g.window) break;
      const h = hitEnv(tau, g);
      punch += (b.k === 0 ? g.downbeat : 1) * h;
      if (b.k === 1) rock += h; else if (b.k === 3) rock -= h;
    }
    const sw = Math.sin(2 * Math.PI * this.audio.barAt(t));
    return {
      ...p,
      // the punch takes dist up to ~5.4% under the shot director's resting floor (0.9) for a fraction of a beat: the
      // face texture (PX_PER_PU 2.2 texels per page unit) is then magnified at most ~8% (a page unit is ~2.37 px on
      // screen at 1080p), motion-blurred in the export; accepted
      dist: p.dist * (1 - g.punch * e * punch),
      y: p.y - g.drop * e * punch,
      tilt: p.tilt + g.nod * e * punch,
      x: p.x + g.sway * e * sw,
      roll: p.roll + e * (g.rock * rock + g.swayRoll * sw),
    };
  }
}
