// The narrator's lipstick: a waxy brush stamped along a path (soft dabs, pressure, drag streaks, flecks where
// the wax misses the paper) and handwriting in it; the kiss print lives in ./kiss and is re-exported here.
// Deterministic: every random choice is hashed from (seed, index), so a stroke being written never re-rolls its
// texture, and nothing a call keeps for the next reaches its pixels. Every call inks one mark on a canvas of its own,
// where its own flecks and creases open gaps, and lays it over the target source-over: an earlier mark shows through
// a later one's gaps, as wax over wax does. Draw into a transparent marks layer; the paper shader lays it over the
// print with gloss.
//
// A stroke's wax is the shapes waxParts lists, laid down by the GL brush in ./waxgl and copied over the target; a kiss
// is drawn in Canvas2D on a scratch (inkMark). Canvas2D costs ~1–3 µs a shape on the GPU side whatever its size (a
// sprite drawImage included), and a stroke has ~3 per unit of length (at width 6 a dab every 0.6, a fleck every 0.75),
// plus its streaks: shape by shape, a growing 2000 pu loop at width 6 took ~40 ms a redraw at 1080p and ~70 ms at
// --scale 2, a script word ~18 and ~22 ms. Through the GL brush either takes ~2–2.5 ms (~3–4 ms with its face's clear
// and upload), at any length and either scale, nearly all of it computing the shapes (~1 µs per unit of length): it is
// drawn from nothing every time, no cache.
import { type V2, clamp, hash3, pointAtLength, polylineLengths } from './util';
import { HEX } from './palette';
import { kiss } from './kiss';
import { ELL_FLOATS, SEG_FLOATS, SEG_NEXT, SEG_NEXT_ENDS, SEG_PREV, SEG_PREV_STARTS, type WaxDraw, waxGL } from './waxgl';

export { kiss };

export interface BrushOpts {
  /** Stroke width (drawing units). */
  width: number;
  seed: number;
  /**
   * Pressure 0..1 along the stroke (argument: 0..1 of its length; for lipstickWrite, of the whole text's).
   * Default: a soft taper at both ends (lipstickWrite: only where the lipstick meets or leaves the paper).
   */
  pressure?: (s: number) => number;
}
const taper = (s: number) => clamp(Math.min(s / 0.08, (1 - s) / 0.12));

// ------------------------------------------------------------------ marks
/**
 * Scratch canvases for inkMark (a kiss; strokes ink on the GL brush's canvas instead), as [mark, layer] pairs of one
 * size each. A mark on a W x H target inks on the smallest pair at least W x H, at its own device position (it only
 * clears and reads back its own region), and a new pair is made at exactly W x H only when none is that large: in the
 * magazine that is the faces' pair, which prewarm makes first and which serves every smaller canvas a spread holds
 * marks on as well, so a held kiss inks as it would live on its face. Never resize one (e.g. to grow on demand): a
 * grown-on-demand scratch made frames differ by a level depending on the frames before them. A scratch's size does
 * reach a mark's pixels, if barely: the same kiss inked through pairs from 255 x 255 to 3154 x 4096 differs at
 * ≤ 18 of its pixels by ≤ 1.9 levels (premultiplied), within the frames' 2-level tolerance. Never freed: a face is
 * ~15 MB at 1080p and ~52 MB at --scale 2, the layer canvas made once a mark uses `layer`.
 */
const scratches: { w: number; h: number; cv: HTMLCanvasElement[] }[] = [];
function scratchOf(W: number, H: number, k: number) {
  let s: (typeof scratches)[number] | undefined;
  for (const q of scratches) if (q.w >= W && q.h >= H && (!s || q.w * q.h < s.w * s.h)) s = q;
  if (!s) scratches.push((s = { w: W, h: H, cv: [] }));
  if (!s.cv[k]) {
    const cv = document.createElement('canvas');
    cv.width = s.w;
    cv.height = s.h;
    s.cv[k] = cv;
  }
  return s.cv[k]!;
}

/**
 * Lays part of a mark on through a clip: `paint` draws it unclipped on a second scratch (in the mark's current
 * user space), which is then copied onto the mark through `clip` (a path in that space) — one clipped copy
 * instead of clipping every shape, which is what clipping costs on the GPU.
 */
