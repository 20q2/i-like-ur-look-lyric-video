// The lipstick brush's rasteriser (WebGL2): lays a stroke's wax down in one canvas of its own, from three instanced
// draws, in order: its dabs (ellipses, source-over), its drag streaks (segments, source-over) and its flecks
// (ellipses, destination-out), for lipstick.ts to copy over the target. Canvas2D pays ~1–3 µs a shape on the GPU side
// whatever the shape (a sprite drawImage included), and a stroke has ~3 per unit of length; here a shape costs its
// instance's few floats.
//
// Coverage follows what Skia gave the same shapes. A dab, one convex path to Skia, is covered by its distance from
// the pixel centre, clamped to half a pixel either side of the edge (the exact distance to the ellipse: a first-order
// estimate inked small dabs up to 18 % denser). The flecks, one path of many to Skia, which cut by their area, are
// covered by area (8 x 8 samples a pixel). A segment is covered by its distance, round where its run goes on and butt
// where it starts or ends; a pixel of a run is drawn once, by the segment covering it most among it and its
// neighbours (their union: Skia strokes a run as one path). A shape narrower than a pixel, a sub-pixel fleck or a
// hairline streak, comes widened to a pixel at proportionally less alpha (lipstick.ts), so it inks or cuts by its
// area at every output scale. Measured against the Canvas2D brush on the same strokes: the wax's total alpha within
// 0.6 % at 1080p and 0.3 % at --scale 2, the flecks' cut within ~5 % of theirs.
//
// Deterministic: the same instances give the same pixels (fixed-function blending into RGBA8; nothing is read back).
// They don't depend on the canvas's size either, which only ever grows: every position is computed in device px from
// the mark's (integer) corner (the lipstick test card's frames match bit for bit rendered in either order, the canvas
// grown in different steps).

/** An ellipse instance: centre (device px, mark-relative), its first axis's direction, its semi-axes (px), premultiplied
 *  colour. */
export const ELL_FLOATS = 10;
/** A segment instance: previous point, start, end, next point (device px), half width, flags, premultiplied colour. */
export const SEG_FLOATS = 14;
/** Segment flags: the run continues before it / after it; the previous / next segment starts / ends the run. */
export const SEG_PREV = 1, SEG_NEXT = 2, SEG_PREV_STARTS = 4, SEG_NEXT_ENDS = 8;

