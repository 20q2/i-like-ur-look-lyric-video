import { expect, test } from 'bun:test';
import { type BrushOpts, principalAxes, waxParts } from '../src/engine/lipstick';
import { type V2, clamp, hash, hash3, pointAtLength, polylineLengths } from '../src/engine/util';
import { loopAround } from '../src/spreads/marks';

// The lipstick brush's geometry (lipstick.ts waxParts): the shapes a stroke is laid down with, which the GL brush
// (waxgl.ts) then rasterises. Its pixels are checked in the browser (scripts/render.ts --card lipsticktest).

const loop = loopAround([372, 330, 690, 820], 11); // spread 1's boot loop, ~1970 pu
const zigzag: V2[] = [{ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 45, y: -10 }, { x: 46, y: 60 }, { x: 120, y: 58 }, { x: 121, y: 58.5 }];
const taper = (s: number) => clamp(Math.min(s / 0.08, (1 - s) / 0.12));
const cases: [V2[], BrushOpts][] = [
  [loop, { width: 6, seed: 11 }],
  [zigzag, { width: 14, seed: 3 }],
  [zigzag, { width: 2.5, seed: 4, pressure: (s) => 0.3 + 0.7 * Math.sin(s * 9) ** 2 }],
  [loop, { width: 30, seed: 5 }],
];
const of = (pts: V2[], len: number, o: BrushOpts) => {
  const L = polylineLengths(pts), total = L[L.length - 1]!;
  return { L, total, end: Math.min(len, total), w: waxParts(pts, L, total, Math.min(len, total), o) };
};

test('hash3 is hash of three numbers (the brush hashes with it)', () => {
  for (let i = 0; i < 20000; i++) {
    const a = (i * 7919) % 1001 - 500 + (i % 7) * 0.37, b = (i * 104729) % 5003, c = (i % 13) - 4;
    expect(hash3(a, b, c)).toBe(hash(a, b, c));
  }
});

test("the brush lays down exactly the shapes it always has: every dab, streak point and fleck, as hashed", () => {
  // the reference: the loops of the Canvas2D brush the GL one replaced (its stamp(), before it drew anything)
  for (const [pts, o] of cases) for (const len of [7, 333, Infinity]) {
    const { L, total, end, w } = of(pts, len, o);
    const prAt = (s: number) => clamp((o.pressure ?? taper)(s / total)), widthAt = (pr: number) => o.width * (0.55 + 0.45 * pr);
    const step = Math.min(Math.max(0.4, o.width * 0.1), 1.5), thin = step / Math.max(0.4, o.width * 0.1);
    let i = 0;
    for (; i * step <= end; i++) {
      const s = i * step, p = pointAtLength(pts, L, s), pr = prAt(s), wd = widthAt(pr);
      expect(Array.from(w.dabs.subarray(i * 7, i * 7 + 7))).toEqual([
        p.x + (hash(o.seed, i, 1) - 0.5) * wd * 0.06, p.y + (hash(o.seed, i, 2) - 0.5) * wd * 0.06,
        Math.cos(p.angle), Math.sin(p.angle), Math.max(0.3, wd * 0.22), wd * 0.5, 1 - Math.pow(0.72 - 0.14 * pr, thin),
      ]);
    }
    expect(w.nDabs).toBe(i);
    // the streaks' samples, in order, each run's last point repeated as the next run's first
    const sx: number[] = [];
    for (let k = 0; k < 6; k++) {
      const f = (hash(o.seed, k, 3) - 0.5) * 0.8;
      let lv = 0;
      for (let s = 0, first = true; ; s = Math.min(end, s + step * 3)) {
        const p = pointAtLength(pts, L, s), pr = prAt(s), off = f * widthAt(pr);
        const x = p.x - Math.sin(p.angle) * off, y = p.y + Math.cos(p.angle) * off, q = Math.round(pr * 8) / 8;
        sx.push(x, y);
        if (first) { lv = q; first = false; }
        else if (q !== lv || s >= end) { if (s < end) sx.push(x, y); lv = q; }
        if (s >= end) break;
      }
    }
    const got: number[] = [];
    for (let r = 0; r < w.nRuns; r++) {
      const i0 = w.runs[r * 4]!, n = w.runs[r * 4 + 1]!;
      for (let j = 0; j < n; j++) got.push(w.sx[(i0 + j) * 2]!, w.sx[(i0 + j) * 2 + 1]!);
    }
    expect(got.length).toBe(sx.length);
    got.forEach((v, k) => expect(v).toBeCloseTo(sx[k]!, 9)); // (the sin and cos of the same angle, from a table)
    let j = 0;
    for (let jj = 0; jj < Math.floor((total / o.width) * 8); jj++) {
      const s = hash(o.seed, jj, 5) * total;
      if (s > end) continue;
      const p = pointAtLength(pts, L, s), off = (hash(o.seed, jj, 6) - 0.5) * 0.9 * widthAt(prAt(s));
      const e = [p.x - Math.sin(p.angle) * off, p.y + Math.cos(p.angle) * off, Math.cos(p.angle), Math.sin(p.angle),
        o.width * (0.03 + 0.25 * hash(o.seed, jj, 8)), o.width * (0.008 + 0.018 * hash(o.seed, jj, 9)),
        0.35 + 0.4 * (Math.min(3, Math.floor(hash(o.seed, jj, 7) * 4)) + 0.5) / 4];
      Array.from(w.flecks.subarray(j * 7, j * 7 + 7)).forEach((v, k) => expect(v).toBeCloseTo(e[k]!, 9));
      j++;
    }
    expect(w.nFlecks).toBe(j);
  }
});

