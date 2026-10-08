// Spread 7, Contact sheet (chorus 2): the cover shoot's contact sheet, marked up, in
// house style B. Both pages are solid ink, a contact print. Three strips of 35 mm film run
// across the spread, eight frames each, four a page, with their sprocket holes and edge print (the stock, EFFORTLESS 400;
// frame numbers 1–24 and their arrows) cut out of the black. The frames are line drawings of the shoot: him, the
// jacket, on a zebra crossing, alone or with her cut line beside him, the street cut away where they stand. He walks
// alone (frames 1–10), she joins him (11–22), and he walks on alone (23–24): twelve frames each.
// Under each strip a paper band, cut out of the black, carries its chorus line in italic 44. The line is set in phrases,
// each centred under the frames the loupe is on while it's sung. Line 4 runs along the bottom band in Bodoni 40, across
// the gutter.
// The camera is the editor's loupe. It works close over a strip and its band, a frame a beat, with a snap back to each
// line's first frame. For line 3 it takes two strips at once, since the X's are made on both. Line 4 starts at the
// page's foot, then the camera goes out to the spread for the turn.
// The lipstick is the editor's grease pencil at its height (Markup), and its rate doubles at each stage. On "She wears
// you well" it puts an X through every frame with her, left to right: one a beat, then one an eighth through "but
// can't you see?". On "better on me" it loops every frame of him alone, one a sixteenth, and writes "ME" beside the
// last, on "yeah".
// Positions are in spread units (x from the left page's outer edge; the right face draws at x − 770). What crosses the
// gutter (the strips, the bands) is drawn on both faces at its own offset, and each canvas clips its own half.
import { type Side, drawFolio, karaokeKey, setLine, subLine } from '../engine/layout';
import type { Line, Word } from '../engine/lyrics';
import { lipstickStroke, lipstickWrite } from '../engine/lipstick';
import { rgba } from '../engine/palette';
import { filmStrip, knockout } from '../engine/print';
import { type StrokeText, strokeText } from '../engine/stroke';
import { F, font, measure } from '../engine/type';
import { type V2, ease, hash, noise1, polylineLengths, prog } from '../engine/util';
import { ART, type ArtDrawing, HER, JACKET_NECK, OUTLINE, artDrawings, drawArt } from './art';
import { sectionLine } from './cues';
import { ANGLES, type Box, SNAP_S, type Shot, type ShotFrame, beatAtOrAfter, director, downbeatAtOrAfter, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';

// ---- the layout (page units) ----
/** The right face's offset in spread units. */
const SP = 770;
/** The three strips of film: their tops, each STRIP_H tall (the edge to the sprocket holes, the edge print, the
 *  window, the edge print, the holes, the edge). */
const STRIP_Y = [106, 348, 590] as const, STRIP_H = 172;
/** A strip's eight frames: frame k's window at spread x x0 + pitch·k, `inset` below the strip's top, w × h (3:2, as
 *  35 mm's 36 × 24). The pitch is eight sprocket holes (print.ts SPROCKET.pitch 24), as on the film. Four frames sit
 *  on each page, so the gutter falls in the gap between the fourth and fifth (12, as between every frame), 8 in from
 *  the outer edges. */
const FRAME = Object.freeze({ x0: 8, pitch: 192, w: 180, h: 120, inset: 26, n: 8 });
/** The camera's data back, imprinted in each frame's bottom right corner (`inset` pu in, at `size` pu): the date, as in
 *  her music video — but the time on the first frame of strips 1 and 2 (both under the loupe), as her computer's clock
 *  and her desk clock read in it. Keyed `strip,frame`. */
const IMPRINT = Object.freeze({ date: "10 11 '26", times: Object.freeze({ '0,0': '12:01', '1,0': '4:15' }) as Readonly<Record<string, string>>, inset: 7, size: 11 });
/** The edge print's baselines below each strip's top: the stock along the top edge, between the holes and the windows,
 *  and the frame numbers along the bottom. Small mono meant to be read, the numbers, is Plex Mono 600 at 10.5 (the
 *  house rule); the stock is decoration, at 9. */
const EDGE = Object.freeze({ top: 23.5, bottom: 156, num: 10.5, stock: 9 });
/** The paper bands cut out of the black, and the baselines of their type. Bands 1–3 run under strips 1–3 and carry
 *  lines 1–3. Band 4, at the bottom, carries line 4. */
const BANDS = Object.freeze([
  { y: 278, h: 70, base: 324 }, { y: 520, h: 70, base: 566 }, { y: 762, h: 70, base: 808 }, { y: 864, h: 64, base: 907 },
]);
/** Lines 1–3 are set along their bands in these phrases (word index cuts), each centred under the frames the loupe
 *  holds while it's sung (`runs`, below). A phrase sung over more frames than the loupe can keep in view is split:
 *  L2's "so" and "effortlessly", which together would leave the frame as the loupe walks. */
const PHRASES = Object.freeze([[0, 3, 5, 7, 8], [0, 4, 5, 6], [0, 4, 6, 8]] as const);
/** Phrases set centred on their page instead (line, phrase): L2's "effortlessly", the only word on its band's right half,
 *  sung while the loupe walks that page's four frames — centred on them all, it stays under the loupe throughout. */
const PAGE_CENTRED = Object.freeze([[1, 2]] as const);
/** Phrases keep this clear of the spine (the gutter's shade, and a line broken across it reads as two) and of the
 *  outer edges; and this far from each other. */
const KEEP = Object.freeze({ spine: 30, edge: 40, gap: 24 });
/** Line 4 across the gutter: "That you definitely look" set flush right on the left page, "better on me, yeah" flush
 *  left on the right, `gutter` either side of the spine. */
const L4_AT = Object.freeze({ split: 4, gutter: 30 });
/** The header over strip 1. On the left page, the spread's title: display italic cut out of the black, whole between
 *  the page's top edge and the strip (its caps ~0.75 of its size: ~19 pu clear of the edge, 12 of the strip). The
 *  small print beside it and on the right page is cut too. */
const TITLE = Object.freeze({ text: 'The Edit', x: 40, y: 94, size: 100 });

const ITALIC = F.bodoni(400, { italic: true });
/** Line 4 at 40 is the text cut: below ~45 pu the display cut's hairlines go sub-pixel at the spread framing it's read
 *  at (TREATMENT §2). */
const TEXT = F.bodoni(400, { text: true });
const SIZE = Object.freeze({ band: 44, l4: 40 });
/** The display italic's cap height, in em (Bodoni Moda's OS/2 sCapHeight, 1500 of 2000): a lyric box's type size, as
 *  the guard takes it for display type (FocusBox.size). */
const ITALIC_CAP = 0.75;
const MONO = F.mono(600), MONO_LIGHT = F.mono(500);

// ---- the frames ----
/** One frame's picture. Him: the jacket's centre at `x` of the window's width, swung `tilt` (rad, + clockwise, about
 *  its neck) and lifted `lift` pu, mid-stride. Her, if she's in it: her centre `dx` cover units right of his (the
 *  cover's pairing is +212, less and they'd touch; on his left, negative), leaning `lean` (rad, about her feet). `k`:
 *  the figures' scale (cover units to pu), K unless the photographer has stepped in or back. */
interface Pic { x: number; tilt?: number; lift?: number; her?: { dx: number; lean?: number }; k?: number }
/** The figures' scale, cover units to pu: her 97 pu tall, the jacket 45 wide, spread 3's walking jacket's size. */
const K = 0.167;
/** Where they stand: her feet (the cover's y 854) this far down the window, on the crossing; the jacket hangs where it
 *  does beside her on the cover, its neck at 340, as if worn. */
const GROUND = 110, FEET = 854;
/** His stride, as in spread 3's strip: the hem swings each way about the neck, and he rises on the passing step. */
const walk = (j: number) => ({ tilt: 0.035 * [1, 0, -1, 0][j % 4]!, lift: j % 2 ? 1.2 : 0 });
/** The roll, a strip at a time. Frames 1–8: him alone, walking the crossing left to right. Frames 9–16: still alone
 *  (9, 10), then she's with him, walking. Frames 17–24: posed together (17–22: her on his right, then his left, then
 *  leaning in, then apart), then he walks on alone (23, 24). */
const PICS: readonly (readonly Pic[])[] = Object.freeze([
  Array.from({ length: 8 }, (_, j): Pic => ({ x: 0.17 + (0.66 * j) / 7, ...walk(j) })),
  [
    { x: 0.24, ...walk(0) }, { x: 0.42, ...walk(1) },
    { x: 0.2, her: { dx: 214 }, ...walk(2) }, { x: 0.26, her: { dx: 222, lean: -0.02 }, ...walk(3) },
    { x: 0.32, her: { dx: 216 }, ...walk(0) }, { x: 0.38, her: { dx: 226, lean: -0.03 }, ...walk(1) },
    { x: 0.44, her: { dx: 218 }, ...walk(2) }, { x: 0.5, her: { dx: 230, lean: -0.02 }, ...walk(3) },
  ],
  [
    { x: 0.36, her: { dx: 214 } }, { x: 0.33, her: { dx: 224, lean: -0.02 }, k: 0.18 },
    { x: 0.62, her: { dx: -216 } }, { x: 0.64, her: { dx: -226, lean: 0.015 }, k: 0.18 },
    { x: 0.35, her: { dx: 232, lean: -0.045 } }, { x: 0.3, her: { dx: 262 }, k: 0.158 },
    { x: 0.62, ...walk(0) }, { x: 0.8, ...walk(1) },
  ],
]);
/** The street behind each strip (ART.street<n>), at STREET_K: its 150 height is the window's 120, so it spans the
 *  window top to bottom (the crossing along its foot), shifted `sx` pu to show part of its 256 width. */
const STREETS = Object.freeze([{ art: 0, sx: -30 }, { art: 2, sx: -62 }, { art: 4, sx: -14 }]);
const STREET_K = 0.8;
/** The street's lines, times art.ts's weights (~0.45–0.7 pu), in graphite: the background, behind the figures. In ink, as
 *  first drawn, it was as dark as him and darker than her dotted line, which it swallowed. */
const STREET_WEIGHT = 0.9;

// ---- the lipstick (the narrator's grease pencil) ----
/** The brush's width (pu). */
const LIP = Object.freeze({ x: 7, loop: 6.5, me: 8 });
/** The loops round his frames: a quick oval (a superellipse of exponent `n`, a little squarer than an ellipse), its
 *  radii `outX`, `outY` pu more than the window's half-sizes, round `turns` times from its upper left, tilted up to
 *  `tilt` rad, wobbling and drifting out a little so the end runs clear of the start. Being round it cuts across the
 *  window's corners, as a grease pencil's does. (Squarer, as first drawn at n 3.5 hugging the window, the loops read as
 *  a row of pink boxes, the selection rectangles of an app.) On a page's outer edge it's squeezed to stay `edge` pu on
 *  the page. */
const LOOP = Object.freeze({ n: 2.4, outX: 9, outY: 12, turns: 1.15, tilt: 0.04, wobble: 0.025, drift: 0.05, edge: 4, vary: Object.freeze({ out: 15, shift: 14, turns: 0.3, tilt: 0.2, wobble: 0.04 }) });
/** "ME" in the narrator's hand (Hershey Script, TREATMENT §2): the stroke text's origin, its left baseline, at (x, y)
 *  on the right page, under the last loop (frame 24's), rotated `rot`, at `size` pu. */
const ME = Object.freeze({ text: 'ME', x: 528, y: 830, rot: -0.12, size: 128, seed: 71 });
/** The marks' quantisation: each mark's progress is one of this many levels. A beat's X stroke takes ~11 frames, an
 *  eighth's ~5, a loop ~6, ME ~20. */
const STEPS = Object.freeze({ xBeat: 16, xEighth: 8, loop: 12, me: 32 });

// ---- the camera ----
/** The loupe for each line: its height (the pose's target, page v) and distance. Lines 1 and 2: one strip and its band,
 *  the header in view over strip 1; line 3: strips 2 and 3 and their bands, where the X's are made. Pulled back from
 *  the closest the guards allow (0.94 and 1.04; shots.ts DIST.min is 0.9), so the glide along each strip moves less of
 *  the frame. */
const LOUPE = Object.freeze([{ v: 245, dist: 1.1 }, { v: 469, dist: 1.1 }, { v: 590, dist: 1.2 }]);
/** A step is held at least this long (s): the beat after a line's snap back comes too soon for a step on it in lines 2
 *  and 3, and the beat before the next line's cue too late. */
const HOLD = 0.4;
/** Line 4 opens on the page's foot, the left page's strip 3, band 3 and line 4's first half, before the spread. */
const FOOT: Box = [0, 590, 770, 928];

// ---- widths without the DOM (the factory must not touch it: the guards build every spread under bun) ----
/** Advance widths (thousandths of the em) of the two faces the bands set, from their font files (BodoniModaItalic-o96-400
 *  and BodoniModa-o11-400). The factory places the phrases with them, the sum of their advances plus WIDTH_SLACK, and
 *  the first draw checks that against the canvas's own measure. The canvas kerns (GPOS, which the plain advances leave
 *  out): measured, it sets the phrases from 1.8% narrower ("extreme") to 0.9% wider ("your look,", the comma's kern). */
const ADV_CHARS = ' !\',.?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz’';
const ADV: Readonly<Record<string, readonly number[]>> = {
  [ITALIC]: [250, 319, 200, 215, 200, 550, 725, 625, 663, 695, 574, 554, 728, 720, 350, 428, 672, 562, 835, 715, 715, 605, 715, 715, 556, 622,
    684, 720, 963, 725, 725, 549, 544, 490, 438, 544, 457, 336, 585, 553, 284, 250, 492, 288, 817, 575, 482, 550, 498, 445, 407, 321, 566, 501,
    712, 506, 498, 401, 215],
  [TEXT]: [250, 318, 200, 215, 200, 550, 772, 656, 716, 726, 619, 599, 739, 762, 387, 450, 705, 604, 873, 774, 750, 639, 750, 722, 576, 674,
    726, 774, 1005, 767, 734, 577, 523, 609, 509, 609, 524, 398, 596, 596, 303, 305, 604, 333, 861, 596, 561, 609, 609, 442, 439, 336, 598, 542,
    762, 577, 547, 467, 215],
};
function widthOf(text: string, family: string, size: number): number {
  const adv = ADV[family]!;
  let w = 0;
  for (const ch of text) {
    const i = ADV_CHARS.indexOf(ch);
    if (i < 0) throw new Error(`contactsheet: no advance width for "${ch}" in ${family} (add it to ADV)`);
    w += adv[i]!;
  }
  return (w * size * (1 + WIDTH_SLACK)) / 1000;
}
const WIDTH_SLACK = 0.02;

/** A 2D affine transform in canvas order [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type M2 = readonly [number, number, number, number, number, number];
const mul = (m: M2, n: M2): M2 => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const tr = (x: number, y: number): M2 => [1, 0, 0, 1, x, y];
const rot = (a: number): M2 => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const sc = (k: number): M2 => [k, 0, 0, k, 0, 0];
const apply = (m: M2, p: V2): V2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const asInit = (m: M2) => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });

/** The smallest box holding these points, padded by r. */
const bounds = (pts: readonly V2[], r = 0): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r];
};
const lengthOf = (pts: readonly V2[]) => { const L = polylineLengths(pts); return L[L.length - 1]!; };

