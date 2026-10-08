// Global post-processing: bloom (HDR highlights only), chromatic aberration, a contrast curve under the scene's lit
// paper, tone shoulder above paper white, grain (a printed page's or a sensor's), vignette, fades/flash.
// Operates on the composited HDR (linear) frame.
import * as THREE from 'three';
import { FSPass, makeRT, W, H, SCALE } from './gl';
import { LIN } from './palette';

/** The tone shoulder (linear HDR -> 0..1 linear), shared with the engine's sampling error estimate. */
export const SHOULDER_GLSL = /* glsl */ `
vec3 shoulder(vec3 x) {
  // Below k (paper, #F2EDE4 ≈ 0.89 linear) the tone curve itself leaves values unchanged; smooth
  // exponential shoulder above; very bright values desaturate toward white. Channels above k (sRGB ~246)
  // are compressed slightly — pure white prints ~#FCFCFC and lipstick #FF2E88 ~#FC2E88; paper has ~4
  // levels of headroom (242 on its R channel) before the shoulder engages.
  const float k = 0.92;
  vec3 y = mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
  float over = max(max(x.r, x.g), x.b);
  return mix(y, vec3(1.0), smoothstep(2.0, 12.0, over) * 0.85);
}`;

export interface PostParams {
  exposure: number;
  bloom: number; // bloom strength
  bloomThreshold: number; // where bloom's soft knee starts (threshold - knee), on the max colour channel, not luminance
  bloomKnee: number; // soft knee width
  bloomRadius: number; // 0..1 upsample spread
  halation: number; // neutral-white halation around highlights (no orange in this palette; pink is reserved for the narrator)
  ca: number; // chromatic aberration in px at the frame edge
  grain: number; // grain amplitude (sRGB units, before its tone weighting), ~0.03-0.1
  grainShadow: number; // 0..1: grain weighted to mid-tones (0, a printed page) or to shadows (1, a camera sensor)
  /** 0..~0.3: a power curve per channel, pivoted at contrastPivot. Each channel below the pivot darkens: lit paper's red
   *  stays, its green and blue deepen slightly (~1-3 levels), and near-neutrals gain saturation (~12% at 0.12). */
  contrast: number;
  /** Linear, 0 < pivot <= the shoulder's k (0.92, SHOULDER_GLSL): the contrast curve's pivot, the scene's lit paper (its
   *  red). Above k the shoulder would compress the paper the pivot is meant to hold. */
  contrastPivot: number;
  vignette: number; // 0..1; darkens paper toward the edges deliberately (a photographed page)
  fade: number; // fade to paper 0..1
  flash: number; // additive paper-white flash 0..1+
  shake: [number, number]; // frame offset in px
  zoom: number; // frame zoom (1 = none), for punch-ins on hits
  invert: number; // 0..1 invert (ink <-> paper), applied before grain
}

export const DEFAULT_POST: PostParams = {
  exposure: 1,
  bloom: 0.08,
  // Bloom's soft knee starts at threshold - knee (= 1.0 at defaults), evaluated on the max colour
  // channel (not luminance) — see the prefilter's `l = max(c.r, c.g, c.b)`. Paper sits at ~0.89 max
  // channel — with the upstream threshold of 0.85 the whole page would bloom. Lipstick's R channel is
  // already 1.0, so lipstick drawn brighter than its nominal colour (exposure, additive glow) will bloom
  // pink; otherwise only true HDR highlights such as spot gloss should bloom.
  bloomThreshold: 1.5,
  bloomKnee: 0.5,
  bloomRadius: 0.75,
  halation: 0,
  // The palette has no colour but pink: no chromatic aberration by default (it fringed every page edge
  // blue and cyan). The parameter stays for deliberate use.
  ca: 0,
  grain: 0.03,
  grainShadow: 0,
  contrast: 0,
  // only read when contrast > 0: a scene that enables contrast passes its own pivot (the magazine: its lamp-lit paper)
  contrastPivot: LIN.paper[0],
  vignette: 0.08,
  fade: 0,
  flash: 0,
  shake: [0, 0],
  zoom: 1,
  invert: 0,
};

