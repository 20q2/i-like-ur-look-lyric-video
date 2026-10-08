// The physical magazine: leaves hinged at the spine, lying on page stacks, turned by a curl in the vertex
// shader (curl.ts holds the same math for the CPU). A leaf mesh spans x in [0, PAGE_W], y in [0, 1] at rest
// on the right; uTurn = 1 lays it on the left, back face up.
import * as THREE from 'three';
import { GLSL_COMMON } from './glsl/common';
import { BOW, BOW_GLSL, CURL, PAGE_W, curlPoint } from './curl';
import { FACE_TEX_GLSL, GUTTER_GLSL, PAPER_FRAG } from './paper';
import { LAMP, LAMP_GLSL, LAMP_ON } from './lamp';
import { clamp, ease, lerp, smoothstep } from './util';
import { CutPiece, type CutPose } from './cutout';

/** One leaf's thickness (world units). */
export const LEAF_EPS = 0.0016;
/** How much of the lamp's light the turning leaf's shadow takes from the pages beneath it at mid-turn: of its key and
 *  its reflections (paper.ts). The ambient is the room's, not the lamp's: it stays and fills the shadow cool. Tuned so
 *  the shadow's centre at 22.7 s is as dark as when the shadow took 0.45 of the whole light, the ambient included
 *  (74e7065). */
export const TURN_SHADOW = 0.515;
/** The turning leaf's shadow's sharpest edge: the least penumbra either side of it (world units), however low the leaf
 *  (paper.ts's smoothstep needs it > 0). */
const SHADOW_SOFT_MIN = 0.01;
/** The lamp's world x and z: where the turning leaf's shadow is cast from (turnShadow). */
const LAMP_XZ = { x: LAMP.pos[0], z: LAMP.pos[2] };
/**
 * A face's paper stock: its sheen, the lamp's reflection in the coating, is a GGX lobe of roughness `rough` weighted by
 * `spec` (paper.ts) — broad and soft, it glides over the page as the camera moves; `tooth` (0..1) is how much of the
 * paper's tooth shows, its tone and its tilt. The cover's outside is varnished: a tighter, brighter lobe than the
 * satin-coated pages', over a smoother surface (the varnish fills the tooth; the paper's cockle still shows through).
 */
export type Stock = readonly [rough: number, spec: number, tooth: number];
export const PAPER_STOCK: Stock = [0.42, 0.68, 1]; // spec relative to the exposed key (LAMP_KEY)
/** The covers' outsides are varnished; their insides (the inside front and back covers) are the same coated stock as
 *  the pages. */
export const COVER_STOCK: Stock = [0.22, 0.22, 0.35];
/** The magazine's leaves, 26 pages: leaf 0's front is the cover, leaf LEAVES - 1's back the back cover (TREATMENT §7).
 *  The flatplan (spreads/flatplan.ts) lays the spreads on them; a rip takes one out, but the leaves keep their numbers. */
export const LEAVES = 13;
/** Leaf i's [front, back] stock: the cover's outside and the back cover's are varnished (null: no leaf, a hidden page). */
const leafStock = (i: number | null): [Stock, Stock] => [i === 0 ? COVER_STOCK : PAPER_STOCK, i === LEAVES - 1 ? COVER_STOCK : PAPER_STOCK];
export interface FaceTex { print: THREE.Texture; marks: THREE.Texture }