/** A grease-pencil X through a window (its box on its face): two quick strokes corner to corner, each a slightly bowed
 *  line overshooting the corners a little, jittered by `seed`; kept `edge` pu on the page. */
function frameX(b: Box, seed: number, edge: number): [V2[], V2[]] {
  const j = (i: number, s: number) => (hash(seed, i) - 0.5) * 2 * s;
  const onPage = (x: number) => Math.min(770 - edge, Math.max(edge, x));
  const stroke = (ax: number, ay: number, bx: number, by: number, bow: number): V2[] => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L, ny = (bx - ax) / L;
    const cx = mx + nx * bow, cy = my + ny * bow, pts: V2[] = [];
    for (let i = 0; i <= 20; i++) {
      const s = i / 20, r = 1 - s;
      pts.push({ x: onPage(r * r * ax + 2 * r * s * cx + s * s * bx), y: r * r * ay + 2 * r * s * cy + s * s * by });
    }
    return pts;
  };
  const [x0, y0, x1, y1] = b;
  // (each X its own, a hand in a hurry: where it starts and lands, up to 20 pu either way across and 14 up or down, and
  // how it bows, up to 22; and the whole X sometimes short of a corner, sometimes well past it)
  const over = 1 + j(11, 0.18), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, X = (x: number) => cx + (x - cx) * over, Y = (y: number) => cy + (y - cy) * over;
  return [
    stroke(X(x0 - 4 + j(1, 20)), Y(y0 - 2 + j(2, 14)), X(x1 + 5 + j(3, 20)), Y(y1 + 3 + j(4, 14)), j(5, 22)),
    stroke(X(x1 + 2 + j(6, 20)), Y(y0 - 3 + j(7, 14)), X(x0 - 5 + j(8, 20)), Y(y1 + 2 + j(9, 14)), j(10, 22)),
  ];
}
/** A grease-pencil loop round a window (its box on its face), as LOOP describes, each its own by `seed` (LOOP.vary: up
 *  to `out` pu looser or tighter, its centre `shift` off the window's, `turns` more or fewer, `tilt` more, and `wobble`
 *  more wobble), kept LOOP.edge on the page. */
