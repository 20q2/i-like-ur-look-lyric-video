// Spread 2, In Memoriam (pre-chorus 1, pp. 4–5): a deadpan obituary for her.
// The left page is solid ink, and everything on it
// is cut out of the black (TREATMENT.md §6): "In Memoriam"; her portrait, an oval of bare paper with a dotted cut line,
// her head and shoulders inside it as the cover's dotted outline; the epitaph (lyrics 1–2, karaoke on black); the
// dates. The scissors cut all the way round her over "Tonight, just pretend"; on "dead" she's snatched up off the page,
// held trembling, and on "gone" flung out of frame, spinning (a piece of paper of her own: engine/cutout.ts), leaving a
// hole through to the page under this one, spread 1's boots. The right page: NOTICES, a giant SPLIT that tears in half
// on "done" over lyric 3, and deadpan society notices; lyric 4 isn't printed: the narrator interjects it, writing "It
// could be so fun" in lipstick across the page's blank foot, finishing as the page turns into the chorus.
import { F, font, glyphX } from '../engine/type';
import { PAGE } from '../engine/pagesize';
import { rgba } from '../engine/palette';
import { HAIRLINE_PU, drawFolio, karaokeKey, setLine } from '../engine/layout';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { drawStretch, knockout } from '../engine/print';
import { lipstickWrite } from '../engine/lipstick';
import { type StrokeText, strokeText, writtenLength } from '../engine/stroke';
import { TAU, type V2, clamp, ease, mulberry32, pointAtLength, polylineLengths, prog } from '../engine/util';
import { drawCutShadow } from '../engine/cutout';
import { ART, SCISSORS_AXIS, SCISSORS_ROOT, artDrawings, drawArt } from './art';
import { sectionLine } from './cues';
import { resolveFlatplan, spreadCtx } from './flatplan';
import { coverstory } from './coverstory';
import { getthelook } from './getthelook';
import { charTimes } from './marks';
import { type Shot, director, plan, resolveAt } from './shots';
import { type Cutout, type FocusBox, type SpreadFactory, turnOut } from './spread';

/** The portrait: an oval cut out of the black, to bare paper. */
const OVAL = Object.freeze({ x: 385, y: 456, rx: 152, ry: 196 });
/** Her cut line inside it, dotted in graphite (pu), and the polyline the scissors ride it on (segments round it). */
const CUT_LINE = Object.freeze({ rx: 140, ry: 184, width: 1.4, dash: 6, gap: 5, segments: 720 });
/** ART.herBust placed in the oval: its box's centre on (x, y), times `scale`; its line keeps the art's own width and
 *  dash in page units (the cover's dotted outline of her). */
const BUST = Object.freeze({ x: 385, y: 470, scale: 1.6 });
/** Coming loose (spread.ts Cutout.loose), in one unbroken lift with the song's slow drawl: from "dead" she peels up
 *  by her top over `peelS`, and from `flyFrom` after "dead" she floats up and away, slow at first and gathering pace, gone by the end
 *  of the long "gone". Her motion (engine/cutout.ts CutMotion): lifted `peel` rad with a soft curl, turning a little
 *  as she rises up and off past the page's outer edge, out of frame by the end at every framing of it. */
const LOOSE = Object.freeze({
  peelS: 0.7, flyFrom: 0.35,
  motion: Object.freeze({ peel: 0.62, bend: 1.0, flip: 0.5, roll: 0.8, flyBend: 1.2, move: Object.freeze([-0.16, 0.2, 0.05] as const) }),
});
/** Her shadow on the page while she's loose (engine/cutout.ts drawCutShadow): `amt` of ink where she lies close,
 *  fading out by `fadeH` above the page (world units), cast through `pts` points of her outline. */
