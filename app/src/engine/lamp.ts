// The bedside lamp: the magazine scene's one light, shared by every surface it lights — the pages (paper.ts), their
// stacks (page.ts) and the sheets (scenes/magazine/sheets.ts) — so no two can disagree. A warm key falling off with
// distance, a dim cool ambient, and one exposure: the brightest point of a flat open spread is lit at `peak`, so the
// lamp pool's paper prints just under the tone shoulder (post.ts, k = 0.92): lit paper, never paper white.
import { PAGE_W } from './curl';
import { clamp } from './util';

type V3 = readonly [number, number, number];
const v3 = (x: number, y: number, z: number): V3 => Object.freeze([x, y, z] as const);
export interface Lamp {
  readonly pos: V3; readonly key: V3; readonly fall: number; readonly amb: number; readonly ambColor: V3;
  readonly peak: number; readonly size: number;
}
/** Frozen, tuples and all: LAMP_GLSL and the exposure are built from it once, as this module loads. */
export const LAMP: Lamp = Object.freeze({
  /** World position: upper left, above the magazine. */
  pos: v3(-0.6, 1.4, 1.8),
  /** The key's colour, linear RGB with its largest channel 1: warm tungsten, mostly white-balanced — a bedside lamp,
   *  cream on paper rather than yellow, and the narrator's pink still reads pink. Less blue turns the kiss coral: at
   *  (1, 0.88, 0.72) its hue sat 8° off #FF2E88's, the limit (3° of that is the wax's own). */
  key: v3(1.0, 0.945, 0.875),
  /** The key's distance falloff: 1 / (1 + fall d²). */
  fall: 0.35,
  /** The ambient: its level, and its colour (cool: the room at night). */
  amb: 0.08,
  ambColor: v3(0.62, 0.72, 0.95),
  /** The light on the red channel at the brightest point of a flat open spread. */
  peak: 0.97,
  /** Its size (world units), as the turning leaf's shadow sees it (page.ts turnShadow): the penumbra either side of
   *  the shadow's edge is half of it times (the leaf edge's height above the page) / (the lamp's height above the
   *  edge), so a lifted leaf casts a soft edge and a landing one a sharp edge. */
  size: 0.3,
});
const UP = v3(0, 0, 1);

/** The key's lambert with falloff at P with normal n: no colour, no exposure. */
function keyFactor(P: V3, n: V3) {
  const x = LAMP.pos[0] - P[0], y = LAMP.pos[1] - P[1], z = LAMP.pos[2] - P[2];
  const d = Math.hypot(x, y, z);
  return Math.max(0, (x * n[0] + y * n[1] + z * n[2]) / d) / (1 + LAMP.fall * d * d);
}
/** The exposure: the key's scale that lights the brightest point of a flat open spread (z = 0, facing up) at `peak` on
 *  the red channel, the ambient included. Facing up, the key only falls with the distance from the lamp's foot, so
 *  that point is the spread's nearest to the foot. */
export function lampExposure() {
  const top = keyFactor([clamp(LAMP.pos[0], -PAGE_W, PAGE_W), clamp(LAMP.pos[1], 0, 1), 0], UP);
  return (LAMP.peak - LAMP.amb * LAMP.ambColor[0]) / (top * LAMP.key[0]);
}
const E = lampExposure();
/** The lamp's key at P with normal n: linear RGB, exposure included, no ambient (the CPU mirror of LAMP_GLSL's
 *  lampKey). */
export function lampKey(P: V3, n: V3): [number, number, number] {
  const k = E * keyFactor(P, n);
  return [k * LAMP.key[0], k * LAMP.key[1], k * LAMP.key[2]];
}
/** The lamp's light at P with normal n: its key plus the ambient (the CPU mirror of LAMP_GLSL's lampLight). */
export function lampLight(P: V3, n: V3): [number, number, number] {
  const k = lampKey(P, n);
  return [0, 1, 2].map((c) => k[c]! + LAMP.amb * LAMP.ambColor[c]!) as [number, number, number];
}

/** The lamp's switch, 0 (off: the room's ambient alone) to 1 (on): one uniform object, shared by every material the
 *  lamp lights (each lists it as `uLampOn` in its uniforms), set each frame by Magazine.render from the open spread's
 *  Spread.lamp. It scales the key and so every reflection of it (LAMP_KEY is their unit). */
export const LAMP_ON = { value: 1 };

const f = (x: number) => x.toFixed(6);
/**
 * GLSL for every shader the lamp lights (after GLSL_COMMON): its constants, its key and its light. LAMP_KEY, the
 * exposed key, is also the unit of every reflection of the lamp: each reflection's weight (the stocks' sheen in
 * page.ts, the wax's in paper.ts, the sheets' sheen) is relative to it, so `peak` rescales the reflections with the
 * diffuse light.
 */
export const LAMP_GLSL = /* glsl */ `
const vec3 LAMP_POS = vec3(${f(LAMP.pos[0])}, ${f(LAMP.pos[1])}, ${f(LAMP.pos[2])});
uniform float uLampOn; // (LAMP_ON)
const vec3 LAMP_KEY_ON = vec3(${f(E * LAMP.key[0])}, ${f(E * LAMP.key[1])}, ${f(E * LAMP.key[2])}); // colour x exposure
#define LAMP_KEY (LAMP_KEY_ON * uLampOn)
const vec3 LAMP_AMB = vec3(${f(LAMP.amb * LAMP.ambColor[0])}, ${f(LAMP.amb * LAMP.ambColor[1])}, ${f(LAMP.amb * LAMP.ambColor[2])});
const float LAMP_FALL = ${f(LAMP.fall)};
/** The lamp's key at P with normal n: its lambert with falloff, exposure included, no ambient (what a shadow of the
 *  lamp takes). Also gives the unit direction to the lamp and the key's falloff, which its reflections use. */
vec3 lampKey(vec3 P, vec3 n, out vec3 L, out float fall) {
  vec3 Lv = LAMP_POS - P; float d = length(Lv); L = Lv / d;
  fall = 1.0 / (1.0 + LAMP_FALL * d * d);
  return LAMP_KEY * max(dot(n, L), 0.0) * fall;
}
/** The lamp's light at P with normal n: its key plus the ambient. */
vec3 lampLight(vec3 P, vec3 n, out vec3 L, out float fall) { return lampKey(P, n, L, fall) + LAMP_AMB; }`;