function frameLoop(b: Box, seed: number): V2[] {
  const v = LOOP.vary, j = (i: number, s: number) => (hash(seed, 10 + i) - 0.5) * 2 * s;
  let cx = (b[0] + b[2]) / 2 + j(1, v.shift), a = (b[2] - b[0]) / 2 + LOOP.outX + j(2, v.out);
  const wob = LOOP.wobble + Math.abs(j(3, v.wobble)), turns = LOOP.turns + j(4, v.turns);
  const cy = (b[1] + b[3]) / 2 + j(5, v.shift * 0.6), h = (b[3] - b[1]) / 2 + LOOP.outY + j(6, v.out * 0.7), grow = 1 + wob + LOOP.drift;
  // an outer window's loop is narrowed on its page-edge side (its centre moved in) to stay on the page
  const lo = Math.max(cx - a * grow, LOOP.edge), hi = Math.min(cx + a * grow, 770 - LOOP.edge);
  cx = (lo + hi) / 2;
  a = (hi - lo) / 2 / grow;
  const tilt = (hash(seed, 1) - 0.5) * 2 * (LOOP.tilt + v.tilt), a0 = -Math.PI * 0.8 + (hash(seed, 2) - 0.5) * 0.6, e = 2 / LOOP.n;
  const pts: V2[] = [];
  for (let i = 0, n = 160; i <= n; i++) {
    const s = i / n, th = a0 + s * turns * 2 * Math.PI, r = 1 + wob * noise1(s * 6, seed) + LOOP.drift * s;
    const co = Math.cos(th), si = Math.sin(th);
    const x = a * r * Math.sign(co) * Math.abs(co) ** e, y = h * r * Math.sign(si) * Math.abs(si) ** e;
    pts.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) });
  }
  return pts;
}

