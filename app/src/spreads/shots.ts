// The camera language. A spread lists its shots — what to
// frame, from what angle, starting when — and the director turns them into moves that start on a beat, a sung word's
// cue, or a hit, and land on the beat grid (snaps: a fixed quarter second after their cue): 'land' overshoots its
// pose and settles back on a beat, 'glide' eases across a bar to a downbeat (or an explicit time), 'snap' jumps at
// its fixed delay. Each move starts from wherever the camera is when it starts, so the pose is continuous, even
// when a shot starts before the last one has landed. Pure functions of t.
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { H, W } from '../engine/gl';
import { PAGE, type Side } from '../engine/layout';
import { ease } from '../engine/util';
import { type CameraPose, FRAME_SPREAD, LENS, lerpPose, pageToWorld, placeCamera } from './spread';

/** A box on a page, in page units: [u0, v0, u1, v1] (origin top-left, v down). */
export type Box = readonly [u0: number, v0: number, u1: number, v1: number];
export type ShotFrame = { side: Side; box: Box } | 'spread' | { pose: CameraPose };
export type ShotMove = 'land' | 'snap' | 'glide';
/** A sung word's cue (song s): resolves to `start - LEAD`, so a snap's motion lands on the word, not after it. `w`,
 *  the word itself, is optional and used only to name it in error messages (a collision with another shot). */
export type WordCue = { start: number; w?: string };
export interface Shot {
  /** When the move starts: a beat or a hit (song s, used as given), or a sung word's cue (resolves LEAD earlier). */
  at: number | WordCue;
  frame: ShotFrame;
  /** 'top', 'low', 'ground' (ANGLES) or a tilt in radians. Default 'top'. Box frames only: 'spread' and pose frames
   *  ignore it. */
  angle?: 'top' | 'low' | 'ground' | number;
  /** Radians, + turns the image clockwise. Default 0. Box and 'spread' frames. */
  roll?: number;
  /** Default 'snap'. */
  move?: ShotMove;
  /** Land exactly then instead of on the move's own grid point. Must fall on the beat grid unless the move is
   *  'snap' (snaps are fixed-length and may set it freely). */
  until?: number;
  /** Air around the box, as a fraction of its size. Default 0.15. Box frames only. */
  pad?: number;
  /** Times the fitted distance (< 1 comes closer). Default 1. Box frames only. */
  zoom?: number;
  /** The move's own easing, 0 -> 1 over u in [0, 1] (ease(0) = 0, ease(1) = 1), in place of its `move`'s; `move` still
   *  sets when it lands. For a run of moves that must flow into one another (contactsheet.ts's pans). */
  ease?: (u: number) => number;
}
/** A planned move: from `from` at `at` to `to` at `land`, eased. `at` is the shot's resolved time (a word cue's
 *  LEAD already applied). */
export interface Move { at: number; land: number; from: CameraPose; to: CameraPose; ease: (u: number) => number }

/** Tilts of the named angles (radians; FRAME_SPREAD's is 0.1). */
export const ANGLES = Object.freeze({ top: 0.12, low: 0.8, ground: 0.95 });
/** The camera's range: at 0.9 a page unit is ~2.2 px at 1080p, where the face textures run out (faces.ts PX_PER_PU);
 *  2.1 is just wider than FRAME_SPREAD. DIST is the resting range: a 'land' overshoots below it momentarily, as the
 *  groove's punch does. A spread wider than two pages may take a range of its own (DirectorOpts.dist). */
export const DIST = Object.freeze({ min: 0.9, max: 2.1 });
/** A resting range for the camera's distance (world units), as DIST is. */
export type DistRange = { readonly min: number; readonly max: number };
/** At a turn the right page — the leaf that turns — is in frame, from at least this far. */
export const TURN_DIST = 1.6;
/** 'land's overshoot (ease.outBack's s): ~5.7% of the move past its pose, settling back. */
export const OVERSHOOT = 1.25;
/** 'land' takes at least LAND_MIN (s) to reach its beat. */
export const LAND_MIN = 0.25;
/** 'snap's fixed duration (s) — the approved animatic's jump from its cue, not a grid landing: word starts sit a
 *  median 38 ms off the eighth grid, so grid-landing 'snap' made jumps 0.12-0.34 s long and some words snap nearly
 *  3x harder than others. The animatic itself used 0.25 s for its per-word steps, 0.30 s for most other snaps, and
 *  0.50 s for its two big moves; `until` lengthens an individual snap past SNAP_S when a shot needs that. */
