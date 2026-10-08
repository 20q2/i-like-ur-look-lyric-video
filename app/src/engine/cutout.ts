// A piece of a page that comes loose and flies off (spread.ts Cutout: memoriam's portrait, cut out of the left page;
// the perfume ad's scent strip, torn off the right). While it lies in its page the page's face draws it; loose, it is
// its own mesh — an ellipse or a rectangle of paper lit as the leaves are (PAPER_FRAG), its front the spread's 'C'
// face — peeling up about its tab (the bit the scissors left, the strip's perforated hinge), then torn free and flung
// out of frame, off the page's outer edge. The page's face draws what it leaves, and the shadow it casts
// (drawCutShadow): cutPoint gives them, and the mesh, the one placement.
import * as THREE from 'three';
import { GLSL_COMMON } from './glsl/common';
import { FACE_TEX_GLSL, PAPER_FRAG } from './paper';
import { LAMP, LAMP_GLSL, LAMP_ON } from './lamp';
import { PAGE } from './pagesize';
import type { FaceTex, Stock } from './page';

/** A cut-out's outline on its page (pu: an ellipse, or a rectangle, about (x, y), rx and ry its half-extents) and its
 *  tab (the angle from its centre, as CanvasRenderingContext2D.ellipse's, to the point of its outline where it's hinged
 *  and tears free last: for a rectangle, on the side it meets); posed, how loose it is: its peel and its fly, each
 *  0..1, eased by the spread (spread.ts Cutout). */
export interface CutShape {
  side: 'L' | 'R'; shape: 'ellipse' | 'rect'; x: number; y: number; rx: number; ry: number; tab: number;
  /** How it comes loose, if not CUT's. */
  motion?: CutMotion;
}
export interface CutPose extends CutShape { peel: number; fly: number }
/** The point of the outline at angle a from its centre (pu). */
export function outlineAt(c: Pick<CutShape, 'shape' | 'x' | 'y' | 'rx' | 'ry'>, a: number): [number, number] {
  const co = Math.cos(a), si = Math.sin(a), m = c.shape === 'rect' ? Math.max(Math.abs(co), Math.abs(si)) : 1;
  return [c.x + (c.rx * co) / m, c.y + (c.ry * si) / m];
}

/**
 * How it comes loose. Peeling, it lifts about its tab by `peel` radians, curling up from it (`bend`: the curl's
 * curvature, 1/world: a lift of ~0.03 at the far edge on top of the turn's ~0.06); torn free, it flips over its tab
 * by `flip`, turns `roll` about the vertical and moves `move` (world units: off the page's outer edge, up the page and
 * up toward the camera — out of frame by fly 1 at every framing of the page; mirrored on the right page), its curl
 * easing to `flyBend`.
 */
export interface CutMotion { peel: number; bend: number; flip: number; roll: number; flyBend: number; move: readonly [number, number, number] }
export const CUT: CutMotion = Object.freeze({ peel: 0.3, bend: 0.9, flip: 1.5, roll: 0.9, flyBend: 1.4, move: Object.freeze([-0.7, 0.34, 0.5] as const) });

type V3 = [number, number, number];
/** The piece placed (cutPose): its tab's hinge point in the book's frame, the unit direction from it across the piece
 *  (to the ellipse's centre), its curl, and the rigid motion about the hinge (rot: 3x3, row-major) plus `move`. */
export interface CutPlace { hinge: V3; dir: [number, number]; bend: number; rot: readonly number[]; move: V3 }

/** A point of a page in pu -> the book's frame (spread.ts pageToWorld's). */
const world = (side: 'L' | 'R', u: number, v: number): [number, number] => [(side === 'L' ? u - PAGE.w : u) / PAGE.h, 1 - v / PAGE.h];
/** The book's frame -> a page's pu (world's inverse). */
const toPage = (side: 'L' | 'R', x: number, y: number): [number, number] => [x * PAGE.h + (side === 'L' ? PAGE.w : 0), (1 - y) * PAGE.h];

