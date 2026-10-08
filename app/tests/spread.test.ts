import { expect, test } from 'bun:test';
import { PAGE } from '../src/engine/layout';
import { PAGE_W } from '../src/engine/curl';
import { lerpPose, pageToWorld } from '../src/spreads/spread';

test('page units map to spread space', () => {
  expect(pageToWorld('R', 0, 0)).toEqual({ x: 0, y: 1 });
  expect(pageToWorld('R', PAGE.w, PAGE.h)).toEqual({ x: PAGE_W, y: 0 });
  expect(pageToWorld('L', 0, PAGE.h)).toEqual({ x: -PAGE_W, y: 0 });
});
test('poses interpolate, distance geometrically', () => {
  const a = { x: 0, y: 0, dist: 1, tilt: 0, roll: 0 }, b = { x: 1, y: 2, dist: 4, tilt: 0.2, roll: 0.1 };
  const m = lerpPose(a, b, 0.5);
  expect(m.x).toBeCloseTo(0.5, 9);
  expect(m.y).toBeCloseTo(1, 9);
  expect(m.dist).toBeCloseTo(2, 9);
  expect(m.tilt).toBeCloseTo(0.1, 9);
  expect(m.roll).toBeCloseTo(0.05, 9);
  expect(lerpPose(a, b, 0)).toEqual(a);
});