export const SNAP_S = 0.25;
/** A word cue leads its word by this (s): outExpo puts most of a snap's motion in its first frames, so starting
 *  LEAD early makes the visible jump land on the sung word instead of trailing it. */
export const LEAD = 0.04;
/** The margin a fitted box keeps inside the frame (NDC, a fraction of the half-frame). */
export const FIT_MARGIN = 0.03;

const cam = new THREE.PerspectiveCamera(LENS.fov, W / H, LENS.near, LENS.far);
const v3 = new THREE.Vector3();
const TAN = Math.tan((LENS.fov * Math.PI) / 360), ASPECT = W / H;

export const tiltOf = (a: Shot['angle']) => (typeof a === 'number' ? a : ANGLES[a ?? 'top']);
/** A shot's `at`, resolved to a song-second: a word cue leads by LEAD, a plain number is used as is. */
export const resolveAt = (at: Shot['at']) => (typeof at === 'number' ? at : at.start - LEAD);
const clampDist = (p: CameraPose, d: DistRange): CameraPose => ({ ...p, dist: Math.min(d.max, Math.max(d.min, p.dist)) });
/** Names a shot's resolved start for an error message: a word cue's `w`, if it has one, else the resolved time. */
const describeAt = (s: Shot, at: number): string => {
  const raw = s.at;
  return typeof raw === 'object' && raw.w !== undefined ? `word "${raw.w}" at ${at.toFixed(3)}` : JSON.stringify(raw);
};

/** A page box's extent in spread space (world units; spread.ts pageToWorld). */
export function boxCorners(side: Side, b: Box) {
  const p = pageToWorld(side, b[0], b[1]), q = pageToWorld(side, b[2], b[3]);
  return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) };
}

/** Whether a page box, at height z above the bed, is inside the frame at pose p, `margin` in from its edges (NDC). */
export function inFrame(p: CameraPose, side: Side, b: Box, z = 0, margin = 0): boolean {
  placeCamera(cam, p);
  const c = boxCorners(side, b);
  for (const [x, y] of [[c.x0, c.y0], [c.x1, c.y0], [c.x0, c.y1], [c.x1, c.y1]] as const) {
    v3.set(x, y, z).project(cam);
    if (!(Math.abs(v3.x) <= 1 - margin && Math.abs(v3.y) <= 1 - margin && v3.z < 1)) return false;
  }
  return true;
}

/** A grid of points on the bed (spread x -0.77..0.77, y 0..1, z 0), for measuring image motion. */
const BED_GRID: readonly { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number }[] = [], N = 8;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) pts.push({ x: -0.77 + (1.54 * i) / N, y: j / N });
  return pts;
})();

/** The image motion between two poses: the worst on-screen displacement of any bed point visible in either pose, as
 *  a fraction of the frame's width (NDC y scaled by 9/16, the frame's aspect, so both axes read in the same unit).
 *  The smooth contract's measure (tests/shots.test.ts, on synthetic shots: a spread exposes only camera(t), not which
 *  of its moves are snaps, so no guard measures the real spreads' moves yet). */
export function imageMotion(a: CameraPose, b: CameraPose): number {
  let worst = 0;
  for (const p of BED_GRID) {
    placeCamera(cam, a); v3.set(p.x, p.y, 0).project(cam);
    const ax = v3.x, ay = v3.y, aVisible = Math.abs(ax) <= 1 && Math.abs(ay) <= 1;
    placeCamera(cam, b); v3.set(p.x, p.y, 0).project(cam);
    const bx = v3.x, by = v3.y, bVisible = Math.abs(bx) <= 1 && Math.abs(by) <= 1;
    if (!aVisible && !bVisible) continue;
    worst = Math.max(worst, Math.hypot(bx - ax, (by - ay) * (9 / 16)) / 2);
  }
  return worst;
}

/** The pose framing `f` from `tilt` and `roll`: centred on the box, from as near as it fits in the 16:9 frame with
 *  `pad` air (its height foreshortened by the tilt, then backed off until perspective and roll both agree), times
 *  `zoom`, within `dist` (the spread's resting range, DIST unless it takes its own). 'spread' is FRAME_SPREAD (rolled);
 *  a pose frame is that pose, its distance also clamped into `dist` — the resting range nothing should ask to sit
 *  outside of. */
