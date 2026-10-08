// Ink illustrations that draw themselves. SVG path data (or raw polylines) is flattened into polylines with
// cumulative arc lengths — the same shape the stroke fonts produce — so a drawing can be inked progressively,
// timed to the music. Hatch fills are parallel lines clipped to a polygon. Pure geometry, except
// drawProgress, which strokes into a Canvas2D context with its current style.
import { type V2, noise1, polylineLengths } from './util';

export interface Drawing {
  /** Its polylines. Read-only: those of raw polylines drawn without wobble are the caller's own arrays (shared art is
   *  frozen: spreads/art.ts). */
  strokes: readonly (readonly V2[])[];
  /** Cumulative arc length at each vertex of each stroke. */
  lens: Float32Array[];
  /** Cumulative length at the start of each stroke; `total` is the whole drawing. */
  startLen: number[];
  total: number;
}

/** Straight segments per Bézier curve when flattening. */
const CURVE_SEGMENTS = 16;
const TOKEN = /[MLHVCQZmlhvcqz]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g;
const isCmd = (s: string) => /^[A-Za-z]$/.test(s);

/** SVG path data (M L H V C Q Z, absolute and relative, implicit repeats) -> one polyline per subpath. */
export function parsePath(d: string): V2[][] {
  if (/[^MLHVCQZmlhvcqz\d\s.,eE+-]/.test(d)) throw new Error(`unsupported path data (only M L H V C Q Z): ${d}`);
  const tok = d.match(TOKEN) ?? [];
  if (d.replace(TOKEN, '').replace(/[\s,]/g, '') !== '') throw new Error(`unrecognized characters in path data: ${d}`);
  const out: V2[][] = [];
  let cur: V2[] = [];
  let x = 0, y = 0, sx = 0, sy = 0, i = 0, cmd = '';
  const num = () => {
    const v = tok[i];
    if (v === undefined || isCmd(v)) throw new Error(`path data ended early after "${cmd}": ${d}`);
    i++;
    return +v;
  };
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  while (i < tok.length) {
    if (isCmd(tok[i]!)) cmd = tok[i++]!;
    else if (!cmd) throw new Error(`path data must start with a command: ${d}`);
    const rel = cmd >= 'a';
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        flush();
        x = ox + num(); y = oy + num(); sx = x; sy = y;
        cur.push({ x, y });
        cmd = rel ? 'l' : 'L'; // further coordinate pairs are implicit line-tos
        break;
      case 'L': x = ox + num(); y = oy + num(); cur.push({ x, y }); break;
      case 'H': x = ox + num(); cur.push({ x, y }); break;
      case 'V': y = oy + num(); cur.push({ x, y }); break;
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
        for (let k = 1; k <= CURVE_SEGMENTS; k++) {
          const t = k / CURVE_SEGMENTS, u = 1 - t;
          cur.push({
            x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          });
        }
        x = x3; y = y3;
        break;
      }
      case 'Q': {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num();
        for (let k = 1; k <= CURVE_SEGMENTS; k++) {
          const t = k / CURVE_SEGMENTS, u = 1 - t;
          cur.push({ x: u * u * x + 2 * u * t * x1 + t * t * x2, y: u * u * y + 2 * u * t * y1 + t * t * y2 });
        }
        x = x2; y = y2;
        break;
      }
      case 'Z':
        cur.push({ x: sx, y: sy });
        x = sx; y = sy;
        flush();
        cur = [{ x, y }]; // a command after Z without an M continues from the subpath's start
        if (i < tok.length && !isCmd(tok[i]!)) throw new Error(`numbers after Z: ${d}`);
        break;
      default:
        throw new Error(`unsupported path command "${cmd}": ${d}`);
    }
  }
  flush();
  return out;
}

/** Insert points so no segment is longer than `maxSeg`; the original vertices are kept exactly. */
export function subdivide(pts: readonly V2[], maxSeg: number): V2[] {
  if (!(maxSeg > 0 && Number.isFinite(maxSeg))) throw new Error('subdivide: maxSeg must be > 0');
  const out: V2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxSeg));
    for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    out.push(b);
  }
  return out;
}

/** Closed polyline approximating a circle (first and last points identical). */
export function circle(cx: number, cy: number, r: number, n = 32): V2[] {
  const pts: V2[] = [];
  for (let k = 0; k < n; k++) pts.push({ x: cx + r * Math.cos((k / n) * 2 * Math.PI), y: cy + r * Math.sin((k / n) * 2 * Math.PI) });
  pts.push({ ...pts[0]! });
  return pts;
}