/** Where the piece is at its pose (the one placement: CutPiece's shader and the page's hole and shadow). */
export function cutPlace(c: CutPose): CutPlace {
  const [hx, hy] = world(c.side, ...outlineAt(c, c.tab)), [cx, cy] = world(c.side, c.x, c.y), out = c.side === 'L' ? 1 : -1;
  const l = Math.hypot(cx - hx, cy - hy), dx = (cx - hx) / l, dy = (cy - hy) / l;
  // about the axis along the tab, (dy, -dx, 0): it turns the far side up (axis x dir = +z)
  const M = c.motion ?? CUT, th = M.peel * c.peel + M.flip * c.fly, ax = dy, ay = -dx;
  const co = Math.cos(th), si = Math.sin(th), k = 1 - co;
  const A = [co + ax * ax * k, ax * ay * k, ay * si, ay * ax * k, co + ay * ay * k, -ax * si, -ay * si, ax * si, co];
  const r = out * M.roll * c.fly, cr = Math.cos(r), sr = Math.sin(r);
  const Z = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const rot = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    return Z[row * 3]! * A[col]! + Z[row * 3 + 1]! * A[3 + col]! + Z[row * 3 + 2]! * A[6 + col]!;
  });
  const m = M.move;
  return { hinge: [hx, hy, 0], dir: [dx, dy], bend: M.bend * c.peel + (M.flyBend - M.bend) * c.fly, rot, move: [out * m[0] * c.fly, m[1] * c.fly, m[2] * c.fly] };
}
/** Where the piece's point that lay at (x, y) (the book's frame) is, above the page's surface (add the page's height):
 *  curled up from the tab by 0.5·bend·d² at d across it, then turned about the hinge and moved. CUT_VERT's, on the
 *  CPU. */
export function cutPoint(p: CutPlace, x: number, y: number): V3 {
  const qx = x - p.hinge[0], qy = y - p.hinge[1], d = Math.max(0, qx * p.dir[0] + qy * p.dir[1]), qz = 0.5 * p.bend * d * d;
  const R = p.rot;
  return [
    R[0]! * qx + R[1]! * qy + R[2]! * qz + p.hinge[0] + p.move[0],
    R[3]! * qx + R[4]! * qy + R[5]! * qz + p.hinge[1] + p.move[1],
    R[6]! * qx + R[7]! * qy + R[8]! * qz + p.move[2],
  ];
}