export function fit(f: ShotFrame, tilt: number, roll = 0, pad = 0.15, zoom = 1, dist: DistRange = DIST): CameraPose {
  if (f === 'spread') return { ...FRAME_SPREAD, roll };
  if ('pose' in f) {
    if (!(f.pose.tilt >= 0 && f.pose.tilt < Math.PI / 2)) throw new Error(`pose tilt ${f.pose.tilt} is outside [0, pi/2) — degrees passed as radians?`);
    return clampDist(f.pose, dist);
  }
  if (!(tilt >= 0 && tilt < Math.PI / 2)) throw new Error(`tilt ${tilt} is outside [0, pi/2) — degrees passed as radians?`);
  const c = boxCorners(f.side, f.box);
  const w = (c.x1 - c.x0) * (1 + pad), h = (c.y1 - c.y0) * (1 + pad) * Math.cos(tilt);
  const p: CameraPose = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, dist: Math.max(w / (2 * TAN * ASPECT), h / (2 * TAN)), tilt, roll };
  // (the estimate ignores perspective — the near half of a tilted box looms larger than its far half shrinks — and
  // a roll's rotated extent; inFrame checks the real projection, so the loop corrects for both)
  for (let i = 0; i < 60 && p.dist < dist.max && !inFrame(p, f.side, f.box, 0, FIT_MARGIN); i++) p.dist *= 1.03;
  return clampDist({ ...p, dist: p.dist * zoom }, dist);
}

// ---- the beat grid (data/audio.json's beats and downbeats; eighth notes are the beats' midpoints) ----
export const beatAtOrAfter = (a: AudioData, t: number) => a.timeOfBeat(Math.ceil(a.beatAt(t) - 1e-9));
/** The last beat at or before t. plan's own pull-back works in beat indices directly (robust to uneven spacing);
 *  this is for authors and tests reasoning about a time instead. */
export const beatAtOrBefore = (a: AudioData, t: number) => a.timeOfBeat(Math.floor(a.beatAt(t) + 1e-9));
/** The first eighth note (a beat's midpoint) at or after t. Not used by 'snap' (a fixed SNAP_S now, not grid-landed)
 *  — a helper for authors who want to land an explicit `until` on an eighth. */
export const eighthAtOrAfter = (a: AudioData, t: number) => a.timeOfBeat(Math.ceil(a.beatAt(t) * 2 - 1e-9) / 2);
const barOf = (a: AudioData) => { const d = a.downbeats; return d.length > 1 ? d[d.length - 1]! - d[d.length - 2]! : 240 / a.bpm; };
/** The first downbeat at or after t (past the last, extrapolated by the bar). */
export function downbeatAtOrAfter(a: AudioData, t: number) {
  const d = a.downbeats;
  for (const x of d) if (x >= t - 1e-9) return x;
  const last = d[d.length - 1] ?? 0, bar = barOf(a);
  return last + Math.ceil((t - last) / bar - 1e-9) * bar;
}
/** The last downbeat at or before t (t before the first downbeat: the first downbeat). */
export function downbeatAtOrBefore(a: AudioData, t: number) {
  let r = a.downbeats[0] ?? 0;
  for (const x of a.downbeats) { if (x <= t + 1e-9) r = x; else break; }
  return r;
}
/** Whether t falls on the beat grid (a beat or an eighth note) within 1 ms. */
function onGrid(a: AudioData, t: number): boolean {
  const nearestEighth = Math.round(a.beatAt(t) * 2) / 2;
  return Math.abs(a.timeOfBeat(nearestEighth) - t) < 1e-3;
}

const EASE: Record<ShotMove, (u: number) => number> = {
  land: (u) => ease.outBack(u, OVERSHOOT),
  snap: (u) => (1 - 2 ** (-10 * u)) / (1 - 2 ** -10), // outExpo, normalised so u=1 lands exactly (no pop)
  glide: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
};
function landing(a: AudioData, s: Shot, at: number): number {
  const m = s.move ?? 'snap';
  if (s.until !== undefined) {
    if (m !== 'snap' && !onGrid(a, s.until)) {
      throw new Error(`shot at ${at.toFixed(3)}: until ${s.until} is not on the beat grid (a beat or an eighth, within 1 ms) — snaps may set it freely, other moves may not`);
    }
    return s.until;
  }
  if (m === 'snap') return at + SNAP_S;
  if (m === 'glide') return downbeatAtOrAfter(a, at + barOf(a));
  return beatAtOrAfter(a, at + LAND_MIN);
}

/** The pose at t: the last move with `at <= t`, eased from its own start (a later move, started before an earlier
 *  one landed, takes over from where that one had got to); before the first shot, `start`. */
export function evaluate(moves: readonly Move[], t: number, start: CameraPose): CameraPose {
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i]!;
    if (t >= m.at) {
      const u = (t - m.at) / (m.land - m.at);
      return u >= 1 ? m.to : lerpPose(m.from, m.to, m.ease(u));
    }
  }
  return start;
}

