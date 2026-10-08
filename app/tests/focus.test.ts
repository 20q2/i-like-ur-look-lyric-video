import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { PAGE_W } from '../src/engine/curl';
import { H, W } from '../src/engine/gl';
import { LEAVES, leafZ } from '../src/engine/page';
import { FADE, FOCUS, FOCUS_GLSL, SHARP, SLACK, coc, focusDistance, viewZ } from '../src/scenes/magazine/focus';
import { COVER_HOME } from '../src/spreads/cover';
import { type CameraPose, FRAME_SPREAD, LENS, placeCamera } from '../src/spreads/spread';

/** The magazine's camera, as Magazine builds and places it: its lens (LENS) at the output's aspect, placed by
 *  placeCamera. */
function camera(p: CameraPose) {
  const cam = new THREE.PerspectiveCamera(LENS.fov, W / H, LENS.near, LENS.far);
  placeCamera(cam, p);
  return cam;
}
/** The magazine's leaves, all of them (the rip takes one: the piles are then a leaf lower, the pages less high). */
const N = LEAVES;

test("depth-buffer values linearise back to three's view distances", () => {
  const cam = camera(FRAME_SPREAD);
  for (const z of [0.03, 0.14, 0.5, 1, 1.98, 2.25, 7, 59]) {
    const ndc = new THREE.Vector3(0, 0, -z).applyMatrix4(cam.projectionMatrix); // (applyMatrix4 divides by w)
    expect(viewZ(ndc.z * 0.5 + 0.5, cam.near, cam.far) / z).toBeCloseTo(1, 9);
  }
});
test("the lens focuses on the page at the camera's target", () => {
  for (const p of [FRAME_SPREAD, COVER_HOME, { ...FRAME_SPREAD, dist: 1, tilt: 0.4 }]) {
    const v = new THREE.Vector3(p.x, p.y, FOCUS.pageZ).applyMatrix4(camera(p).matrixWorldInverse);
    expect(-v.z).toBeCloseTo(focusDistance(p), 9);
    expect(coc(focusDistance(p), focusDistance(p))).toBe(0);
  }
  // capped, and the sheets' backdrop on top
  expect(coc(0.1, 2)).toBe(FOCUS.maxCoc);
  expect(coc(2, 2, 1)).toBeCloseTo(FOCUS.backdrop, 12);
});

/** The largest circle (px at 1080p) on the pages in frame at pose p, `onLeft` of the N leaves on the left pile (0: the
 *  cover alone, the magazine closed at the front; N: the back cover alone, closed at the back), both pages raised `raise`
 *  above their piles. */
function pageMaxCoc(p: CameraPose, onLeft: number, raise: number) {
  const cam = camera(p), z = leafZ(N, onLeft, false), focus = focusDistance(p), n = 64;
  const left = { x0: -PAGE_W, z: z.left }, right = { x0: 0, z: z.right };
  let max = 0;
  for (const page of [...(onLeft > 0 ? [left] : []), ...(onLeft < N ? [right] : [])]) {
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const P = new THREE.Vector3(page.x0 + (PAGE_W * i) / n, j / n, page.z + raise), s = P.clone().project(cam);
      if (Math.abs(s.x) > 1 || Math.abs(s.y) > 1) continue; // out of frame
      max = Math.max(max, coc(-P.applyMatrix4(cam.matrixWorldInverse).z, focus));
    }
  }
  return max;
}
test('the page stays under the sharp budget at the standard framings, piles and the bow included', () => {
  // the piles at their most uneven (a page a leaf up, the other N - 1), and the cover's own at its home (0 on the left:
  // the cover alone on all N leaves, the highest page at rest), and the closed back as the spread's framing sees it (the
  // back cover's own home is Task S13's); flat or raised 0.012 (the rest bow). Every pose a spread holds its type in
  // belongs here too (TREATMENT §6: a close, tilted hold softens the type away from its target)
  const cases: [CameraPose, number][] = [[FRAME_SPREAD, 1], [FRAME_SPREAD, N - 1], [FRAME_SPREAD, N], [COVER_HOME, 0], [COVER_HOME, 1], [COVER_HOME, N - 1]];
  for (const [p, open] of cases) for (const raise of [0, 0.012]) expect(pageMaxCoc(p, open, raise)).toBeLessThan(SHARP);
});
test("the shader is built from the same thresholds, in logical px, and the lens's planes", () => {
  expect(SHARP).toBeLessThan(FADE); // (GLSL's smoothstep is undefined unless its first edge is below its second)
  for (const x of [SHARP, FADE, SLACK]) expect(FOCUS_GLSL).toContain(x.toFixed(4));
  // the magazine's camera is LENS's (magazine.ts), so the pass bakes its planes in rather than taking them per frame
  expect(FOCUS_GLSL).toContain(`const float NEAR = ${LENS.near.toFixed(6)}, FAR = ${LENS.far.toFixed(6)};`);
  expect(FOCUS_GLSL).not.toMatch(/uNear|uFar/);
  expect(FOCUS_GLSL).toContain('c0 < SHARP * PX_SCALE');
  expect(FOCUS_GLSL).toContain('SLACK * PX_SCALE');
  expect(FOCUS_GLSL).toContain('smoothstep(SHARP, FADE, c0 / PX_SCALE)');
});
