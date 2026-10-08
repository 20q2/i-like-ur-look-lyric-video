// Page-face fragment shader: print laid on paper, the lipstick marks layer over it, lit by the lamp (lamp.ts). The
// paper has long fibres along its grain and a two-scale grain; the ink soaks in unevenly (the fibres starve it); the
// paper has tooth and cockle; the coated stock reflects the lamp in a broad GGX sheen; the sheen and the tooth are set
// per face (the cover's outside is varnished: a tighter sheen, the tooth filled in); the lipstick is wax with a relief
// of its own, which catches the lamp, and a broad satin; the gutter's valley hides the paper near the spine from all
// of its light (GUTTER); the turning leaf's shadow takes the lamp's key and its reflections, and the cool ambient
// fills it. Face textures are premultiplied (see faces.ts). The leaf's back face samples the back textures mirrored.
import { PAGE } from './pagesize';

/**
 * The gutter's occlusion. The valley between the two pages hides the paper near the spine from the room and from the
 * lamp alike, so a real gutter darkens on both sides of the spine, whichever way the lamp falls (the bow's tilt alone
 * only shades the side facing away, and a valley as shallow occludes almost nothing by its geometry). Two soft terms
 * from the hinge, s world units along the page from it: the crease, deep and narrow (g1 over w1), and the valley,
 * shallow and broad (g2 over w2) — the light that reaches the paper times 1 - k (g1 exp(-(s/w1)²) + g2 exp(-(s/w2)²)),
 * k the book's opening (page.ts: 0 closed, 1 open; the turning leaf's fades out as it lifts, as its bow does). Mock A,
 * fitted with this model like for like (its rows 500–850 at the open-spread framing, ~1000 px per world unit; the paper
 * without the gutter a trend either side): g1 ~0.27 over w1 ~24 px, g2 ~0.10–0.13 over w2 ~120 px — its spine at
 * ~0.6 of its paper, 34–37 sRGB levels below it. Our paper there is ~21 levels brighter than the mock's, so the same
 * share would take ~39–42 levels: g1 and g2 are a little lower, for the mock's depth in levels (at 16 s, ~34 below the
 * page without the gutter; 37 by the same fit as the mock's). Near the spine it costs type some light — ~8% at 60 pu
 * from it, ~4% at 120 pu, ink-to-paper ratios falling by a little less — which spread authors budget against the 4.5:1
 * legibility floor (the M3.5 plan; its Task 7 writes the floor into TREATMENT). Frozen: GUTTER_GLSL is built from it
 * once, as this module loads.
 */
export const GUTTER = Object.freeze({ g1: 0.25, w1: 0.024, g2: 0.1, w2: 0.12 });
/** GLSL for the pages and the stacks' spine faces: gutterOcc(s, k), the share of its light the gutter leaves the paper
 *  s from the hinge, with the book open k. */
export const GUTTER_GLSL = /* glsl */ `
float gutterOcc(float s, float k) {
  float a = s / ${GUTTER.w1.toFixed(6)}, b = s / ${GUTTER.w2.toFixed(6)};
  return 1.0 - k * (${GUTTER.g1.toFixed(6)} * exp(-a * a) + ${GUTTER.g2.toFixed(6)} * exp(-b * b));
}`;

/**
 * Reading a face texture. Faces hold the canvas's premultiplied sRGB values in plain RGBA8 (an sRGB texture
 * format makes every canvas upload go through the CPU, see faces.ts), so this decodes them: premultiplied
 * linear out. Decoding the straight colour is also what makes partial alpha right: a hardware-decoded
 * premultiplied texel would give decode(c * a), not decode(c) * a, and darken the soft edges of bright marks.
 * Prepended to PAPER_FRAG by page.ts; always sample the face textures through it (faceAlphaLod for coverage
 * alone: alpha is stored linear, there is nothing to decode).
 */
export const FACE_TEX_GLSL = /* glsl */ `
vec4 faceTex(sampler2D s, vec2 uv) {
  vec4 c = texture(s, uv);
  return c.a > 0.0 ? vec4(toLinear(min(c.rgb / c.a, 1.0)) * c.a, c.a) : vec4(0.0);
}
float faceAlphaLod(sampler2D s, vec2 uv, float lod) { return textureLod(s, uv, lod).a; }`;