/** Whether a pose is ready for a turn: the right page all in frame, from at least TURN_DIST. */
export const turnReady = (p: CameraPose) => p.dist >= TURN_DIST - 1e-9 && inFrame(p, 'R', [0, 0, PAGE.w, PAGE.h]);

export interface DirectorOpts {
  /** The pose before the first shot (default FRAME_SPREAD). */
  start?: CameraPose;
  /** When the next turn starts (the spread's end). Every shot must resolve to a time before it — plan throws
   *  otherwise — and the camera must be at rest there: the last move landed, its pose turnReady. If the shots don't
   *  leave it so, a two-beat 'spread' glide is added, landing on the beat at least a beat before it; if there isn't
   *  room for that either (the last shot lands too close to turnAt), plan throws rather than cut silently. None for
   *  the last spread (SpreadCtx.turnAt): nothing turns away from it, so there is no turn rule. */
  turnAt?: number;
  /** The spread's resting range for the camera's distance (default DIST), which its shots are fitted within (fit): a
   *  spread wider than the two pages needs more (the fold-out's centrefold, four pages wide). */
  dist?: DistRange;
}

export function plan(a: AudioData, shots: readonly Shot[], o: DirectorOpts = {}): Move[] {
  const start = Object.freeze({ ...(o.start ?? FRAME_SPREAD) }), dist = o.dist ?? DIST;
  if (!(dist.min > 0 && dist.min <= dist.max)) throw new Error(`dist ${JSON.stringify(dist)}: a range of distances, 0 < min <= max`);
  const moves: Move[] = [];
  const resolved = shots.map((s) => ({ s, at: resolveAt(s.at) })).sort((x, y) => x.at - y.at);
  for (let i = 1; i < resolved.length; i++) {
    if (Math.abs(resolved[i]!.at - resolved[i - 1]!.at) < 1e-6) {
      throw new Error(`two shots both resolve to the same start, ${resolved[i]!.at.toFixed(3)}: ${describeAt(resolved[i - 1]!.s, resolved[i - 1]!.at)} and ${describeAt(resolved[i]!.s, resolved[i]!.at)} — give them distinct times`);
    }
  }
  if (o.turnAt !== undefined) {
    for (const { s, at } of resolved) {
      if (at >= o.turnAt) throw new Error(`shot ${describeAt(s, at)} starts at or after the turn at ${o.turnAt.toFixed(3)}`);
    }
  }
  const add = (s: Shot, at: number) => {
    const land = landing(a, s, at);
    if (!(land > at)) throw new Error(`shot at ${at.toFixed(3)}: lands at ${land.toFixed(3)}, not after it starts`);
    const to = Object.freeze(fit(s.frame, tiltOf(s.angle), s.roll ?? 0, s.pad, s.zoom, dist));
    moves.push({ at, land, from: Object.freeze(evaluate(moves, at, start)), to, ease: s.ease ?? EASE[s.move ?? 'snap'] });
  };
  for (const { s, at } of resolved) add(s, at);
  if (o.turnAt !== undefined) {
    const last = moves[moves.length - 1];
    const landed = !last || last.land <= o.turnAt + 1e-9;
    if (!landed || !turnReady(evaluate(moves, o.turnAt, start))) {
      // L and its start are the beat indices before the turn's: robust to the song's actual spacing there (a beat
      // isn't always exactly 60/bpm long — a 0.447 s gap would throw off a time-based "turnAt - one beat").
      const idx = Math.floor(a.beatAt(o.turnAt) + 1e-9) - 1, L = a.timeOfBeat(idx), at = a.timeOfBeat(idx - 2);
      if (last && (at < last.at || at < last.land - 1e-9)) {
        throw new Error(`the last shot (at ${last.at.toFixed(3)}, landing ${last.land.toFixed(3)}) leaves no room for the two-beat pull-back to the spread before the turn at ${o.turnAt.toFixed(3)}: land the last by ${at.toFixed(3)}, or end it on a turn-ready shot (framing the whole right page from >= ${TURN_DIST}).`);
      }
      add({ at, frame: 'spread', move: 'glide', until: L }, at);
    }
  }
  return moves;
}

/** The spread's camera(t). */
export function director(a: AudioData, shots: readonly Shot[], o: DirectorOpts = {}): (t: number) => CameraPose {
  const moves = plan(a, shots, o), start = Object.freeze({ ...(o.start ?? FRAME_SPREAD) });
  return (t) => evaluate(moves, t, start);
}
