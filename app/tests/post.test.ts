import { expect, test } from 'bun:test';
import { DEFAULT_POST, SHOULDER_GLSL } from '../src/engine/post';
import { MAGAZINE_POST } from '../src/scenes/magazine';

/** The tone shoulder's knee, k (SHOULDER_GLSL): below it the curve leaves values as they are. */
const K = Number(/const float k = ([\d.]+);/.exec(SHOULDER_GLSL)?.[1]);

test("the contrast curve pivots under the tone shoulder's knee (above it the shoulder moves the paper the pivot holds)", () => {
  expect(K).toBe(0.92);
  for (const p of [MAGAZINE_POST, DEFAULT_POST]) {
    expect(p.contrastPivot).toBeGreaterThan(0);
    expect(p.contrastPivot).toBeLessThanOrEqual(K);
  }
});
