// The narrator's gestures with the lipstick, as geometry for engine/lipstick.ts: a loop round something she wants, and
// the timing of a word she writes as it's sung.
import { norm } from '../engine/lyrics';
import { hash, noise1, type V2 } from '../engine/util';
import type { Box } from './shots';

/** A hand-drawn loop round a box: an ellipse on the box's centre, its radii `grow` x √2·0.82 (1.39x at the default
 *  1.2) the box's half-sizes, tilted, wobbling, drifting outward, going round `turns` times so its end overlaps its
 *  start. Every point lies outside the box's inscribed ellipse, for any seed and any aspect (tests/marks.test.ts); being
 *  round, the loop does cut across the box's corners. `grow` must be at least 1.2. Deterministic in `seed`. */
export function loopAround(box: Box, seed: number, o: { grow?: number; turns?: number } = {}): V2[] {
  const [u0, v0, u1, v1] = box, cx = (u0 + u1) / 2, cy = (v0 + v1) / 2;
  const g = o.grow ?? 1.2;
  if (!(g >= 1.2)) throw new Error(`loopAround: grow ${g} is under 1.2, the floor this guarantee (outside the box's inscribed ellipse) is computed for`);
  const rx = ((u1 - u0) / 2) * g * Math.SQRT2 * 0.82, ry = ((v1 - v0) / 2) * g * Math.SQRT2 * 0.82;
  // Outside the inscribed ellipse at any aspect: scaled so that ellipse is a unit circle, the untilted loop keeps a
  // radius >= 1.32 (grow 1.2 x √2·0.82, less the wobble's 5%). In that scale a tilt θ shears the loop's circle into an
  // ellipse whose narrowest radius is σ of it, where 1/σ − σ = sin θ·|ρ − 1/ρ| (ρ the box's aspect). Holding that to
  // 0.5 keeps σ >= 0.78, so the loop stays at >= 1.03 (r² >= 1.065): the tilt is ±0.125 rad up to ~4.2:1, and less the
  // flatter the box.
  const rho = (u1 - u0) / (v1 - v0), skew = Math.abs(rho - 1 / rho);
  const maxTilt = skew > 0 ? Math.min(0.125, Math.asin(Math.min(1, 0.5 / skew))) : 0.125;
  const tilt = (hash(seed, 1) - 0.5) * 2 * maxTilt, turns = o.turns ?? 1.12;
  const a0 = -Math.PI * 0.8 + (hash(seed, 2) - 0.5) * 0.5;
  const n = 120, pts: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, a = a0 + s * turns * 2 * Math.PI;
    const r = 1 + 0.05 * noise1(s * 5, seed) + 0.05 * s; // (the drift keeps the overlap from retracing the start)
    const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r;
    pts.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) });
  }
  return pts;
}

/** Each character's [start, end] for writing `text` as `words` are sung (for stroke.ts writtenLength): a word's
 *  letters share its span; a space waits from the word before's end to the next's start. `text` is the words joined
 *  by single spaces, each written as it's sung or with its punctuation left off ("better on me" for the sung
 *  `better` `on` `me,`): its i-th space-separated piece must match word i under `norm`. Characters are counted as
 *  strokeText counts them (code points). */
export function charTimes(text: string, words: readonly { w: string; start: number; end: number }[]): [number, number][] {
  const pieces = text.split(' ');
  if (pieces.length !== words.length || pieces.some((p, i) => norm(p) !== norm(words[i]!.w))) {
    throw new Error(`charTimes: "${text}" is not the words ${words.map((w) => `"${w.w}"`).join(' ')} joined by spaces`);
  }
  const out: [number, number][] = [];
  pieces.forEach((p, i) => {
    const w = words[i]!, n = Array.from(p).length;
    for (let k = 0; k < n; k++) out.push([w.start + ((w.end - w.start) * k) / n, w.start + ((w.end - w.start) * (k + 1)) / n]);
    if (i < words.length - 1) out.push([w.end, words[i + 1]!.start]);
  });
  return out;
}
