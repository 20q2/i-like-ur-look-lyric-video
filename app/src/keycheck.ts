// The keys check (TREATMENT §6, "Keys are load-bearing"),
// pure: main.ts's __lv.keycheck runs checkLayer on every spread's sides and layers in the browser (render.ts keys), and
// tests/keycheck.test.ts runs it on synthetic faces. The scene redraws a face only when its key differs from the one it
// last drew it under (faces.ts) and keeps showing that drawing, and it renders times in any order: scrubbing, the
// preview's loop, stills and sheets, the export's motion-blur sub-frames (engine.ts ternaryOffsets). So a key must name
// one face, whenever it comes up.

/** A face as getImageData reads it: RGBA bytes, unpremultiplied, `width` px a row. */
export interface Face { readonly data: Uint8ClampedArray; readonly width: number }

/** How far apart two drawings of one face may be and still count as the same face: Chrome's canvas raster noise
 *  (TREATMENT §6, every pixel within 2 levels). A stale ink key is ~13 levels (an ink step, layout.ts INK_STEPS). */
export const RASTER_TOL = 2;

/** How long after a sample whose key has just changed the check looks again, while the key holds (s): a quarter frame
 *  and a frame at 60 fps. A key quantised finer than the step changes at every sample, so the samples alone almost never
 *  compare two faces under it: the short probe is for animations quantised finely (a karaoke word's ink steps every
 *  6–20 ms), the frame for slower ones, which a quarter frame moves by less than RASTER_TOL. (Before the backward look,
 *  BACK_S: a karaoke line drawn with its exact ink under its quantised key failed 2 key runs over spreads 0–1 on the
 *  samples alone, 34 with these probes.) */
export const PROBES = Object.freeze([1 / 240, 1 / 60]);

/** Where the key changes between two samples, the check finds the change to within this (s), and looks just before it,
 *  under the old key: a face that changes ahead of its key fails there. */
export const BACK_S = 1e-4;

/** A box of face px, [x0, y0, x1, y1], inclusive. */
export type PxBox = readonly [number, number, number, number];
/** How two drawings of a face differ: the most any channel does, in levels, and the box around the pixels that differ by
 *  more than the tolerance (null if none do). */
export interface Delta { d: number; box: PxBox | null }

const words = (x: Uint8ClampedArray) => (x.byteOffset % 4 === 0 ? new Uint32Array(x.buffer, x.byteOffset, x.length >> 2) : new Uint32Array(x.slice().buffer));

/**
 * How two drawings of a face differ, compared premultiplied, as the paper shader composites a face (faces.ts) and as the
 * canvas stores it. getImageData unpremultiplies, so a nearly transparent pixel's colour is noise there (at alpha 1/255
 * any colour reads alike) and comparing those bytes would blow it up to any size; rounding v·a/255 recovers the stored
 * value (to within a level).
 */
export function faceDelta(a: Face, b: Face, tol = RASTER_TOL): Delta {
  const p = a.data, q = b.data;
  if (p.length !== q.length || p.length % 4 || a.width !== b.width) throw new Error(`faceDelta: faces of ${p.length} and ${q.length} bytes, ${a.width} and ${b.width} px wide`);
  const A = words(p), B = words(q), w = a.width; // most pairs are identical: compare whole pixels first
  let d = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) continue;
    const j = 4 * i, pa = p[j + 3]!, qa = q[j + 3]!;
    let e = Math.abs(pa - qa);
    for (let c = j; c < j + 3; c++) e = Math.max(e, Math.abs(Math.round((p[c]! * pa) / 255) - Math.round((q[c]! * qa) / 255)));
    if (e > d) d = e;
    if (e > tol) {
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { d, box: x1 < 0 ? null : [x0, y0, x1, y1] };
}
/** The most any channel of two drawings of a face differs by, in levels (faceDelta). */
export const faceDiff = (a: Face, b: Face) => faceDelta(a, b).d;

const quote = (key: string) => JSON.stringify(key.length > 80 ? `${key.slice(0, 80)}…` : key);
/** Two keys, shown from where they first differ (a key runs to hundreds of characters: a karaoke key is one a word). */
export function keyPair(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 12), cut = (s: string) => JSON.stringify(`${from > 0 ? '…' : ''}${s.slice(from, i + 28)}${s.length > i + 28 ? '…' : ''}`);
  return `${cut(a)}, then ${cut(b)}${from > 0 ? ` (they part at character ${i})` : ''}`;
}