test("a stroke being written never re-rolls its texture: a longer one lays down the shorter one's dabs and flecks", () => {
  for (const [pts, o] of cases) {
    const total = of(pts, Infinity, o).total, a = of(pts, total * 0.4, o).w, b = of(pts, total * 0.8, o).w;
    expect(a.nDabs).toBeLessThan(b.nDabs);
    expect(Array.from(b.dabs.subarray(0, a.nDabs * 7))).toEqual(Array.from(a.dabs.subarray(0, a.nDabs * 7)));
    // a's flecks are b's that lie in its first 40 %, in the same order
    let k = 0;
    for (let j = 0; j < b.nFlecks && k < a.nFlecks; j++) {
      if (b.flecks.subarray(j * 7, j * 7 + 7).every((v, q) => v === a.flecks[k * 7 + q])) k++;
    }
    expect(k).toBe(a.nFlecks);
    expect(a.nFlecks).toBeLessThan(b.nFlecks);
  }
});

test('the streaks are six lines of runs, each run a stroke of two or more points at one quantised pressure', () => {
  for (const [pts, o] of cases) for (const len of [5, 260, Infinity]) {
    const { w } = of(pts, len, o);
    let breaks = 0;
    for (let r = 0; r < w.nRuns; r++) {
      const i0 = w.runs[r * 4]!, n = w.runs[r * 4 + 1]!, lw = w.runs[r * 4 + 2]!;
      expect(n).toBeGreaterThanOrEqual(2);
      const lv = (lw / (o.width * 0.14) - 0.55) / 0.45; // widthAt(lv) * 0.14, lv in eighths
      expect(lv * 8).toBeCloseTo(Math.round(lv * 8), 9);
      if (r > 0) {
        const p = w.runs[(r - 1) * 4]! + w.runs[(r - 1) * 4 + 1]! - 1; // the previous run's last point
        if (w.sx[p * 2] !== w.sx[i0 * 2] || w.sx[p * 2 + 1] !== w.sx[i0 * 2 + 1]) breaks++; // a new streak
      }
    }
    expect(breaks).toBe(5);
  }
});

test("every shape lies within the mark's extent: the part drawn so far, padded by 0.6 of the width", () => {
  // (lipstickStroke inks only that box: anything outside it would be cut off)
  for (const [pts, o] of cases) for (const len of [9, 250, Infinity]) {
    const { L, end, w } = of(pts, len, o);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (p: V2) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); };
    for (let i = 0; i < pts.length && L[i]! <= end; i++) grow(pts[i]!);
    grow(pointAtLength(pts, L, end));
    const r = o.width * 0.6, inside = (x: number, y: number, ex: number, ey: number) =>
      x - ex >= x0 - r && x + ex <= x1 + r && y - ey >= y0 - r && y + ey <= y1 + r;
    for (const [src, n] of [[w.dabs, w.nDabs], [w.flecks, w.nFlecks]] as const) for (let i = 0; i < n; i++) {
      const k = i * 7, cs = src[k + 2]!, sn = src[k + 3]!, rx = src[k + 4]!, ry = src[k + 5]!;
      expect(inside(src[k]!, src[k + 1]!, Math.hypot(rx * cs, ry * sn), Math.hypot(rx * sn, ry * cs))).toBe(true);
    }
    for (let ri = 0; ri < w.nRuns; ri++) {
      const i0 = w.runs[ri * 4]!, n = w.runs[ri * 4 + 1]!, hw = w.runs[ri * 4 + 2]! / 2;
      for (let j = i0; j < i0 + n; j++) expect(inside(w.sx[j * 2]!, w.sx[j * 2 + 1]!, hw, hw)).toBe(true);
    }
  }
});

test('principalAxes finds the ellipse a linear map makes of a circle: M Mᵀ = R diag(sa², sb²) Rᵀ, sa ≥ sb', () => {
  for (let i = 0; i < 2000; i++) {
    const m0 = hash(i, 1) * 8 - 4, m1 = hash(i, 2) * 8 - 4, m2 = hash(i, 3) * 8 - 4, m3 = hash(i, 4) * 8 - 4;
    const [sa, sb, ux, uy] = principalAxes(m0, m1, m2, m3);
    expect(sa).toBeGreaterThanOrEqual(sb);
    expect(Math.hypot(ux, uy)).toBeCloseTo(1, 12);
    const s = Math.max(1, sa * sa); // (M = [m0 m2; m1 m3], its columns the images of the circle's axes)
    expect((ux * ux * sa * sa + uy * uy * sb * sb) / s).toBeCloseTo((m0 * m0 + m2 * m2) / s, 9);
    expect((ux * uy * (sa * sa - sb * sb)) / s).toBeCloseTo((m0 * m1 + m2 * m3) / s, 9);
    expect((uy * uy * sa * sa + ux * ux * sb * sb) / s).toBeCloseTo((m1 * m1 + m3 * m3) / s, 9);
  }
});