const SHADOW = Object.freeze({ amt: 0.4, fadeH: 0.3, pts: 48 });
/** The hole's edge, the page's own thickness: a soft shade just inside it, `w` pu wide, `amt` of ink. */
const RIM = Object.freeze({ w: 5, amt: 0.3 });
/** ART.scissors on the cut line, placed by their root and turned by their axis (art.ts SCISSORS_ROOT, SCISSORS_AXIS).
 *  The tips sit 5 units either side of the axis, 25–27 along it; the rings' centres 5.5 either side and 5.3 along it,
 *  one ahead of the root and one behind (radius 5). `scale`: the cover's mark is 37 pu long, a squiggle at these
 *  framings; at 1.45 it reads as scissors. Riding the cut line, the root sits `inset` pu inside it and the axis follows
 *  its tangent: the line runs on between the open blades, and the outer ring (15 pu off the axis) stays inside the
 *  oval's edge, 12 pu outside the line. `width`: its line (pu). */
const SNIP = Object.freeze({ scale: 1.45, inset: 5, width: 1.3 });
/** Lyric 4, the narrator's interjection: "It could be so fun" in lipstick across the right page's blank foot, in her
 *  hand (Hershey Script, TREATMENT §2), as two lines, `words` [from, to) of the line each: each stroke text's origin
 *  (its left baseline) at (x, y), rotated `rot` about it, at `size` pu, with a `width` brush. "fun" gets at least `minS`
 *  between the word's start and the turn. */
const WRITE = Object.freeze({
  lines: Object.freeze([
    Object.freeze({ text: 'It could be', words: [0, 3] as const, x: 50, y: 768, size: 150, width: 8, seed: 22 }),
    Object.freeze({ text: 'so fun', words: [3, 5] as const, x: 300, y: 906, size: 190, width: 9, seed: 21 }),
  ]),
  rot: (-6 * Math.PI) / 180, minS: 0.2,
});
/** SPLIT tears in half on "done": a ragged tear down through it from y0 to y1 (pu) about x, its `n` points wandering
 *  `jag` either side. It runs down over `runS` and opens behind its front over `openS`, each half pulled `open` pu
 *  aside at its widest — a lens, closed at either end; the halves are drawn in `slice`-pu bands, each shifted by its
 *  share. The rift shows the page beneath (the next spread's right page), in the tear's shade (`amt` of ink), and its
 *  edges the paper's white core where the tear crosses ink (`fibre` pu wide). */
const TEAR = Object.freeze({ x: 392, y0: 128, y1: 362, n: 30, jag: 6, seed: 44, runS: 0.09, openS: 0.32, open: 20, slice: 4, amt: 0.22, fibre: 1.6 });
/** Quantisation steps: every animated value is one of these many levels (the keys and the drawing share them). The
 *  scissors' are set per spread, from lyric 1's length: a step a frame. */
const STEPS = Object.freeze({ shadow: 96, run: 8, open: 24, write: 64 });

const ITALIC = F.bodoni(400, { italic: true });
const NOTICE = Object.freeze({ family: F.bodoni(400, { text: true }), size: 15 });
/** Type sizes (pu): what the faces set, and what the focus boxes are judged by (FocusBox.size). SPLIT's box gives its
 *  cap height: Archivo 1250/900's flat capitals (I, H) are 0.688 em, 172 pu at 250 (measured). */
const SIZE = Object.freeze({ epitaph: 52, lyric3: 56, split: 250, splitCap: 172 });
/** Small mono meant to be read: Plex Mono 600 at 10.5 pu or more (the house rule: lighter or smaller, at these framings
 *  its strokes print grey, TREATMENT §6). */
const SMALL = Object.freeze({ family: F.mono(600), size: 10.5 });
/** The deadpan society notices under the rule: two columns, a label and two lines each. */
const NOTICES = Object.freeze([
  { x: 58, label: 'ENGAGED', lines: ['Mr. —— and Ms. ——, at her parents’', 'house, in June. A wedding is planned.'] },
  { x: 400, label: 'SEEN', lines: ['At Thursday’s opening of “Detour”', 'at the Lenz Gallery.'] },
]);

/** A rule over each run of em dashes, BLANK_PU thick at the dash's own height: the names withheld ("Mr. —— and
 *  Ms. ——"). The text cut's dash is 0.019 em thick, 0.3 pu at 15 pu, a faint grey hair on screen: a society column's
 *  blank is a rule you see. */
