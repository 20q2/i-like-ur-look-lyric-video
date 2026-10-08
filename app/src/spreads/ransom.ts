// Spread 10, Ransom note (chorus 3, pp. 18 and 21), house
// style B, Collage (batch-2 spec §4: "the issue torn and re-taped, cut-out letters"). The rip (schedule.ts, RIP_S) tears
// spread 9's right page off over 133.669–134.269: this module's left face is spread 9's (whoworeit) ME page at its
// final state, re-used so the cut at the rip's end is invisible (whoworeitLeft), with the collage glued over it. The
// right face is page 21, the fashion page under the one torn out: four photos of her in the jacket, each scribbled out
// in lipstick a kick apart through line 3 ("She wears you well, but can't you see?", held on the whole spread so it's
// seen), the torn stub of p. 19 along the spine, and a couple of strips of tape. Every sung word of
// the chorus is spelled across both pages in cut-out letter tiles, word by word, each a little tile of paper or ink,
// rotated, shadowed, roughly cut — a ransom note. Lipstick (Collage, much reduced from spread 9's Takeover): only the
// underline under "better on me" and a last kiss on "yeah", in the corner.
import { HAIRLINE_PU, PAGE, type Side, drawFolio } from '../engine/layout';
import { kiss, lipstickStroke } from '../engine/lipstick';
import type { Line, Word } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { STRETCH_STEPS, knockout, stretchFamily } from '../engine/print';
import { ARCHIVO_WIDTHS, F, font } from '../engine/type';
import { type V2, clamp, ease, hash, polylineLengths, prog } from '../engine/util';
import { ART, JACKET_NECK, artDrawings, drawArt } from './art';
import { kicksAcross, sectionLine } from './cues';
import { resolveFlatplan, spreadCtx } from './flatplan';
import { type Box, type Shot, director, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';
import { landsAt } from '../scenes/magazine/schedule';
import { whoworeitLeft } from './whoworeit';

// ======================================================================== the layout (page units; spread x across the
// gutter, the right face at x − PAGE.w) ========================================================================

/** The ransom note's rows: a running cursor across the spread, wrapping within a margin, line by line, line 1's size
 *  smallest (top left) growing to line 4's (across the bottom, the punchline). No DOM measurement in the factory: a
 *  tile's advance is a fraction of its own size (baseAdvK), not a measured glyph width — ransom-note letters are never
 *  evenly kerned anyway — but that fraction is itself scaled per letter by its font's own width (Archivo's width step)
 *  and its shape (an "I" or an "M"/"W"), below: a tile sized only off baseAdvK clips a wide glyph in a wide font (an
 *  "X" or "Y" set in Archivo's widest step read as a stray slash or parenthesis with only baseAdvK — the bug this
 *  guards). */
const ROW = Object.freeze({ marginX: 40, baseAdvK: 0.58, letterGap: 0.1, wordGap: 0.46, rowK: 1.3 });
/** A word on the right page starts at least this far past the spine (pu): set right at it, its first tile's chip and
 *  rotation lay it across the gutter. */
const SPINE_PAD = 30;
const LINE_SIZES = [52, 58, 64, 78] as const;
const TOP_Y = 150, LINE_GAP = 16;
/** "yeah" (line 4's last word) is pulled out of the wrap and dropped alone in the corner, with the kiss beside it: "a
 *  final kiss on 'yeah', in the corner" (the spec's own words). */
const CORNER = Object.freeze({ size: 100, x0: 466, y: 896 });
/** A tile's size (pu) is its line's base size, jittered a little (the spec's range, 50–110 pu, stays). */
const SIZE_JITTER = 8;
/** Rotation (rad), the contact shadow's offset and strength: "rotated ±6°... with a soft contact shadow". */
const ROT_MAX = (6 * Math.PI) / 180;
const SHADOW = Object.freeze({ dx: 2.2, dy: 3.2, alpha: 0.32 });
/** How a tile slaps down: a short, fixed settle (not a slow word's whole span) — "a tiny settle". */
const SETTLE_S = 0.12;
/** The note reads a little ahead of the song: a word's tiles start landing LEAD_S before it's sung, one after another
 *  across at most RUN_S (each settling over SETTLE_S), and none before `notBefore` (the rip's end: the page isn't up
 *  until then). */
const LEAD_S = 0.25, RUN_S = 0.2;
const STEPS = Object.freeze({ tile: 10, ul: 20, kiss: 16 });
const BODONI_W = [400, 700, 900] as const;
const MONO = F.mono(600);

const offOf = (side: Side): number => (side === 'R' ? PAGE.w : 0);

/** A tile's look: its font family, hashed per letter so each reads as cut from a different page of the issue —
 *  "Bodoni, Archivo at any width, or mono" — with `widthK`, how much wider or narrower that pick runs than a plain
 *  normal-width face at the same size: Archivo's own width step (its instances run 62%–125% of normal, ARCHIVO_WIDTHS,
 *  a real difference between font files, not a transform), a touch more for Bodoni's italic (it leans into extra
 *  width), none for mono (every glyph is its own fixed-width cell already). */
function tileLook(seed: number): { font: string; widthK: number } {
  const r = hash(seed, 1);
  if (r < 0.34) {
    const italic = hash(seed, 3) < 0.3;
    return { font: F.bodoni(BODONI_W[Math.floor(hash(seed, 2) * BODONI_W.length)]!, { italic }), widthK: italic ? 1.08 : 1 };
  }
  if (r < 0.72) {
    const step = Math.floor(hash(seed, 4) * (STRETCH_STEPS + 1));
    return { font: stretchFamily(step, hash(seed, 5) < 0.5 ? 700 : 900), widthK: ARCHIVO_WIDTHS[step]! / 1000 };
  }
  return { font: MONO, widthK: 1 };
}
/** How much wider or narrower a letter's own shape runs than the font's plain advance: "I" alone is narrow, "M"/"W"
 *  wide (the two shapes the bug report named, and the two every text font agrees on) — mono gets neither (its cells
 *  are the same width whatever letter sits in them, so varying this would just misalign the glyph within its own
 *  cell, not fix anything). */
function letterWidthK(ch: string, mono: boolean): number {
  if (mono) return 1;
  if (ch === 'I') return 0.5;
  if (ch === 'M' || ch === 'W') return 1.55;
  return 1;
}

interface Tile {
  ch: string; cx: number; cy: number; size: number; rot: number; dark: boolean; font: string;
  /** This tile's own advance (a fraction of `size`): baseAdvK already scaled by its font's width and its letter's
   *  shape, so the chip painted at it (paintTile) always fits the glyph drawn on it. */
  advK: number;
  side: Side; seed: number;
  from: number; to: number; // the settle's window (song s)
}
interface WordBox { side: Side; box: Box; from: number; to: number }

/** A word's letters only (no punctuation — the tiles spell the sounds, not the apostrophes), each one's settle window
 *  SETTLE_S long ("a tiny settle"), starting one after another from LEAD_S before the word across RUN_S (or the word's
 *  own span, if shorter), and not before `notBefore`. */
function letterSlots(w: { w: string; start: number; end: number }, notBefore: number): { ch: string; from: number; to: number }[] {
  const letters = Array.from(w.w).filter((ch) => /\p{L}/u.test(ch));
  const n = letters.length || 1, run = Math.min(RUN_S, w.end - w.start), t0 = Math.max(notBefore, w.start - LEAD_S);
  return letters.map((ch, k) => {
    const s0 = t0 + (run * k) / n;
    return { ch: ch.toUpperCase(), from: s0, to: s0 + SETTLE_S };
  });
}

/** The whole note's layout: every letter tile (reading order, for a running seed) and each word's box (for the camera
 *  and the guard), wrapping word by word across the spread, line by line, down the page. A word that would straddle
 *  the gutter jumps to the right page first, so no tile ever itself crosses it (each canvas clips its own half: a
 *  straddling tile would be cut in two, which a glued paper tile never is). Pure: only the lines' own word timings and
 *  a fixed advance model, no DOM. */
function buildLayout(lines: readonly Line[], seedBase: number, notBefore: number): { tiles: Tile[]; words: WordBox[][] } {
  const tiles: Tile[] = [];
  const words: WordBox[][] = [];
  let y: number = TOP_Y, gi = 0;
  const SP = PAGE.w, RIGHT = 2 * SP - ROW.marginX;
  lines.forEach((line, li) => {
    const size = LINE_SIZES[li]!, rowH = size * ROW.rowK;
    let x: number = ROW.marginX, row = 0;
    const lineWords: WordBox[] = [];
    line.words.forEach((w) => {
      const slots = letterSlots(w, notBefore);
      // each letter's seed, font and advance, settled before either pass uses them, so the wordW this word reserves
      // (below) and the tile actually placed on it (further below) agree
      const seeds = slots.map((_, k) => seedBase + (gi + k) * 29);
      const looks = seeds.map((sd) => tileLook(sd));
      const advKs = slots.map((s, k) => ROW.baseAdvK * looks[k]!.widthK * letterWidthK(s.ch, looks[k]!.font === MONO));
      let wordW = 0;
      advKs.forEach((advK, k) => { wordW += size * advK + (k < slots.length - 1 ? size * ROW.letterGap : 0); });
      let gap = x > ROW.marginX ? size * ROW.wordGap : 0;
      if (x > ROW.marginX && x + gap + wordW > RIGHT) { row++; x = ROW.marginX; gap = 0; }
      if (x < SP + SPINE_PAD && x + gap + wordW > SP) { x = SP + SPINE_PAD; gap = 0; } // (onto the right page, clear of the spine)
      if (x + gap + wordW > RIGHT) { row++; x = ROW.marginX; gap = 0; } // (pushed past the right margin by that)
      x += gap;
      const x0 = x, rowY = y + row * rowH;
      slots.forEach((s, k) => {
        const seed = seeds[k]!, { font: fnt } = looks[k]!, advK = advKs[k]!;
        const cx = x + (size * advK) / 2, tSize = size + (hash(seed, 9) - 0.5) * 2 * SIZE_JITTER;
        tiles.push({
          ch: s.ch, cx, cy: rowY, size: tSize, rot: (hash(seed, 10) - 0.5) * 2 * ROT_MAX, dark: hash(seed, 11) < 0.45,
          font: fnt, advK, side: cx < SP ? 'L' : 'R', seed, from: s.from, to: s.to,
        });
        x += size * advK + (k < slots.length - 1 ? size * ROW.letterGap : 0);
        gi++;
      });
      const pad = size * 0.35, side: Side = x0 < SP ? 'L' : 'R', off = offOf(side);
      const box: Box = [x0 - pad - off, rowY - size * 0.62 - pad, x - pad - off, rowY + size * 0.62 + pad];
      lineWords.push({ side, box, from: slots[0]!.from, to: slots[slots.length - 1]!.to });
    });
    words.push(lineWords);
    y += (row + 1) * rowH + LINE_GAP;
  });
  return { tiles, words };
}

/** A hand-rough rect, hw x hh about its centre: a few jittered points a side, not per-pixel ("a cheap rough edge"). */
const ROUGH_SIDES = [
  { a: [-1, -1], b: [1, -1], n: [0, -1] },
  { a: [1, -1], b: [1, 1], n: [1, 0] },
  { a: [1, 1], b: [-1, 1], n: [0, 1] },
  { a: [-1, 1], b: [-1, -1], n: [-1, 0] },
] as const;
function roughRect(hw: number, hh: number, seed: number): V2[] {
  const j = Math.min(hw, hh) * 0.16, pts: V2[] = [];
  ROUGH_SIDES.forEach((s, si) => {
    for (let i = 0; i < 3; i++) {
      const u = i / 3, x = (s.a[0] + (s.b[0] - s.a[0]) * u) * hw, y = (s.a[1] + (s.b[1] - s.a[1]) * u) * hh;
      const off = (hash(seed, si * 5 + i, 40) - 0.5) * 2 * j;
      pts.push({ x: x + s.n[0] * off, y: y + s.n[1] * off });
    }
  });
  return pts;
}
function fillPoly(c: CanvasRenderingContext2D, pts: readonly V2[]) {
  c.beginPath();
  c.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
  c.closePath();
  c.fill();
}

/** A tile's final look (scale 1, full shadow): the contact shadow (a simple offset fill, not a blur — perf), the chip,
 *  the letter — "either black on paper or paper on black". Drawn about the tile's own centre (caller translates and
 *  rotates first). */
/** A tile's chip outline about its centre (paintTile's). */
const tileChip = (t: Tile) => roughRect((t.size * t.advK) / 2 + 4, t.size * 0.58, t.seed);
/** What a settled tile covers about its centre: its chip and its contact shadow. */
function tileFootprint(t: Tile): V2[] {
  const p = tileChip(t), xs = [...p.map((q) => q.x), ...p.map((q) => q.x + SHADOW.dx)], ys = [...p.map((q) => q.y), ...p.map((q) => q.y + SHADOW.dy)];
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
function paintTile(c: CanvasRenderingContext2D, t: Tile) {
  const poly = tileChip(t);
  c.fillStyle = `rgba(0,0,0,${SHADOW.alpha})`;
  fillPoly(c, poly.map((p) => ({ x: p.x + SHADOW.dx, y: p.y + SHADOW.dy })));
  c.fillStyle = rgba(t.dark ? 'ink' : 'paper');
  fillPoly(c, poly);
  c.fillStyle = rgba(t.dark ? 'paper' : 'ink');
  c.font = font(t.font, t.size * 0.82);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(t.ch, 0, t.size * 0.03);
  // a Didone's hairlines (X's, A's and Y's thin diagonals) vanish at tile sizes — "EXTREME" read "E\TREME": outline the
  // glyph too, as layout.ts's setLine `hairline` does for the lyrics (TREATMENT §2)
  if (t.font.includes('Bodoni')) {
    c.strokeStyle = c.fillStyle;
    c.lineWidth = Math.max(HAIRLINE_PU, t.size * 0.025);
    c.lineJoin = 'round';
    c.strokeText(t.ch, 0, t.size * 0.03);
  }
}
/** A tile mid-slap, at settle progress p (0..1, linear): scales up with a tiny overshoot, fading in with it. */
function paintTileSettling(c: CanvasRenderingContext2D, t: Tile, side: Side, p: number) {
  const k = Math.max(0.05, ease.outBack(p, 1.5));
  c.save();
  c.translate(t.cx - offOf(side), t.cy);
  c.rotate(t.rot);
  c.scale(k, k);
  c.globalAlpha = clamp(p * 3);
  paintTile(c, t);
  c.restore();
}

/** A part of a face that no longer changes, kept as pixels (whoworeit.ts's Held, the pattern every heavy spread uses to
 *  pay a redraw's cost once). */
class Held {
  private kept: { cv: HTMLCanvasElement; at: string; cpu: boolean } | null = null;
  constructor(private readonly box: Box, private readonly paint: (c: CanvasRenderingContext2D) => void) {}
  stamp(c: CanvasRenderingContext2D) {
    const proto = CanvasRenderingContext2D.prototype, T = proto.getTransform.call(c);
    if (!(T.b === 0 && T.c === 0 && T.a > 0 && T.d > 0)) { c.save(); try { this.paint(c); } finally { c.restore(); } return; }
    const [u0, v0, u1, v1] = this.box, W = c.canvas.width, H = c.canvas.height;
    const X0 = Math.max(0, Math.floor(T.a * u0 + T.e)), Y0 = Math.max(0, Math.floor(T.d * v0 + T.f));
    const X1 = Math.min(W, Math.ceil(T.a * u1 + T.e)), Y1 = Math.min(H, Math.ceil(T.d * v1 + T.f));
    if (!(X1 > X0 && Y1 > Y0)) return;
    const cpu = c.getContextAttributes?.().willReadFrequently === true;
    const at = `${T.a},${T.d},${T.e},${T.f}|${X0},${Y0},${X1},${Y1}|${cpu}`;
    if (this.kept?.at !== at) {
      const k0 = this.kept, fits = k0 !== null && k0.cpu === cpu && k0.cv.width === X1 - X0 && k0.cv.height === Y1 - Y0;
      const cv = fits ? k0.cv : Object.assign(document.createElement('canvas'), { width: X1 - X0, height: Y1 - Y0 });
      const k = cv.getContext('2d', { willReadFrequently: cpu })!;
      k.setTransform(1, 0, 0, 1, 0, 0);
      k.clearRect(0, 0, cv.width, cv.height);
      k.setTransform(T.a, 0, 0, T.d, T.e - X0, T.f - Y0);
      k.save();
      try { this.paint(k); } finally { k.restore(); }
      this.kept = { cv, at, cpu };
    }
    c.save();
    proto.resetTransform.call(c);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.kept.cv, X0, Y0);
    c.restore();
  }
}

// ======================================================================== the fashion page (right face) =============

const STUB_W = 30;
/** Four photo frames, a 2x2 grid clear of the spine (the torn stub) and the folio. */
const FRAME = Object.freeze({ x: [56, 394], y: [92, 512], w: 320, h: 378 });
/** Her placed in a frame: scale, offset from the frame's own centring, a slight rotation — "scale, offset, slight
 *  rotation", the spec's own words for the four poses. */
const POSES = [
  { k: 0.6, dx: 0, dy: 6, rot: 0 },
  { k: 0.66, dx: 16, dy: 2, rot: 0.05 },
  { k: 0.56, dx: -14, dy: -4, rot: -0.06 },
  { k: 0.63, dx: 8, dy: 10, rot: 0.03 },
] as const;
const JACKET_SCALE = 0.47; // (coverstory's, whoworeit's own ratio: the cover's)
const HER_NECK = { x: 608, y: 360 } as const; // (her own landmark in ART.her's units, as whoworeit's)
const HER_W = ART.her.box[2] - ART.her.box[0], HER_H = ART.her.box[3] - ART.her.box[1];

/** The narrator scribbles her out of each photo, each photo its own way (scribbleOut's `kind`), one stroke over her
 *  figure (padded `padX` pu either side, `pad` above and below), overshooting by up to `over` pu and wobbling `wob`;
 *  over `s` from its cue, with a `width` brush; quantised to `steps`. Rows: `rows` passes back and forth down her, then
 *  an X. Coil: `loops` overlapping loops down her and back up. Slashes: `cols` tall strokes up and down across her,
 *  then a slash. Spiral: `turns` tightening turns round her, then struck through. */
const SCRIB = Object.freeze({ s: 0.45, pad: 10, padX: 34, over: 20, wob: 9, width: 9, steps: 24, rows: 13, loops: 9, cols: 9, turns: 3.2 });
type ScribKind = 'rows' | 'coil' | 'slashes' | 'spiral';
const SCRIB_KINDS: readonly ScribKind[] = ['rows', 'coil', 'slashes', 'spiral'];
/** A scribble-out of `kind` over `box` (SCRIB), deterministic in `seed`. */
function scribbleOut(box: Box, kind: ScribKind, seed: number): V2[] {
  const [x0, y0, x1, y1] = box, pts: V2[] = [], j = (k: number, a: number) => (hash(seed, k) - 0.5) * 2 * a;
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (kind === 'rows') {
    for (let r = 0; r <= SCRIB.rows; r++) {
      const y = y0 + (h * r) / SCRIB.rows, left = r % 2 === 0;
      const xa = (left ? x0 : x1) + (left ? -1 : 1) * Math.abs(j(r * 3, SCRIB.over));
      const xb = (left ? x1 : x0) + (left ? 1 : -1) * Math.abs(j(r * 3 + 1, SCRIB.over));
      if (r === 0) pts.push({ x: xa, y: y + j(r * 3 + 2, SCRIB.wob) });
      // each pass a slightly bowed run to the other side, a little lower (the hand drops as it goes)
      for (let i = 1; i <= 6; i++) {
        const u = i / 6, dy = (h / SCRIB.rows) * 0.6 * u + Math.sin(Math.PI * u) * j(r * 7 + i, SCRIB.wob);
        pts.push({ x: xa + (xb - xa) * u, y: y + dy });
      }
    }
    // and a slash up across it and back down the other way: an X through her
    pts.push({ x: x0 - SCRIB.over / 2, y: y1 - h * 0.15 }, { x: x1 + SCRIB.over / 2, y: y0 + h * 0.08 },
      { x: x0 + j(90, SCRIB.over), y: y0 + h * 0.12 }, { x: x1 + SCRIB.over / 2, y: y1 - h * 0.1 });
  } else if (kind === 'coil') {
    // overlapping loops, each nearly as wide as her, travelling down her and (offset) back up: a tangle
    const n = SCRIB.loops, per = 14, rx = w * 0.5 + SCRIB.over / 2, ry = (h / n) * 1.3;
    for (const [dir, k0] of [[1, 0], [-1, 500]] as const) {
      for (let i = 0; i < n * per; i++) {
        const u = i / (n * per), a = (i / per) * 2 * Math.PI, d = dir > 0 ? u : 1 - u;
        const r = 1 + j(k0 + Math.floor(i / per), 0.18);
        pts.push({ x: cx + j(k0 + 99, SCRIB.over) * 0.5 + Math.cos(a) * rx * r * (dir > 0 ? 1 : 0.8), y: y0 + h * d + Math.sin(a) * ry * r * dir });
      }
    }
  } else if (kind === 'slashes') {
    // tall strokes up and down, leaning, marching across her, then one long slash back across the lot
    const n = SCRIB.cols, lean = j(1, w * 0.25);
    for (let c = 0; c <= n; c++) {
      const x = x0 - SCRIB.over / 2 + ((w + SCRIB.over) * c) / n, up = c % 2 === 1;
      const top = y0 - Math.abs(j(c * 3, SCRIB.over)), bot = y1 + Math.abs(j(c * 3 + 1, SCRIB.over));
      pts.push(up ? { x: x - lean / 2 + j(c * 3 + 2, SCRIB.wob), y: bot } : { x: x + lean / 2 + j(c * 3 + 2, SCRIB.wob), y: top });
      pts.push(up ? { x: x + lean / 2, y: top } : { x: x - lean / 2, y: bot });
    }
    pts.push({ x: x1 + SCRIB.over, y: y0 + h * (0.3 + j(70, 0.1)) }, { x: x0 - SCRIB.over, y: y1 - h * (0.25 + j(71, 0.1)) });
  } else {
    // a tight spiral, in from round her to her middle, wobbling, then a slash clean through it
    const n = Math.round(SCRIB.turns * 40), a0 = hash(seed, 2) * 2 * Math.PI, rx = w / 2 + SCRIB.over, ry = h / 2 + SCRIB.over;
    for (let i = 0; i <= n; i++) {
      const u = i / n, a = a0 + u * SCRIB.turns * 2 * Math.PI, r = (1 - 0.8 * u) * (1 + j(10 + Math.floor(i / 7), 0.06));
      pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
    }
    pts.push({ x: x1 + SCRIB.over, y: y0 - SCRIB.over / 2 }, { x: x0 - SCRIB.over, y: y1 + SCRIB.over / 2 });
  }
  return pts;
}

/** The torn stub of p. 19 along the spine: a jagged vertical edge, a shade off the page's own paper, with a hint of a
 *  shadow (no stub geometry exists in the engine: painted here, per the spec). */
function drawStub(c: CanvasRenderingContext2D) {
  const n = 26, pts: V2[] = [];
  for (let i = 0; i <= n; i++) pts.push({ x: STUB_W + (hash(917, i) - 0.5) * 14, y: (PAGE.h * i) / n });
  c.fillStyle = rgba('paper2');
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(0, PAGE.h);
  for (let i = n; i >= 0; i--) c.lineTo(pts[i]!.x, pts[i]!.y);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.16)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(pts[0]!.x + 2, pts[0]!.y);
  for (let i = 1; i <= n; i++) c.lineTo(pts[i]!.x + 2, pts[i]!.y);
  c.stroke();
}
/** A strip of clear tape, torn-ended, with a faint diagonal sheen — holding the torn edge, or a few tiles, down. */
function drawTape(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, seed: number) {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(rot);
  const notch = (side: 1 | -1) => {
    const n = 4, pts: V2[] = [];
    for (let i = 0; i <= n; i++) pts.push({ x: side * (w / 2) + (hash(seed, i, side) - 0.5) * 6, y: -h / 2 + (h * i) / n });
    return pts;
  };
  const left = notch(-1), right = notch(1);
  c.fillStyle = 'rgba(230,223,211,0.3)';
  c.beginPath();
  c.moveTo(left[0]!.x, left[0]!.y);
  for (const p of left) c.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i]!.x, right[i]!.y);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.22)';
  c.fillRect(-w / 2, -h * 0.12, w, h * 0.22);
  c.restore();
}