const CUT_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform vec2 uHinge, uDir;
uniform float uBend, uZ;
uniform mat3 uRot;
uniform vec3 uMove;
out vec2 vUv; out vec3 vN; out vec3 vPos; out float vGutter;
void main() {
  vec2 q = position.xy - uHinge;
  float d = max(dot(q, uDir), 0.0);
  vec3 p = uRot * vec3(q, 0.5 * uBend * d * d) + vec3(uHinge, uZ) + uMove;
  // the curl's surface z = bend d² / 2: its gradient bend·d·dir
  vec3 n = uRot * normalize(vec3(-uBend * d * uDir, 1.0));
  vPos = (modelMatrix * vec4(p, 1.0)).xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vUv = uv;
  vGutter = 0.0; // (out in the page, far from the spine)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

/** The piece's geometry: its outline (pu, on its page) in the book's frame, rings out from its centre so the curl
 *  bends it smoothly; uv as its page's face is printed, so the 'C' face lands where it lay. A rectangle's corners are
 *  among the segments' angles, so its rings keep them square. */
function cutGeometry(c: CutShape, rings = 10, n = 96) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const add = (u: number, v: number) => { const [x, y] = world(c.side, u, v); pos.push(x, y, 0); uv.push(u / PAGE.w, 1 - v / PAGE.h); };
  const k = Math.atan2(c.ry, c.rx), corners = c.shape === 'rect' ? [k, Math.PI - k, Math.PI + k, 2 * Math.PI - k] : [];
  const angles = [...Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n), ...corners].sort((x, y) => x - y), segs = angles.length;
  add(c.x, c.y);
  for (let r = 1; r <= rings; r++) {
    for (const a of angles) {
      const [u, v] = outlineAt(c, a);
      add(c.x + ((u - c.x) * r) / rings, c.y + ((v - c.y) * r) / rings);
    }
  }
  const at = (r: number, s: number) => (r === 0 ? 0 : 1 + (r - 1) * segs + (s % segs));
  // the rings run clockwise seen from above (their angle turns as the page's y, which runs down): each triangle is wound
  // against them, counter-clockwise from above, so its front faces the camera lying flat
  for (let s = 0; s < segs; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) idx.push(at(r, s), at(r + 1, s + 1), at(r + 1, s), at(r, s), at(r, s + 1), at(r + 1, s + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class CutPiece {
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  private shape = '';
  /** `stock`: the pages' (page.ts PAPER_STOCK: it is cut from one). */
  constructor(private blank: THREE.Texture, stock: Stock) {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: CUT_VERT,
      fragmentShader: `precision highp float;\n${GLSL_COMMON}\n${LAMP_GLSL}\n${FACE_TEX_GLSL}\n${PAPER_FRAG}`,
      uniforms: {
        uLampOn: LAMP_ON,
        uHinge: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) }, uBend: { value: 0 }, uZ: { value: 0 },
        uRot: { value: new THREE.Matrix3() }, uMove: { value: new THREE.Vector3() },
        uPrintF: { value: blank }, uMarksF: { value: blank }, uPrintB: { value: blank }, uMarksB: { value: blank },
        uStockF: { value: new THREE.Vector3(...stock) }, uStockB: { value: new THREE.Vector3(...stock) },
        uShadowX: { value: 0 }, uShadowSoft: { value: 0.01 }, uShadowAmt: { value: 0 }, uShadowSide: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  /** Shows the piece loose at `c` (none: hidden), its front `face`, lying flat at height `z` (Book.pose: half a leaf
   *  above its page there, so as it starts to lift it never z-fights what's under it). */
  pose(c: CutPose | undefined, face: FaceTex | undefined, z: number) {
    this.mesh.visible = !!c;
    if (!c) return;
    const shape = `${c.side},${c.shape},${c.x},${c.y},${c.rx},${c.ry}`;
    if (shape !== this.shape) { this.mesh.geometry.dispose(); this.mesh.geometry = cutGeometry(c); this.shape = shape; }
    const p = cutPlace(c), u = this.mat.uniforms, R = p.rot;
    (u.uHinge!.value as THREE.Vector2).set(p.hinge[0], p.hinge[1]);
    (u.uDir!.value as THREE.Vector2).set(p.dir[0], p.dir[1]);
    u.uBend!.value = p.bend;
    u.uZ!.value = z;
    (u.uRot!.value as THREE.Matrix3).set(R[0]!, R[1]!, R[2]!, R[3]!, R[4]!, R[5]!, R[6]!, R[7]!, R[8]!); // (set takes row-major)
    (u.uMove!.value as THREE.Vector3).set(...p.move);
    u.uPrintF!.value = face?.print ?? this.blank; u.uMarksF!.value = face?.marks ?? this.blank;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/**
 * A loose piece's shadow on its page, drawn on the page's face (in its pu): its outline as cutPoint places it, at `pts`
 * points, projected from the lamp (LAMP.pos) onto the page, blurred by the lamp's penumbra at its mean height (as
 * page.ts turnShadow's), `amt` of ink (`ink(alpha)`) where it lies close, fading out by `fadeH` above the page (world
 * units).
 */
export function drawCutShadow(c: CanvasRenderingContext2D, pose: CutPose, ink: (a: number) => string, o: { amt: number; fadeH: number; pts: number }) {
  const p = cutPlace(pose), [lx, ly, lz] = LAMP.pos;
  let hSum = 0;
  const pts = Array.from({ length: o.pts }, (_, i) => {
    const [x, y, h] = cutPoint(p, ...world(pose.side, ...outlineAt(pose, (2 * Math.PI * i) / o.pts))), k = lz / Math.max(lz - h, 1e-3);
    hSum += h;
    return toPage(pose.side, lx + (x - lx) * k, ly + (y - ly) * k);
  });
  const h = hSum / o.pts, amt = o.amt * (1 - Math.min(1, Math.max(0, h / o.fadeH)));
  if (amt <= 0) return;
  const soft = Math.max(1.5, 0.5 * LAMP.size * (lz / (lz - h) - 1) * PAGE.h); // (pu)
  c.save();
  c.fillStyle = ink(amt);
  c.filter = `blur(${(soft / 2) * c.getTransform().a}px)`; // (a filter's blur is in canvas px)
  c.beginPath();
  pts.forEach(([u, v], i) => (i ? c.lineTo(u, v) : c.moveTo(u, v)));
  c.closePath();
  c.fill();
  c.restore();
}