const BLANK_PU = 0.75;
/** A notice's line, at (x, baseline y) in `family` at `size`, its blanks ruled. Leaves the font set to it. */
function noticeLine(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number) {
  c.font = font(family, size);
  c.fillText(text, x, y);
  const m = c.measureText('—'), mid = y + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '—') continue;
    let j = i;
    while (chars[j] === '—') j++;
    const x0 = x + glyphX(text, i, family, size), x1 = x + glyphX(text, j, family, size);
    c.fillRect(x0, mid - BLANK_PU / 2, x1 - x0, BLANK_PU);
    i = j;
  }
}

/** A line of `section`, its word count checked (a re-alignment that split or merged words would move every cue). */
function lineOf(lyrics: Lyrics, section: string, text: string, words: number): Line {
  const l = sectionLine(lyrics, section, text);
  if (l.words.length !== words) throw new Error(`memoriam: "${l.text}" has ${l.words.length} words, expected ${words}`);
  return l;
}

export const memoriam: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = lineOf(lyrics, section, 'Tonight, just pretend', 3);
  const L2 = lineOf(lyrics, section, "That she's dead and gone", 5);
  const L3 = lineOf(lyrics, section, "Tell me y'all are done", 5);
  const L4 = lineOf(lyrics, section, 'It could be so fun', 5);
  // The words things happen on, by name: a shot's cue and every lookup of it use the same one.
  const tonight = L1.words[0]!, pretend = L1.words[2]!, thatShes = L2.words[0]!, dead = L2.words[2]!, gone = L2.words[4]!;
  const tellMe = L3.words[0]!, done = L3.words[4]!, itCould = L4.words[0]!, fun = L4.words[4]!;
  // "fun" is sung past the turn (it ends 0.35 s after the page starts to lift, and the leaf passes upright 0.09 s in), so
  // the lipstick writes it over the word as sung up to the turn: she finishes as the page turns, and the word is whole
  // while it can still be seen. Written to the word's end, only "fu" would show before the leaf took it away.
  const funEnd = Math.min(fun.end, turnAt);
  if (!(funEnd - fun.start >= WRITE.minS)) {
    throw new Error(`memoriam: the lipstick has ${(funEnd - fun.start).toFixed(3)} s to write "fun", from the word (${fun.start}) to ${funEnd === turnAt ? `the turn (${turnAt})` : `its end (${fun.end})`}; it needs ${WRITE.minS}`);
  }
  const writeTimes = WRITE.lines.map((l) => charTimes(l.text, L4.words.slice(l.words[0], l.words[1]).map((w) => (w === fun ? { ...w, end: funEnd } : w))));
  /** The scissors' steps round the loop: one a frame (at 60 fps) while lyric 1 is sung. */
  const snipSteps = Math.max(1, Math.ceil((L1.end - L1.start) * 60));

  // ---- the page under this one, which the hole shows: spread 1's left page, the leaf below ours on the left pile, as
  // it was left (its faces don't change once it's turned from) ----
  const plan0 = resolveFlatplan(audio, lyrics), ui = plan0.findIndex((e) => e.left !== null && e.left === (ctx.leaves.left ?? NaN) - 1);
  if (ui < 0 || plan0[ui]!.id !== 'getthelook') throw new Error(`memoriam: the page under its left page is ${ui < 0 ? 'none' : plan0[ui]!.id}'s, not getthelook's`);
  const under = getthelook(spreadCtx(audio, lyrics, plan0, ui)), underAt = ctx.start;
  // and the page under its right page, which SPLIT's tear shows: spread 3's right page, the leaf below ours on the right
  // pile, as it will come up
  const ri = plan0.findIndex((e) => e.right !== null && e.right === (ctx.leaves.right ?? NaN) + 1);
  if (ri < 0 || plan0[ri]!.id !== 'coverstory') throw new Error(`memoriam: the page under its right page is ${ri < 0 ? 'none' : plan0[ri]!.id}'s, not coverstory's`);
  const next = coverstory(spreadCtx(audio, lyrics, plan0, ri)), nextAt = plan0[ri]!.start;

  // ---- drawings (pure geometry: built here) ----
  const bust = artDrawings(ART.herBust, 41);
  const scissors = artDrawings(ART.scissors, 42);
  const bustAt = { x: (ART.herBust.box[0] + ART.herBust.box[2]) / 2, y: (ART.herBust.box[1] + ART.herBust.box[3]) / 2 };
  /** The cut line as a polyline from its top, clockwise on screen (the way the scissors cut it): they ride it at an even
   *  speed, and its length sets the dashes. */
  const cutPath: V2[] = Array.from({ length: CUT_LINE.segments + 1 }, (_, i) => {
    const th = -Math.PI / 2 + (TAU * i) / CUT_LINE.segments;
    return { x: OVAL.x + CUT_LINE.rx * Math.cos(th), y: OVAL.y + CUT_LINE.ry * Math.sin(th) };
  });
  const cutLens = polylineLengths(cutPath), cutLen = cutLens[cutLens.length - 1]!;
  /** The dotted cut line's dash pattern, stretched (by under 0.1%) so a whole number of dashes goes round the loop: no
   *  short dash where the path closes. */
  const cutDash = (() => {
    const period = CUT_LINE.dash + CUT_LINE.gap, k = cutLen / Math.round(cutLen / period) / period;
    return [CUT_LINE.dash * k, CUT_LINE.gap * k];
  })();
  /** SPLIT's tear, from its top down. */
  const tearPath: V2[] = (() => {
    const r = mulberry32(TEAR.seed);
    return Array.from({ length: TEAR.n + 1 }, (_, i) => ({
      x: TEAR.x + (i === 0 || i === TEAR.n ? 0 : TEAR.jag * (2 * r() - 1)), y: TEAR.y0 + ((TEAR.y1 - TEAR.y0) * i) / TEAR.n,
    }));
  })();

  // ---- the lipstick's stroke text: font-dependent, built on first use (the factory must not touch the DOM) ----
  let writeInk: StrokeText[] | null = null;
  const writeText = () => (writeInk ??= WRITE.lines.map((l) => strokeText(l.text, 'hscript', l.size)));

  // ---- the camera: Snap, a shot per set piece ----
  // Lyric 1 prints under the oval (y 742), so the shots over it keep it in frame: the whole obituary on "Tonight", then
  // closer on her portrait and the epitaph (framed on the oval alone, as first planned, lyric 1 was out of frame while it
  // was sung). Every hold's frame edges fall in the gaps between type, through the groove's punches and the hand
  // (measured at every frame of each hold, across the type's width):
  // - "Tonight": its bottom edge between the dates (to y 872) and the folio (from 958);
  // - "pretend": its top between the title (to 177) and the oval (from 260), its bottom between lyric 2 (to 820) and the
  //   dates (from 864). Closer than this, its bottom edge cut through lyric 2, and there's no framing it between lyrics 1
  //   and 2: they're 10 pu apart, and the punches and the hand move the edge 14 over the hold. So lyric 2 is in, whole;
  // - "That she's": its top between the title and the oval, its bottom between the dates and the folio. She flies off
  //   it, lifting up and out past the page's outer edge, over "dead and gone" (LOOSE);
  // - "Tell me": its bottom between the notices' rule (490) and their labels (from 520), unrolled: rolled, as first
  //   planned, the edge's tilt swept it back and forth across the rule. It holds through "done": SPLIT tears in half
  //   on a still frame.
  const shots: Shot[] = [
    { at: tonight, frame: { side: 'L', box: [100, 96, 670, 886] }, roll: 0.02 }, // the obituary, whole
    { at: pretend, frame: { side: 'L', box: [196, 252, 574, 814] } }, // closer: the scissors cutting round her, lyrics 1-2
    { at: thatShes, frame: { side: 'L', box: [90, 256, 680, 892] } }, // her, the epitaph and the dates, for "gone"
    { at: tellMe, frame: { side: 'R', box: [30, 102, 740, 444] } }, // lyric 3 under SPLIT, close, as it tears
    { at: itCould, frame: { side: 'R', box: [0, 0, 770, 1000] } }, // the right page (the turn's framing), as she writes
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  /** When the move a cue starts has landed, as the director plans it (whatever the shot's move or `until`). */
  const landed = (cue: Word) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`memoriam: no shot starts on "${cue.w}" (${at})`);
    return m.land;
  };
  /** A line reads from its start, or, if the camera is still moving as it starts, from where that move lands — from its
   *  second word at the latest. (The move in flight is the last one started, as the director evaluates them.) */
  const settled = (l: Line) => {
    const m = moves.findLast((x) => x.at <= l.start);
    return m && l.start < m.land ? Math.min(m.land, l.words[1]!.start) : l.start;
  };
  /** The scissors are put away once the loop is cut, on the snap at "That she's": the oval stays in frame, but the change
   *  lands in a camera move rather than on a still frame. */
  const scissorsAway = resolveAt(thatShes);
  // the lyrics while they're sung, and what they're about: her portrait (cut round on lyric 1, torn out on lyric 2, the
  // page beneath it showing), SPLIT (torn on "done"), the lipstick's lyric 4 (until the turn: the leaf takes it then,
  // with its last word)
  const focus: FocusBox[] = [
    { from: settled(L1), to: L1.end, side: 'L', box: [130, 700, 640, 760], size: SIZE.epitaph },
    { from: settled(L2), to: L2.end, side: 'L', box: [100, 764, 670, 824], size: SIZE.epitaph },
    { from: settled(L3), to: L3.end, side: 'R', box: [54, 372, 560, 432], size: SIZE.lyric3 },
    { from: settled(L1), to: L2.end, side: 'L', box: [225, 252, 545, 660] }, // (a drawing: no size)
    { from: landed(tellMe), to: L3.end, side: 'R', box: [40, 150, 730, 336], size: SIZE.splitCap },
    { from: settled(L4), to: turnAt, side: 'R', box: [40, 600, 740, 990], size: WRITE.lines[0]!.size }, // (the script's ink and brush)
  ];

  // Every animated value is quantised once, here; the keys encode exactly these values and the draws draw exactly them.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  /** How loose she is (spread.ts Cutout.loose): null while she lies in the page and once she's gone. Unquantised: the
   *  mesh moves smoothly (the motion blur's sub-frames see it move); her shadow, on the face, is quantised (state). */
  const goneAt = gone.end;
  if (!(goneAt < resolveAt(tellMe))) throw new Error(`memoriam: she's still lifting away at ${goneAt}, past "Tell me"'s cue`);
  const loose = (t: number) => (t < dead.start || t >= goneAt ? null : {
    peel: ease.inOutQuad(prog(t, dead.start, dead.start + LOOSE.peelS)),
    fly: ease.inCubic(prog(t, dead.start + LOOSE.flyFrom, goneAt)),
  });
  // (her tab: the top of the cut line, where the scissors started and finished: she's snatched up by it)
  const cutout: Cutout = { side: 'L', shape: 'ellipse', x: OVAL.x, y: OVAL.y, rx: CUT_LINE.rx, ry: CUT_LINE.ry, tab: -Math.PI / 2, motion: LOOSE.motion, loose };
  const state = (t: number) => {
    const lo = loose(t);
    return {
      /** The scissors' way round the loop (0 at the top, clockwise, 1 back there), or -1 once they're put away. */
      snip: t < scissorsAway ? q(prog(t, L1.start, L1.end), snipSteps) : -1,
      /** Her place: 0 in the page, 1 snatched out of it (the hole shows). */
      cut: t < dead.start ? 0 : 1,
      /** While she's loose, for her shadow: her peel and fly, quantised (-1 otherwise). */
      peel: lo ? q(lo.peel, STEPS.shadow) : -1, fly: lo ? q(lo.fly, STEPS.shadow) : -1,
      /** SPLIT's tear: its front's way down (0..1) and its opening (0..1). */
      run: q(prog(t, done.start, done.start + TEAR.runS), STEPS.run),
      open: q(prog(t, done.start, done.start + TEAR.openS, ease.outCubic), STEPS.open),
    };
  };
  /** How much of each line of lyric 4 the lipstick has written, of its stroke text's length. Needs the stroke font
   *  (writeText): called only to draw the face or key it, in the browser. */
  const writeAt = (t: number) => writeText().map((st, i) => q(writtenLength(st, writeTimes[i]!, t) / st.total, STEPS.write));

  const ellipse = (c: CanvasRenderingContext2D, rx: number, ry: number) => { c.beginPath(); c.ellipse(OVAL.x, OVAL.y, rx, ry, 0, 0, TAU); };
  /** Her head and shoulders, clipped to the cut line: she's cut out along it. */
  const drawBust = (c: CanvasRenderingContext2D) => {
    c.save();
    ellipse(c, CUT_LINE.rx, CUT_LINE.ry);
    c.clip();
    c.translate(BUST.x, BUST.y);
    c.scale(BUST.scale, BUST.scale);
    c.translate(-bustAt.x, -bustAt.y);
    c.strokeStyle = rgba('graphite');
    drawArt(c, bust, [1], 1 / BUST.scale);
    c.restore();
  };
  /** Her cut line, dotted, from the top, where the scissors start. */
  const drawCutLine = (c: CanvasRenderingContext2D) => {
    c.strokeStyle = rgba('graphite');
    c.lineWidth = CUT_LINE.width;
    c.setLineDash(cutDash);
    c.beginPath();
    c.ellipse(OVAL.x, OVAL.y, CUT_LINE.rx, CUT_LINE.ry, 0, -Math.PI / 2, 1.5 * Math.PI);
    c.stroke();
    c.setLineDash([]);
  };
  /** The hole she leaves: through to the page beneath (its print, or its marks), with the page's thickness shading its
   *  edge (RIM). */
  const drawHole = (c: CanvasRenderingContext2D, layer: 'print' | 'marks') => {
    if (layer === 'print') knockout(c, (k) => { ellipse(k, CUT_LINE.rx, CUT_LINE.ry); k.fill(); });
    c.save();
    ellipse(c, CUT_LINE.rx, CUT_LINE.ry);
    c.clip();
    c.save();
    if (layer === 'print') under.drawPrint('L', c, underAt);
    else under.drawMarks('L', c, underAt);
    c.restore();
    if (layer === 'print') {
      c.strokeStyle = rgba('ink', RIM.amt);
      c.lineWidth = 2 * RIM.w;
      c.filter = `blur(${(RIM.w / 3) * c.getTransform().a}px)`; // (a filter's blur is in canvas px)
      ellipse(c, CUT_LINE.rx, CUT_LINE.ry);
      c.stroke();
    }
    c.restore();
  };
  // ---- the left page: the obituary, cut out of the black ----
  const drawLeft = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink');
    c.fillRect(0, 0, 770, 1000);
    knockout(c, (k) => { // the title, outlined like the cut lyrics (its hairlines, the italic's joins)
      k.font = font(ITALIC, 96);
      k.textAlign = 'center';
      k.fillText('In Memoriam', 385, 176);
      k.lineWidth = HAIRLINE_PU;
      k.lineJoin = 'round';
      k.strokeText('In Memoriam', 385, 176);
    });
    knockout(c, (k) => { ellipse(k, OVAL.rx, OVAL.ry); k.fill(); });
    drawCutLine(c); // (on the bare paper)
    if (s.cut === 0) {
      drawBust(c);
      // the slit behind the scissors, along the line as they cut it
      const along = (s.snip < 0 ? 1 : s.snip) * cutLen;
      if (along > 0) {
        c.strokeStyle = rgba('ink', 0.8);
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(cutPath[0]!.x, cutPath[0]!.y);
        for (let i = 1; i < cutPath.length && cutLens[i]! < along; i++) c.lineTo(cutPath[i]!.x, cutPath[i]!.y);
        const e = pointAtLength(cutPath, cutLens, along);
        c.lineTo(e.x, e.y);
        c.stroke();
      }
    } else drawHole(c, 'print');
    if (s.snip >= 0) { // the scissors on the cut line, cutting it clockwise at an even speed
      const p = pointAtLength(cutPath, cutLens, s.snip * cutLen); // (its angle: the line's tangent there)
      c.save();
      // `inset` along the inward normal (the tangent turned a quarter clockwise, on screen)
      c.translate(p.x - SNIP.inset * Math.sin(p.angle), p.y + SNIP.inset * Math.cos(p.angle));
      c.rotate(p.angle - SCISSORS_AXIS);
      c.scale(SNIP.scale, SNIP.scale);
      c.translate(-SCISSORS_ROOT.x, -SCISSORS_ROOT.y);
      c.strokeStyle = rgba('graphite');
      drawArt(c, scissors, [1], SNIP.width / SNIP.scale);
      c.restore();
    }
    // the epitaph, cut: a ghost (dark grey on the black) cutting through to bare paper as it's sung
    setLine(c, L1, t, 385, 742, { family: ITALIC, size: SIZE.epitaph, align: 'center', cut: true, hairline: true });
    setLine(c, L2, t, 385, 806, { family: ITALIC, size: SIZE.epitaph, align: 'center', cut: true, hairline: true });
    knockout(c, (k) => { // the dates, cut through to bare paper (small mono on black: TREATMENT §6)
      const text = '1997 — TONIGHT · SURVIVED BY ONE JACKET', ls = 3;
      k.font = font(SMALL.family, 11);
      k.letterSpacing = `${ls}px`;
      k.textAlign = 'left';
      // centred on its letters: the canvas's spacing trails the last letter too
      k.fillText(text, 385 - (k.measureText(text).width - ls) / 2, 872);
      k.letterSpacing = '0px';
    });
    knockout(c, (k) => drawFolio(k, 'L', pages[0])); // cut as deep as the other folios print: drawFolio's 0.85
    if (s.peel >= 0) drawCutShadow(c, { ...cutout, peel: s.peel, fly: s.fly }, (a) => rgba('ink', a), SHADOW);
  };

  /** SPLIT, whole or torn (TEAR): each half in bands, shifted aside by the lens's share at its height behind the tear's
   *  front and clipped to its side of the tear; the rift between them; the paper's white core along its edges. */
  const drawSplit = (c: CanvasRenderingContext2D, run: number, open: number) => {
    const word = () => drawStretch(c, 'SPLIT', 40, 330, SIZE.split, 5, { width: 690 });
    c.fillStyle = rgba('ink');
    if (run <= 0) { word(); return; }
    const front = TEAR.y0 + (TEAR.y1 - TEAR.y0) * run;
    /** How far each half is pulled aside at height y (pu). */
    const aside = (y: number) => (y >= front ? 0 : open * TEAR.open * Math.sin(Math.PI * clamp((y - TEAR.y0) / (front - TEAR.y0))));
    const half = (side: -1 | 1) => {
      const far = side < 0 ? -10 : PAGE.w + 10;
      c.beginPath();
      c.moveTo(far, TEAR.y0 - 1);
      for (const p of tearPath) c.lineTo(p.x, p.y);
      c.lineTo(far, TEAR.y1 + 1);
      c.closePath();
    };
    // SPLIT lies within the tear's span (its caps 158-330): the bands cover it all. Each overlaps the next by a pu, so
    // their anti-aliased edges never leave a seam through the ink
    for (let y = TEAR.y0; y < TEAR.y1; y += TEAR.slice) {
      const d = aside(y + TEAR.slice / 2);
      for (const side of [-1, 1] as const) {
        c.save();
        c.beginPath();
        c.rect(-10, y, PAGE.w + 20, TEAR.slice + 1);
        c.clip();
        c.translate(side * d, 0);
        half(side);
        c.clip();
        word();
        c.restore();
      }
    }
    // the rift, and the tear's edges, down to its front
    const tear = tearPath.filter((p) => p.y <= front);
    if (tear.length < 2) return;
    c.save();
    c.beginPath();
    tear.forEach((p, i) => (i ? c.lineTo(p.x - aside(p.y), p.y) : c.moveTo(p.x - aside(p.y), p.y)));
    for (let i = tear.length - 1; i >= 0; i--) c.lineTo(tear[i]!.x + aside(tear[i]!.y), tear[i]!.y);
    c.closePath();
    knockout(c, (k) => k.fill()); // (through to bare paper: the halves' ink is drawn across the rift)
    c.save();
    c.clip();
    c.save();
    next.drawPrint('R', c, nextAt);
    c.restore();
    c.fillStyle = rgba('ink', TEAR.amt);
    c.fillRect(0, 0, PAGE.w, PAGE.h);
    c.restore();
    c.strokeStyle = rgba('paper');
    c.lineWidth = TEAR.fibre;
    c.lineJoin = 'round';
    for (const side of [-1, 1]) {
      c.beginPath();
      tear.forEach((p, i) => (i ? c.lineTo(p.x + side * aside(p.y), p.y) : c.moveTo(p.x + side * aside(p.y), p.y)));
      c.stroke();
    }
    c.restore();
  };

  // ---- the right page: the notices ----
  const drawRight = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillStyle = rgba('ink');
    c.font = font(SMALL.family, SMALL.size);
    c.letterSpacing = '4px';
    c.fillText('NOTICES', 58, 110);
    c.letterSpacing = '0px';
    drawSplit(c, s.run, s.open);
    setLine(c, L3, t, 58, 418, { family: ITALIC, size: SIZE.lyric3, hairline: true });
    c.fillStyle = rgba('ink');
    c.font = font(SMALL.family, SMALL.size);
    c.letterSpacing = '1.5px';
    c.fillText('EFFECTIVE IMMEDIATELY · NO FURTHER COMMENT', 58, 452);
    c.fillRect(58, 489.6, 664, 0.8);
    c.letterSpacing = '2px';
    for (const n of NOTICES) c.fillText(n.label, n.x, 528);
    c.letterSpacing = '0px';
    for (const n of NOTICES) n.lines.forEach((l, i) => noticeLine(c, l, n.x, 554 + i * 20, NOTICE.family, NOTICE.size));
    drawFolio(c, 'R', pages[1]);
  };

  /** A quantised value as its step index, for the keys (short, and exactly as distinct as the values). */
  const step = (x: number, n: number) => Math.round(x * n);
  return {
    id: 'memoriam', section, pages,
    drawPrint(side, c, t) {
      if (side === 'L') drawLeft(c, t, state(t));
      else if (side === 'R') drawRight(c, t, state(t));
      else { drawCutLine(c); drawBust(c); } // 'C': her, loose, as she lay in the page
    },
    drawMarks(side, c, t) {
      if (side === 'L') { if (state(t).cut > 0) drawHole(c, 'marks'); return; }
      if (side !== 'R') return; // ('C': she has none)
      writeAt(t).forEach((f, i) => {
        if (f <= 0) return;
        const l = WRITE.lines[i]!, st = writeText()[i]!;
        c.save();
        c.translate(l.x, l.y);
        c.rotate(WRITE.rot);
        lipstickWrite(c, st, f * st.total, { width: l.width, seed: l.seed });
        c.restore();
      });
    },
    key(side, layer, t) {
      if (side === 'L') {
        const s = state(t);
        return layer === 'marks' ? `${s.cut > 0 ? 1 : 0}`
          : `${step(s.snip, snipSteps)},${s.cut},${step(s.peel, STEPS.shadow)},${step(s.fly, STEPS.shadow)},${karaokeKey([L1, L2], t)}`;
      }
      if (side === 'R') {
        if (layer === 'marks') return writeAt(t).map((f) => step(f, STEPS.write)).join(',');
        const s = state(t);
        return `${step(s.run, STEPS.run)},${step(s.open, STEPS.open)},${karaokeKey([L3], t)}`;
      }
      return 'her'; // 'C': she doesn't change
    },
    camera, focus, cutout,
  };
};
