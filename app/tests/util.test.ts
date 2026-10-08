import { expect, test } from 'bun:test';
import { fbm2, hash } from '../src/engine/util';

// fbm2's octaves lie half a cell apart in x and in y, as fbm1's do (util.ts; fbm1's own tests are the handheld sway's,
// tests/handheld.test.ts). Unshifted, every octave had a lattice line at each integer x and y, where the sum's slope
// across them vanished: a motion made of fbm2 stalled there.

test("across its first octave's lattice lines fbm2 is steep, not still (its other octaves are mid-cell there)", () => {
  // (the slope across them averages 1.33x fbm2's slope elsewhere, 0.93x for the worst of these seeds; unshifted, 0)
  const e = 1e-4, d = (a: number, b: number) => Math.abs(a - b) / (2 * e);
  for (let seed = 1; seed <= 20; seed++) {
    const px = 64 * hash(seed), py = 64 * hash(seed, 1); // the seed's phase in x and in y
    const x0 = 3 + Math.ceil(px) - px, y0 = 3 + Math.ceil(py) - py; // on the first octave's lattice lines
    let onX = 0, onY = 0, offX = 0, offY = 0;
    for (let k = 0; k < 200; k++) {
      const a = 0.013 + k * 0.0371, b = 0.21 + k * 0.0913;
      onX += d(fbm2(x0 + e, a, 3, seed), fbm2(x0 - e, a, 3, seed));
      onY += d(fbm2(a, y0 + e, 3, seed), fbm2(a, y0 - e, 3, seed));
      offX += d(fbm2(b + e, a, 3, seed), fbm2(b - e, a, 3, seed));
      offY += d(fbm2(a, b + e, 3, seed), fbm2(a, b - e, 3, seed));
    }
    expect(onX / offX).toBeGreaterThan(0.5);
    expect(onY / offY).toBeGreaterThan(0.5);
  }
});

/** The share of steps on which a motion in the plane moves under a tenth of its median step. */
function slowFraction(at: (s: number) => readonly [number, number], steps: number, step: number) {
  let prev = at(0);
  const speed: number[] = [];
  for (let i = 1; i < steps; i++) { const q = at(i * step); speed.push(Math.hypot(q[0] - prev[0], q[1] - prev[1])); prev = q; }
  const median = [...speed].sort((a, b) => a - b)[speed.length >> 1]!;
  return speed.filter((s) => s < 0.1 * median).length / speed.length;
}
test('a motion made of fbm2 keeps moving along either axis: under a tenth of its median speed on < 2% of steps', () => {
  // (three minutes of frames at the handheld sway's lattice rate, 20 seed pairs, along x and along y. The worst is
  // 1.31%; unshifted, 5.2% along x and 6.0% along y)
  const steps = 60 * 180, step = 0.3 / 60;
  let worst = 0;
  for (let j = 0; j < 20; j++) {
    const sx = 2 * j + 1, sy = 2 * j + 2;
    worst = Math.max(worst,
      slowFraction((s) => [fbm2(s, 0.37, 3, sx), fbm2(s, 0.37, 3, sy)], steps, step),
      slowFraction((s) => [fbm2(0.37, s, 3, sx), fbm2(0.37, s, 3, sy)], steps, step));
  }
  expect(worst).toBeLessThan(0.02);
});