/** A line of the section, its word count checked (the layout cuts it by word index). */
function lineOf(lyrics: Parameters<SpreadFactory>[0]['lyrics'], section: string, text: string, words: number): Line {
  const l = sectionLine(lyrics, section, text);
  if (l.words.length !== words) throw new Error(`contactsheet: "${l.text}" has ${l.words.length} words, the layout sets ${words}`);
  return l;
}

export const contactsheet: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = lineOf(lyrics, section, "'Cause I like your look, it's so extreme", 8);
  const L2 = lineOf(lyrics, section, 'You walk the street so effortlessly', 6);
  const L3 = lineOf(lyrics, section, "She wears you well, but can't you see?", 8);
  const L4 = lineOf(lyrics, section, 'That you definitely look better on me, yeah', 8);
  const LINES = [L1, L2, L3] as const;
  const W3 = L3.words, W4 = L4.words;
  // The words things happen on, by name.
  const well = W3[3]!, better = W4[4]!;

  // ---- the frames, where they print ----
  /** Frame k of strip r: its window in spread units, its face and its x there. */
  const win = (r: number, k: number) => {
    const x = FRAME.x0 + FRAME.pitch * k, side: Side = x < SP ? 'L' : 'R';
    return { x, y: STRIP_Y[r]! + FRAME.inset, side, u: x - (side === 'R' ? SP : 0) };
  };
  const centreOf = (k: number) => FRAME.x0 + FRAME.pitch * k + FRAME.w / 2;
  if (win(0, 3).x + FRAME.w >= SP || win(0, 4).x <= SP) throw new Error('contactsheet: a frame crosses the gutter');
  /** Each frame's figures as transforms from cover units into its window (window-local pu). */
  const placed = PICS.map((row) => row.map((p) => {
    const k = p.k ?? K, X = p.x * FRAME.w;
    const him = mul(tr(X, GROUND - (FEET - JACKET_NECK.y) * k - (p.lift ?? 0)), mul(rot(p.tilt ?? 0), mul(sc(k), tr(-JACKET_NECK.x, -JACKET_NECK.y))));
    const her = p.her ? mul(tr(X + p.her.dx * k, GROUND), mul(rot(p.her.lean ?? 0), mul(sc(k), tr(-608, -FEET)))) : null;
    return { ...p, k, him, her };
  }));
  if (PICS.length !== 3 || PICS.some((row) => row.length !== FRAME.n)) throw new Error('contactsheet: PICS is not three strips of eight');
  if (PICS[0]!.some((p) => p.her)) throw new Error('contactsheet: she is in strip 1, which the loupe for line 3 (where the X\'s are made) never frames');

  // ---- drawings (pure: built here) ----
  const streets = STREETS.map((s, r) => artDrawings([ART.street0, ART.street1, ART.street2, ART.street3, ART.street4, ART.street5][s.art]!, 700 + 13 * r));
  /** Him: the jacket's outline, lapels and pockets (at this size its stitches and hatching would be grey fuzz), in spread
   *  3's weights (cover units: ~1.2, 0.9, 0.75 pu at K). */
  const him: ArtDrawing[] = artDrawings(ART.jacket, 610).slice(0, 3).map((g, i) => ({ ...g, width: [7, 5.3, 4.5][i]! }));
  /** Her cut line: the cover's, its dots closer for her size here and a little heavier, to hold against the street
   *  (1.4 pu wide, 3.6 on and 2.2 off, in pu at K). */
  const herLine: ArtDrawing[] = artDrawings(ART.her, 620).map((g) => ({ ...g, width: 1.4 / K, dash: [3.6 / K, 2.2 / K] }));

  // ---- the camera: the loupe, a frame a beat along each line, then the foot, then the spread ----
  /** The loupe's steps along a line: on its first word a snap (back) to its first frame; then the next frame on each
   *  beat that leaves the step before it, and the next line's cue after it, HOLD at least, up to the last frame. The
   *  glide to the second frame starts as the snap lands, not on its beat: the loupe never sits on the first frame
   *  waiting for one (the user saw it hang a beat there; it should move with the song uninterrupted). */
  const stepsOf = (l: Line, until: number): { at: number | Word; k: number }[] => {
    const out: { at: number | Word; k: number }[] = [{ at: l.words[0]!, k: 0 }];
    let last = resolveAt(l.words[0]!);
    for (const b of audio.beats) {
      if (out.length >= FRAME.n || b > until - HOLD) break;
      if (b < last + HOLD) continue;
      out.push({ at: b, k: out.length });
      last = b;
    }
    if (out.length > 1) out[1] = { at: resolveAt(l.words[0]!) + SNAP_S, k: 1 };
    return out;
  };
  const cueOf = (l: Line) => resolveAt(l.words[0]!);
  const loupes = [stepsOf(L1, cueOf(L2)), stepsOf(L2, cueOf(L3)), stepsOf(L3, cueOf(L4))];
  const loupeFrame = (r: number, k: number): ShotFrame => ({
    pose: { x: (centreOf(k) - SP) / 1000, y: 1 - LOUPE[r]!.v / 1000, dist: LOUPE[r]!.dist, tilt: ANGLES.top, roll: 0 },
  });
  /** A pan's easing along a run of them (a frame each, landing on the beat), a cubic Hermite from speed `v0` to `v1`
   *  (in its own units): each kicks off its beat at KICK times the run's beat speed and coasts into its frame at COAST
   *  of it, never stopping, so the push lands on the beat — from rest after the snap, to rest on the last frame. (The
   *  plain glide stopped dead on every frame, too much bounce; a symmetric soft pulse, fastest between the beats, lost
   *  the beat's oomph: the user's notes.) */
  const KICK = 1.6, COAST = 0.4;
  const panEase = (v0: number, v1: number) => (u: number) => v0 * u + (3 - 2 * v0 - v1) * u * u + (v0 + v1 - 2) * u * u * u;
  const beatS = 60 / audio.bpm;
  const shots: Shot[] = [
    // a line's first frame is a snap back (on its first word); from there the loupe pans frame to frame, landing on
    // each on the beat, so it pans along the strip rather than jumping a frame a beat (the user found the jumps
    // jarring: hard to focus on), without stopping on each (the plain glide's stop-start read as bounce)
    ...loupes.flatMap((steps, r) => steps.map((s, i): Shot => {
      if (i === 0) return { at: s.at, frame: loupeFrame(r, s.k) };
      const at = resolveAt(s.at), last = i + 1 >= steps.length;
      const until = last ? beatAtOrAfter(audio, at + beatS - 1e-3) : resolveAt(steps[i + 1]!.at);
      // (the run's beat speed, one frame a beat, in this pan's own units: its length in beats)
      const v = (until - at) / beatS;
      return { at: s.at, frame: loupeFrame(r, s.k), move: 'glide', until, ease: panEase(i === 1 ? 0 : KICK * v, last ? 0 : COAST * v) };
    })),
    { at: W4[0]!, frame: { side: 'L', box: FOOT } }, // "That": the foot of the left page, line 4's first half
    { at: better, frame: 'spread' }, // "better": out to the spread, for the loops (and the turn)
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  /** When the move cued at `cue` lands, as the director plans it. */
  const landed = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`contactsheet: no shot starts at ${at.toFixed(3)}`);
    return m.land;
  };
  /** A line (or a phrase of one) reads from its start, or, if the camera is still moving as it starts, from where that
   *  move lands: from its second word at the latest (a one-word phrase: its end). The move in effect at t is the last
   *  one started, as the director evaluates them. */
  const settled = (l: Line) => {
    const m = moves.findLast((x) => x.at <= l.start);
    return m && l.start < m.land ? Math.min(m.land, l.words[1]?.start ?? l.end) : l.start;
  };

  // ---- the phrases along bands 1–3, each centred under the frames the loupe holds while it's sung ----
  /** The loupe's frame on line r at t: its last step started by then. */
  const heldAt = (r: number, t: number) => loupes[r]!.findLast((s) => resolveAt(s.at) <= t + 1e-9)?.k ?? 0;
  const runs = LINES.flatMap((l, r) => {
    const cuts = PHRASES[r]!;
    if (cuts[cuts.length - 1] !== l.words.length) throw new Error(`contactsheet: line ${r + 1}'s phrases don't end at its last word`);
    const out = cuts.slice(0, -1).map((i0, j) => {
      const line = subLine(l, i0, cuts[j + 1]!), w = widthOf(line.text, ITALIC, SIZE.band);
      let cx = (centreOf(heldAt(r, line.start)) + centreOf(heldAt(r, line.end))) / 2;
      const centred = PAGE_CENTRED.some(([pr, pj]) => pr === r && pj === j);
      if (centred) cx = (cx < SP ? 0 : SP) + SP / 2;
      // clear of the spine (to the side of its centre) and the outer edges
      if (cx - w / 2 < SP + KEEP.spine && cx + w / 2 > SP - KEEP.spine) cx = cx < SP ? SP - KEEP.spine - w / 2 : SP + KEEP.spine + w / 2;
      cx = Math.min(2 * SP - KEEP.edge - w / 2, Math.max(KEEP.edge + w / 2, cx));
      const side: Side = cx < SP ? 'L' : 'R', u = cx - (side === 'R' ? SP : 0), base = BANDS[r]!.base;
      return { r, line, side, u, w, centred, box: [u - w / 2 - 6, base - 37, u + w / 2 + 6, base + 14] as Box };
    });
    out.forEach((p, j) => {
      const q = out[j + 1];
      if (q && q.side === p.side && q.u - q.w / 2 - (p.u + p.w / 2) < KEEP.gap) throw new Error(`contactsheet: "${p.line.text}" and "${q.line.text}" collide on band ${r + 1}`);
    });
    return out;
  });
  /** Line 4's halves, either side of the gutter. */
  const L4a = subLine(L4, 0, L4_AT.split), L4b = subLine(L4, L4_AT.split, L4.words.length);
  const l4w = [widthOf(L4a.text, TEXT, SIZE.l4), widthOf(L4b.text, TEXT, SIZE.l4)] as const, B4 = BANDS[3]!.base;
  const L4A_BOX: Box = [SP - L4_AT.gutter - l4w[0] - 6, B4 - 34, SP - L4_AT.gutter + 6, B4 + 12];
  const L4B_BOX: Box = [L4_AT.gutter - 6, B4 - 34, L4_AT.gutter + l4w[1] + 6, B4 + 12];

  // ---- the marks ----
  /** The frames with her, left to right (a column at a time, strip 2 before 3), and those of him alone. */
  const order = Array.from({ length: FRAME.n }, (_, k) => [0, 1, 2].map((r) => ({ r, k }))).flat();
  const withHer = order.filter(({ r, k }) => PICS[r]![k]!.her), alone = order.filter(({ r, k }) => !PICS[r]![k]!.her);
  // The X's, on the beat grid (beat indices: eighths and sixteenths are its fractions): one a beat from the first beat
  // of "She wears you well" while it's sung, then one an eighth, through "but can't you see?". Each is two strokes, in
  // its slot's first and second halves.
  const slots: { at: number; to: number; beat: boolean }[] = [];
  let bi = Math.ceil(audio.beatAt(L3.start) - 1e-9);
  for (; slots.length < withHer.length && audio.timeOfBeat(bi) < well.end; bi++) slots.push({ at: audio.timeOfBeat(bi), to: audio.timeOfBeat(bi + 1), beat: true });
  for (let h = 0; slots.length < withHer.length; h++) slots.push({ at: audio.timeOfBeat(bi + h / 2), to: audio.timeOfBeat(bi + (h + 1) / 2), beat: false });
  const lastX = slots[slots.length - 1]!;
  if (lastX.to > cueOf(L4) + 1e-6) throw new Error(`contactsheet: the X's run to ${lastX.to.toFixed(3)}, past line 4's cue (${cueOf(L4).toFixed(3)}), where the loupe leaves them`);
  const xs = withHer.map(({ r, k }, i) => {
    const f = win(r, k), box: Box = [f.u, f.y, f.u + FRAME.w, f.y + FRAME.h], [a, b] = frameX(box, 900 + i, 3), s = slots[i]!, d = s.to - s.at;
    return {
      side: f.side, a, b, la: lengthOf(a), lb: lengthOf(b), steps: s.beat ? STEPS.xBeat : STEPS.xEighth,
      a0: s.at, a1: s.at + d * 0.42, b0: s.at + d * 0.5, b1: s.at + d * 0.92, box: bounds([...a, ...b], LIP.x), seed: 300 + 7 * i,
    };
  });
  // The loops: one a sixteenth from the downbeat in "better", round every frame of him alone, left to right; then "ME".
  const li = Math.round(audio.beatAt(downbeatAtOrAfter(audio, better.start)));
  const loops = alone.map(({ r, k }, i) => {
    const f = win(r, k), pts = frameLoop([f.u, f.y, f.u + FRAME.w, f.y + FRAME.h], 400 + i);
    const from = audio.timeOfBeat(li + i / 4), to = from + (audio.timeOfBeat(li + (i + 1) / 4) - from) * 0.9;
    return { side: f.side, r, k, pts, len: lengthOf(pts), from, to, box: bounds(pts, LIP.loop), seed: 500 + 11 * i };
  });
  const lastLoop = loops[loops.length - 1]!;
  if (lastLoop.side !== 'R') throw new Error('contactsheet: the last loop is on the left page, but "ME" is written on the right');
  /** "ME" from the sixteenth after the last loop, done a little before the turn (the leaf carries it away). */
  const meAt = { from: audio.timeOfBeat(li + loops.length / 4), to: turnAt - 0.1 };
  if (!(meAt.to - meAt.from >= 0.25)) throw new Error(`contactsheet: "ME" has ${(meAt.to - meAt.from).toFixed(3)} s before the turn (it needs 0.25)`);

  // ---- lazily built (font-dependent, DOM) ----
  let cache: { jacket: Path2D; her: Path2D; holes: Path2D[][]; me: StrokeText; meBox: Box } | null = null;
  const lazy = () => {
    if (!cache) {
      // the width table, checked against the canvas (which kerns): never narrower than it draws
      for (const [text, fam, size, w] of [...runs.map((p) => [p.line.text, ITALIC, SIZE.band, p.w] as const), [L4a.text, TEXT, SIZE.l4, l4w[0]] as const, [L4b.text, TEXT, SIZE.l4, l4w[1]] as const]) {
        const m = measure(text, fam, size);
        if (m > w) throw new Error(`contactsheet: "${text}" measures ${m.toFixed(2)} pu, wider than ADV's ${w.toFixed(2)} (raise WIDTH_SLACK)`);
      }
      const jacket = new Path2D(OUTLINE[0]), her = new Path2D(HER[0]);
      // where the street is cut away for the figures: each window, less him and her (their silhouettes as filled paths)
      const holes = placed.map((row, r) => row.map((p, k) => {
        const f = win(r, k), at = tr(f.u, f.y), hole = new Path2D();
        hole.rect(f.u, f.y, FRAME.w, FRAME.h);
        hole.addPath(jacket, asInit(mul(at, p.him)));
        if (p.her) hole.addPath(her, asInit(mul(at, p.her)));
        return hole;
      }));
      const me = strokeText(ME.text, 'hscript', ME.size);
      const m = mul(tr(ME.x, ME.y), rot(ME.rot)), meBox = bounds(me.strokes.flat().map((p) => apply(m, p)), LIP.me);
      cache = { jacket, her, holes, me, meBox };
    }
    return cache;
  };

  /** A page-centred phrase (PAGE_CENTRED) reads once the loupe is on its page: from its own start, or if the loupe's
   *  step onto the page comes on the beat just after it (L2's "effortlessly", sung from 25 ms before it), where that
   *  step lands. */
  const onItsPage = (p: (typeof runs)[number]) => {
    const step = loupes[p.r]!.find((s) => resolveAt(s.at) >= p.line.start - 1e-9 && (centreOf(s.k) < SP ? 'L' : 'R') === p.side);
    return step && resolveAt(step.at) - p.line.start < HOLD ? landed(step.at) : settled(p.line);
  };

  // ---- what must read when ----
  const focus: FocusBox[] = [
    // each phrase while it's sung (type: as soft as its cap height on screen allows), until the snap back to the next
    // line's first frame takes the loupe away (a word cue leads its word: the line's last word is still sung then)
    ...runs.map((p): FocusBox => ({
      from: p.centred ? onItsPage(p) : settled(p.line), to: Math.min(p.line.end, cueOf([L2, L3, L4][p.r]!)), side: p.side, box: p.box, size: ITALIC_CAP * SIZE.band,
    })),
    { from: settled(L4a), to: L4a.end, side: 'L', box: L4A_BOX, size: SIZE.l4 },
    { from: settled(L4b), to: Math.min(L4b.end, turnAt), side: 'R', box: L4B_BOX, size: SIZE.l4 },
    // the frames the loupe is on, from each step's landing until the next (drawings: as soft as FADE)
    ...loupes.flatMap((steps, r) => steps.map((s, i): FocusBox[] => {
      const to = i + 1 < steps.length ? resolveAt(steps[i + 1]!.at) : r + 1 < LINES.length ? cueOf(LINES[r + 1]!) : cueOf(L4);
      return (r === 2 ? [1, 2] : [r]).map((row) => {
        const f = win(row, s.k);
        return { from: landed(s.at), to, side: f.side, box: [f.u, f.y, f.u + FRAME.w, f.y + FRAME.h] };
      });
    }).flat()),
    // and every mark while it's made
    ...xs.map((x): FocusBox => ({ from: x.a0, to: x.b1, side: x.side, box: x.box })),
    ...loops.map((l): FocusBox => ({ from: l.from, to: l.to, side: l.side, box: l.box })),
  ];
  // "ME"'s box is its ink's, measured from the stroke font on first draw: a fixed box round where it's written
  // stands in for the guard (its text is under 100 pu at x 556..~730 on the right page's band 3)
  focus.push({ from: meAt.from, to: meAt.to, side: 'R', box: [ME.x - 12, ME.y - 90, ME.x + 200, ME.y + 30], size: ME.size });

  // ---- every animated value, quantised once ----
  const q = (x: number, n: number) => Math.round(x * n) / n;
  const marksAt = (t: number) => ({
    x: xs.map((x) => [q(prog(t, x.a0, x.a1, ease.outQuad), x.steps), q(prog(t, x.b0, x.b1, ease.outQuad), x.steps)] as const),
    loop: loops.map((l) => q(prog(t, l.from, l.to, ease.inOutQuad), STEPS.loop)),
    me: q(prog(t, meAt.from, meAt.to, ease.inOutQuad), STEPS.me),
  });

  // ---- the print ----
  const ink = rgba('ink');
  /** A frame's picture: the street, cut away where they stand; him; her cut line. */
  const drawPic = (c: CanvasRenderingContext2D, r: number, k: number) => {
    const z = lazy(), f = win(r, k), p = placed[r]![k]!, st = STREETS[r]!;
    c.save();
    c.beginPath();
    c.rect(f.u, f.y, FRAME.w, FRAME.h);
    c.clip();
    c.save();
    c.clip(z.holes[r]![k]!, 'evenodd');
    c.translate(f.u + st.sx, f.y);
    c.scale(STREET_K, STREET_K);
    c.strokeStyle = rgba('graphite');
    drawArt(c, streets[r]!, [1, 1, 1, 1], STREET_WEIGHT);
    c.restore();
    c.translate(f.u, f.y);
    c.save();
    c.transform(...p.him);
    c.strokeStyle = ink;
    drawArt(c, him, [1, 1, 1], K / p.k);
    c.restore();
    if (p.her) {
      c.transform(...p.her);
      c.strokeStyle = rgba('graphite');
      drawArt(c, herLine, [1], K / p.k);
    }
    c.restore();
    // the data back's imprint
    c.save();
    c.font = font(MONO, IMPRINT.size);
    c.letterSpacing = '1px';
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('graphite');
    c.fillText(IMPRINT.times[`${r},${k}`] ?? IMPRINT.date, f.u + FRAME.w - IMPRINT.inset, f.y + FRAME.h - IMPRINT.inset);
    c.restore();
  };
  /** A small arrow, pointing along the film (right), its foot on the baseline at (x, y): the edge print's. */
  const arrow = (k: CanvasRenderingContext2D, x: number, y: number, s: number) => {
    k.beginPath();
    k.moveTo(x, y - s);
    k.lineTo(x + s * 0.9, y - s / 2);
    k.lineTo(x, y);
    k.closePath();
    k.fill();
  };
  /** The edge print of every strip on a face, cut out of the black: EFFORTLESS 400 along the top edge over every other
   *  frame; along the bottom, each frame's number and arrow at its left, and its half-frame mark (nA) at its middle. */
  const drawEdge = (k: CanvasRenderingContext2D, side: Side) => {
    k.textAlign = 'left';
    k.textBaseline = 'alphabetic';
    STRIP_Y.forEach((sy, r) => {
      for (let j = 0; j < FRAME.n; j++) {
        const f = win(r, j), n = r * FRAME.n + j + 1;
        if (f.side !== side) continue;
        if (j % 2 === 0) {
          k.font = font(MONO_LIGHT, EDGE.stock);
          k.letterSpacing = '1.5px';
          k.fillText('EFFORTLESS 400', f.u + 8, sy + EDGE.top);
          k.letterSpacing = '0px';
        }
        k.font = font(MONO, EDGE.num);
        k.fillText(`${n}`, f.u + 6, sy + EDGE.bottom);
        arrow(k, f.u + 6 + measure(`${n}`, MONO, EDGE.num) + 3, sy + EDGE.bottom, 7);
        k.font = font(MONO_LIGHT, EDGE.stock);
        arrow(k, f.u + FRAME.w * 0.55, sy + EDGE.bottom, 6);
        k.fillText(`${n}A`, f.u + FRAME.w * 0.55 + 9, sy + EDGE.bottom);
      }
    });
  };
  /** The header over strip 1: the title on the left page, cut; the small print. */
  const drawHeader = (k: CanvasRenderingContext2D, side: Side) => {
    k.textAlign = 'left';
    k.textBaseline = 'alphabetic';
    if (side === 'L') {
      k.font = font(ITALIC, TITLE.size);
      k.fillText(TITLE.text, TITLE.x, TITLE.y);
      k.lineWidth = 0.5;
      k.lineJoin = 'round';
      k.strokeText(TITLE.text, TITLE.x, TITLE.y);
      k.font = font(MONO, 10.5);
      k.letterSpacing = '2px';
      k.fillText('CONTACT SHEET', 600, 44);
      k.fillText('ROLL 47', 600, 60);
      k.fillText('SHOT ON LOCATION', 600, 76);
      k.letterSpacing = '0px';
    } else {
      k.font = font(MONO, 10.5);
      k.letterSpacing = '2px';
      k.fillText('24 EXPOSURES · EFFORTLESS 400', 30, 60);
      k.fillText('SELECTS MARKED BY THE EDITOR', 30, 76);
      k.letterSpacing = '0px';
    }
  };
  /** Line 4's half on a face, in the text cut. */
  const drawL4 = (c: CanvasRenderingContext2D, side: Side, t: number) => {
    if (side === 'L') setLine(c, L4a, t, SP - L4_AT.gutter, B4, { family: TEXT, size: SIZE.l4, align: 'right' });
    else setLine(c, L4b, t, L4_AT.gutter, B4, { family: TEXT, size: SIZE.l4 });
  };

  return {
    id: 'contactsheet', section, pages,
    drawPrint(side, c, t) {
      const off = side === 'R' ? SP : 0;
      c.fillStyle = ink;
      c.fillRect(0, 0, 770, 1000);
      knockout(c, (k) => { for (const b of BANDS) k.fillRect(0, b.y, 770, b.h); });
      STRIP_Y.forEach((sy, r) => {
        filmStrip(c, -off, sy, 2 * SP, STRIP_H, Array.from({ length: FRAME.n }, (_, k) => ({ x: win(r, k).x - off, y: sy + FRAME.inset, w: FRAME.w, h: FRAME.h })));
        for (let k = 0; k < FRAME.n; k++) if (win(r, k).side === side) drawPic(c, r, k);
      });
      knockout(c, (k) => { drawEdge(k, side); drawHeader(k, side); });
      for (const p of runs) if (p.side === side) setLine(c, p.line, t, p.u, BANDS[p.r]!.base, { family: ITALIC, size: SIZE.band, align: 'center', hairline: true });
      drawL4(c, side, t);
      knockout(c, (k) => drawFolio(k, side, pages[side === 'L' ? 0 : 1])); // (cut as deep as the other folios print: drawFolio's 0.85)
    },
    drawMarks(side, c, t) {
      const m = marksAt(t);
      xs.forEach((x, i) => {
        if (x.side !== side) return;
        const [pa, pb] = m.x[i]!;
        if (pa > 0) lipstickStroke(c, x.a, pa * x.la, { width: LIP.x, seed: x.seed });
        if (pb > 0) lipstickStroke(c, x.b, pb * x.lb, { width: LIP.x, seed: x.seed + 1 });
      });
      loops.forEach((l, i) => {
        if (l.side === side && m.loop[i]! > 0) lipstickStroke(c, l.pts, m.loop[i]! * l.len, { width: LIP.loop, seed: l.seed });
      });
      if (side === 'R' && m.me > 0) {
        const z = lazy();
        c.save();
        c.translate(ME.x, ME.y);
        c.rotate(ME.rot);
        lipstickWrite(c, z.me, m.me * z.me.total, { width: LIP.me, seed: ME.seed });
        c.restore();
      }
    },
    key(side, layer, t) {
      if (layer === 'marks') {
        const m = marksAt(t), s = (x: number, n: number) => Math.round(x * n).toString(36);
        return [
          xs.map((x, i) => (x.side === side ? s(m.x[i]![0], x.steps) + s(m.x[i]![1], x.steps) : '')).join(''),
          loops.map((l, i) => (l.side === side ? s(m.loop[i]!, STEPS.loop) : '')).join(''),
          side === 'R' ? s(m.me, STEPS.me) : '',
        ].join('|');
      }
      return karaokeKey([...runs.filter((p) => p.side === side).map((p) => p.line), side === 'L' ? L4a : L4b], t);
    },
    camera, focus,
  };
};