const MIPS = 7;

export class Post {
  private prefilter: FSPass;
  private down: FSPass;
  private up: FSPass;
  private final: FSPass;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];

  constructor() {
    // the bloom pyramid stays at the logical resolution at every output scale (same radii, same look)
    let w = W >> 1, h = H >> 1;
    for (let i = 0; i < MIPS; i++) {
      this.mips.push(makeRT(Math.max(2, w), Math.max(2, h), { depthBuffer: false, pxScale: 1 }));
      this.ups.push(makeRT(Math.max(2, w), Math.max(2, h), { depthBuffer: false, pxScale: 1 }));
      w >>= 1; h >>= 1;
    }
    this.prefilter = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform vec2 texel; uniform float threshold, knee;
      void main() {
        // 4-tap box downsample + soft threshold on the max colour channel
        vec3 c = vec3(0.0);
${SCALE === 1 ? `        c += texture(src, vUv + texel * vec2(-1, -1)).rgb; c += texture(src, vUv + texel * vec2(1, -1)).rgb;
        c += texture(src, vUv + texel * vec2(-1, 1)).rgb;  c += texture(src, vUv + texel * vec2(1, 1)).rgb;
        c *= 0.25;` : `        // output scale > 1: the same 4x4-logical-px box from a SCALE x larger source, as 2x2-texel bilinear taps
        const int N = ${SCALE * 2};
        for (int j = 0; j < N; j++) for (int i = 0; i < N; i++)
          c += texture(src, vUv + texel * (vec2(float(i), float(j)) * 2.0 - float(N - 1)) / PX_SCALE).rgb;
        c /= float(N * N);`}
        c = min(c, vec3(40.0));
        float l = max(c.r, max(c.g, c.b));
        float rq = clamp(l - threshold + knee, 0.0, 2.0 * knee);
        rq = rq * rq / (4.0 * knee + 1e-5);
        float w = max(rq, l - threshold) / max(l, 1e-5);
        fragColor = vec4(c * w, 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 } });
    this.down = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform vec2 texel;
      void main() {
        // 13-tap downsample (Jimenez 2014)
        vec3 a = texture(src, vUv + texel * vec2(-2, -2)).rgb, b = texture(src, vUv + texel * vec2(0, -2)).rgb, c = texture(src, vUv + texel * vec2(2, -2)).rgb;
        vec3 d = texture(src, vUv + texel * vec2(-1, -1)).rgb, e = texture(src, vUv + texel * vec2(1, -1)).rgb;
        vec3 f = texture(src, vUv + texel * vec2(-2, 0)).rgb, g = texture(src, vUv).rgb, h = texture(src, vUv + texel * vec2(2, 0)).rgb;
        vec3 i = texture(src, vUv + texel * vec2(-1, 1)).rgb, j = texture(src, vUv + texel * vec2(1, 1)).rgb;
        vec3 k = texture(src, vUv + texel * vec2(-2, 2)).rgb, l = texture(src, vUv + texel * vec2(0, 2)).rgb, m = texture(src, vUv + texel * vec2(2, 2)).rgb;
        vec3 o = (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
        fragColor = vec4(o, 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() } });
    this.up = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D prev; uniform vec2 texel; uniform float radius;
      void main() {
        // 9-tap tent upsample of the smaller level, added to this level
        vec2 o = texel * radius;
        vec3 s = texture(src, vUv - o).rgb + 2.0 * texture(src, vUv + vec2(0, -o.y)).rgb + texture(src, vUv + vec2(o.x, -o.y)).rgb
          + 2.0 * texture(src, vUv + vec2(-o.x, 0)).rgb + 4.0 * texture(src, vUv).rgb + 2.0 * texture(src, vUv + vec2(o.x, 0)).rgb
          + texture(src, vUv + vec2(-o.x, o.y)).rgb + 2.0 * texture(src, vUv + vec2(0, o.y)).rgb + texture(src, vUv + o).rgb;
        fragColor = vec4(texture(prev, vUv).rgb + s / 16.0, 1.0);
      }`, { src: { value: null }, prev: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } });
    this.final = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D bloomTex; uniform sampler2D haloTex;
      uniform float exposure, bloom, halation, ca, grain, grainShadow, contrast, contrastPivot, contrastInvPivot, vignette, fade, flash, time, zoom, invert;
      uniform vec2 shake; uniform vec2 res;
      ${SHOULDER_GLSL}
      void main() {
        vec2 uv = (vUv - 0.5) / zoom + 0.5 - shake / res;
        vec2 dc = uv - 0.5;
        float r2 = dot(dc * vec2(res.x / res.y, 1.0), dc * vec2(res.x / res.y, 1.0));
        vec2 off = dc * r2 * ca / res.x * 4.0;
        vec3 col;
        col.r = texture(src, uv + off).r;
        col.g = texture(src, uv).g;
        col.b = texture(src, uv - off).b;
        vec3 bl = texture(bloomTex, uv).rgb;
        vec3 ha = texture(haloTex, uv).rgb;
        col += bl * bloom;
        col += vec3(1.0) * luma(ha) * halation; // neutral-white halation: this palette has no orange, pink is reserved for the narrator
        col *= exposure;
        // contrast: a power curve per channel, pivoted at contrastPivot. Each channel below the pivot darkens, so lit
        // paper's red stays while its green and blue deepen slightly (~1-3 levels) and near-neutrals gain saturation.
        // It scales by contrastInvPivot, the inverse taken on the CPU: dividing by the uniform came out one of two ways
        // between browser sessions, and sometimes mid-session (a background shader recompile): ~280 px 1 level apart;
        // the multiply doesn't. Skipped at 0, so the frames of scenes without it (the diagnostic cards) are exactly as
        // they were.
        if (contrast > 0.0)
          col = mix(col, contrastPivot * pow(max(col, 0.0) * contrastInvPivot, vec3(1.0 + contrast)), step(col, vec3(contrastPivot)));
        col = shoulder(col);
        col = mix(col, C_PAPER + C_INK - col, invert); // exact linear-space ink <-> paper swap
        col += C_PAPER * flash;
        // vignette: darkens paper toward the edges deliberately (a photographed page): 1 inside r 0.25, 0 from 0.95. Its
        // ramp goes through smoothstep(0, 1, .) because GLSL ES 3.00 leaves smoothstep undefined for edge0 >= edge1; this
        // form renders bit-identically to the old smoothstep(0.95, 0.25, r) on ANGLE/D3D11 (1 - smoothstep(0.25, 0.95, r)
        // moved 4-21 px a frame by 1 level).
        float v = smoothstep(0.0, 1.0, (0.95 - length(dc * vec2(1.0, 0.8))) / 0.7);
        col *= mix(1.0, v, vignette);
        col = mix(col, C_PAPER, fade);
        vec3 s = toSRGB(sat(col));
        // grain: two scales, stronger in mid-tones (a printed page) or, with grainShadow, in shadows (a sensor)
${SCALE === 1 ? `        float g1 = hash12(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5;
        float g2 = hash12(floor(gl_FragCoord.xy / 2.0) + fract(time * 7.13) * 1000.0) - 0.5;` : `        // output scale > 1: the fine grain is per physical px with its amplitude raised by PX_SCALE so its
        // power per logical px (what survives a downscale) matches 1x; the coarse grain keeps 2x2-logical-px cells
        float g1 = (hash12(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5) * PX_SCALE;
        float g2 = hash12(floor(FRAG_PX / 2.0) + fract(time * 7.13) * 1000.0) - 0.5;`}
        float lm = luma(s);
        float amt = grain * mix(0.55 + 1.2 * lm * (1.0 - lm), 0.35 + 0.9 * (1.0 - lm), grainShadow);
        s += (g1 * 0.6 + g2 * 0.4) * amt;
        s += (hash12(gl_FragCoord.xy * 1.37 + time) - 0.5) / 255.0; // dither
        fragColor = vec4(sat(s), 1.0);
      }`, {
      src: { value: null }, bloomTex: { value: null }, haloTex: { value: null },
      exposure: { value: 1 }, bloom: { value: 0.5 }, halation: { value: 0.2 }, ca: { value: 1 }, grain: { value: 0.05 },
      grainShadow: { value: 0 }, contrast: { value: 0 },
      contrastPivot: { value: DEFAULT_POST.contrastPivot }, contrastInvPivot: { value: 1 / DEFAULT_POST.contrastPivot },
      vignette: { value: 0.3 }, fade: { value: 0 }, flash: { value: 0 }, time: { value: 0 },
      zoom: { value: 1 }, invert: { value: 0 }, shake: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2(W, H) },
    });
  }

  /** Apply the chain: src (HDR linear) -> out (sRGB 8-bit target or screen). */
  render(renderer: THREE.WebGLRenderer, src: THREE.Texture, out: THREE.WebGLRenderTarget | null, p: PostParams, time: number) {
    // bloom pyramid
    this.prefilter.u.src!.value = src;
    (this.prefilter.u.texel!.value as THREE.Vector2).set(1 / W, 1 / H);
    this.prefilter.u.threshold!.value = p.bloomThreshold;
    this.prefilter.u.knee!.value = p.bloomKnee;
    this.prefilter.render(renderer, this.mips[0]!);
    for (let i = 1; i < MIPS; i++) {
      const s = this.mips[i - 1]!;
      this.down.u.src!.value = s.texture;
      (this.down.u.texel!.value as THREE.Vector2).set(1 / s.width, 1 / s.height);
      this.down.render(renderer, this.mips[i]!);
    }
    // upsample: ups[i] = mips[i] + up(ups[i+1])
    let prevTex = this.mips[MIPS - 1]!.texture;
    for (let i = MIPS - 2; i >= 0; i--) {
      const small = i === MIPS - 2 ? this.mips[MIPS - 1]! : this.ups[i + 1]!;
      this.up.u.src!.value = prevTex;
      this.up.u.prev!.value = this.mips[i]!.texture;
      (this.up.u.texel!.value as THREE.Vector2).set(1 / small.width, 1 / small.height);
      this.up.u.radius!.value = 0.5 + p.bloomRadius;
      this.up.render(renderer, this.ups[i]!);
      prevTex = this.ups[i]!.texture;
    }
    const f = this.final.u;
    f.src!.value = src;
    f.bloomTex!.value = this.ups[0]!.texture;
    f.haloTex!.value = this.ups[3]!.texture;
    f.exposure!.value = p.exposure;
    f.bloom!.value = p.bloom / 3; // pyramid sums ~MIPS levels; normalize
    f.halation!.value = p.halation;
    f.ca!.value = p.ca;
    f.grain!.value = p.grain;
    f.grainShadow!.value = p.grainShadow;
    f.contrast!.value = p.contrast;
    f.contrastPivot!.value = p.contrastPivot;
    f.contrastInvPivot!.value = 1 / p.contrastPivot; // (the curve multiplies by it: see its comment)
    f.vignette!.value = p.vignette;
    f.fade!.value = p.fade;
    f.flash!.value = p.flash;
    f.time!.value = time;
    f.zoom!.value = p.zoom;
    f.invert!.value = p.invert;
    (f.shake!.value as THREE.Vector2).set(p.shake[0], p.shake[1]);
    this.final.render(renderer, out);
  }
}