const LEAF_VERT = /* glsl */ `
precision highp float;
#define PI 3.14159265359
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform float uTurn, uZ0, uZ1;
uniform float uBow, uSettle, uGutter;
uniform float uBowFlip; // 1 on a fold-out panel (Book): its bow counts from its free edge (below)
const float PAGE_W = ${PAGE_W.toFixed(5)};
const float BETA = ${CURL.beta.toFixed(5)};
const float LEAD = ${CURL.lead.toFixed(5)};
${BOW_GLSL}
out vec2 vUv; out vec3 vN; out vec3 vPos; out float vGutter;
void main() {
  float s = position.x, yN = position.y;
  float lift = sin(PI * uTurn);
  float a0 = clamp(PI * uTurn + LEAD * lift * (yN - 0.5), 0.0, PI);
  float k = -a0 * BETA * lift / PAGE_W;
  float a = a0 + k * s;
  // curl.ts's (sin a - sin a0) / k and (cos a0 - cos a) / k, written as the arc's chord (length s sinc(ks/2) at
  // the mean angle a0 + ks/2): in float32 those differences cancel catastrophically for small k (the very start
  // and the last few % of every turn) and shredded the landing leaf by tens of px
  float h = 0.5 * k * s, h2 = h * h;
  float sinc = abs(h) < 0.1 ? 1.0 - h2 / 6.0 + h2 * h2 / 120.0 : sin(h) / h;
  vec2 xz = s * sinc * vec2(cos(a0 + h), sin(a0 + h));
  // the rest bow (curl.ts BOW), faded out as the leaf lifts and back in as it lands; and the landed leaf's settle, its
  // free edge's lift uSettle (curl.ts settleLift), easing in from the spine. The gutter's occlusion (paper.ts GUTTER),
  // a simplification: the turning leaf's shade fades with its bow; the valley it forms with the pages beside it
  // mid-turn isn't modelled
  float bw = uBow * (1.0 - lift);
  vGutter = uGutter * (1.0 - lift);
  // A fold-out panel lies folded over the right page from the page's outer edge, its free edge at the spine: it follows
  // the page's bow from that edge, dipping from its hinge's height (the page's there, where the bow is flat), so it lies
  // a leaf above the page everywhere (Book.pose)
  float sb = mix(s, PAGE_W - s, uBowFlip);
  float zb = bw * (bowZ(sb) - uBowFlip * BOW_H) + uSettle * (s / PAGE_W) * (s / PAGE_W);
  float dzb = bw * (1.0 - 2.0 * uBowFlip) * bowSlope(sb) + uSettle * 2.0 * s / (PAGE_W * PAGE_W);
  vec3 p = vec3(xz.x, yN, mix(uZ0, uZ1, uTurn) + xz.y + zb);
  vPos = (modelMatrix * vec4(p, 1.0)).xyz;
  // the surface's tangent is (cos a, sin a + dzb) in (x, z): its normal (-(sin a + dzb), cos a)
  vN = normalize(mat3(modelMatrix) * vec3(-(sin(a) + dzb), 0.0, cos(a)));
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const STACK_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uBow, uSpine; // (uSpine: see STACK_FRAG)
out vec3 vPos; out vec3 vN;
${BOW_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  // the top of the stack follows the pages' rest bow (the page on it is a leaf above, bowed the same), its normal
  // leaning toward the spine, on its own side of it
  if (position.z > 0.0) {
    float s = abs(wp.x);
    wp.z += uBow * bowZ(s);
    if (n.z > 0.5) n = normalize(vec3(-uSpine * uBow * bowSlope(s), 0.0, 1.0));
  }
  vPos = wp.xyz; vN = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
// uSpine: which side of the spine the stack lies on (+1 right, -1 left). Its spine-side face stands in for the pages
// curving down into the binding, so it is shaded as paper at the spine: lit as if facing up, and in the gutter's
// occlusion there (paper.ts GUTTER at s = 0, uGutter the book's opening) — between the two pages beside it, which the
// rest bow (curl.ts BOW) tilts toward and away from the lamp, and untouched by the turn shadow. The spread cameras see
// it all but edge-on, filling the sub-pixel gap between the two piles' top leaves (so neither difference shows); lit as
// the side of the pile it drew a broken 1-px line down the gutter, and left out, the sheets showed through the gap
// instead.
const STACK_FRAG = /* glsl */ `
in vec3 vPos; in vec3 vN;
uniform float uSpine, uGutter;
out vec4 fragColor;
${GUTTER_GLSL}
void main() {
  vec3 n = normalize(vN);
  bool spine = dot(n, vec3(-uSpine, 0.0, 0.0)) > 0.5;
  if (spine) n = vec3(0.0, 0.0, 1.0);
  vec3 L; float fall;
  vec3 light = lampLight(vPos, n, L, fall);
  if (spine) light *= gutterOcc(0.0, uGutter);
  // a faint line at every leaf edge, at fixed heights: they don't follow the bow, so where it raises the stack's top
  // (STACK_VERT) the sides show more lines than the stack has leaves — up to twice as many, as the bow over a stack is
  // at most its height (leafBow). Sub-pixel at every framing so far
  float leaf = 0.5 + 0.5 * cos(vPos.z * TAU / ${LEAF_EPS.toFixed(5)});
  fragColor = vec4((spine ? C_PAPER : C_PAPER2 * (0.82 + 0.1 * leaf)) * light, 1.0);
}`;

export function leafGeometry(segX = 64, segY = 6) {
  const g = new THREE.PlaneGeometry(PAGE_W, 1, segX, segY);
  g.translate(PAGE_W / 2, 0.5, 0);
  return g;
}
/** A fold-out panel's geometry: leafGeometry's, its u flipped. The panel's mesh is mirrored (Book: scale.x -1), so it
 *  turns outward from its hinge, and the mirror flips its faces' u; flipping it back here prints each face upright, as
 *  it is read: the front (the panel's outside, up while folded) and the back (its inside, up while open). LEAF_VERT
 *  bends the leaf by position, not u, and the gutter's occlusion (paper.ts, by vUv.x) then counts from the panel's free
 *  edge — where panel A, folded, meets the spine. */
export function panelGeometry() {
  const g = leafGeometry(), uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  return g;
}
function blankTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
}
/** A page stack's material; `spine`: the side of the spine the stack lies on (+1 right, -1 left). */
function stackMaterial(spine: number) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: STACK_VERT,
    fragmentShader: `precision highp float;\n${GLSL_COMMON}\n${LAMP_GLSL}\n${STACK_FRAG}`,
    uniforms: { uLampOn: LAMP_ON, uSpine: { value: spine }, uBow: { value: 0 }, uGutter: { value: 0 } },
  });
}

/** The turning leaf's shadow on one page (Leaf.shadow): its edge x, the penumbra either side of it, and the share of
 *  the lamp's key and its reflections taken. */
export interface PageShadow { x: number; soft: number; amt: number }
const NO_SHADOW: PageShadow = { x: 0, soft: SHADOW_SOFT_MIN, amt: 0 };
/** Where the leaves lie in the book (Book.pose): the right and left pages; the turning leaf's hinge at the start and
 *  the end of its turn (LEAF_VERT's uZ0 and uZ1); and the heights of the stacks of leaves under the two pages, each a
 *  leaf below its page (<= 0: no stack). */
export interface LeafZ { right: number; left: number; turn0: number; turn1: number; stackR: number; stackL: number }
/** Where the leaves lie with `leaves` in the book, `onLeft` of them on the left pile and the rest on the right, the
 *  right pile's top leaf turning off it if `turning` (BookPose: counted as the spread it is turned away from shows it). */
export function leafZ(leaves: number, onLeft: number, turning: boolean): LeafZ {
  const zR = (leaves - onLeft) * LEAF_EPS, zL = onLeft * LEAF_EPS; // tops of the right / left piles
  // while the right pile's top leaf turns off it that page is a leaf lower (its stack a leaf shorter), and the turning
  // leaf's hinge goes from the right pile's top to a leaf above the left's (where it then lies as the next left page).
  // The stacks count their leaves (not page z minus a leaf) so their heights stay exact multiples of LEAF_EPS
  return {
    right: turning ? zR - LEAF_EPS : zR, left: zL, turn0: zR, turn1: zL + LEAF_EPS,
    stackR: (leaves - onLeft - (turning ? 2 : 1)) * LEAF_EPS, stackL: (onLeft - 1) * LEAF_EPS,
  };
}

/** How much of the rest bow (curl.ts BOW) a leaf can carry with `pile` (world units) of leaves under it: a thin pile
 *  can't lift a page, so it rises at most as high as the pile under it — a page with nothing under it lies flat. */
export const bowAllowed = (pile: number) => clamp(pile / BOW.h);
/**
 * How much of the rest bow each leaf can carry with the book posed as z (leafZ), before the book's opening (Book.pose
 * scales it by that): the right and left pages by the stacks under them (their stacks' tops carry the same, so the pages
 * keep lying a leaf above them), and the turning leaf as it starts, lying on the right page, and as it lands on the left
 * page — so by those pages' heights (turn0 and turn1 mean nothing while no leaf turns). The turning leaf blends from one
 * to the other with its turn (Book.pose), so each leaf keeps its bow as a turn starts and lands.
 */
export function leafBow(z: LeafZ): { right: number; left: number; turn0: number; turn1: number } {
  return { right: bowAllowed(z.stackR), left: bowAllowed(z.stackL), turn0: bowAllowed(z.right), turn1: bowAllowed(z.left) };
}

/**
 * The turning leaf's shadow on the two pages beneath it at eased turn progress p, cast from the lamp (world x and
 * z; the book is the world's frame raised by `lift`, Book.group). The free edge (at mid-height) projected from the lamp
 * onto a page is the shadow's edge there, and the shadow lies between that edge and the spine: on the right page until
 * the projected edge crosses the spine, then on the left, so the pages hand it over by themselves — no switch, the
 * penumbra slides across the spine. A higher edge casts a softer edge (the lamp is not a point: LAMP.size).
 * It keeps flat-page math: the edge is the curl's alone (curlPoint's default bow = 0) and the pages are planes at their
 * hinges' heights — the rest bow (curl.ts BOW: a percent or two of a page's height) is small enough that the flat
 * projection holds. `fade` scales it all: a ripped leaf's shadow fades out as the leaf flies off (ripPose), cast from the
 * curled leaf it was as it tore.
 */
export function turnShadow(lamp: { x: number; z: number }, p: number, z: LeafZ, lift: number, fade = 1): { right: PageShadow; left: PageShadow } {
  const e = curlPoint(PAGE_W, p);
  // as LEAF_VERT places it, less the bow: mix(uZ0, uZ1, uTurn) + the curl
  const zEdge = z.turn0 + (z.turn1 - z.turn0) * p + e.z;
  const amt = fade * TURN_SHADOW * Math.sin(Math.PI * p);
  const on = (zPage: number): PageShadow => {
    const h = zEdge - zPage, up = lamp.z - lift - zPage; // the edge's and the lamp's heights above the page
    const k = up / Math.max(up - h, 1e-3); // lamp -> edge, stretched down onto the page
    return { x: lamp.x + (e.x - lamp.x) * k, soft: Math.max(SHADOW_SOFT_MIN, 0.5 * LAMP.size * (k - 1)), amt };
  };
  return { right: on(z.right), left: on(z.left) };
}

/**
 * The rip (Task B2): the right page's leaf torn out instead of turned. Over its first `tear` of the rip the leaf curls
 * up off its free edge as a turn does, as a hand grabs it, to `curl` of a turn; then it tears free and flies, up toward
 * the camera and off to the upper right — `move` (world units) and, about its spine edge's midpoint, `rotY` and `rotZ`
 * (radians), all of it by r = `gone`: out of frame then (eased in over the whole rest of the rip, from 0.35 to 1, it was
 * still a third of the frame at 0.85 and only cleared it at ~0.98). It stays there, unseen, until the rip ends. The
 * turn shadow fades out as it flies, by `fade`.
 */
export const RIP = Object.freeze({ tear: 0.35, gone: 0.85, curl: 0.32, move: Object.freeze([0.55, 0.35, 1.6] as const), rotY: 1.1, rotZ: -0.5, fade: 0.6 });
/** The rip at progress r (0..1, linear in time: schedule.ts magState): the leaf's curl (as LEAF_VERT's uTurn), the
 *  fling's eased progress (0 until it tears, 1 from RIP.gone on), how much of the turn shadow is left, and whether the leaf
 *  is still there (it is gone at r >= 1). Continuous, with its slope, through the tear: the curl eases out to its
 *  height as the fling eases in from rest. */
export function ripPose(r: number): { curl: number; fling: number; shadow: number; shown: boolean } {
  const R = RIP;
  return {
    curl: R.curl * ease.outCubic(Math.min(1, Math.max(0, r) / R.tear)),
    fling: ease.inCubic(clamp((r - R.tear) / (R.gone - R.tear))),
    shadow: 1 - smoothstep(R.tear, R.fade, r),
    shown: r < 1,
  };
}
/** Places `o` (the turning leaf's mesh) as the torn-out leaf at fling progress f (ripPose): rotated by f of RIP.rotY and
 *  RIP.rotZ about its spine edge's midpoint, (0, 0.5, `hinge`) in the book's frame, and moved by f of RIP.move. Leaves
 *  it untransformed at f = 0. */
export function placeFling(o: THREE.Object3D, f: number, hinge: number) {
  const pivot = new THREE.Vector3(0, 0.5, hinge), [dx, dy, dz] = RIP.move;
  o.quaternion.setFromEuler(new THREE.Euler(0, RIP.rotY * f, RIP.rotZ * f));
  o.position.set(dx * f, dy * f, dz * f).add(pivot).sub(pivot.applyQuaternion(o.quaternion));
}

/** Where the fold-out's panels lie (Book.pose), at the book's z (leafZ) with the right page's bow `bowR` (what Book.pose
 *  gives it): each flat at its hinge's height, z0 = z1 — A's a leaf above the right page's outer edge (the page's hinge
 *  plus its bow, flat out there: curl.ts BOW), and B's a leaf above A's, so B lying folded on A never z-fights it. */
export function panelZ(z: LeafZ, bowR: number): { a: number; b: number } {
  const a = z.right + bowR * BOW.h + LEAF_EPS;
  return { a, b: a + LEAF_EPS };
}
/** The shadow a fold-out panel lifting at eased progress p casts on what it lies folded on (the right page for A, A for
 *  B): turnShadow's, mirrored about the panel's hinge at x = `hinge` (it turns outward, away from the spine), so it
 *  covers x > its x (Leaf.shadow side -1). The panel's hinge is at zHinge, the surface under it at zPage. */
export function panelShadow(lamp: { x: number; z: number }, p: number, hinge: number, zHinge: number, zPage: number, lift: number): PageShadow {
  const z: LeafZ = { right: zPage, left: zPage, turn0: zHinge, turn1: zHinge, stackR: 0, stackL: 0 };
  const s = turnShadow({ x: hinge - lamp.x, z: lamp.z }, p, z, lift).right;
  return { ...s, x: hinge - s.x };
}
/** How far the open panels widen the magazine's footprint (Book.footprint), world x: a page for each panel lying open,
 *  joining it as it lands, as the cover joins the left (the free edge lands last; an airborne panel casts no contact
 *  shadow). */
export function panelReach(p?: { a: number; b: number }) {
  return p ? PAGE_W * (smoothstep(0.99, 1, p.a) + smoothstep(0.99, 1, p.b)) : 0;
}

export class Leaf {
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  /** `bowFlip`: 1 on a fold-out panel, whose bow counts from its free edge (LEAF_VERT). */
  constructor(geo: THREE.BufferGeometry, private blank: THREE.Texture, bowFlip = 0) {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: LEAF_VERT,
      fragmentShader: `precision highp float;\n${GLSL_COMMON}\n${LAMP_GLSL}\n${FACE_TEX_GLSL}\n${PAPER_FRAG}`,
      uniforms: {
        uLampOn: LAMP_ON,
        uTurn: { value: 0 }, uZ0: { value: 0 }, uZ1: { value: 0 }, uBow: { value: 0 }, uSettle: { value: 0 }, uGutter: { value: 0 },
        uBowFlip: { value: bowFlip },
        uPrintF: { value: blank }, uMarksF: { value: blank }, uPrintB: { value: blank }, uMarksB: { value: blank },
        uStockF: { value: new THREE.Vector3(...PAPER_STOCK) }, uStockB: { value: new THREE.Vector3(...PAPER_STOCK) },
        uShadowX: { value: 0 }, uShadowSoft: { value: SHADOW_SOFT_MIN }, uShadowAmt: { value: 0 }, uShadowSide: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }
  /** `stock`: this leaf's [front, back] paper stocks (leafStock); `bow`: how much of the rest bow it carries at rest
   *  (Book.pose: what its pile allows, times the book's opening); `gutter`: how deep the gutter's occlusion is at rest
   *  (paper.ts GUTTER: the book's opening, whatever the pile); `settle`: its free edge's lift as it settles after
   *  landing (BookPose.settle, 0 by default). The bow and the occlusion fade out as the leaf lifts (LEAF_VERT). */
  set(o: {
    turn: number; z0: number; z1: number; front?: FaceTex; back?: FaceTex; stock: [Stock, Stock]; bow: number; gutter: number;
    settle?: number;
  }) {
    const u = this.mat.uniforms;
    u.uTurn!.value = o.turn; u.uZ0!.value = o.z0; u.uZ1!.value = o.z1;
    u.uBow!.value = o.bow; u.uGutter!.value = o.gutter; u.uSettle!.value = o.settle ?? 0;
    u.uPrintF!.value = o.front?.print ?? this.blank; u.uMarksF!.value = o.front?.marks ?? this.blank;
    u.uPrintB!.value = o.back?.print ?? this.blank; u.uMarksB!.value = o.back?.marks ?? this.blank;
    (u.uStockF!.value as THREE.Vector3).set(...o.stock[0]); (u.uStockB!.value as THREE.Vector3).set(...o.stock[1]);
  }
  /** A shadow on this page between the spine and x (side +1: the right page, covering x' < x; -1: the left page,
   *  covering x' > x), with a penumbra `soft` either side of x, taking `amt` of the lamp's key and its reflections
   *  (the ambient stays). */
  shadow(s: PageShadow & { side: number }) {
    const u = this.mat.uniforms;
    u.uShadowX!.value = s.x; u.uShadowSoft!.value = Math.max(s.soft, SHADOW_SOFT_MIN); // (paper.ts needs it > 0)
    u.uShadowAmt!.value = s.amt; u.uShadowSide!.value = s.side;
  }
}

export interface BookPose {
  /** The leaves in the book, and how many of them lie on the left pile (the rest on the right), as the spread up shows
   *  them — during a turn, the spread turned away from: the turning leaf still counted on the right pile, which it lifts
   *  off (schedule.ts bookLeaves). */
  leaves: number; onLeft: number;
  /** The leaves the pages are (null: none — the closed magazine has no left page at the front, no right page at the
   *  back): the left page is leaf `leftLeaf`'s back, the right page leaf `rightLeaf`'s front, and the turning leaf
   *  `turnLeaf`, while turnP isn't null. Each page shows while its leaf is there, in its leaf's stock (leafStock), so a
   *  face keeps its stock through a turn. */
  leftLeaf: number | null; rightLeaf: number | null; turnLeaf: number | null;
  /** Eased turn progress, or null when no turn is in progress. */
  turnP: number | null;
  /** In a rip (schedule.ts bookLeaves), its progress r (0..1): the turning leaf is torn out rather than turned. Its curl
   *  and fling are ripPose(r)'s (turnP, then, is only whether a leaf is in play); its hinge stays on the right pile, it
   *  lands nowhere, and it is hidden from r = 1. */
  rip?: number;
  /** The fold-out: the right page's gatefold panels' unfold progress (0 folded, 1 open; spread.ts Spread.panels) — none,
   *  or both 0, while a turn is in progress: a turn carries the panels folded (schedule.ts foldFaces). Panel A is hinged
   *  on the right page's outer edge and B on A's; a panel is posed while it is lifting or open (> 0), B only with A
   *  open (a = 1). */
  panels?: { a: number; b: number };
  /** Height of the whole magazine above the sheets (world units): the cover's drop (Spread.lift). */
  lift: number;
  /** The just-landed left page's settle: its free edge's lift (curl.ts settleLift). */
  settle: number;
  left?: FaceTex; turnFront?: FaceTex; turnBack?: FaceTex; right?: FaceTex;
  /** The panels' faces, front and back (schedule.ts foldFaces says which surface each shows). */
  aFront?: FaceTex; aBack?: FaceTex; bFront?: FaceTex; bBack?: FaceTex;
  /** A piece of a page, loose (spread.ts Cutout; cutout.ts), and its front's face. */
  cut?: CutPose; cutFace?: FaceTex;
}

/** The book's opening, 0..1: 0 while the magazine is closed, at either end; the cover's turn as it opens, and the last
 *  leaf's turn, run back, as it closes onto its back cover; 1 while it is open. The share of the rest bow their piles
 *  allow them (leafBow) that the pages carry, and the depth of the gutter's occlusion. */
function opening(b: BookPose) {
  const p = b.turnP, right = b.leaves - b.onLeft; // (the right pile's leaves: the turning leaf among them)
  if (p === null) return b.onLeft > 0 && right > 0 ? 1 : 0;
  return (b.onLeft === 0 ? p : 1) * (right === 1 ? 1 - p : 1);
}

export class Book {
  /** Translated only in z (the drop: pose sets it) — never in x or y, never rotated or scaled, in a world scene that is
   *  not transformed at all: the turning leaf's shadow is computed in the book's own frame (x, and z less the lift) and
   *  compared with world x in paper.ts, and paper.ts takes up the page to be world +y. pose throws otherwise. */
  group = new THREE.Group();
  private geo = leafGeometry();
  private blank = blankTexture();
  left = new Leaf(this.geo, this.blank);
  turning = new Leaf(this.geo, this.blank);
  right = new Leaf(this.geo, this.blank);
  // (segmented along x, so the tops can follow the bow: STACK_VERT)
  private stackL = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 24, 1, 1), stackMaterial(-1));
  private stackR = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 24, 1, 1), stackMaterial(1));
  /** The fold-out's panels (BookPose.panels): leaves mirrored to turn outward, A from the right page's outer edge, B from
   *  A's (panelGeometry prints their faces upright). */
  private panelGeo = panelGeometry();
  panelA = new Leaf(this.panelGeo, this.blank, 1);
  panelB = new Leaf(this.panelGeo, this.blank);
  /** A piece of a page, while it's loose (BookPose.cut). */
  cut = new CutPiece(this.blank, PAPER_STOCK);
  constructor() {
    this.group.add(this.left.mesh, this.turning.mesh, this.right.mesh, this.stackL, this.stackR, this.cut.mesh);
    this.panelA.mesh.position.x = PAGE_W; this.panelB.mesh.position.x = 2 * PAGE_W;
    for (const p of [this.panelA, this.panelB]) { p.mesh.scale.x = -1; p.mesh.visible = false; this.group.add(p.mesh); }
  }
  pose(b: BookPose) {
    this.checkPlacement();
    const turning = b.turnP !== null;
    if (turning !== (b.turnLeaf !== null)) throw new Error(`the book's pose turns ${turning ? `at p ${b.turnP}` : 'nothing'}, but its turning leaf is ${b.turnLeaf}`);
    const z0 = leafZ(b.leaves, b.onLeft, turning); // once, for the meshes and the shadow alike
    // a rip: the leaf curls (rp.curl in place of the turn's progress) with its hinge on the right pile (it is going
    // nowhere on the left), then flies off; its shadow fades as it goes
    const rp = b.rip === undefined ? null : ripPose(b.rip), p = rp ? rp.curl : b.turnP;
    const z = rp ? { ...z0, turn1: z0.turn0 } : z0;
    // each leaf's and stack's bow: what its pile allows, the turning leaf's blended with its turn, times the book's
    // opening, k; the gutter's occlusion is k itself on every leaf and stack, whatever its pile (a thin pile still lies
    // in the valley)
    const k = opening(b), w = leafBow(z), bowR = k * w.right, bowL = k * w.left;
    this.group.position.z = b.lift;
    // a page shows while its leaf is there (a face that hasn't come is blank paper), in its leaf's stock
    this.left.mesh.visible = b.leftLeaf !== null;
    this.left.set({ turn: 1, z0: 0, z1: z.left, back: b.left, stock: leafStock(b.leftLeaf), bow: bowL, gutter: k, settle: b.settle });
    this.right.mesh.visible = b.rightLeaf !== null;
    this.right.set({ turn: 0, z0: z.right, z1: 0, front: b.right, stock: leafStock(b.rightLeaf), bow: bowR, gutter: k });
    this.turning.mesh.visible = turning && (rp?.shown ?? true);
    // (the fling's transform is the mesh's, not the group's: checkPlacement holds the group to a z translation)
    placeFling(this.turning.mesh, rp?.fling ?? 0, z.turn0);
    if (turning) {
      this.turning.set({ turn: p!, z0: z.turn0, z1: z.turn1, front: b.turnFront, back: b.turnBack, stock: leafStock(b.turnLeaf),
        bow: k * (rp ? w.turn0 : lerp(w.turn0, w.turn1, p!)), gutter: k });
    }
    this.setStack(this.stackR, 0, z.stackR, bowR, k);
    this.setStack(this.stackL, -PAGE_W, z.stackL, bowL, k);
    const s = turning ? turnShadow(LAMP_XZ, p!, z, b.lift, rp?.shadow ?? 1) : null;
    this.right.shadow({ ...(s?.right ?? NO_SHADOW), side: 1 });
    this.left.shadow({ ...(s?.left ?? NO_SHADOW), side: -1 });
    this.posePanels(b, z, bowR, k);
    const cutL = b.cut?.side === 'L';
    if (b.cut && (cutL ? b.leftLeaf : b.rightLeaf) === null) throw new Error(`the book's pose has a piece loose from the ${cutL ? 'left' : 'right'} page, but there is none`);
    if (b.cut && turning) throw new Error("the book's pose has a piece loose during a turn");
    // (out where pieces come from, well away from the spine, a page's bow is flat at its full height: curl.ts BOW)
    this.cut.pose(b.cut, b.cutFace, (cutL ? z.left + bowL * BOW.h : z.right + bowR * BOW.h) + LEAF_EPS / 2);
  }
  /** The fold-out's panels (BookPose.panels): each posed while it lifts or lies open, flat at its hinge (panelZ), A
   *  carrying the right page's bow and gutter while it lies folded over it (fading as it opens: open, it lies flat beyond
   *  the page), and each shadowing what it lifts off (panelShadow) — A the right page (no turn is under way to shadow
   *  it), B panel A. */
  private posePanels(b: BookPose, z: LeafZ, bowR: number, k: number) {
    const pa = b.panels?.a ?? 0, pb = b.panels?.b ?? 0;
    if ((pa > 0 || pb > 0) && (b.turnP !== null || b.rightLeaf === null)) throw new Error(`the book's pose opens its panels (a ${pa}, b ${pb}) ${b.turnP !== null ? 'during a turn' : 'with no right page'}`);
    if (pb > 0 && pa !== 1) throw new Error(`the book's pose unfolds panel B (b ${pb}) while A isn't open (a ${pa})`);
    const zp = panelZ(z, bowR), PAPER: [Stock, Stock] = [PAPER_STOCK, PAPER_STOCK];
    this.panelA.mesh.visible = pa > 0;
    this.panelA.set({ turn: pa, z0: zp.a, z1: zp.a, front: b.aFront, back: b.aBack, stock: PAPER, bow: bowR * (1 - pa), gutter: k * (1 - pa) });
    this.panelB.mesh.visible = pb > 0;
    this.panelB.set({ turn: pb, z0: zp.b, z1: zp.b, front: b.bFront, back: b.bBack, stock: PAPER, bow: 0, gutter: 0 });
    // (the right page's outer edge, where A lies folded: its hinge plus the bow, flat out there)
    if (pa > 0 && pa < 1) this.right.shadow({ ...panelShadow(LAMP_XZ, pa, PAGE_W, zp.a, zp.a - LEAF_EPS, b.lift), side: -1 });
    this.panelA.shadow({ ...(pb > 0 && pb < 1 ? panelShadow(LAMP_XZ, pb, 2 * PAGE_W, zp.b, zp.a, b.lift) : NO_SHADOW), side: -1 });
    this.panelB.shadow({ ...NO_SHADOW, side: -1 });
  }
  /**
   * The magazine's footprint on the sheets [x0, y0, x1, y1] (for the contact shadow): each side with a pile on it. The
   * cover, turning onto the empty left, only joins it as it settles, spreading from the spine (the free edge lands
   * last: it is still 0.05 up at p = 0.99); following p itself put a dark contact shadow under the whole airborne leaf.
   * The last leaf, turning off the right as the magazine closes, leaves it as it lifts, back to the spine (its free edge
   * is 0.024 up by p = 0.01).
   */
  footprint(b: BookPose): [number, number, number, number] {
    const p = b.turnP, stays = b.leaves - b.onLeft - (p === null ? 0 : 1); // (the right pile, less a leaf turning off it)
    const x0 = b.onLeft > 0 ? -PAGE_W : p === null ? 0 : -PAGE_W * smoothstep(0.99, 1, p);
    const x1 = stays > 0 ? PAGE_W : p === null ? 0 : PAGE_W * (1 - smoothstep(0, 0.01, p));
    return [x0, 0, x1 + panelReach(b.panels), 1]; // (the fold-out's open panels widen it: panelReach)
  }
  dispose() {
    this.geo.dispose();
    this.panelGeo.dispose();
    this.blank.dispose();
    for (const l of [this.left, this.turning, this.right, this.panelA, this.panelB]) l.mat.dispose();
    this.cut.dispose();
    for (const s of [this.stackL, this.stackR]) { s.material.dispose(); s.geometry.dispose(); }
  }
  /** Throws unless the book sits in the world as Book.group says: the group translated in z alone, every object above
   *  it (the world scene) not transformed at all. */
  private checkPlacement() {
    for (let o: THREE.Object3D | null = this.group; o; o = o.parent) {
      const p = o.position, q = o.quaternion, s = o.scale;
      if (p.x !== 0 || p.y !== 0 || (o !== this.group && p.z !== 0) || q.x !== 0 || q.y !== 0 || q.z !== 0 ||
          s.x !== 1 || s.y !== 1 || s.z !== 1) {
        throw new Error("the book may only be translated in z, in an untransformed world (the turning leaf's shadow is computed in the book's own frame)");
      }
    }
  }
  /** A stack of leaves `h` high (none if h <= 0) under the page spanning x0..x0 + PAGE_W, its top carrying `bow` of the
   *  rest bow as the page on it does, its spine face in the gutter's occlusion `gutter` deep (Book.pose). */
  private setStack(m: THREE.Mesh<THREE.BufferGeometry, THREE.RawShaderMaterial>, x0: number, h: number, bow: number, gutter: number) {
    const u = m.material.uniforms;
    u.uBow!.value = bow; u.uGutter!.value = gutter; // (set while hidden too: its uniforms always match the pose)
    m.visible = h > 0;
    if (h <= 0) return;
    m.scale.set(PAGE_W, 1, h);
    m.position.set(x0 + PAGE_W / 2, 0.5, h / 2);
  }
}