export type MarkLayer = (clip: Path2D, paint: (s: CanvasRenderingContext2D) => void) => void;

/**
 * Get marks on canvases of `c`'s size ready ahead of their first frame: makes the scratch canvases for that size and
 * the GL brush (its context and programs), and runs a kiss and a stroke through them once, into `c` (cleared again
 * after), so the first real mark doesn't pay for their creation and the GPU's first use of what a mark draws with
 * (~180 ms on the cover kiss's first frame at 1080p). Doesn't change any output: a mark only reads back the region of
 * a scratch, or of the GL brush's canvas, that it has just cleared.
 */
export function prewarm(c: CanvasRenderingContext2D) {
  const { width: w, height: h } = c.canvas;
  const u = Math.min(w, h) / 100;
  c.save();
  // device identity, as inkMark resets it: a Layer2D context's own setTransform / resetTransform apply its logical
  // scale, which would put the warm-up marks off-canvas at --scale 2
  CanvasRenderingContext2D.prototype.resetTransform.call(c);
  kiss(c, 50 * u, 50 * u, 30 * u, -0.1, 1, 1, 1);
  lipstickStroke(c, [{ x: 20 * u, y: 80 * u }, { x: 80 * u, y: 76 * u }], Infinity, { width: 3 * u, seed: 1 });
  c.clearRect(0, 0, w, h);
  c.restore();
}

/** True while inkMark inks a mark: the scratches are shared, so a mark inked inside another would wipe it. */
let inking = false;

/**
 * Ink one mark over `c`: `draw` paints it, in `c`'s current user space, on a cleared region of a scratch canvas
 * covering the device-space bounds of `ext` (points spanning the mark, in user space); that region is then
 * copied onto `c` pixel for pixel, source-over — under `c`'s own alpha and clip; its composite mode is not used.
 * The device transform comes from the prototype's getTransform: Layer2D patches the context's own to report
 * logical px, which would draw the mark at 1/SCALE of the target's resolution. Not re-entrant: calling it (or
 * lipstickStroke, lipstickWrite, kiss) from inside a `draw` or `paint` callback throws.
 */
export function inkMark(c: CanvasRenderingContext2D, ext: V2[], draw: (m: CanvasRenderingContext2D, layer: MarkLayer) => void) {
  if (inking) throw new Error('inkMark is not re-entrant');
  const T = CanvasRenderingContext2D.prototype.getTransform.call(c);
  const box = deviceBox(c, T, ext);
  if (!box) return;
  const { bx, by, w, h } = box, CW = c.canvas.width, CH = c.canvas.height;
  const mark = scratchOf(CW, CH, 0), m = mark.getContext('2d')!;
  /** A fresh region of scratch `cv` in the mark's current space; `paint` runs in it, its state undone after. */
  const fresh = (cv: HTMLCanvasElement, t: DOMMatrix, paint: (s: CanvasRenderingContext2D) => void) => {
    const s = cv.getContext('2d')!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = 1;
    s.clearRect(bx, by, w, h);
    s.save();
    s.setTransform(t);
    try { paint(s); } finally { s.restore(); }
  };
  const layer: MarkLayer = (clip, paint) => {
    const cv = scratchOf(CW, CH, 1);
    fresh(cv, m.getTransform(), paint);
    m.save();
    try {
      m.clip(clip);
      m.resetTransform();
      m.globalCompositeOperation = 'source-over';
      m.globalAlpha = 1;
      m.imageSmoothingEnabled = false;
      m.drawImage(cv, bx, by, w, h, bx, by, w, h);
    } finally { m.restore(); }
  };
  inking = true;
  try {
    fresh(mark, T, (s) => draw(s, layer));
    lay(c, mark, bx, by, box);
  } finally {
    inking = false;
  }
}

