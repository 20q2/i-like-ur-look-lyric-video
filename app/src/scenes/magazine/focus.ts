// Depth of field for the magazine's world render. A thin-lens circle of confusion from the depth buffer, focused where
// the camera looks, on the page (FOCUS.pageZ above the bed): a page at the standard framings stays under SHARP, its
// type untouched, while a turning page swinging toward the lens and the magazine in the drop soften. The backdrop — the
// sheets, which write alpha 0 (sheets.ts) — gets `backdrop` px more, so the bed reads out of focus behind a sharp page
// (depth alone can't: the magazine lies on it).
// A gather blur: a golden-angle disc of TAPS samples scaled by the pixel's circle. A tap in front of the pixel counts as
// far as its own circle reaches back to it, a tap behind it as far as the larger of its circle and the pixel's lens
// circle (the lens's blur of this pixel takes in what lies behind it; the backdrop's extra doesn't reach out), both to
// within SLACK. The depth is one sub-sample and the colour the average of all four, so a blurred leaf's anti-aliased
// edge over a page reads as leaf: taking in the page behind it keeps the edge anti-aliased. Only a sample that is
// sheets alone is backdrop: a page's anti-aliased edge, half sheets, counted as half backdrop spread the page's light
// over the next 2 px of sheets (a grey rim round every page). So a sharp page leaves the sheets around it all but
// untouched (at most ~10 levels on the pixel beside it), and something blurred over them (the magazine falling, a leaf
// standing up) spills 1–2 px out onto them.
// The limit: a pixel gathers only as far as its own circle, and a sharp one not at all, so a blurred leaf over a sharp
// page softens only on its own side of its outline (a pre-pass spreading the largest circle around each pixel would
// soften the page's side too: deferred, as a render with motion blur smears the turn over the outline anyway — one with
// --samples above 1; render.ts's video takes 1 sample unless told otherwise, and there the edge shows).
import * as THREE from 'three';
import { FSPass, SCALE } from '../../engine/gl';
import { LENS } from '../../spreads/spread';

/** Circle-of-confusion radii in px at 1080p (the pass scales them by the output scale): `aperture` at |1 - focus/z| = 1,
 *  capped at `maxCoc`; `backdrop` more on the sheets. `pageZ`: the page's height above the bed the lens focuses at,
 *  piles and bow included (world units; focusDistance). Frozen: the radii are baked into the pass's uniforms when it
 *  is built. */
export const FOCUS = Object.freeze({ aperture: 8, maxCoc: 7, backdrop: 2.2, pageZ: 0.02 });
/** Thresholds in px at 1080p. A pixel whose circle is under SHARP passes through untouched — the page's budget, so the
 *  lyrics stay exactly as printed — and the blur fades in from there to FADE. A tap counts to SLACK past its reach
 *  (the reach test's anti-aliasing). */
export const SHARP = 0.35, FADE = 0.7, SLACK = 0.5;
const TAPS = 24;

/** View distance from a depth-buffer value: the inverse of three's perspective projection with these near and far
 *  planes (the CPU mirror of the pass's viewZ, which bakes in the lens's, LENS). */
export function viewZ(d: number, near: number, far: number) {
  const z = d * 2 - 1;
  return (2 * near * far) / (far + near - z * (far - near));
}
/** The circle of confusion (px at 1080p) of a point at view distance z with the lens focused at `focus`; `bg` 1 on the
 *  sheets (the CPU mirror of the pass's lens(): its lens circle with bg 0, its circle `c` with bg 1). */
export function coc(z: number, focus: number, bg = 0) {
  return Math.min(FOCUS.maxCoc, FOCUS.aperture * Math.abs(1 - focus / z) + FOCUS.backdrop * bg);
}
/** Where the lens focuses for a camera pose: the view distance of the page at the camera's target (placeCamera, in
 *  spread.ts, looks at the bed from `dist`, tilted; the page lies FOCUS.pageZ above it). */
export function focusDistance(p: { dist: number; tilt: number }) { return p.dist - Math.cos(p.tilt) * FOCUS.pageZ; }

