// The narrator's kiss print: two lips pressed onto the paper in lipstick, inking in from the fullest part of each
// lip, with the skin's creases, a light touch and the paper's tooth leaving gaps, and specks pulled away on lift.
// Pure Canvas2D and deterministic (hashed from the seed); inked as one mark over the target (see inkMark in
// ./lipstick, which re-exports `kiss`).
import { type V2, TAU, clamp, hash, lerp, noise1, noise2, smoothstep } from './util';
import { rgba } from './palette';
import { inkMark } from './lipstick';

// Lip outlines in mouth-width units (x right, y down, origin mid-mouth). Each lip is its outer edge and its inner
// edge (the mouth line), both flattened left to right from Béziers; `lobes` [x, y, rx, ry] are where it presses
// first and inks fullest; its creases fan out from `focus`; `inward` is the y direction from the outer edge into
// the lip. The counts are per lip.
interface Lip {
  outer: V2[]; inner: V2[];
  /** The lip's greatest height (outer edge to mouth line). */
  hMax: number;
  lobes: [number, number, number, number][];
  focus: V2; inward: number;
  /** How much lighter the lip prints at its middle (the Cupid's bow; the lower lip's central groove). */
  mid: number;
  sd: number; dabs: number; creases: number; patches: number; tooth: number; clusters: number;
}

/** Flatten a chain of cubic Béziers given as x0,y0 then 6 numbers (c1, c2, end) per segment. */
function bez(q: number[], n = 20): V2[] {
  const out: V2[] = [{ x: q[0]!, y: q[1]! }];
  for (let i = 2; i + 5 < q.length; i += 6) {
    const x0 = q[i - 2]!, y0 = q[i - 1]!, x1 = q[i]!, y1 = q[i + 1]!, x2 = q[i + 2]!, y2 = q[i + 3]!, x3 = q[i + 4]!, y3 = q[i + 5]!;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      out.push({ x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 });
    }
  }
  return out;
}

/** y of an x-monotonic polyline at x (clamped to its ends). */
function yAt(p: V2[], x: number) {
  const n = p.length;
  if (x <= p[0]!.x) return p[0]!.y;
  if (x >= p[n - 1]!.x) return p[n - 1]!.y;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid]!.x <= x) lo = mid; else hi = mid; }
  const a = p[lo]!, b = p[hi]!;
  return a.y + (b.y - a.y) * ((x - a.x) / Math.max(1e-9, b.x - a.x));
}

/** A lip, with its greatest height measured from its edges. */
function lip(d: Omit<Lip, 'hMax'>): Lip {
  const x0 = d.outer[0]!.x, x1 = d.outer[d.outer.length - 1]!.x;
  let hMax = 0;
  for (let k = 0; k <= 100; k++) { const x = lerp(x0, x1, k / 100); hMax = Math.max(hMax, Math.abs(yAt(d.inner, x) - yAt(d.outer, x))); }
  return { ...d, hMax };
}

const LIPS: Lip[] = [
  lip({
    outer: bez([-0.48, 0.01, -0.4, -0.02, -0.3, -0.17, -0.16, -0.18, -0.08, -0.19, -0.035, -0.14, 0, -0.125,
      0.035, -0.145, 0.085, -0.195, 0.165, -0.185, 0.31, -0.175, 0.41, -0.025, 0.48, 0.005]),
    inner: bez([-0.48, 0.01, -0.34, -0.025, -0.14, -0.05, 0.02, 0.01, 0.17, -0.055, 0.34, -0.03, 0.48, 0.005]),
    lobes: [[-0.19, -0.12, 0.2, 0.075], [0.19, -0.125, 0.2, 0.075]],
    focus: { x: 0, y: 0.42 }, inward: 1, mid: 0.2,
    sd: 11, dabs: 560, creases: 44, patches: 70, tooth: 200, clusters: 5,
  }),
  lip({
    outer: bez([-0.45, 0.035, -0.39, 0.18, -0.2, 0.29, 0.02, 0.285, 0.22, 0.285, 0.39, 0.16, 0.44, 0.03]),
    inner: bez([-0.45, 0.035, -0.3, 0.06, -0.14, 0.03, 0, 0.035, 0.15, 0.03, 0.3, 0.055, 0.44, 0.03]),
    lobes: [[-0.11, 0.17, 0.22, 0.12], [0.11, 0.17, 0.22, 0.12]],
    focus: { x: 0, y: -0.36 }, inward: -1, mid: 0.3,
    sd: 23, dabs: 760, creases: 50, patches: 90, tooth: 260, clusters: 8,
  }),
];