/** A mark's box on its target: whole device px, inside the canvas. */
interface Box { bx: number; by: number; w: number; h: number }
/** The box over points `ext` (user space, under device transform T), or null if it holds no pixel of c's canvas. */
function deviceBox(c: CanvasRenderingContext2D, T: DOMMatrix, ext: V2[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ext) {
    const X = T.a * p.x + T.c * p.y + T.e, Y = T.b * p.x + T.d * p.y + T.f;
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0));
  const w = Math.min(c.canvas.width, Math.ceil(x1)) - bx, h = Math.min(c.canvas.height, Math.ceil(y1)) - by;
  return w > 0 && h > 0 ? { bx, by, w, h } : null;
}

/** Copy `src`'s box-sized region at (sx, sy) onto c at the box, pixel for pixel, source-over, under c's alpha and clip. */
function lay(c: CanvasRenderingContext2D, src: HTMLCanvasElement, sx: number, sy: number, b: Box) {
  c.save();
  try {
    CanvasRenderingContext2D.prototype.resetTransform.call(c); // device identity (Layer2D's own restores its logical scale)
    c.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = false;
    c.drawImage(src, sx, sy, b.w, b.h, b.bx, b.by, b.w, b.h);
  } finally { c.restore(); }
}

// ------------------------------------------------------------------ brush
/**
 * A stroke's wax up to `end` as the shapes that lay it down, in user units and in drawing order: the dabs (each over
 * the ones before), then the drag streaks, then the flecks cut out of both. `dabs` and `flecks` hold ellipses,
 * [x, y, cos, sin, rx, ry, alpha] each (rx along the stroke, at the angle cos/sin); `runs` the streaks' runs, [first
 * point, point count, line width, alpha] each, over the points `sx` ([x, y] each): a run is one stroke (butt ends,
 * round joins), and the next run starts where it ends. Pure; exported for the tests.
 */
export interface WaxParts {
  dabs: Float64Array; nDabs: number;
  sx: Float64Array; runs: Float64Array; nRuns: number;
  flecks: Float64Array; nFlecks: number;
}

/**
 * pointAtLength along `pts` (the same point), with the cos and sin of its angle, without its binary search for
 * lengths that only grow between calls (`next`; `reset` starts again) and without its trig per call (a table per
 * segment). Returns one object, overwritten by the next call.
 */
function walker(pts: readonly V2[], L: Float32Array) {
  const n = pts.length, cs = new Float64Array(n), sn = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!, b = pts[i]!, ang = Math.atan2(b.y - a.y, b.x - a.x);
    cs[i] = Math.cos(ang); sn[i] = Math.sin(ang);
  }
  const P = { x: 0, y: 0, cos: 1, sin: 0 };
  const put = (s: number, hi: number) => { // (pointAtLength's lerp, on the segment ending at hi)
    const a = pts[hi - 1]!, b = pts[hi]!, seg = L[hi]! - L[hi - 1]!, u = seg > 0 ? (s - L[hi - 1]!) / seg : 0;
    P.x = a.x + (b.x - a.x) * u; P.y = a.y + (b.y - a.y) * u; P.cos = cs[hi]!; P.sin = sn[hi]!;
    return P;
  };
  let h = 1;
  return {
    reset() { h = 1; },
    // pointAtLength takes the segment ending at the first point at or past s (the first, at s = 0)
    next(s: number) { s = clamp(s, 0, L[n - 1]!); while (h < n - 1 && L[h]! < s) h++; return put(s, h); },
    at(s: number) {
      s = clamp(s, 0, L[n - 1]!);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid]! < s) lo = mid; else hi = mid; }
      return put(s, hi);
    },
  };
}