// ======================================================================== the lipstick (Collage: much reduced) ======
const LIP = Object.freeze({ ulWidth: 5.5, kissSize: 46 });

export const ransom: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = sectionLine(lyrics, section, "I like your look, it's so extreme");
  const L2 = sectionLine(lyrics, section, 'You walk the street so effortlessly');
  const L3 = sectionLine(lyrics, section, "She wears you well but can't you see?");
  const L4 = sectionLine(lyrics, section, 'That you definitely look better on me, yeah');
  for (const [l, n] of [[L1, 7], [L2, 6], [L3, 8], [L4, 8]] as const) {
    if (l.words.length !== n) throw new Error(`ransom: "${l.text}" has ${l.words.length} words, the layout sets ${n}`);
  }
  const yeah = L4.words[7]!;
  const yeahEnd = Math.min(yeah.end, turnAt);
  if (!(yeahEnd - yeah.start >= 0.3)) throw new Error(`ransom: "yeah" has ${(yeahEnd - yeah.start).toFixed(3)} s before the turn, too little to slap its letters down`);
  const L4_BODY: Line = { ...L4, words: L4.words.slice(0, 7) }; // the wrap gets "That ... me,"; "yeah" is placed by hand, in the corner

  // ---- the left page: spread 9's ME page, at its final state (the rip leaves it on screen unchanged) ----
  const plan9 = resolveFlatplan(audio, lyrics);
  const wwIdx = plan9.findIndex((e) => e.id === 'whoworeit');
  if (wwIdx < 0) throw new Error('ransom: whoworeit is not in the flatplan');
  const wwCtx = spreadCtx(audio, lyrics, plan9, wwIdx);
  const wwBase = whoworeitLeft(wwCtx);
  const T_FINAL = turnOut(wwCtx); // whoworeit's own turn-out start: this spread's start, by construction
  const LEFT_BOX: Box = [0, 0, PAGE.w, PAGE.h];
  const wwPrintHeld = new Held(LEFT_BOX, (c) => wwBase.drawPrint(c, T_FINAL));
  const wwMarksHeld = new Held(LEFT_BOX, (c) => wwBase.drawMarks(c, T_FINAL));
  const WW_PRINT_KEY = wwBase.key('print', T_FINAL), WW_MARKS_KEY = wwBase.key('marks', T_FINAL);

  // ---- the ransom note's layout (pure: the lines' own word timings, a fixed advance model) ----
  const upAt = landsAt(plan9[plan9.findIndex((e) => e.id === 'ransom')]!); // (the rip's end: the page is up)
  const { tiles, words } = buildLayout([L1, L2, L3, L4_BODY], 4001, upAt);
  const tileHeld = tiles.map((t) => ({
    t,
    held: new Held(
      [t.cx - offOf(t.side) - t.size, t.cy - t.size, t.cx - offOf(t.side) + t.size, t.cy + t.size],
      (c) => { c.translate(t.cx - offOf(t.side), t.cy); c.rotate(t.rot); paintTile(c, t); },
    ),
  }));
  const progressOf = (t: Tile, time: number) => Math.round(clamp(prog(time, t.from, t.to)) * STEPS.tile) / STEPS.tile;

  // "yeah", dropped alone in the corner, bigger, for the last word of the chorus
  const yeahSlots = letterSlots({ w: yeah.w, start: yeah.start, end: yeahEnd }, upAt);
  let cornerCursor = CORNER.x0 + PAGE.w; // spread x (R side)
  const cornerTiles: Tile[] = yeahSlots.map((s, k) => {
    const seed = 8800 + k * 29, { font: fnt, widthK } = tileLook(seed), advK = ROW.baseAdvK * widthK * letterWidthK(s.ch, fnt === MONO);
    const size = CORNER.size + (hash(seed, 9) - 0.5) * 2 * SIZE_JITTER;
    const cx = cornerCursor + (CORNER.size * advK) / 2;
    cornerCursor += CORNER.size * advK + CORNER.size * ROW.letterGap;
    return { ch: s.ch, cx, cy: CORNER.y, size, rot: (hash(seed, 10) - 0.5) * 2 * ROT_MAX, dark: hash(seed, 11) < 0.45, font: fnt, advK, side: 'R', seed, from: s.from, to: s.to };
  });
  if (cornerCursor - PAGE.w > PAGE.w - 24) throw new Error('ransom: "yeah" runs off the right page\'s corner');
  const cornerHeld = cornerTiles.map((t) => ({
    t,
    held: new Held([t.cx - PAGE.w - t.size, t.cy - t.size, t.cx - PAGE.w + t.size, t.cy + t.size], (c) => { c.translate(t.cx - PAGE.w, t.cy); c.rotate(t.rot); paintTile(c, t); }),
  }));
  const allTileHeld = [...tileHeld, ...cornerHeld];

  // ---- the photos: four poses of her in the jacket, each scribbled out on a cue, kick-timed across line 3 (cues.ts's
  // kicksAcross: "n cues across this window") ----
  const herLine = artDrawings(ART.her, 5100), herJacket = artDrawings(ART.jacket, 5200);
  // on the line about her, while the camera holds the whole spread (shots, below): through line 1, they fell while the
  // camera was on the letters, and the user never saw them (and scissored out, as they were then, they looked cheap)
  const scribAt = kicksAcross(audio, 4, L3.start, L3.end);
  const photos = POSES.map((p, i) => {
    const fx = FRAME.x[i % 2]!, fy = FRAME.y[Math.floor(i / 2)]!;
    const box: Box = [fx, fy, fx + FRAME.w, fy + FRAME.h];
    const originX = fx + (FRAME.w - HER_W * p.k) / 2 + p.dx; // centred in the frame (placeHer handles her own box's own origin)
    const originY = fy + FRAME.h - HER_H * p.k - 10 + p.dy;
    const herBox: Box = [originX - SCRIB.padX, originY - SCRIB.pad, originX + HER_W * p.k + SCRIB.padX, originY + HER_H * p.k + SCRIB.pad];
    const scrib = scribbleOut(herBox, SCRIB_KINDS[i % SCRIB_KINDS.length]!, 7300 + 17 * i);
    return { box, originX, originY, k: p.k, rot: p.rot, scribFrom: scribAt[i]!, scrib, scribLen: polylineLengths(scrib).at(-1)! };
  });
  type Photo = (typeof photos)[number];
  /** Her placed in a photo's pose: the same transform the figure and its knockout both use. */
  const placeHer = (c: CanvasRenderingContext2D, ph: Photo) => {
    c.translate(ph.originX, ph.originY);
    c.rotate(ph.rot);
    c.scale(ph.k, ph.k);
    c.translate(-ART.her.box[0], -ART.her.box[1]);
  };
  const photoHeld = photos.map((ph) => new Held(ph.box, (c) => {
    c.save();
    c.beginPath();
    c.rect(ph.box[0], ph.box[1], ph.box[2] - ph.box[0], ph.box[3] - ph.box[1]);
    c.clip();
    placeHer(c, ph);
    c.strokeStyle = rgba('graphite');
    drawArt(c, herLine, herLine.map(() => 1));
    c.translate(HER_NECK.x, HER_NECK.y);
    c.scale(JACKET_SCALE, JACKET_SCALE);
    c.translate(-JACKET_NECK.x, -JACKET_NECK.y);
    c.strokeStyle = rgba('ink');
    drawArt(c, herJacket, herJacket.map(() => 1), 1 / (JACKET_SCALE * ph.k));
    c.restore();
  }));

  // ---- the lipstick: an underline under "better on me" (line 4), and a kiss on "yeah" ----
  const better4 = L4_BODY.words[4]!, me4 = L4_BODY.words[6]!;
  const w4 = words[3]!; // line 4's word boxes, in layout order: That you definitely look better on me,
  const betterBox = w4[4]!, meBox = w4[6]!;
  const spreadX = (wb: WordBox, edge: 0 | 2) => wb.box[edge] + offOf(wb.side);
  const ulX0 = spreadX(betterBox, 0), ulX1 = spreadX(meBox, 2), ulY = Math.max(betterBox.box[3], meBox.box[3]) - 4;
  const underline = (() => {
    const n = 20, pts: V2[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, sag = 10 * Math.sin(Math.PI * u);
      pts.push({ x: ulX0 - 4 + (ulX1 - ulX0 + 8) * u, y: ulY + sag });
    }
    return { pts, len: polylineLengths(pts).at(-1)! };
  })();
  const underlineSides: Side[] = [...(ulX0 < PAGE.w ? (['L'] as const) : []), ...(ulX1 > PAGE.w ? (['R'] as const) : [])];
  const ulFrom = better4.start, ulTo = Math.min(me4.end + 0.4, turnAt);
  const KISS_AT = { x: CORNER.x0 - 36, y: CORNER.y - 70 } as const;
  const kissFrom = yeah.start, kissTo = turnAt, kissLiftFrom = Math.max(yeah.start, turnAt - 0.18);

  // ---- the camera: Snap, word to word as the tiles land, low and close — but a snap takes SNAP_S (0.25 s) to land,
  // so two cues closer than that can't each get their own: consecutive words sung within MIN_GAP share a hold, its box
  // their union (or, crossing the gutter, the whole spread) — still "word to word" at the pace the beat allows. A
  // glide across each line's end, then out for the turn (the spec's own words). ----
  const unionBox = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  interface Hold { words: Word[]; boxes: Partial<Record<Side, Box>> }
  const MIN_GAP = 0.3;
  function buildHolds(line: Line, wbs: WordBox[]): Hold[] {
    const holds: Hold[] = [];
    line.words.forEach((w, i) => {
      const wb = wbs[i]!, cue = resolveAt(w), last = holds[holds.length - 1];
      if (last && cue - resolveAt(last.words[0]!) < MIN_GAP) {
        last.words.push(w);
        last.boxes[wb.side] = last.boxes[wb.side] ? unionBox(last.boxes[wb.side]!, wb.box) : wb.box;
      } else {
        holds.push({ words: [w], boxes: { [wb.side]: wb.box } });
      }
    });
    return holds;
  }
  const lineHolds = [L1, L2, L3].map((line, li) => buildHolds(line, words[li]!));
  const l4Holds = buildHolds(L4_BODY, words[3]!);
  const betterHoldIdx = l4Holds.findIndex((h) => h.words.includes(better4));
  const l4ShotHolds = l4Holds.slice(0, betterHoldIdx + 1); // "That ... better" get word-close shots
  const l4FocusHolds = l4Holds.slice(betterHoldIdx + 1); // "on me," reads in the pull-back, with the underline
  const TILT_WORD = 0.32; // shallow enough to stay sharp close in (TREATMENT §6's depth-of-field note), still "low"
  const holdShots = (holds: Hold[]): Shot[] => holds.map((h): Shot => {
    const sides = Object.keys(h.boxes) as Side[];
    return sides.length === 1 ? { at: h.words[0]!, frame: { side: sides[0]!, box: h.boxes[sides[0]!]! }, angle: TILT_WORD, pad: 0.3 } : { at: h.words[0]!, frame: 'spread' };
  });
  // "better" lands, then the camera pulls back for the punchline — "on me," lands, underlined with "better", in the
  // wide view, then "yeah" drops in the corner with the kiss, held wide out for the turn.
  const on4 = L4_BODY.words[5]!;
  const pullBackAt = 148.446;
  const shots: Shot[] = [
    ...holdShots(lineHolds[0]!), { at: L1.end, frame: 'spread', move: 'glide' },
    ...holdShots(lineHolds[1]!), { at: L2.end, frame: 'spread' }, // (snapped out to the spread, not a bar's glide: line 3 reads there from its first word)
    // line 3 is held on the whole spread (from L2's glide out to it): its letters, and her being cut out of the photos

    ...holdShots(l4ShotHolds),
    { at: pullBackAt, frame: 'spread', move: 'land' },
  ];
  if (!(resolveAt(better4) < pullBackAt && pullBackAt < resolveAt(on4))) {
    throw new Error(`ransom: the pull-back at ${pullBackAt} must fall between "better" (${resolveAt(better4).toFixed(3)}) and "on" (${resolveAt(on4).toFixed(3)})`);
  }
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  const landingOf = (at: Shot['at']) => {
    const r = resolveAt(at), m = moves.find((x) => Math.abs(x.at - r) < 1e-9);
    if (!m) throw new Error(`ransom: no shot starts at ${r.toFixed(3)}`);
    return m.land;
  };
  const pullBackLand = landingOf(pullBackAt);

  // ---- what must read when: each hold's tiles over its own span, the underline, the kiss ----
  const focus: FocusBox[] = [];
  [L1, L2, L3].forEach((line, li) => {
    const holds = lineHolds[li]!;
    holds.forEach((h, hi) => {
      const next = hi + 1 < holds.length ? resolveAt(holds[hi + 1]!.words[0]!) : line.end;
      // (line 3 has no shots of its own: it reads on the spread, from the glide out to it or its cue, the later)
      const from = li === 2 ? Math.max(landingOf(L2.end), resolveAt(h.words[0]!)) : landingOf(h.words[0]!), to = Math.min(next, turnAt);
      for (const side of Object.keys(h.boxes) as Side[]) {
        const box = h.boxes[side]!;
        focus.push({ from, to, side, box, size: box[3] - box[1] });
      }
    });
  });
  // each photo as she's scribbled out of it (a drawing), on the spread
  for (const p of photos) focus.push({ from: Math.max(p.scribFrom, landingOf(L2.end)), to: p.scribFrom + SCRIB.s + 0.2, side: 'R', box: p.box });
  l4ShotHolds.forEach((h, hi) => {
    const next = hi + 1 < l4ShotHolds.length ? resolveAt(l4ShotHolds[hi + 1]!.words[0]!) : pullBackAt;
    const from = landingOf(h.words[0]!), to = Math.min(next, turnAt);
    for (const side of Object.keys(h.boxes) as Side[]) {
      const box = h.boxes[side]!;
      focus.push({ from, to, side, box, size: box[3] - box[1] });
    }
  });
  // "better" and "on me," (and the underline under them) read together, in the pull-back's wide view
  l4FocusHolds.forEach((h) => {
    for (const side of Object.keys(h.boxes) as Side[]) {
      const box = h.boxes[side]!;
      focus.push({ from: pullBackLand, to: turnAt, side, box, size: box[3] - box[1] });
    }
  });
  for (const side of underlineSides) {
    const off = offOf(side);
    const box: Box = [Math.max(0, ulX0 - off - 6), ulY - 14, Math.min(PAGE.w, ulX1 - off + 6), ulY + 14];
    focus.push({ from: Math.max(ulFrom, pullBackLand), to: turnAt, side, box });
  }
  focus.push({ from: kissFrom, to: kissTo, side: 'R', box: [KISS_AT.x - 40, KISS_AT.y - 30, KISS_AT.x + 40, KISS_AT.y + 30] });

  // ---- drawing ----
  const drawRightBase = (c: CanvasRenderingContext2D) => {
    c.fillStyle = rgba('paper');
    c.fillRect(0, 0, PAGE.w, PAGE.h);
    drawStub(c);
    for (const ph of photoHeld) ph.stamp(c);
    c.strokeStyle = 'rgba(20,20,20,0.5)';
    c.lineWidth = 1.2;
    for (const p of photos) c.strokeRect(p.box[0], p.box[1], p.box[2] - p.box[0], p.box[3] - p.box[1]);
    drawTape(c, 4, 220, 66, 34, -0.07, 11);
    drawTape(c, 4, 624, 66, 34, 0.05, 12);
    drawFolio(c, 'R', pages[1]);
  };
  const scribProgress = (t: number) => photos.map((p) => Math.round(clamp(prog(t, p.scribFrom, p.scribFrom + SCRIB.s, ease.outQuad)) * SCRIB.steps) / SCRIB.steps);
  const drawTiles = (c: CanvasRenderingContext2D, side: Side, t: number) => {
    for (const { t: tile, held } of allTileHeld) {
      if (tile.side !== side) continue;
      const p = progressOf(tile, t);
      if (p <= 0) continue;
      if (p >= 1) held.stamp(c);
      else paintTileSettling(c, tile, side, p);
    }
  };
  /** The tiles down on a face at t, in the order they land (each from its own `from`: laidOn's count keys them). */
  const laidOn = (side: Side, t: number) => allTileHeld.filter(({ t: tile }) => tile.side === side && progressOf(tile, t) > 0).map(({ t: tile }) => tile);
  const tileKey = (side: Side, t: number) => allTileHeld.filter(({ t: tile }) => tile.side === side).map(({ t: tile }) => Math.round(progressOf(tile, t) * STEPS.tile).toString(36)).join('');

  return {
    id: 'ransom', section, pages,
    drawPrint(side, c, t) {
      if (side === 'L') { wwPrintHeld.stamp(c); drawTiles(c, 'L', t); return; }
      drawRightBase(c);
      drawTiles(c, 'R', t);
    },
    drawMarks(side, c, t) {
      if (side === 'L') {
        wwMarksHeld.stamp(c);
        // the tiles are glued over spread 9's lipstick: the marks layer composites over the print, so it's erased under
        // each tile once it's down (its chip and shadow, as it lies settled)
        knockout(c, (k) => { for (const tile of laidOn('L', t)) { k.save(); k.translate(tile.cx, tile.cy); k.rotate(tile.rot); fillPoly(k, tileFootprint(tile)); k.restore(); } });
      }
      if (side === 'R') {
        // her, scribbled out of each photo; then (the marks layer composites over the print) erased under the tiles
        // glued down after the scribbles began, which lie on top of them
        scribProgress(t).forEach((p, i) => { if (p > 0) lipstickStroke(c, photos[i]!.scrib, p * photos[i]!.scribLen, { width: SCRIB.width, seed: 7300 + 17 * i }); });
        const after = laidOn('R', t).filter((tile) => tile.from >= photos[0]!.scribFrom);
        if (after.length) knockout(c, (k) => { for (const tile of after) { k.save(); k.translate(tile.cx - offOf('R'), tile.cy); k.rotate(tile.rot); fillPoly(k, tileFootprint(tile)); k.restore(); } });
      }
      if (underlineSides.includes(side)) {
        const ul = Math.round(clamp(prog(t, ulFrom, ulTo, ease.outQuad)) * STEPS.ul) / STEPS.ul;
        if (ul > 0) {
          const off = offOf(side);
          lipstickStroke(c, underline.pts.map((p) => ({ x: p.x - off, y: p.y })), ul * underline.len, { width: LIP.ulWidth, seed: 9001 });
        }
      }
      if (side === 'R') {
        const press = clamp(prog(t, kissFrom, kissTo)), lift = clamp(prog(t, kissLiftFrom, turnAt));
        if (press > 0) {
          const pq = Math.round(press * STEPS.kiss) / STEPS.kiss, lq = Math.round(lift * STEPS.kiss) / STEPS.kiss;
          kiss(c, KISS_AT.x, KISS_AT.y, LIP.kissSize, -0.15, pq, lq, 9100);
        }
      }
    },
    key(side, layer, t) {
      if (layer === 'marks') {
        const ul = underlineSides.includes(side) ? Math.round(clamp(prog(t, ulFrom, ulTo, ease.outQuad)) * STEPS.ul) : -1;
        if (side === 'L') return `${WW_MARKS_KEY}|${ul}|${laidOn('L', t).length}`;
        const press = Math.round(clamp(prog(t, kissFrom, kissTo)) * STEPS.kiss), lift = Math.round(clamp(prog(t, kissLiftFrom, turnAt)) * STEPS.kiss);
        const after = laidOn('R', t).filter((tile) => tile.from >= photos[0]!.scribFrom).length;
        return `${ul}|${press},${lift}|${scribProgress(t).map((p) => Math.round(p * SCRIB.steps)).join(',')}|${after}`;
      }
      if (side === 'L') return `${WW_PRINT_KEY}|${tileKey('L', t)}`;
      return tileKey('R', t);
    },
    camera, focus,
  };
};