/** A lip's print outline, ragged: both edges wander and bite inward, calming where the lip pinches to a corner. */
function lipPath(l: Lip, seed: number): Path2D {
  const x0 = l.outer[0]!.x, x1 = l.outer[l.outer.length - 1]!.x, N = 110;
  const edge = (e: V2[], other: V2[], inward: number, amp: number, s: number) => {
    const out: V2[] = [];
    for (let k = 0; k <= N; k++) {
      const x = lerp(x0, x1, k / N), y = yAt(e, x);
      const env = clamp(Math.abs(yAt(other, x) - y) / 0.05);
      const bite = Math.max(0, noise1(x * 21, s + 2) - 0.45) * 0.04;
      out.push({ x, y: y + env * (amp * noise1(x * 43, s) + amp * 0.45 * noise1(x * 131, s + 1) + inward * bite) });
    }
    return out;
  };
  const o = edge(l.outer, l.inner, l.inward, 0.004, seed * 7 + l.sd);
  const i = edge(l.inner, l.outer, -l.inward, 0.006, seed * 7 + l.sd + 50);
  const p = new Path2D();
  p.moveTo(o[0]!.x, o[0]!.y);
  for (const q of o) p.lineTo(q.x, q.y);
  for (let k = i.length - 1; k >= 0; k--) p.lineTo(i[k]!.x, i[k]!.y);
  p.closePath();
  return p;
}

/** Add a lens from P to Q to `p`: pointed at both ends, `w` across at its middle, bowed through (bx, by). */
function lens(p: Path2D, P: V2, Q: V2, bx: number, by: number, w: number) {
  const d = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
  const nx = (-(Q.y - P.y) / d) * w, ny = ((Q.x - P.x) / d) * w;
  p.moveTo(P.x, P.y);
  p.quadraticCurveTo(bx + nx, by + ny, Q.x, Q.y);
  p.quadraticCurveTo(bx - nx, by - ny, P.x, P.y);
  p.closePath();
}

/** Add an ellipse to `p` as its own subpath. */
function oval(p: Path2D, x: number, y: number, rx: number, ry: number, a: number) {
  p.moveTo(x + rx * Math.cos(a), y + rx * Math.sin(a));
  p.ellipse(x, y, rx, ry, a, 0, TAU);
}

/**
 * Gaps cut in four strengths: `band(h)` is the path to add a shape of strength h (0..1, quantised to four bands);
 * `cut` then removes them from the wax with one fill per band, band q taking out lerp(lo, hi, (q + 0.5) / 4) of it.
 * (Within a band, overlapping gaps take out their union once, not compounding.)
 */
function gaps(lo: number, hi: number) {
  const bands = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  return {
    band: (h: number) => bands[Math.min(3, Math.floor(h * 4))]!,
    cut(s: CanvasRenderingContext2D) { bands.forEach((P, q) => { s.globalAlpha = lerp(lo, hi, (q + 0.5) / 4); s.fill(P); }); },
  };
}