export function waxParts(pts: readonly V2[], L: Float32Array, total: number, end: number, o: BrushOpts): WaxParts {
  const press = o.pressure ?? taper;
  const prAt = (s: number) => clamp(press(s / total));
  /** The mark's width where the pressure is pr: pressing flattens the lipstick onto the paper. */
  const widthAt = (pr: number) => o.width * (0.55 + 0.45 * pr);
  const at = walker(pts, L), seed = o.seed;
  // dabs every tenth of the width, but at most 1.5 units apart: wider spacing shows each dab's edge as a scale.
  // Closer dabs are thinner (`thin`), so the wax still builds to the same density.
  const step = Math.min(Math.max(0.4, o.width * 0.1), 1.5), thin = step / Math.max(0.4, o.width * 0.1);
  // 1. body: overlapping soft elliptical dabs, flattened across the stroke
  let nDabs = 0;
  while (nDabs * step <= end) nDabs++;
  const dabs = new Float64Array(nDabs * 7);
  for (let i = 0; i < nDabs; i++) {
    const s = i * step, p = at.next(s), pr = prAt(s), w = widthAt(pr), k = i * 7;
    dabs[k] = p.x + (hash3(seed, i, 1) - 0.5) * w * 0.06;
    dabs[k + 1] = p.y + (hash3(seed, i, 2) - 0.5) * w * 0.06;
    dabs[k + 2] = p.cos; dabs[k + 3] = p.sin;
    dabs[k + 4] = Math.max(0.3, w * 0.22);
    dabs[k + 5] = w * 0.5;
    dabs[k + 6] = 1 - Math.pow(0.72 - 0.14 * pr, thin); // 0.28 + 0.14·pr when thin = 1
  }
  // 2. drag streaks: thin darker lines along the stroke, each held at a fixed fraction of the local width and
  //    fading with the pressure, so they narrow into the tapers instead of running past them. A run of samples at
  //    one (quantised) pressure is one stroke; its round joins keep every corner within half a line width of the
  //    path, so the mark's padding holds.
  //    The six sample the stroke at the same lengths: the point, its normal and the pressure are taken once.
  let ns = 0;
  for (let s = 0; ; s = Math.min(end, s + step * 3)) { ns++; if (s >= end) break; }
  const smp = new Float64Array(ns * 5); // x, y, sin, cos, pressure
  at.reset();
  for (let s = 0, i = 0; ; s = Math.min(end, s + step * 3), i++) {
    const p = at.next(s), k = i * 5;
    smp[k] = p.x; smp[k + 1] = p.y; smp[k + 2] = p.sin; smp[k + 3] = p.cos; smp[k + 4] = prAt(s);
    if (s >= end) break;
  }
  const sx = new Float64Array(6 * ns * 4), runs = new Float64Array(6 * ns * 4);
  let np = 0, nRuns = 0;
  for (let k = 0; k < 6; k++) {
    const f = (hash3(seed, k, 3) - 0.5) * 0.8, a = 0.05 + 0.08 * hash3(seed, k, 4);
    let lv = 0, first = 0;
    for (let i = 0; i < ns; i++) {
      const pr = smp[i * 5 + 4]!, off = f * widthAt(pr);
      const x = smp[i * 5]! - smp[i * 5 + 2]! * off, y = smp[i * 5 + 1]! + smp[i * 5 + 3]! * off;
      const q = Math.round(pr * 8) / 8;
      sx[np * 2] = x; sx[np * 2 + 1] = y; np++;
      if (i === 0) { first = np - 1; lv = q; }
      else if (q !== lv || i === ns - 1) {
        runs[nRuns * 4] = first; runs[nRuns * 4 + 1] = np - first;
        runs[nRuns * 4 + 2] = widthAt(lv) * 0.14; runs[nRuns * 4 + 3] = a * (0.25 + 0.75 * lv);
        nRuns++;
        if (i < ns - 1) { sx[np * 2] = x; sx[np * 2 + 1] = y; first = np; np++; } // the next run starts here
        lv = q;
      }
    }
  }
  // 3. flecks where the wax skipped: positions hashed over the whole stroke, shown once the pen has passed, cut in
  //    four strengths. The sub-pixel flecks of a thin stroke stay in: together they still lighten the wax, and
  //    without them a thin stroke inks denser at 1080p than at 4K (the GL brush cuts each by its area).
  const n = Math.floor((total / o.width) * 8);
  const flecks = new Float64Array(n * 7);
  let nFlecks = 0;
  for (let j = 0; j < n; j++) {
    const s = hash3(seed, j, 5) * total;
    if (s > end) continue;
    const ry = o.width * (0.008 + 0.018 * hash3(seed, j, 9));
    const p = at.at(s);
    const off = (hash3(seed, j, 6) - 0.5) * 0.9 * widthAt(prAt(s));
    const k = nFlecks++ * 7;
    flecks[k] = p.x - p.sin * off;
    flecks[k + 1] = p.y + p.cos * off;
    flecks[k + 2] = p.cos; flecks[k + 3] = p.sin;
    flecks[k + 4] = o.width * (0.03 + 0.25 * hash3(seed, j, 8));
    flecks[k + 5] = ry;
    flecks[k + 6] = 0.35 + 0.4 * (Math.min(3, Math.floor(hash3(seed, j, 7) * 4)) + 0.5) / 4;
  }
  return { dabs, nDabs, sx, runs, nRuns, flecks, nFlecks };
}