const ELL_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aC;
layout(location = 2) in vec4 aUA;
layout(location = 3) in vec4 aCol;
uniform vec2 uSize;
flat out vec2 vC;
flat out vec4 vUA;
flat out vec4 vCol;
void main() {
  vec2 u = aUA.xy, ab = aUA.zw;
  vec2 ext = vec2(length(vec2(ab.x * u.x, ab.y * u.y)), length(vec2(ab.x * u.y, ab.y * u.x))) + 1.0;
  vec2 p = aC + aCorner * ext;
  vC = aC; vUA = aUA; vCol = aCol;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const ELL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float uTop;
uniform bool uArea;
flat in vec2 vC;
flat in vec4 vUA;
flat in vec4 vCol;
out vec4 oCol;
// signed distance from p to the ellipse with semi-axes ab, in its own frame: Inigo Quilez's closed form
// (iquilezles.org/articles/ellipsedist), exact to ~0.003 px in fp32 near the edge
float sdEllipse(vec2 p, vec2 ab) {
  p = abs(p);
  if (abs(ab.x - ab.y) <= 1e-3 * ab.x) return length(p) - ab.x;
  if (p.x > p.y) { p = p.yx; ab = ab.yx; }
  float l = ab.y * ab.y - ab.x * ab.x;
  float m = ab.x * p.x / l, m2 = m * m;
  float n = ab.y * p.y / l, n2 = n * n;
  float c = (m2 + n2 - 1.0) / 3.0, c3 = c * c * c;
  float q = c3 + m2 * n2 * 2.0;
  float d = c3 + m2 * n2;
  float g = m + m * n2;
  float co;
  if (d < 0.0) {
    float h = acos(clamp(q / c3, -1.0, 1.0)) / 3.0;
    float s = cos(h), t = sin(h) * sqrt(3.0);
    float rx = sqrt(max(0.0, -c * (s + t + 2.0) + m2));
    float ry = sqrt(max(0.0, -c * (s - t + 2.0) + m2));
    co = (ry + sign(l) * rx + abs(g) / (rx * ry) - m) / 2.0;
  } else {
    float h = 2.0 * m * n * sqrt(d);
    float s = sign(q + h) * pow(abs(q + h), 1.0 / 3.0);
    float u = sign(q - h) * pow(abs(q - h), 1.0 / 3.0);
    float rx = -s - u - c * 4.0 + 2.0 * m2;
    float ry = (s - u) * sqrt(3.0);
    float rm = sqrt(rx * rx + ry * ry);
    co = (ry / sqrt(rm - rx) + 2.0 * g / rm - m) / 2.0;
  }
  vec2 r = ab * vec2(co, sqrt(max(0.0, 1.0 - co * co)));
  return length(r - p) * sign(p.y - r.y);
}
void main() {
  vec2 u = vUA.xy, ab = vUA.zw;
  vec2 d0 = vec2(gl_FragCoord.x, uTop - gl_FragCoord.y) - vC;
  float cov;
  if (uArea) { // the share of the pixel inside: 8 x 8 samples
    float k = 0.0;
    for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
      vec2 e = d0 + (vec2(i, j) - 3.5) / 8.0, q = vec2(dot(e, u), e.x * u.y - e.y * u.x) / ab;
      k += dot(q, q) <= 1.0 ? 1.0 : 0.0;
    }
    cov = k / 64.0;
  } else { // half a pixel either side of the edge
    vec2 q = vec2(dot(d0, u), d0.x * u.y - d0.y * u.x);
    float d = sdEllipse(q, ab);
    if (!(abs(d) < 1e6)) { vec2 z = q / ab; d = (dot(z, z) - 1.0) * inversesqrt(max(dot(2.0 * z / ab, 2.0 * z / ab), 1e-30)); }
    cov = clamp(0.5 - d, 0.0, 1.0);
  }
  oCol = vCol * cov;
}`;
const SEG_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPA;
layout(location = 2) in vec4 aBN;
layout(location = 3) in vec2 aHF;
layout(location = 4) in vec4 aCol;
uniform vec2 uSize;
flat out vec4 vPA;
flat out vec4 vBN;
flat out vec2 vHF;
flat out vec4 vCol;
void main() {
  vec2 a = aPA.zw, ab = aBN.xy - a;
  float l = length(ab), m = aHF.x + 1.0;
  vec2 u = l > 0.0 ? ab / l : vec2(1.0, 0.0), n = vec2(-u.y, u.x);
  vec2 p = a + u * mix(-m, l + m, aCorner.x * 0.5 + 0.5) + n * (aCorner.y * m);
  vPA = aPA; vBN = aBN; vHF = aHF; vCol = aCol;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const SEG_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float uTop;
flat in vec4 vPA;
flat in vec4 vBN;
flat in vec2 vHF;
flat in vec4 vCol;
out vec4 oCol;
// coverage of segment a-b stroked hw either side: round where the run goes on, butt where it starts or ends
float seg(vec2 p, vec2 a, vec2 b, float hw, bool capA, bool capB) {
  vec2 ab = b - a;
  float l = length(ab);
  if (l <= 0.0) return 0.0;
  vec2 u = ab / l, ap = p - a;
  float t = dot(ap, u), e = abs(ap.x * u.y - ap.y * u.x);
  float d = t < 0.0 ? (capA ? e : length(ap)) : t > l ? (capB ? e : length(p - b)) : e;
  float c = clamp(hw + 0.5 - d, 0.0, 1.0);
  if (capA) c *= clamp(t + 0.5, 0.0, 1.0);
  if (capB) c *= clamp(l - t + 0.5, 0.0, 1.0);
  return c;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uTop - gl_FragCoord.y);
  int f = int(vHF.y);
  bool hasP = (f & ${SEG_PREV}) != 0, hasN = (f & ${SEG_NEXT}) != 0;
  float ck = seg(p, vPA.zw, vBN.xy, vHF.x, !hasP, !hasN);
  float cp = hasP ? seg(p, vPA.xy, vPA.zw, vHF.x, (f & ${SEG_PREV_STARTS}) != 0, false) : 0.0;
  float cn = hasN ? seg(p, vBN.xy, vBN.zw, vHF.x, false, (f & ${SEG_NEXT_ENDS}) != 0) : 0.0;
  if (!(ck > cp && ck >= cn)) discard; // (a pixel is its run's once: drawn by the segment covering it most)
  oCol = vCol * ck;
}`;

