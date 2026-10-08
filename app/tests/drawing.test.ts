import { expect, test } from 'bun:test';
import { circle, hatchLines, makeDrawing, parsePath, partial, subdivide } from '../src/engine/drawing';

test('absolute lines', () => {
  expect(parsePath('M0 0 L10 0 L10 10')).toEqual([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]]);
});
test('relative commands and close', () => {
  expect(parsePath('m5 5 l10 0 v10 h-10 z')).toEqual([[{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }, { x: 5, y: 5 }]]);
});
test('implicit line-to after a move', () => {
  expect(parsePath('M0 0 10 0 10 10')).toEqual([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]]);
});
test('cubic Béziers are flattened', () => {
  const [p] = parsePath('M0 0 C0 10 10 10 10 0');
  expect(p!.length).toBe(17);
  expect(p![16]).toEqual({ x: 10, y: 0 });
  expect(p![8]!.x).toBeCloseTo(5, 9);
  expect(p![8]!.y).toBeCloseTo(7.5, 9);
});
test('quadratic Béziers are flattened', () => {
  const [p] = parsePath('M0 0 Q5 10 10 0');
  expect(p![8]!.x).toBeCloseTo(5, 9);
  expect(p![8]!.y).toBeCloseTo(5, 9);
});
test('several subpaths, and drawing on after a close', () => {
  expect(parsePath('M0 0 L1 0 M5 5 L6 5').length).toBe(2);
  const q = parsePath('M0 0 L10 0 L10 10 Z L0 10');
  expect(q.length).toBe(2);
  expect(q[1]).toEqual([{ x: 0, y: 0 }, { x: 0, y: 10 }]);
});
test('unsupported or malformed data is an error', () => {
  expect(() => parsePath('M0 0 A5 5 0 0 1 10 0')).toThrow();
  expect(() => parsePath('M0')).toThrow();
  expect(() => parsePath('0 0 L1 1')).toThrow();
});
test('lengths and partial drawing', () => {
  const d = makeDrawing(['M0 0 L10 0 L10 10 L0 10 Z', [{ x: 20, y: 0 }, { x: 30, y: 0 }]]);
  expect(d.total).toBeCloseTo(50, 9);
  expect(d.startLen).toEqual([0, 40]);
  const p = partial(d, 15);
  expect(p.length).toBe(1);
  expect(p[0]![p[0]!.length - 1]).toEqual({ x: 10, y: 5 });
  expect(partial(d, 45)[1]).toEqual([{ x: 20, y: 0 }, { x: 25, y: 0 }]);
  expect(d.strokes).toEqual(partial(d, 1e9)); // (strokes first: they're read-only, partial's copy isn't)
});
test('wobble is deterministic, bounded, and keeps closed shapes closed', () => {
  const a = makeDrawing([circle(0, 0, 50)], { wobble: 1.5, seed: 3 });
  const b = makeDrawing([circle(0, 0, 50)], { wobble: 1.5, seed: 3 });
  expect(a.strokes).toEqual(b.strokes);
  const s = a.strokes[0]!;
  expect(s[0]).toEqual(s[s.length - 1]);
  for (const p of s) expect(Math.abs(Math.hypot(p.x, p.y) - 50)).toBeLessThan(1.5 * Math.SQRT2 + 0.3);
});
test('subdivide limits segment length and keeps the end point exact', () => {
  const s = subdivide([{ x: 0, y: 0 }, { x: 10, y: 0 }], 3);
  expect(s.length).toBe(5);
  expect(s[4]).toEqual({ x: 10, y: 0 });
});
test('hatching a square', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const h = hatchLines(sq, 0, 2);
  expect(h.length).toBe(5);
  for (const [a, b] of h) {
    expect(a!.x).toBeCloseTo(0, 9);
    expect(b!.x).toBeCloseTo(10, 9);
    expect(a!.y).toBeCloseTo(b!.y, 9);
  }
  for (const [a, b] of hatchLines(sq, Math.PI / 2, 2)) expect(a!.x).toBeCloseTo(b!.x, 9);
});
test('hatching a concave shape gives one segment per arm', () => {
  const U = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  expect(hatchLines(U, 0, 20, 3).length).toBe(2); // the one scanline, y = 3, crosses both arms
});
test('parsePath rejects stray characters that do not tokenize', () => {
  expect(() => parsePath('M0 0 L10 e 0')).toThrow();
  expect(() => parsePath('E')).toThrow();
  expect(() => parsePath('.')).toThrow();
  expect(() => parsePath('+')).toThrow();
  const [p] = parsePath('M0 0 L1e1 0');
  expect(p![1]).toEqual({ x: 10, y: 0 });
});
test('partial does not duplicate a vertex that len lands on exactly', () => {
  const d = makeDrawing(['M0 0 L10 0 L10 10 L0 10 Z']);
  expect(partial(d, 10)).toEqual([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
});
test('partial rejects NaN but accepts Infinity', () => {
  const d = makeDrawing(['M0 0 L10 0']);
  expect(() => partial(d, NaN)).toThrow();
  expect(d.strokes).toEqual(partial(d, Infinity));
});
test('hatching skips near-zero slivers where a vertex is tangent to the scanline', () => {
  for (const [a, b] of hatchLines(circle(0, 0, 10), 0, 10, 0)) {
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeGreaterThan(1e-6);
  }
});
test('subdivide rejects a non-positive or non-finite maxSeg', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  expect(() => subdivide(pts, 0)).toThrow();
  expect(() => subdivide(pts, -1)).toThrow();
  expect(() => subdivide(pts, Infinity)).toThrow();
  expect(() => subdivide(pts, NaN)).toThrow();
});