const rgb01 = (hex: string) => [16, 8, 0].map((sh) => ((parseInt(hex.slice(1), 16) >> sh) & 255) / 255);
const LIP = rgb01(HEX.lipstick), DEEP = rgb01(HEX.lipstickDeep);

/**
 * The principal axes of the ellipse whose own axes map to (m0, m1) and (m2, m3): its major and minor semi-axes and the
 * major's unit direction, [sa, sb, ux, uy] (a closed-form 2 x 2 SVD). For transforms that aren't a rotation and a
 * uniform scale; exported for the tests.
 */
export function principalAxes(m0: number, m1: number, m2: number, m3: number): [number, number, number, number] {
  const E = (m0 + m3) / 2, F = (m0 - m3) / 2, G = (m1 + m2) / 2, H = (m1 - m2) / 2;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G), phi = (Math.atan2(H, E) + Math.atan2(G, F)) / 2;
  return [Q + R, Math.abs(Q - R), Math.cos(phi), Math.sin(phi)];
}

/**
 * Put an ellipse instance at `k`: centre (X, Y), major semi-axis `sa` along the unit direction (ux, uy) and minor `sb`
 * across it, in device px; colour `rgb` (null: black, for a cut) at alpha `al`. A semi-axis under half a pixel is
 * widened to half a pixel at alpha scaled by the ratio, so the ellipse still inks by its area (see ./waxgl).
 */
function putEllipse(out: Float32Array, k: number, X: number, Y: number, ux: number, uy: number, sa: number, sb: number, rgb: readonly number[] | null, al: number) {
  if (sb < 0.5) { al *= sb / 0.5; sb = 0.5; }
  if (sa < 0.5) { al *= sa / 0.5; sa = 0.5; }
  out[k] = X; out[k + 1] = Y; out[k + 2] = ux; out[k + 3] = uy; out[k + 4] = sa; out[k + 5] = sb;
  out[k + 6] = rgb ? rgb[0]! * al : 0; out[k + 7] = rgb ? rgb[1]! * al : 0; out[k + 8] = rgb ? rgb[2]! * al : 0; out[k + 9] = al;
}

let bufE = new Float32Array(0), bufS = new Float32Array(0), bufF = new Float32Array(0);
const room = (b: Float32Array<ArrayBuffer>, n: number) => (b.length >= n ? b : new Float32Array(Math.max(n, b.length * 2)));

/**
 * A stroke's parts as the GL brush's instances: in device px under T, relative to the box's corner. Ellipses map exactly
 * under any T; a streak's width scales by T's mean scale, exact for a rotation and a uniform scale (every caller's).
 */