/** Ink one lip of a kiss (in mouth-width units), unclipped: the mark lays it on through the lip's outline. */
function inkLip(s: CanvasRenderingContext2D, l: Lip, press: number, lift: number, seed: number) {
  const { outer, inner, sd, focus } = l;
  const x0 = outer[0]!.x, x1 = outer[outer.length - 1]!.x;
  const pe = smoothstep(0, 1, press), fade = smoothstep(0, 0.15, press);
  /** A point inside the lip, area-weighted (null: rejected), and t = 0 at its outer edge .. 1 at the mouth line. */
  const pick = (j: number, kind: number) => {
    const x = lerp(x0, x1, hash(seed, sd, kind, j, 1));
    const yo = yAt(outer, x), yi = yAt(inner, x);
    if (hash(seed, sd, kind, j, 2) * l.hMax > Math.abs(yi - yo)) return null;
    const t = hash(seed, sd, kind, j, 3);
    return { x, y: lerp(yo, yi, t), t };
  };
  /** How fully the lip inks at a point: lighter at the outline, lighter still at the mouth line and corners, mottled. */
  const density = (x: number, y: number, t: number) =>
    (0.5 + 0.5 * smoothstep(0, 0.3, t)) * (1 - 0.6 * smoothstep(0.6, 1, t)) *
    (1 - smoothstep(0.6, 1, Math.abs(x) / 0.47)) * (1 - l.mid * Math.exp(-((x / 0.1) ** 2))) *
    (0.65 + 0.35 * noise2(x * 17, y * 17, seed * 31 + sd));
  /** The press progress at which a point inks: the lobe centres first, then outward along an uneven front. */
  const arrive = (x: number, y: number) => {
    let dm = Infinity;
    for (const [cx, cy, rx, ry] of l.lobes) dm = Math.min(dm, Math.hypot((x - cx) / rx, (y - cy) / ry));
    return dm / 1.4 + 0.2 * noise2(x * 9, y * 9, seed * 17 + sd);
  };
  const along = (x: number, y: number) => Math.atan2(y - focus.y, x - focus.x); // the creases' direction here
  // 1. body: a soft pool of wax spreading out from each lobe as the lips press in
  for (const [cx, cy, rx, ry] of l.lobes) {
    const g = s.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba('lipstick', 0.85 * fade));
    g.addColorStop(0.55, rgba('lipstick', 0.62 * fade));
    g.addColorStop(1, rgba('lipstick', 0));
    const k = 0.3 + 0.95 * pe;
    s.save();
    s.translate(cx, cy);
    s.scale(rx * k * 1.25, ry * k * 1.35);
    s.fillStyle = g;
    s.fillRect(-1, -1, 2, 2);
    s.restore();
  }
  // 2. mottle: dabs of wax stretched along the creases, fullest in the body, inking in from the lobes (the deeper
  //    tone second). Each its own fill: overlapping dabs must build up.
  for (const deep of [false, true]) {
    s.fillStyle = rgba(deep ? 'lipstickDeep' : 'lipstick');
    for (let j = 0; j < l.dabs; j++) {
      if ((hash(seed, sd, 0, j, 4) < 0.15) !== deep) continue;
      const p = pick(j, 0);
      if (!p) continue;
      const vis = smoothstep(-0.12, 0.12, press * 1.25 - arrive(p.x, p.y));
      if (vis <= 0) continue;
      s.globalAlpha = (deep ? 0.16 : 0.55) * density(p.x, p.y, p.t) * vis * (0.5 + hash(seed, sd, 0, j, 5));
      s.beginPath();
      s.ellipse(p.x, p.y, 0.012 + 0.022 * hash(seed, sd, 0, j, 6), 0.0045 + 0.0075 * hash(seed, sd, 0, j, 7), along(p.x, p.y), 0, TAU);
      s.fill();
    }
  }
  // 3. gaps where the skin's folds, a light touch and the paper's tooth kept the wax off
  const creases = gaps(0.25, 0.9), patches = gaps(0.1, 0.4), tooth = gaps(0.45, 0.95), specks = gaps(0.55, 0.95);
  // creases: fanning out from the focus, curved, broken, of varied length, some branching
  for (let k = 0; k < l.creases; k++) {
    const H = (n: number) => hash(seed, sd, 9, k, n);
    const x = lerp(x0, x1, (k + 0.5 + (H(0) - 0.5) * 0.85) / l.creases);
    const yo = yAt(outer, x), yi = yAt(inner, x), h = Math.abs(yi - yo);
    if (h < 0.012) continue;
    const my = (yo + yi) / 2;
    let dx = x - focus.x, dy = my - focus.y;
    const dl = Math.hypot(dx, dy);
    dx /= dl; dy /= dl;
    const half = h / 2 / Math.max(0.35, Math.abs(dy));
    const at = (t: number) => ({ x: x + dx * half * (1 - 2 * t), y: my + dy * half * (1 - 2 * t) }); // t: outer edge 0 .. mouth line 1
    const span = H(1) < 0.75 ? 0.55 + 0.4 * H(2) : 0.2 + 0.3 * H(2);
    const t0 = 0.03 + (0.94 - span) * H(3), t1 = t0 + span;
    const pieces = 1 + Math.floor(H(4) * 1.6);
    const bend = (H(5) - 0.5) * 0.03;
    const wid = 0.0036 + 0.0058 * H(6) + (H(7) < 0.12 ? 0.005 : 0);
    const P = creases.band(H(8));
    const seg = (t1 - t0) / pieces;
    for (let q = 0; q < pieces; q++) {
      const a0 = t0 + q * seg + (q > 0 ? 0.03 + 0.05 * H(10 + q) : 0), a1 = t0 + (q + 1) * seg;
      if (a1 - a0 < 0.03) continue;
      const M = at((a0 + a1) / 2);
      lens(P, at(a0), at(a1), M.x - dy * bend, M.y + dx * bend, wid);
    }
    if (H(9) < 0.22) {
      const B = at(t0 + (t1 - t0) * (0.3 + 0.4 * H(14)));
      const ang = (H(15) < 0.5 ? -1 : 1) * (0.3 + 0.35 * H(16)), sg = H(17) < 0.5 ? 1 : -1;
      const bl = (0.2 + 0.25 * H(18)) * h;
      const E = { x: B.x + sg * (dx * Math.cos(ang) - dy * Math.sin(ang)) * bl, y: B.y + sg * (dx * Math.sin(ang) + dy * Math.cos(ang)) * bl };
      lens(P, B, E, (B.x + E.x) / 2, (B.y + E.y) / 2, wid * 0.8);
    }
  }
  // patches: lighter where the lip met the paper lightly (mostly toward the outline and the mouth line)
  for (let j = 0; j < l.patches; j++) {
    const p = pick(j, 1);
    if (!p || hash(seed, sd, 1, j, 4) > 0.15 + 0.85 * (1 - density(p.x, p.y, p.t))) continue;
    const r = 0.006 + 0.016 * hash(seed, sd, 1, j, 5);
    oval(patches.band(hash(seed, sd, 1, j, 6)), p.x, p.y, r, r * (0.18 + 0.2 * hash(seed, sd, 1, j, 7)), along(p.x, p.y));
  }
  // tooth: pinpricks of paper, thickest where the print is thin
  for (let j = 0; j < l.tooth; j++) {
    const p = pick(j, 2);
    if (!p || hash(seed, sd, 2, j, 4) > 0.25 + 0.75 * (1 - density(p.x, p.y, p.t))) continue;
    const r = 0.001 + 0.0022 * hash(seed, sd, 2, j, 5);
    oval(tooth.band(hash(seed, sd, 2, j, 6)), p.x, p.y, r * 1.6, r, hash(seed, sd, 2, j, 7) * Math.PI);
  }
  // lift: clusters of specks where the lips pulled wax back off the paper, opening one by one
  for (let j = 0; j < l.clusters; j++) {
    const thr = ((j + hash(seed, sd, 3, j, 4)) / l.clusters) * 0.85;
    if (lift <= thr) continue;
    let p: { x: number; y: number; t: number } | null = null;
    for (let tr = 0; tr < 6 && !(p && p.t > 0.1 && p.t < 0.9); tr++) p = pick(j * 6 + tr, 3);
    if (!p) continue;
    const spread = 0.01 + 0.022 * hash(seed, sd, 3, j, 5), ns = 5 + Math.floor(9 * hash(seed, sd, 3, j, 6));
    for (let q = 0; q < ns; q++) {
      const Hs = (n: number) => hash(seed, sd, 4, j, q, n);
      if (lift <= thr + 0.12 * Hs(0)) continue;
      const a = Hs(1) * TAU, r = spread * Math.sqrt(Hs(2)), rr = 0.0015 + 0.0045 * Hs(3);
      oval(specks.band(Hs(4)), p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, rr, rr * (0.55 + 0.45 * Hs(5)), Hs(6) * Math.PI);
    }
  }
  s.globalCompositeOperation = 'destination-out';
  s.fillStyle = '#000';
  for (const g of [creases, patches, tooth, specks]) g.cut(s);
}

/**
 * A kiss print centred at (x, y); `size` = mouth width, `rot` radians. `press` 0..1 inks it in, from the fullest
 * part of each lip outward (and settles it slightly); `lift` 0..1 opens clusters of specks where the lips, pulled
 * away, took wax back off the paper.
 */
export function kiss(c: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, press: number, lift: number, seed: number) {
  if (press <= 0) return;
  const sc = size * (1.035 - 0.035 * smoothstep(0, 1, press));
  const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
  const box = [[-0.53, -0.25], [0.53, -0.25], [0.53, 0.34], [-0.53, 0.34]].map(([u, v]) => ({ x: x + cs * u! - sn * v!, y: y + sn * u! + cs * v! }));
  inkMark(c, box, (m, layer) => {
    m.translate(x, y);
    m.rotate(rot);
    m.scale(sc, sc);
    for (const l of LIPS) layer(lipPath(l, seed), (s) => inkLip(s, l, press, lift, seed));
  });
}