type Mismatch = { t: number; d: number; n: number; box: PxBox | null };
const grow = (m: Mismatch | null, t: number, x: Delta): Mismatch => {
  if (!m) return { t, d: x.d, n: 1, box: x.box };
  const b = m.box && x.box ? [Math.min(m.box[0], x.box[0]), Math.min(m.box[1], x.box[1]), Math.max(m.box[2], x.box[2]), Math.max(m.box[3], x.box[3])] as const : m.box ?? x.box;
  return { t: m.t, d: Math.max(m.d, x.d), n: m.n + 1, box: b };
};

/**
 * The keys check's verdicts on one face layer (one spread's side and layer), fed in time order the key at each sample
 * and the face painted from scratch then (checkLayer drives it).
 * - Within a run of one key, every face must be the face drawn when the run began, the drawing the scene keeps showing,
 *   within RASTER_TOL, or the key is stale: it fails, once per run, naming its span and where on the page the face
 *   changed (a face creeping a level a sample, which consecutive samples would never catch, fails too).
 * - A key that comes up again must bring back the face it first named: the scene draws a face when its key changes, and
 *   renders out of order, so either drawing can be the one shown. The first time is repainted (`repaint`) and compared:
 *   one paint per run of a key seen before.
 * - A new key over identical pixels is a wasted redraw: it warns.
 * - `twice`: the key and the face are pure functions of t, asked again at the same t, on another canvas.
 */
export class KeyTrack {
  readonly fails: string[] = [];
  readonly warns: string[] = [];
  private key: string | null = null;
  private ref: Face | null = null;
  private refT = 0;
  private lastT = 0;
  /** When each key first came up. */
  private readonly first = new Map<string, number>();
  private stale: Mismatch | null = null;
  private readonly recurs = new Map<string, Mismatch>();
  private impure: { first: string; n: number } | null = null;
  /** `pxPerPu`: face px per page unit, to say where on the page a face changed. */
  constructor(readonly name: string, private readonly pxPerPu = 1, readonly tol = RASTER_TOL) {}

  /** The face at t, under `key`; `repaint(t)` paints the face at another t afresh. */
  sample(t: number, key: string, face: Face, repaint?: (t: number) => Face) {
    if (this.ref && key === this.key) {
      const x = faceDelta(face, this.ref, this.tol);
      if (x.d > this.tol) this.stale = grow(this.stale, t, x);
    } else {
      this.flush();
      if (this.ref && faceDelta(face, this.ref, this.tol).d === 0) this.warns.push(`${this.name}: new key at t=${t.toFixed(3)}, same pixels: ${keyPair(this.key!, key)}`);
      const ft = this.first.get(key);
      if (ft === undefined) this.first.set(key, t);
      else if (repaint) {
        const x = faceDelta(face, repaint(ft), this.tol);
        if (x.d > this.tol) this.recurs.set(key, grow(this.recurs.get(key) ?? null, t, x));
      }
      this.key = key; this.ref = face; this.refT = t;
    }
    this.lastT = t;
  }

  /** The key and the face at t, each asked for twice (the second face painted on another canvas). */
  twice(t: number, key: string, keyAgain: string, face: Face, faceAgain: Face) {
    let why: string | null = null;
    if (key !== keyAgain) why = `the key is ${keyPair(key, keyAgain)}`;
    else { const x = faceDelta(face, faceAgain, this.tol); if (x.d > this.tol) why = `painted twice, ${x.d} levels apart ${this.where(x.box)}`; }
    if (!why) return;
    this.impure ??= { first: `t=${t.toFixed(3)}: ${why}`, n: 0 };
    this.impure.n++;
  }

  fail(why: string) { this.fails.push(`${this.name}: ${why}`); }