const f = (x: number) => x.toFixed(4);
/** The pass's fragment shader (after gl.ts's GLSL_COMMON, which gives PX_SCALE). */
export const FOCUS_GLSL = /* glsl */ `
    uniform sampler2D uColor, uDepth; uniform vec2 uTexel;
    uniform float uFocus, uAperture, uMaxCoc, uBackdrop;
    const float SHARP = ${f(SHARP)}, FADE = ${f(FADE)}, SLACK = ${f(SLACK)}; // px at 1080p (focus.ts)
    const float NEAR = ${LENS.near.toFixed(6)}, FAR = ${LENS.far.toFixed(6)}; // the lens's planes (spread.ts LENS)
    float viewZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * NEAR * FAR / (FAR + NEAR - z * (FAR - NEAR)); }
    // (textureLod: neither target has mips, and the taps run after a per-pixel return, where the implicit derivatives
    // of texture() are undefined — the D3D compiler warns)
    // The lens's circle (physical px) at uv, from its depth alone; its view distance z; its circle with the backdrop's.
    float lens(vec2 uv, out float z, out float c) {
      z = viewZ(textureLod(uDepth, uv, 0.0).r);
      float bg = 1.0 - step(1.0 / 1024.0, textureLod(uColor, uv, 0.0).a); // backdrop: a footprint of sheets alone
      float l = min(uMaxCoc, uAperture * abs(1.0 - uFocus / z));
      c = min(uMaxCoc, l + uBackdrop * bg);
      return l;
    }
    void main() {
      vec3 c = texture(uColor, vUv).rgb;
      float z0, c0; float l0 = lens(vUv, z0, c0);
      // sharp: most of every page. At the standard framings a page's circle is at most 0.273 px (at FRAME_SPREAD) lying
      // flat, 0.246 raised by the rest bow's 0.012 (tests/focus.test.ts). The placeholders' camera drift (x ± 0.015,
      // y ± 0.01) takes the worst to 0.277, 0.250 with the bow, and the handheld camera adds about 0.0004 (at most 0.0005
      // at a single pose) on top: it moves only x, y and roll, so the focus stays on the page.
      if (c0 < SHARP * PX_SCALE) { fragColor = vec4(c, 1.0); return; }
      vec3 acc = c; float wsum = 1.0;
      for (int i = 1; i < ${TAPS}; i++) {
        float r = sqrt(float(i) / float(${TAPS})) * c0, th = float(i) * 2.39996323;
        vec2 uv = vUv + vec2(cos(th), sin(th)) * r * uTexel;
        float zt, ct; lens(uv, zt, ct);
        // in front: as far as its own circle reaches back here; behind: as far as this pixel's lens reaches out to it
        // (its lens's alone: with the backdrop's too, the sheets beside a page took in its edge — whose depth is often
        // a sub-sample of sheets just behind them — and the rim came back)
        float w = clamp((zt > z0 ? max(ct, l0) : ct) - r + SLACK * PX_SCALE, 0.0, 1.0);
        acc += textureLod(uColor, uv, 0.0).rgb * w; wsum += w;
      }
      fragColor = vec4(mix(c, acc / wsum, smoothstep(SHARP, FADE, c0 / PX_SCALE)), 1.0);
    }`;

export class Focus {
  private pass = new FSPass(FOCUS_GLSL, {
    uColor: { value: null }, uDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
    uFocus: { value: 2 }, // (render sets it)
    uAperture: { value: FOCUS.aperture * SCALE }, uMaxCoc: { value: FOCUS.maxCoc * SCALE }, uBackdrop: { value: FOCUS.backdrop * SCALE },
  });
  /** Blur `src` (colour + depth texture, from the magazine's camera: LENS's planes) into `out`, focused at `focus` (view
   *  distance, world units: focusDistance). */
  render(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, focus: number) {
    const u = this.pass.u;
    u.uColor!.value = src.texture; u.uDepth!.value = src.depthTexture;
    (u.uTexel!.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
    u.uFocus!.value = focus;
    this.pass.render(renderer, out);
  }
  /** Only the material is ours: an FSPass's fullscreen triangle is gl.ts's, shared by every pass. */
  dispose() { this.pass.mat.dispose(); }
}
