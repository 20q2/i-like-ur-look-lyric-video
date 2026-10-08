import { expect, test } from 'bun:test';
import type * as THREE from 'three';
import { PAGE_W } from '../src/engine/curl';
import { LAMP, LAMP_GLSL, LAMP_ON, lampExposure, lampKey, lampLight } from '../src/engine/lamp';
import { Book } from '../src/engine/page';
import { Sheets } from '../src/scenes/magazine/sheets';

const UP = [0, 0, 1] as const;
/** The red channel's light over a flat open spread, sampled on an n x n/2 grid. */
function spreadMax(n = 160) {
  let max = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n / 2; j++) max = Math.max(max, lampLight([-PAGE_W + (2 * PAGE_W * i) / n, j / (n / 2), 0], UP)[0]);
  return max;
}
test('the brightest point of a flat open spread is lit at the peak, never above', () => {
  expect(spreadMax()).toBeCloseTo(LAMP.peak, 2);
  expect(spreadMax()).toBeLessThanOrEqual(LAMP.peak + 1e-9);
});
test('the light falls to about half across the spread', () => {
  const near = lampLight([-PAGE_W, 1, 0], UP)[0], far = lampLight([PAGE_W, 0, 0], UP)[0];
  expect(far / near).toBeGreaterThan(0.4);
  expect(far / near).toBeLessThan(0.6);
});
test('the key is warm, the ambient cool', () => {
  const [r, g, b] = lampLight([PAGE_W / 2, 0.5, 0], UP);
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  expect(LAMP.ambColor[2]).toBeGreaterThan(LAMP.ambColor[0]);
});
test('the light is the key plus the ambient, which a surface facing away from the lamp still gets', () => {
  const P = [0.3, 0.6, 0] as const, AWAY = [0, 0, -1] as const;
  const key = lampKey(P, UP), light = lampLight(P, UP), away = lampLight(P, AWAY);
  for (const c of [0, 1, 2]) {
    expect(light[c]! - key[c]!).toBeCloseTo(LAMP.amb * LAMP.ambColor[c]!, 12);
    expect(away[c]!).toBeCloseTo(LAMP.amb * LAMP.ambColor[c]!, 12);
  }
  expect(lampKey(P, AWAY)).toEqual([0, 0, 0]);
});
test('the shaders are built from the same numbers', () => {
  const f = (x: number) => x.toFixed(6), v = (c: readonly number[]) => `vec3(${c.map(f).join(', ')})`, E = lampExposure();
  expect(LAMP_GLSL).toContain(`const vec3 LAMP_POS = ${v(LAMP.pos)};`);
  expect(LAMP_GLSL).toContain(`const vec3 LAMP_KEY_ON = ${v(LAMP.key.map((k) => E * k))};`);
  expect(LAMP_GLSL).toContain(`const vec3 LAMP_AMB = ${v(LAMP.ambColor.map((c) => LAMP.amb * c))};`);
  expect(LAMP_GLSL).toContain(`const float LAMP_FALL = ${f(LAMP.fall)};`);
});
test('every surface the lamp lights is lit by LAMP_GLSL, with no lamp of its own', () => {
  // (the book's and the sheets' materials: all there is in the world today. A surface added to it — a prop on the bed,
  // M4 — must be added here too; magazine.ts's `world` says so)
  const book = new Book(), sheets = new Sheets();
  const mats = [...book.group.children.map((o) => (o as THREE.Mesh).material as THREE.RawShaderMaterial), sheets.mat];
  expect(mats.length).toBe(9); // three leaves, two stacks, the fold-out's two panels, a cut-out piece, the sheets
  for (const m of mats) {
    expect(m.fragmentShader).toContain(LAMP_GLSL);
    expect(m.uniforms.uLampOn).toBe(LAMP_ON); // (its switch: the one shared uniform)
    expect(m.fragmentShader.replace(LAMP_GLSL, '')).not.toMatch(/uLight|uKeyNorm|LAMP_POS/);
  }
  book.dispose(); sheets.dispose();
});
