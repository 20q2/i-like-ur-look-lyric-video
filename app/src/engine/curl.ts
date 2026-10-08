// A leaf's shape: its page-turn curl, its rest bow and its settle, shared by the leaf and stack vertex shaders (page.ts
// builds their GLSL from these constants) and CPU code that needs to know where a leaf is (the turning leaf's shadow).
// A leaf is hinged at the spine (x = 0) and bends as a circular arc: the angle at the spine rises 0 -> PI over the turn
// while the free edge lags. At rest an open page bows up out of the gutter and lies flat beyond it (BOW); the bow fades
// out as a leaf lifts and back in as it lands, and a leaf that has just landed settles, its free edge floating up a
// little and back down (SETTLE).
import { PAGE } from './pagesize';
import { smoothstep } from './util';

/** A page's width in world units, where a page is 1 tall: the page-unit page's aspect (pagesize.ts PAGE), so the two
 *  can't disagree (770 / 1000 is exactly the double 0.77). */
export const PAGE_W = PAGE.w / PAGE.h;
/** beta: how far the free edge lags (0 = rigid page, <1 keeps every angle within 0..PI).
 *  lead: how much the top corner leads the bottom (radians at mid-turn). Frozen: LEAF_VERT (page.ts) is built from it
 *  once, as that module loads — so curlPoint takes no curl of its own, which would silently disagree with it (as
 *  bowZ takes no bow, and settleLift no settle). */
export const CURL = Object.freeze({ beta: 0.6, lead: 0.35 });

/** x (along the table from the spine), z (up) and surface angle at arc length s, turn progress u, row yN (0..1); `bow`
 *  (0..1): how much of the rest bow the leaf carries (it fades out as the leaf lifts and back in as it lands). The
 *  angle is the curl's alone: the bow raises the page without tilting it here (LEAF_VERT's normal adds its slope). */
export function curlPoint(s: number, u: number, yN = 0.5, bow = 0): { x: number; z: number; angle: number } {
  const c = CURL, lift = Math.sin(Math.PI * u);
  // With CURL.lead < 2 this pre-clamp angle is monotonic in u and never leaves [0, PI] on its own for any yN
  // (so the clamp below is pure headroom, never engaging); retuning lead >= 2 can push it past PI for yN
  // near 0 or 1, and the clamp then engages as a kink (a flattened corner), not a discontinuous jump.
  const a0 = Math.min(Math.PI, Math.max(0, Math.PI * u + c.lead * lift * (yN - 0.5)));
  const k = (-a0 * c.beta * lift) / PAGE_W;
  const a = a0 + k * s;
  const zb = bow * (1 - lift) * bowZ(s);
  if (Math.abs(k) < 1e-6) return { x: s * Math.cos(a0), z: s * Math.sin(a0) + zb, angle: a0 };
  return { x: (Math.sin(a) - Math.sin(a0)) / k, z: (Math.cos(a0) - Math.cos(a)) / k + zb, angle: a };
}

/** The rest bow: an open page rises out of the gutter over w (world units from the spine) to h above its hinge, then
 *  lies flat — z = h (1 - (1 - s/w)^2) for s < w, slope 2h/w at the spine (the gutter's crease), 0 where it meets the
 *  flat. A page carries as much of it as the pile under it allows (page.ts leafBow: a thin pile can't lift it), and
 *  the stacks' tops follow it (page.ts), so the pages keep lying on them. Frozen: BOW_GLSL is built from it once, as
 *  this module loads. */
export const BOW = Object.freeze({ h: 0.012, w: 0.11 });
export function bowZ(s: number) { const x = Math.min(1, Math.max(0, s / BOW.w)); return BOW.h * (1 - (1 - x) * (1 - x)); }
/** A landed leaf's settle: its free edge's lift (world units) dt after landing — a small damped bounce, windowed to
 *  exactly 0 by `dur`. Slow and heavily damped, so it floats up and settles back rather than rings: the camera's blend
 *  outlasts the turn (schedule.ts CAM_BLEND_S), and a bounce over before the camera stops doesn't read. Its undershoot
 *  must stay above the stack the page lies on, a leaf below it (page.ts LEAF_EPS). */
export const SETTLE = Object.freeze({ a: 0.01, hz: 2.5, tau: 0.1, dur: 0.3 });
export function settleLift(dt: number) {
  const s = SETTLE;
  if (dt <= 0 || dt >= s.dur) return 0;
  return s.a * Math.exp(-dt / s.tau) * Math.sin(2 * Math.PI * s.hz * dt) * (1 - smoothstep(0.7 * s.dur, s.dur, dt));
}
/** GLSL for the leaf and stack vertex shaders: the rest bow and its slope. */
export const BOW_GLSL = /* glsl */ `
const float BOW_H = ${BOW.h.toFixed(6)}, BOW_W = ${BOW.w.toFixed(6)};
float bowZ(float s) { float x = clamp(s / BOW_W, 0.0, 1.0); return BOW_H * (1.0 - (1.0 - x) * (1.0 - x)); }
float bowSlope(float s) { float x = clamp(s / BOW_W, 0.0, 1.0); return 2.0 * BOW_H / BOW_W * (1.0 - x); }`;