function waxDraw(w: WaxParts, T: DOMMatrix, box: Box): WaxDraw {
  const { a, b, c, d } = T, ox = T.e - box.bx, oy = T.f - box.by;
  const sc = Math.sqrt(Math.abs(a * d - b * c));
  // a rotation and a uniform scale (every caller's): an ellipse's axes stay its principal axes, scaled by sc
  const sim = Math.abs(a - d) <= 1e-6 * sc && Math.abs(b + c) <= 1e-6 * sc;
  const ell = (src: Float64Array, n: number, out: Float32Array, rgb: readonly number[] | null) => {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 7, x = src[k]!, y = src[k + 1]!, cs = src[k + 2]!, sn = src[k + 3]!, rx = src[k + 4]!, ry = src[k + 5]!;
      // the images of the ellipse's own x (along the stroke) and y axes
      const xx = a * cs + c * sn, xy = b * cs + d * sn, yx = c * cs - a * sn, yy = d * cs - b * sn;
      let sa: number, sb: number, ux: number, uy: number;
      if (sim) {
        if (rx >= ry) { sa = rx * sc; sb = ry * sc; ux = xx / sc; uy = xy / sc; }
        else { sa = ry * sc; sb = rx * sc; ux = yx / sc; uy = yy / sc; }
      } else [sa, sb, ux, uy] = principalAxes(xx * rx, xy * rx, yx * ry, yy * ry);
      if (!(sb > 1e-9)) continue; // degenerate: nothing to draw
      putEllipse(out, m++ * ELL_FLOATS, a * x + c * y + ox, b * x + d * y + oy, ux, uy, sa, sb, rgb, src[k + 6]!);
    }
    return m;
  };
  bufE = room(bufE, w.nDabs * ELL_FLOATS);
  const nDabs = ell(w.dabs, w.nDabs, bufE, LIP);
  bufF = room(bufF, w.nFlecks * ELL_FLOATS);
  const nFlecks = ell(w.flecks, w.nFlecks, bufF, null);
  // streaks: a run's segments, each with its neighbours in the run (the GL brush draws a run's union)
  let nSeg = 0;
  for (let r = 0; r < w.nRuns; r++) nSeg += w.runs[r * 4 + 1]! - 1;
  bufS = room(bufS, nSeg * SEG_FLOATS);
  const S = bufS, P = w.sx;
  const X = (i: number) => a * P[i * 2]! + c * P[i * 2 + 1]! + ox, Y = (i: number) => b * P[i * 2]! + d * P[i * 2 + 1]! + oy;
  let m = 0;
  for (let r = 0; r < w.nRuns; r++) {
    const i0 = w.runs[r * 4]!, cnt = w.runs[r * 4 + 1]!;
    let hw = (w.runs[r * 4 + 2]! / 2) * sc, al = w.runs[r * 4 + 3]!;
    if (hw < 0.5) { al *= hw / 0.5; hw = 0.5; } // a hairline: a pixel wide, inking by its width (see ./waxgl)
    for (let j = 0; j + 1 < cnt; j++) {
      const i = i0 + j, hasP = j > 0, hasN = j + 2 < cnt, k = m++ * SEG_FLOATS;
      S[k] = hasP ? X(i - 1) : 0; S[k + 1] = hasP ? Y(i - 1) : 0;
      S[k + 2] = X(i); S[k + 3] = Y(i); S[k + 4] = X(i + 1); S[k + 5] = Y(i + 1);
      S[k + 6] = hasN ? X(i + 2) : 0; S[k + 7] = hasN ? Y(i + 2) : 0;
      S[k + 8] = hw;
      S[k + 9] = (hasP ? SEG_PREV : 0) | (hasN ? SEG_NEXT : 0) | (j === 1 ? SEG_PREV_STARTS : 0) | (j + 3 === cnt ? SEG_NEXT_ENDS : 0);
      S[k + 10] = DEEP[0]! * al; S[k + 11] = DEEP[1]! * al; S[k + 12] = DEEP[2]! * al; S[k + 13] = al;
    }
  }
  return { w: box.w, h: box.h, dabs: bufE, nDabs, segs: S, nSegs: m, flecks: bufF, nFlecks };
}

/** Lay the first `len` units of a lipstick stroke along `pts` (Infinity = all of it). Not re-entrant, as inkMark. */
export function lipstickStroke(c: CanvasRenderingContext2D, pts: readonly V2[], len: number, o: BrushOpts) {
  if (pts.length < 2) return;
  const L = polylineLengths(pts);
  const total = L[L.length - 1]!;
  const end = Math.min(len, total);
  if (end <= 0 || total <= 0) return;
  if (inking) throw new Error('inkMark is not re-entrant');
  // the mark's extent: the part laid down so far, padded by half the width and the dabs' jitter
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p: V2) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); };
  for (let i = 0; i < pts.length && L[i]! <= end; i++) grow(pts[i]!);
  grow(pointAtLength(pts, L, end));
  const r = o.width * 0.6;
  const T = CanvasRenderingContext2D.prototype.getTransform.call(c); // (as inkMark's: Layer2D patches its own)
  const box = deviceBox(c, T, [{ x: x0 - r, y: y0 - r }, { x: x1 + r, y: y0 - r }, { x: x1 + r, y: y1 + r }, { x: x0 - r, y: y1 + r }]);
  if (!box) return;
  const g = waxGL();
  g.render(waxDraw(waxParts(pts, L, total, end, o), T, box));
  // a context lost during the render leaves a blank canvas: fail loudly rather than export a frame missing its mark
  if (g.gl.isContextLost()) throw new Error("lipstickStroke: the brush's WebGL context was lost mid-stroke");
  lay(c, g.canvas, 0, 0, box);
}