export const PAPER_FRAG = /* glsl */ `
in vec2 vUv; in vec3 vN; in vec3 vPos;
in float vGutter; // the gutter's occlusion's strength on this leaf (page.ts LEAF_VERT)
${GUTTER_GLSL}
uniform sampler2D uPrintF, uMarksF, uPrintB, uMarksB;
// three's own uniform: the camera's world position, which three uploads with the view and projection matrices to every
// program that declares it, raw shaders included — so the lamp's reflections follow the camera with no plumbing
uniform vec3 cameraPosition;
uniform vec3 uStockF, uStockB; // the leaf's front / back stock: (roughness, weight, tooth), page.ts
uniform float uShadowX, uShadowSoft, uShadowAmt, uShadowSide;
out vec4 fragColor;
const vec2 PAGE_PU = vec2(${PAGE.w.toFixed(1)}, ${PAGE.h.toFixed(1)}); // a page, in the page units spreads draw in
// The coating's tooth: a fine static relief and mottle, ~3 pu grains (~3 px at the open-spread framing, coarse enough
// to survive video compression); TOOTH_A mottles the paper's tone, TOOTH_N tilts its normal, and each face shows its
// stock's share of both (page.ts: varnish fills the tooth). Its finer octave (2.1 TOOTH_F per pu) stays within the
// fibres' ~0.45-per-px limit (see the fibres) at every standard framing (up to ~1.2 pu per px), aliasing no more than
// the fine grain does (18–31% of its rms at the standard framings), so the tooth keeps its strength there and fades
// only on a page pulled further back. Mind the cover's tilt (TOOTH_N times its share): its varnish lobe is ~0.03 rad
// wide, and a tilt as large turns its sheen into glitter. The cockle: a low soft waviness a few cm across (COCKLE_F per
// pu) that breaks up the sheen, as real paper's does, under any coating.
const float TOOTH_F = 0.18, TOOTH_A = 0.07, TOOTH_N = 0.02;
const float COCKLE_F = 0.004, COCKLE_N = 0.03;
// The sheen: GGX (Trowbridge-Reitz) with Schlick's Fresnel off a coating of F0 = SHEEN_F0, and no masking-shadowing:
// G = n·l (within ~5% of Smith-GGX at these framings); ink takes INK_SHEEN of it (duller than the coating around it,
// so type stays readable in the sheen: a quarter keeps solid black under the pages' brightest sheen at <= 45/255, where
// half lifted it to ~55).
const float SHEEN_F0 = 0.04, INK_SHEEN = 0.25;
float toothH(vec2 p) { return 0.6 * snoise(p * TOOTH_F + 21.0) + 0.4 * snoise(p * TOOTH_F * 2.1 + 37.0); }
// (r is kept off 0, a mirror, where the lobe is 0 / 0 at nh = 1; the stocks' r >= 0.22)
float ggx(float nh, float r) {
  r = max(r, 0.02); float a2 = r * r * r * r; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d);
}
// Lipstick wax. Its relief is its coverage times WAX_H (pu), with slopes read over a WAX_BLUR-pu footprint, so
// they are the same at every output scale and zoom (screen derivatives of the coverage are per physical px:
// noisy, blocky in 2x2 quads, and they change with both). The relief's glint (WAX_GLOSS, WAX_SHARP), and a broad
// satin that lifts the wax's own colour, so marks away from the lamp's reflection still read as wax without
// going pastel. The glint's and the satin's weights are relative to the lamp's exposed key, LAMP_KEY (lamp.ts), as
// every reflection of the lamp is: WAX_GLOSS and WAX_SATIN are M3's values (0.45, 0.4) in exposed-key units; retune by
// eye.
const float WAX_H = 3.5, WAX_BLUR = 1.5;
const float WAX_GLOSS = 0.21793, WAX_SHARP = 45.0;
const float WAX_SATIN = 0.19372, WAX_SATIN_E = 8.0;
/**
 * The wax coverage's slope per pu along the page's x (right) and y (down), from taps 1 pu either side. The spacing
 * goes with WAX_BLUR, the footprint the taps are read at: taps much nearer than it only see the filter's own blur
 * (weaker, smoother slopes), much further apart they step over the relief's detail. Change the two together and
 * re-tune WAX_H.
 */
vec2 waxSlope(sampler2D s, vec2 uv, float lod) {
  vec2 du = vec2(1.0 / PAGE_PU.x, 0.0), dv = vec2(0.0, 1.0 / PAGE_PU.y);
  return 0.5 * vec2(faceAlphaLod(s, uv + du, lod) - faceAlphaLod(s, uv - du, lod),
                    faceAlphaLod(s, uv - dv, lod) - faceAlphaLod(s, uv + dv, lod));
}
void main() {
  bool front = gl_FrontFacing;
  vec2 uv = front ? vUv : vec2(1.0 - vUv.x, vUv.y);
  vec4 pr = front ? faceTex(uPrintF, uv) : faceTex(uPrintB, uv);
  vec4 mk = front ? faceTex(uMarksF, uv) : faceTex(uMarksB, uv);
  vec3 n = normalize(front ? vN : -vN);
  vec2 pu = vec2(uv.x, 1.0 - uv.y) * PAGE_PU; // page units: origin top-left, y down
  // paper: long fibres along the grain + two-scale grain. Frequencies are per pu, and at the open-spread framing a
  // pu is ~1 px at 1080p (~0.9 on the cover): finer than ~0.45 / pu aliases into pixel noise (one sample per pixel).
  // The fibres' and the fine grain's detail fades out as it nears the pixel (fw: pu per px) — a pulled-back or
  // foreshortened page, where it would alias and crawl; only the detail fades, so the page's tone stays
  vec2 fw = fwidth(pu);
  float fibFade = 1.0 - smoothstep(0.55, 0.85, 0.45 * fw.x);
  float fineFade = 1.0 - smoothstep(0.55, 0.85, 0.41 * max(fw.x, fw.y));
  float fib = 0.5 + 0.5 * fibFade * snoise(pu * vec2(0.45, 0.1) + (front ? 3.1 : 17.3));
  float grain = 0.6 * snoise(pu * 0.16 + 5.0) + 0.4 * fineFade * snoise(pu * 0.41 + 11.0);
  // the stock's tooth and cockle: they tilt the normal the lamp and the sheen see. The face shows its stock's share of
  // the tooth (st.z: varnish fills it), and the tooth's detail fades as it nears the pixel (a pulled-back or
  // foreshortened page), like the fibres'; the cockle is the paper's own, under any coating
  vec3 st = front ? uStockF : uStockB; // this face's stock (page.ts): (roughness, weight, tooth)
  float toothFade = 1.0 - smoothstep(0.55, 0.85, TOOTH_F * 2.1 * max(fw.x, fw.y));
  float tooth = st.z * toothFade;
  float th = tooth * toothH(pu);
  vec2 tsl = tooth * TOOTH_N * vec2(toothH(pu + vec2(0.5, 0.0)) - toothH(pu - vec2(0.5, 0.0)),
                                    toothH(pu + vec2(0.0, 0.5)) - toothH(pu - vec2(0.0, 0.5)));
  vec2 ck = COCKLE_N * vec2(snoise(pu * COCKLE_F + 1.0), snoise(pu * COCKLE_F + 9.0));
  vec3 nP = normalize(n - (tsl.x + ck.x) * cross(vec3(0.0, 1.0, 0.0), n) + (tsl.y + ck.y) * vec3(0.0, 1.0, 0.0));
  vec3 paper = C_PAPER * (1.0 - 0.035 * grain - 0.04 * fib - TOOTH_A * th);
  // ink soaks in unevenly: the fibres starve it a little, so solid ink is never perfectly flat — only ever lighter
  // than the print (soak <= 1). Amounts are tiny because this is linear light: 1% of the paper showing through
  // lifts #141414 ink by ~14 sRGB levels. 0.005 trades ~1.5 levels of black depth (solid ink ~24-25/255) for
  // fibre texture you can actually see in the ink; much less and the ink reads flat (review of 8254fea).
  float soak = 1.0 - 0.005 * fib - 0.0004 * (0.5 + 0.5 * grain);
  vec3 col = paper * (1.0 - pr.a * soak) + pr.rgb * soak;
  // the lamp (lamp.ts): its key here, and the direction and falloff its reflections use
  vec3 L; float fall;
  vec3 key = lampKey(vPos, nP, L, fall);
  vec3 V = normalize(cameraPosition - vPos); vec3 Hh = normalize(L + V);
  // the turning leaf's shadow on this page, between the spine and its edge uShadowX (side > 0, the right page: it
  // covers x < uShadowX; the left page: x > uShadowX), with a penumbra uShadowSoft either side of the edge (page.ts
  // keeps it > 0). The leaf blocks the lamp: the shadow takes uShadowAmt of its key and of its reflections (sheen,
  // wax), and leaves the ambient, the room's light, which fills it cool as under a real lamp
  // (smoothstep needs edge0 < edge1 — GLSL leaves it undefined otherwise — so the right side is written 1 - ...)
  float covered = smoothstep(uShadowX - uShadowSoft, uShadowX + uShadowSoft, vPos.x);
  if (uShadowSide > 0.0) covered = 1.0 - covered;
  float shade = 1.0 - uShadowAmt * covered;
  // the gutter's occlusion (GUTTER): the valley hides the paper near the spine from the room and the lamp alike, so it
  // takes the key, the ambient and the reflections, and the turn shadow takes the lamp's on top of it. s is the leaf's
  // own u, from its hinge on either face (not the mirrored texture u), in world units (a page is 1 tall)
  float occ = gutterOcc(vUv.x * PAGE_PU.x / PAGE_PU.y, vGutter);
  vec3 light = occ * (key * shade + LAMP_AMB);
  col *= light;
  // the coating's sheen: the lamp's reflection, a GGX lobe (roughness st.x) weighted by st.y — broad and soft, it
  // glides over the page as the camera moves; ink takes INK_SHEEN of it. No masking-shadowing: G = n·l, the nl below
  // (within ~5% of Smith-GGX at these framings)
  float nh = max(dot(nP, Hh), 0.0), nl = max(dot(nP, L), 0.0), nv = max(dot(nP, V), 0.05);
  float fres = SHEEN_F0 + (1.0 - SHEEN_F0) * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
  float sheen = st.y * ggx(nh, st.x) * fres * nl / (4.0 * nv) * (1.0 - (1.0 - INK_SHEEN) * pr.a);
  col += LAMP_KEY * sheen * fall * shade * occ; // reflections are in the exposed key's units (lamp.ts)
  // lipstick over the print: the wax colour, lifted by its satin, and the glint off its relief. The slope taps'
  // mip level: WAX_BLUR pu, or the pixel's own footprint where that is coarser (so they never alias)
  vec2 ts = vec2(front ? textureSize(uMarksF, 0) : textureSize(uMarksB, 0));
  vec2 tx = dFdx(uv * ts), ty = dFdy(uv * ts);
  float lod = max(log2(max(ts.y / PAGE_PU.y * WAX_BLUR, 1.0)), 0.5 * log2(max(max(dot(tx, tx), dot(ty, ty)), 1.0)));
  vec2 g = mk.a > 0.0 ? (front ? waxSlope(uMarksF, uv, lod) : waxSlope(uMarksB, uv, lod)) : vec2(0.0);
  // the relief's normal in the page's own frame, built on the untilted n. A simplification: the wax's diffuse follows
  // the paper's tilted light (light, through nP), while its glint and satin see the wax's own relief alone, ignoring
  // the tooth and the cockle — a 0.5–0.8-level difference on the kiss. Up the page is world +y (leaves only curl
  // about y, and the book is never rotated, page.ts), so across it (+x in pu) is y × n on either face (a back face's u
  // and normal are both mirrored)
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 nL = normalize(n - WAX_H * (g.x * cross(up, n) - g.y * up));
  float h = max(dot(nL, Hh), 0.0);
  float glint = WAX_GLOSS * pow(h, WAX_SHARP) * mk.a * fall * shade * occ;
  float satin = WAX_SATIN * pow(h, WAX_SATIN_E) * fall * shade * occ;
  // the glint is the lamp's own colour with a faint pink of the wax it comes off
  col = col * (1.0 - mk.a) + mk.rgb * (light + satin * LAMP_KEY) + LAMP_KEY * vec3(1.0, 0.92, 0.96) * glint;
  fragColor = vec4(col, 1.0);
}`;
