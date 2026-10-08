import { expect, test } from 'bun:test';
import { BOW, PAGE_W, SETTLE, bowZ, curlPoint, settleLift } from '../src/engine/curl';
import { LEAF_EPS } from '../src/engine/page';

test('at rest the page lies flat on the right', () => {
  for (const s of [0, 0.3, PAGE_W]) {
    const p = curlPoint(s, 0);
    expect(p.x).toBeCloseTo(s, 9);
    expect(p.z).toBeCloseTo(0, 9);
  }
});
test('turned, it lies flat on the left', () => {
  for (const s of [0, 0.3, PAGE_W]) {
    const p = curlPoint(s, 1);
    expect(p.x).toBeCloseTo(-s, 9);
    expect(p.z).toBeCloseTo(0, 9);
  }
});
test('mid-turn the page never dips below the table and keeps its length', () => {
  for (const u of [0.05, 0.25, 0.5, 0.75, 0.95]) for (const yN of [0, 0.5, 1]) {
    let len = 0, prev = curlPoint(0, u, yN);
    for (let i = 1; i <= 200; i++) {
      const q = curlPoint((PAGE_W * i) / 200, u, yN);
      expect(q.z).toBeGreaterThanOrEqual(-1e-9);
      len += Math.hypot(q.x - prev.x, q.z - prev.z);
      prev = q;
    }
    expect(len).toBeCloseTo(PAGE_W, 3);
  }
});
test('the free edge lags behind the spine', () => {
  for (const u of [0.25, 0.5, 0.75]) expect(curlPoint(PAGE_W, u).angle).toBeLessThan(curlPoint(0, u).angle);
});
test('the spine angle stays strictly inside the sheet mid-turn', () => {
  for (const u of [0.05, 0.25, 0.5, 0.75, 0.95]) for (const yN of [0, 0.5, 1]) {
    const a = curlPoint(0, u, yN).angle;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(Math.PI);
  }
});
test('the rest bow rises out of the gutter and then lies flat', () => {
  expect(bowZ(0)).toBe(0);
  expect(bowZ(BOW.w)).toBeCloseTo(BOW.h, 12);
  expect(bowZ(PAGE_W)).toBeCloseTo(BOW.h, 12);
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const z = bowZ((PAGE_W * i) / 100); expect(z).toBeGreaterThanOrEqual(prev); prev = z; }
  // smooth where it meets the flat: the slope just before w is ~0
  expect((bowZ(BOW.w) - bowZ(BOW.w - 1e-4)) / 1e-4).toBeLessThan(0.01);
});
test('a resting page carries the bow; mid-turn it is gone', () => {
  for (const s of [0, 0.05, 0.3, PAGE_W]) {
    expect(curlPoint(s, 0, 0.5, 1).z).toBeCloseTo(bowZ(s), 9);
    expect(curlPoint(s, 1, 0.5, 1).z).toBeCloseTo(bowZ(s), 9);
    expect(curlPoint(s, 0.5, 0.5, 1).z).toBeCloseTo(curlPoint(s, 0.5, 0.5).z, 9);
  }
});
test('the bowed page never dips below the table and stretches by < 0.2% at rest, <= 0.6% through a turn', () => {
  // the bow only raises the page, leaving x the curl's, so it lengthens it a little: most where the curl tilts the
  // still-bowed part up, ~0.49% near u = 0.85
  for (let iu = 0; iu <= 40; iu++) for (const yN of [0, 0.5, 1]) {
    const u = iu / 40;
    let len = 0, prev = curlPoint(0, u, yN, 1);
    for (let i = 1; i <= 400; i++) {
      const q = curlPoint((PAGE_W * i) / 400, u, yN, 1);
      expect(q.z).toBeGreaterThanOrEqual(-1e-9);
      len += Math.hypot(q.x - prev.x, q.z - prev.z);
      prev = q;
    }
    expect(len / PAGE_W).toBeLessThan(u === 0 || u === 1 ? 1.002 : 1.006);
  }
});
test('the settle is a small damped bounce, gone by its end', () => {
  expect(settleLift(-0.01)).toBe(0);
  expect(settleLift(0)).toBe(0);
  let max = 0;
  for (let i = 1; i < 300; i++) max = Math.max(max, Math.abs(settleLift((SETTLE.dur * i) / 300)));
  expect(max).toBeGreaterThan(0.2 * SETTLE.a);
  expect(max).toBeLessThanOrEqual(SETTLE.a);
  expect(Math.abs(settleLift(SETTLE.dur - 1e-3))).toBeLessThan(1e-4);
  expect(settleLift(SETTLE.dur)).toBe(0);
  // never pulls the free edge into its stack, with half a leaf to spare: the stack's top is bowed as the page is (page.ts
  // STACK_VERT), so at rest the free edge lies a leaf above it — not BOW.h, its height above its hinge
  for (let i = 0; i <= 300; i++) expect(settleLift((SETTLE.dur * i) / 300)).toBeGreaterThan(-LEAF_EPS / 2);
});