/** One Chaikin corner-cutting pass over an open polyline, keeping its end points. */
function chaikin(p: V2[]): V2[] {
  if (p.length < 3) return p;
  const r: V2[] = [p[0]!];
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i]!, b = p[i + 1]!;
    r.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  r.push(p[p.length - 1]!);
  return r;
}

/**
 * Write strokes (a stroke-font text or a Drawing) in lipstick, up to total length `len` (measured as `startLen`
 * measures it). A stroke that starts within half the brush width of where an earlier one ended continues it —
 * so which strokes join depends on the width (a much wider brush can bridge gaps a thin one leaves open). Joined
 * strokes are one pen-down run: smoothed (two Chaikin passes, ends kept) so the fonts' polygon corners don't
 * show, and inked as one mark whose pressure tapers only where the lipstick meets or leaves the paper — a word's
 * start and end, a t-cross, a letter pair the font leaves unjoined — never at a join. A given `o.pressure` spans
 * the whole text instead.
 */
export function lipstickWrite(c: CanvasRenderingContext2D, d: { strokes: readonly (readonly V2[])[]; startLen: readonly number[] }, len: number, o: BrushOpts) {
  const S = d.strokes;
  const lens = S.map((p) => { const L = polylineLengths(p); return L[L.length - 1] ?? 0; });
  let total = 0;
  S.forEach((_, i) => { total = Math.max(total, d.startLen[i]! + lens[i]!); });
  const tol = Math.max(0.5, o.width * 0.5);
  const runs: number[][] = [];
  S.forEach((pts, i) => {
    if (pts.length < 2) return;
    let r = -1;
    for (let k = runs.length - 1; k >= 0 && r < 0; k--) {
      const q = S[runs[k]![runs[k]!.length - 1]!]!, e = q[q.length - 1]!;
      if (Math.hypot(e.x - pts[0]!.x, e.y - pts[0]!.y) <= tol) r = k;
    }
    if (r < 0) runs.push([i]); else runs[r]!.push(i);
  });
  for (const run of runs) {
    if (d.startLen[run[0]!]! >= len) continue;
    // the run's polyline (each join point once), how much of it is written, and each member's offset in it
    const pts: V2[] = [], offs: number[] = [];
    let runLen = 0, done = 0;
    for (const i of run) {
      offs.push(runLen);
      for (const p of S[i]!) {
        const q = pts[pts.length - 1];
        if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) pts.push(p);
      }
      done += clamp(len - d.startLen[i]!, 0, lens[i]!);
      runLen += lens[i]!;
    }
    const sm = chaikin(chaikin(pts));
    const Ls = polylineLengths(sm), smLen = Ls[Ls.length - 1]!;
    if (!(smLen > 0)) continue;
    const given = o.pressure;
    const pressure = given
      ? (u: number) => {
          const at = u * runLen;
          let m = 0;
          while (m + 1 < run.length && offs[m + 1]! <= at) m++;
          return given((d.startLen[run[m]!]! + at - offs[m]!) / Math.max(1e-9, total));
        }
      : (u: number) => {
          const s = u * smLen;
          return clamp(Math.min(s / Math.min(o.width * 1.5, smLen * 0.3), (smLen - s) / Math.min(o.width * 4, smLen * 0.45)));
        };
    lipstickStroke(c, sm, (done / Math.max(1e-9, runLen)) * smLen, { ...o, seed: o.seed + run[0]! * 101, pressure });
  }
}