export interface DrawingOpts {
  /** Hand-inked wobble: max offset of the line per axis, in drawing units (0 = ruler-straight). */
  wobble?: number;
  seed?: number;
}

/**
 * A drawing from path data strings and/or raw polylines, in drawing order. A raw polyline counts as
 * closed (and stays closed under wobble) only if its last point equals its first exactly — use circle()
 * or a Z-closed path. Without wobble, raw polylines go into `strokes` as they are (not copied).
 */
export function makeDrawing(items: readonly (string | readonly V2[])[], o: DrawingOpts = {}): Drawing {
  const w = o.wobble ?? 0, seed = o.seed ?? 1;
  let strokes: (readonly V2[])[] = items.flatMap((it) => (typeof it === 'string' ? parsePath(it) : [it]));
  if (w > 0) {
    strokes = strokes.map((p, si) => {
      const closed = p.length > 2 && Math.hypot(p[0]!.x - p[p.length - 1]!.x, p[0]!.y - p[p.length - 1]!.y) < 1e-9;
      const q = subdivide(p, 6);
      const L = polylineLengths(q);
      const r = q.map((pt, k) => ({
        x: pt.x + w * noise1(L[k]! / 40, seed + si * 13),
        y: pt.y + w * noise1(L[k]! / 40, seed + si * 13 + 7),
      }));
      if (closed) r[r.length - 1] = { ...r[0]! };
      return r;
    });
  }
  const lens = strokes.map((p) => polylineLengths(p));
  const startLen: number[] = [];
  let total = 0;
  for (const L of lens) { startLen.push(total); total += L[L.length - 1] ?? 0; }
  return { strokes, lens, startLen, total };
}

/** The first `len` units of a drawing as polylines (the last one cut mid-segment). */
export function partial(d: Drawing, len: number): V2[][] {
  if (Number.isNaN(len)) throw new Error('partial: len must be a finite number or Infinity');
  const out: V2[][] = [];
  for (let i = 0; i < d.strokes.length; i++) {
    const s0 = d.startLen[i]!;
    if (s0 >= len) break;
    const pts = d.strokes[i]!, L = d.lens[i]!;
    const remain = len - s0;
    const seg: V2[] = [pts[0]!];
    let j = 1;
    for (; j < pts.length && L[j]! <= remain; j++) seg.push(pts[j]!);
    if (j < pts.length && remain > L[j - 1]!) {
      const a = pts[j - 1]!, b = pts[j]!;
      const u = (remain - L[j - 1]!) / Math.max(1e-9, L[j]! - L[j - 1]!);
      seg.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    out.push(seg);
  }
  return out;
}

/** Stroke the first `len` units of a drawing with the context's current stroke style. */
export function drawProgress(c: CanvasRenderingContext2D, d: Drawing, len: number) {
  c.beginPath();
  for (const seg of partial(d, len)) {
    c.moveTo(seg[0]!.x, seg[0]!.y);
    for (let k = 1; k < seg.length; k++) c.lineTo(seg[k]!.x, seg[k]!.y);
  }
  c.stroke();
}

/** Parallel lines at `angle` (radians) every `spacing` units, clipped to a closed polygon (even-odd). */
export function hatchLines(poly: readonly V2[], angle: number, spacing: number, phase = 0): V2[][] {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // rotate into a frame where the hatch lines are horizontal: u along a line, v across the lines
  const P = poly.map((p) => ({ u: p.x * ca + p.y * sa, v: -p.x * sa + p.y * ca }));
  let vmin = Infinity, vmax = -Infinity;
  for (const p of P) { vmin = Math.min(vmin, p.v); vmax = Math.max(vmax, p.v); }
  const out: V2[][] = [];
  for (let v = Math.ceil((vmin - phase) / spacing) * spacing + phase; v <= vmax; v += spacing) {
    const xs: number[] = [];
    for (let k = 0; k < P.length; k++) {
      const a = P[k]!, b = P[(k + 1) % P.length]!;
      if ((a.v <= v && b.v > v) || (b.v <= v && a.v > v)) xs.push(a.u + ((v - a.v) / (b.v - a.v)) * (b.u - a.u));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const u0 = xs[k]!, u1 = xs[k + 1]!;
      if (u1 - u0 <= 1e-9) continue; // a vertex tangent to the scanline: a near-zero sliver, not a real crossing
      out.push([{ x: u0 * ca - v * sa, y: u0 * sa + v * ca }, { x: u1 * ca - v * sa, y: u1 * sa + v * ca }]);
    }
  }
  return out;
}