  /** Report what's pending: the last run's mismatches, the keys that came back with another face, the impure samples. */
  finish(): this {
    this.flush();
    for (const [key, m] of this.recurs) {
      const first = this.first.get(key)!.toFixed(3);
      this.fail(`key ${quote(key)} came up again at t=${m.t.toFixed(3)} with another face than at t=${first}, when it first came up: `
        + `up to ${m.d} levels ${this.where(m.box)}${m.n > 1 ? ` (${m.n} times)` : ''}`);
    }
    this.recurs.clear();
    if (this.impure) this.fail(`not a pure function of t — at ${this.impure.first}${this.impure.n > 1 ? ` (${this.impure.n} samples)` : ''}`);
    this.impure = null;
    return this;
  }

  /** Where on the page a face changed: its box in page units. */
  private where(box: PxBox | null) {
    if (!box) return '';
    const u = (x: number) => Math.round(x / this.pxPerPu);
    return `at pu x ${u(box[0])}–${u(box[2] + 1)}, y ${u(box[1])}–${u(box[3] + 1)}`;
  }

  private flush() {
    const s = this.stale;
    if (!s) return;
    const from = this.refT.toFixed(3);
    this.fail(`key ${quote(this.key!)} from t=${from} to ${this.lastT.toFixed(3)}, but the face changed under it — up to ${s.d} levels `
      + `from its drawing at t=${from}, ${this.where(s.box)} (first at t=${s.t.toFixed(3)}, ${s.n} sample${s.n > 1 ? 's' : ''})`);
    this.stale = null;
  }
}

/** One face layer as the check sees it: its key, and its face painted from scratch, at any t. */
export interface LayerSource {
  key(t: number): string;
  /** Paint on canvas A (each sample's own face) or B (everything compared with it: the purity check's second
   *  painting, probes, a recurring key's first face). */
  paint(t: number, on: 'A' | 'B'): Face;
  /** Sampled every `step` s over [t0, t1). */
  t0: number; t1: number; step: number;
  /** Face px per page unit (for the messages). */
  pxPerPu?: number;
}
/** What to look at beyond the samples (tests switch these off to show what each one catches). */
export interface CheckOpts { probes?: readonly number[]; back?: boolean }

/**
 * The keys check on one layer: a sample every `step` s, each judged by a KeyTrack. Wherever the key changes between two
 * samples the check also looks just before the change, under the old key (BACK_S), and just after the sample, while the
 * new key holds (PROBES); every 8th sample it paints again to check purity. A key or a paint that throws ends the
 * layer, as a failure. Returns the verdicts, and how many samples and probes it took.
 */
export function checkLayer(name: string, src: LayerSource, o: CheckOpts = {}) {
  const { t0, t1, step } = src, probes = o.probes ?? PROBES, back = o.back ?? true;
  if (!(step > 0)) throw new Error(`checkLayer: step ${step} s`);
  const track = new KeyTrack(name, src.pxPerPu);
  let at = t0; // (where a throw came from)
  const key = (t: number) => { at = t; return src.key(t); };
  const paint = (t: number, on: 'A' | 'B') => { at = t; return src.paint(t, on); };
  const again = (t: number) => paint(t, 'B');
  // `lastT`: the last sample's time; `seen`: the latest time judged, probes included (they're judged in time order)
  let n = 0, extra = 0, last: string | null = null, lastT = t0, seen = -Infinity;
  try {
    for (let t: number; (t = t0 + n * step) < t1; n++) {
      const k = key(t);
      if (back && last !== null && k !== last) {
        // the change, found to within BACK_S, and just before it the last key's face, which must not have changed yet
        let a = lastT, b = t;
        while (b - a > BACK_S) { const m = (a + b) / 2; if (key(m) === last) a = m; else b = m; }
        if (a > seen) { track.sample(a, last, again(a)); extra++; }
      }
      const face = paint(t, 'A');
      if (n % 8 === 0) track.twice(t, k, key(t), face, again(t));
      track.sample(t, k, face, again);
      seen = t;
      if (k !== last) {
        for (const e of probes) {
          const u = t + e;
          if (!(u < t0 + (n + 1) * step) || key(u) !== k) break;
          track.sample(u, k, again(u));
          seen = u; extra++;
        }
      }
      last = k; lastT = t;
    }
  } catch (e) {
    track.fail(`threw at t=${at.toFixed(4)}: ${String((e as Error)?.stack ?? e)}`);
  }
  track.finish();
  return { fails: track.fails, warns: track.warns, samples: n, probes: extra };
}
