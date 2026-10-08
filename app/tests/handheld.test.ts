import { expect, test } from 'bun:test';
import { H, W } from '../src/engine/gl';
import { fbm1 } from '../src/engine/util';
import { HANDHELD, handheld } from '../src/scenes/magazine/handheld';
import { FRAME_SPREAD, LENS, type CameraPose } from '../src/spreads/spread';

/** px per world unit at the target's distance, at 1080p (the lens's vertical field of view over the frame's height). */
const pxPerUnit = (p: CameraPose) => H / (2 * p.dist * Math.tan((LENS.fov * Math.PI) / 360));
const offsetPx = (p: CameraPose, t: number) => { const q = handheld(p, t); return Math.hypot(q.x - p.x, q.y - p.y) * pxPerUnit(p); };
const FRAMES = Array.from({ length: 60 * 180 }, (_, i) => i / 60); // three minutes of frames

test('the same t gives the same pose', () => {
  for (const t of [0, 1.234, 99.9]) expect(handheld(FRAME_SPREAD, t)).toEqual(handheld(FRAME_SPREAD, t));
});
test('amount 0 is locked off', () => {
  expect(handheld(FRAME_SPREAD, 12.3, { ...HANDHELD, amount: 0 })).toEqual(FRAME_SPREAD);
});
test('at the spread framing it moves the image a pixel or two, no more', () => {
  const max = Math.max(...FRAMES.map((t) => offsetPx(FRAME_SPREAD, t)));
  expect(max).toBeGreaterThan(0.5);
  expect(max).toBeLessThan(2.5);
});
test('frame to frame it never jumps', () => {
  let maxStep = 0;
  for (let i = 1; i < FRAMES.length; i++) {
    const a = handheld(FRAME_SPREAD, FRAMES[i - 1]!), b = handheld(FRAME_SPREAD, FRAMES[i]!);
    maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.y - a.y) * pxPerUnit(FRAME_SPREAD));
  }
  expect(maxStep).toBeLessThan(0.25);
});
/** The share of frames on which a motion in the plane (any units) moves under a tenth of its median speed. */
function slowFraction(at: (t: number) => readonly [number, number]) {
  const speed = FRAMES.slice(1).map((t, i) => { const a = at(FRAMES[i]!), b = at(t); return Math.hypot(b[0] - a[0], b[1] - a[1]); });
  const median = [...speed].sort((a, b) => a - b)[speed.length >> 1]!;
  return speed.filter((s) => s < 0.1 * median).length / speed.length;
}
test('the sway keeps moving: under a tenth of its median speed on fewer than 2% of frames', () => {
  // (fbm's octaves unshifted, all had zero slope at each integer x: the sway stopped dead in both axes every 3.3 s,
  // 5.8% of frames under a tenth of its median speed, for up to 23 frames at a time; util.ts fbm1)
  const sway = { ...HANDHELD, tremor: 0 };
  expect(slowFraction((t) => { const q = handheld(FRAME_SPREAD, t, sway); return [q.x, q.y] as const; })).toBeLessThan(0.02);
});
test("the sway's noise keeps moving for any seeds: under 2% for each of 50 other pairs", () => {
  // (the sway's noise, 3 octaves at swayHz, with seeds 1 to 100 for x and y. The worst of these pairs is 1.29%, of 500
  // 1.52%; with a random phase per octave, 6 of 500 went over, the worst at 3.7%)
  let worst = 0;
  for (let j = 0; j < 50; j++) {
    const sx = 2 * j + 1, sy = 2 * j + 2, noise = (t: number) => [fbm1(t * HANDHELD.swayHz, 3, sx), fbm1(t * HANDHELD.swayHz, 3, sy)] as const;
    worst = Math.max(worst, slowFraction(noise));
  }
  expect(worst).toBeLessThan(0.02);
});
test('closer in, the same hand moves the image a little more, never much more', () => {
  const far = Math.max(...FRAMES.map((t) => offsetPx(FRAME_SPREAD, t)));
  for (const dist of [1.0, 0.2]) { // the cover's close-up, and far closer than any framing (the growth's cap)
    const near = Math.max(...FRAMES.map((t) => offsetPx({ ...FRAME_SPREAD, dist }, t)));
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThan(1.6 * far);
  }
});
test('its roll is a hint: well under a pixel of turn at the frame edge', () => {
  const maxRoll = Math.max(...FRAMES.map((t) => Math.abs(handheld(FRAME_SPREAD, t).roll - FRAME_SPREAD.roll)));
  expect(maxRoll * (W / 2)).toBeLessThan(1);
});