/** The instances of one mark, in device px relative to its corner, and its size (px). */
export interface WaxDraw {
  w: number; h: number;
  dabs: Float32Array; nDabs: number;
  segs: Float32Array; nSegs: number;
  flecks: Float32Array; nFlecks: number;
}

interface Prog { p: WebGLProgram; size: WebGLUniformLocation; top: WebGLUniformLocation; area: WebGLUniformLocation | null }

class WaxGL {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  private ell: Prog;
  private seg: Prog;
  private vao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  constructor() {
    this.canvas.width = this.canvas.height = 1;
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('lipstick: no WebGL2 context for the brush');
    this.gl = gl;
    const prog = (vs: string, fs: string) => {
      const p = gl.createProgram()!;
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`lipstick brush shader: ${gl.getShaderInfoLog(s)}`);
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`lipstick brush program: ${gl.getProgramInfoLog(p)}`);
      return { p, size: gl.getUniformLocation(p, 'uSize')!, top: gl.getUniformLocation(p, 'uTop')!, area: gl.getUniformLocation(p, 'uArea') };
    };
    this.ell = prog(ELL_VS, ELL_FS);
    this.seg = prog(SEG_VS, SEG_FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    for (let k = 1; k <= 4; k++) { gl.enableVertexAttribArray(k); gl.vertexAttribDivisor(k, 1); } // (4: segments only)
    gl.bindVertexArray(null);
  }
  /** Draw one mark into this canvas's top left w x h px (cleared first); the result is then copied out of there. */
  render(d: WaxDraw) {
    const gl = this.gl, cv = this.canvas;
    if (cv.width < d.w || cv.height < d.h) { // grow only (the pixels don't depend on the size: see the header)
      cv.width = Math.max(cv.width, d.w);
      cv.height = Math.max(cv.height, d.h);
      if (gl.drawingBufferWidth < d.w || gl.drawingBufferHeight < d.h) {
        throw new Error(`lipstick: the brush's canvas is capped at ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}, a mark needs ${d.w}x${d.h}`);
      }
    }
    const H = gl.drawingBufferHeight;
    gl.viewport(0, H - d.h, d.w, d.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, H - d.h, d.w, d.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const fE = d.nDabs * ELL_FLOATS, fS = d.nSegs * SEG_FLOATS, fF = d.nFlecks * ELL_FLOATS;
    gl.bufferData(gl.ARRAY_BUFFER, (fE + fS + fF) * 4, gl.STREAM_DRAW);
    // (a length of 0 would copy all of the source)
    if (fE) gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.dabs, 0, fE);
    if (fS) gl.bufferSubData(gl.ARRAY_BUFFER, fE * 4, d.segs, 0, fS);
    if (fF) gl.bufferSubData(gl.ARRAY_BUFFER, (fE + fS) * 4, d.flecks, 0, fF);
    const use = (p: Prog, area = false) => {
      gl.useProgram(p.p);
      gl.uniform2f(p.size, d.w, d.h);
      gl.uniform1f(p.top, H);
      if (p.area) gl.uniform1i(p.area, area ? 1 : 0);
    };
    const ellipses = (byte: number, n: number) => {
      const S = ELL_FLOATS * 4;
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, byte);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, byte + 8);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, byte + 24);
      gl.disableVertexAttribArray(4);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    };
    use(this.ell); // (dabs: coverage by distance, as Skia AAs a convex path)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // source-over (premultiplied)
    if (d.nDabs) ellipses(0, d.nDabs);
    if (d.nSegs) {
      use(this.seg);
      gl.enableVertexAttribArray(4);
      const S = SEG_FLOATS * 4, b = fE * 4;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, b);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, b + 16);
      gl.vertexAttribPointer(3, 2, gl.FLOAT, false, S, b + 32);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, S, b + 40);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.nSegs);
    }
    if (d.nFlecks) {
      use(this.ell, true); // (flecks: coverage by area, as Skia's path of many flecks has it)
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); // destination-out
      ellipses((fE + fS) * 4, d.nFlecks);
    }
    gl.bindVertexArray(null);
  }
}

let wax: WaxGL | null = null;
/** The brush's canvas and context, made on first use (a lost context is replaced). */
export function waxGL(): WaxGL {
  if (!wax || wax.gl.isContextLost()) wax = new WaxGL();
  return wax;
}
