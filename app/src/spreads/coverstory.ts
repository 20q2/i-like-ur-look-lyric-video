// Spread 3, The Cover Story (chorus 1, pp. 6–7): the feature the cover sells ("HIM, WORN WELL — P. 6"), in house style
// B · Grand, laid out as the approved animatic:
// - giant Bodoni "I LIKE / YOUR LOOK", printing word by word;
// - "it's so", then EXTREME stepping out through Archivo's six widths, on sixteenths, until it spans the spread;
// - a film strip across the spread, him (the jacket) walking it, one frame per word of "You walk the street so
//   effortlessly", the words captioned under the frames, cut out of the band;
// - her, cut out of the type on "She wears you well" (the scissors ride her cut line), and the jacket drawn onto her
//   on "but can't you see?";
// - the lipstick writing "better on me" across her, then, back on the whole spread, underlining the printed words.
// Positions are the animatic's, in spread units (the right page's at x − PAGE.w). What crosses the gutter (EXTREME,
// the strip) is drawn on both faces at its own offset, and each canvas clips its own half.
import { makeDrawing, partial } from '../engine/drawing';
import { PAGE, type Side, drawFolio, ghostAlpha, inkAt, karaokeKey, setLine, setRows, subLine, wordInkKey } from '../engine/layout';
import { lipstickStroke, lipstickWrite } from '../engine/lipstick';
import type { Word } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { STRETCH_STEPS, drawStretch, filmStrip, knockout, stretchFamily } from '../engine/print';
import { type StrokeText, strokeText, writtenLength } from '../engine/stroke';
import { F, font, measure } from '../engine/type';
import { type V2, clamp, ease, prog } from '../engine/util';
import { ART, type ArtDrawing, HER, JACKET_NECK, OUTLINE, SCISSORS_AXIS, SCISSORS_ROOT, artDrawings, drawArt } from './art';
import { sectionLine } from './cues';
import { charTimes } from './marks';
import { type Box, type Shot, director, downbeatAtOrAfter, downbeatAtOrBefore, eighthAtOrAfter, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, pageToWorld, turnOut } from './spread';

const GIANT = F.bodoni(900), ITALIC = F.bodoni(400, { italic: true }), TEXT = F.bodoni(400, { text: true });
/** Cap heights per pu of size (the fonts' OS/2 sCapHeight): display type's size for the guards (FocusBox.size). */
const CAP = { bodoni: 0.75, archivo: 0.686 } as const;

// ---- the left page's small type and the headline (spread units) ----
/** THE COVER STORY: small mono meant to be read, Plex Mono 600 at 10.5 pu (TREATMENT §6), tracked 4 pu. 'Cause, the
 *  kicker over "I LIKE", 14 pu higher than the animatic's, whose baseline (88) sat on the I's top serif (83.5), with
 *  the head above it moved up to match. "it's so" set as one run, a word space apart (the animatic's 140 for "so" left
 *  two). Both in the display italic, outlined: "it's" for its t's crossbar (TREATMENT §2), 'Cause to match it. */
const HEAD = { x: 48, y: 34, size: 10.5, tracking: 4 } as const;
const CAUSE = { x: 48, y: 74, size: 42 } as const, ITS_SO = { x: 48, y: 586, size: 54 } as const;
/** "I LIKE": 40..730 on the left page, I and LIKE condensed alike (the animatic squeezed the I to 0.77 of its width
 *  and LIKE to 0.84, so the I's stem came out thinner than the L's), a word space between them. */
const ILIKE = { x: 40, w: 690, y: 268, size: 246, gap: 54 } as const;
/** YOUR and LOOK: each its own width (spread x; LOOK on the right page). */
const YOUR = { x: 14, y: 500, size: 236, width: 724 } as const, LOOK = { x: 798, y: 500, size: 236, width: 728 } as const;
/** EXTREME: Archivo stepped from its narrowest (left page alone) to its widest, spanning x 48..1492. */
const EXTREME = { x: 48, y: 722, size: 150, width: 1444 } as const;

// ---- the strip ----
/** The film strip's band, and its frame windows' row (spread units). */
const STRIP = { y: 744, h: 176 } as const;
const WINDOW = { y: 766, w: 228, h: 107 } as const;
/** The strip's frames, one per word of lyric 2: each window's left edge (spread x), its street, and him in it, the
 *  jacket's neck at `walk` of the window's width. He crosses the strip left to right, 8 pu clear of the windows' edges at
 *  both ends (the animatic's .12 and .90 put a sleeve on the last window's edge). */
const FRAMES = [
  { x: 48, walk: 0.14, art: ART.street0 }, { x: 290, walk: 0.284, art: ART.street1 }, { x: 532, walk: 0.428, art: ART.street2 },
  { x: 818, walk: 0.572, art: ART.street3 }, { x: 1058, walk: 0.716, art: ART.street4 }, { x: 1298, walk: 0.86, art: ART.street5 },
] as const;
/** Him in a frame: the jacket at `k`, its neck `y` down the band; in step, he swings a little each way about his neck
 *  (`swing`, radians) and rises `rise` pu between strides. */
const HIM = { k: 0.171, y: 774.6, swing: 0.035, rise: 1.2 } as const;
/** The streets' lines, times art.ts's weights: at the window's scale (228/320) its windows' 0.6 drew under half a pu,
 *  grey at the spread framing. */
const STREET_WEIGHT = 1.25;
/** The captions: 26 pu, cut out of the band, centred under each window on baseline `y`: the text cut, whose hairlines
 *  hold at that size (TREATMENT §2). Their box (focus) runs a size above the baseline and a third of it below. */
const CAPTION = { family: F.bodoni(400, { italic: true, text: true }), size: 26, y: 896 } as const;

// ---- her, and the jacket on her ----
/** HER's units placed at (x, y) on the right page, scaled `k` (150 pu wide); the jacket on her at `jacket`, its neck at
 *  `neck` (HER's units). */
const HER_AT = { x: 1180 - PAGE.w, y: 56, k: 150 / 144, jacket: 0.47, neck: { x: 608, y: 360 } } as const;
/** ART.scissors riding her cut line by their root (art.ts), turned to its direction of travel, the blades leading:
 *  `scale` times the cover's mark, to read while they move. */
const SNIP = { scale: 1.35 } as const;
/** Lyric 3, in the display italic, over two rows. */
const L3_AT = { x: 70, rows: [130, 180], size: 40 } as const;
/** The knockout on "well,": her shape cut out of the print under her, from nothing to whole over this long (s). */
const KNOCK_S = 0.15;

// ---- the lipstick ----
/** "better on me" in the lipstick, in the narrator's hand (TREATMENT §2: Hershey Script), its baseline from (x, y)
 *  rising at 16°: 104 pu, from 16 pu left of the animatic's start (this hand is wider than the animatic's Allura: at 112
 *  pu from x 270 its e ran off the page). */
const WRITE = { x: 254, y: 380, rot: (-16 * Math.PI) / 180, size: 104, font: 'hscript' } as const;
const LIP_TEXT = 'better on me';
/** The lipstick's pen, and its underline's: drawn over `ulS` on the first beat or eighth after the camera is back on
 *  the spread, so it's seen being drawn. */
const LIP = { width: 6, seed: 31, ulSeed: 32, ulS: 0.35 } as const;
/** Where the lipstick writes: the extent of LIP_TEXT's stroke text turned by WRITE.rot, from WRITE's point, per pu of
 *  WRITE.size (it scales with the size: the scripts aren't kerned). The camera's box for it (focus) is this, placed and
 *  scaled by WRITE, with half the brush round it (a dab's reach across its stroke; their jitter adds 3% of the width).
 *  Measured, not computed here: the stroke fonts load in the browser, and the factory must build without them (the
 *  guards build every spread under bun). So lazy() measures it again, on first use, and throws if it has gone stale. */
const WRITE_INK = Object.freeze({ x0: -0.0352, y0: -1.5848, x1: 4.7118, y1: -0.0261 });
/** Lyric 4, in the text cut on the right page; the underline `ul` below its baseline. */
const L4_AT = { x: 58, y: 960, size: 30, ul: 972 } as const;
/** Where the printed "better on me" lies in lyric 4 (right page x, from its b to its e): what the underline is drawn
 *  under. Measured (its width needs the fonts, which the factory builds without), and checked in lazy(). */
const BETTER_AT = Object.freeze({ b: 395.905, e: 570.175 });

/** Quantisation steps: every animated value is a whole number of these, in the keys and in the drawing alike. */
const STEPS = Object.freeze({ cut: 96, knock: 8, jacket: 48, write: 64, ul: 24 });

/** The extent of `strokes` turned by `rot` (about their origin). */
function turnedExtent(strokes: readonly (readonly V2[])[], rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) {
    for (const p of st) {
      const x = p.x * c - p.y * s, y = p.x * s + p.y * c;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}
/** A box, rounded outward to whole pu (what it holds stays inside it). */
const outward = (b: Box): Box => [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
/** A box round points, `pad` out. */
function boxOf(pts: readonly V2[], pad: number): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return outward([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
}
/** A face's offset in spread units, and whether something from spread x over `w` lies on that face. */
const offOf = (side: Side) => (side === 'R' ? PAGE.w : 0);
const onFace = (side: Side, x: number, w: number) => x - offOf(side) + w > 0 && x - offOf(side) < PAGE.w;
/** A spread x on its page: its side, and its page x. */
const onPage = (x: number): { side: Side; u: number } => (x < PAGE.w ? { side: 'L', u: x } : { side: 'R', u: x - PAGE.w });
/** A lyric word as display type: its letters only (no comma), upper case. */
const caps = (w: Word) => w.w.replace(/[^\p{L}]/gu, '').toUpperCase();
type Words8 = [Word, Word, Word, Word, Word, Word, Word, Word];

export const coverstory: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = sectionLine(lyrics, section, "'Cause I like your look, it's so extreme");
  const L2 = sectionLine(lyrics, section, 'You walk the street so effortlessly');
  const L3 = sectionLine(lyrics, section, "She wears you well, but can't you see");
  const L4 = sectionLine(lyrics, section, 'That you definitely look better on me');
  for (const [l, n] of [[L1, 8], [L2, FRAMES.length], [L3, 8], [L4, 8]] as const) {
    if (l.words.length !== n) throw new Error(`coverstory: "${l.text}" has ${l.words.length} words, the layout sets ${n}`);
  }
  const [cause, i, like, your, look, its, so, extreme] = L1.words as Words8;
  const [she, wears, , well, but, cant] = L3.words as Words8;
  const [that, you, , , better, on, me] = L4.words as Words8;
  const beat = 60 / audio.bpm;
  const causeLine = subLine(L1, 0, 1), itsSo = subLine(L1, 5, 7), extremeText = caps(extreme);
  /** Each character of "better on me" over its sung word (pure: a lyric that stops matching fails here, under bun too). */
  const writeTimes = charTimes(LIP_TEXT, [better, on, me]);

  // ---- drawings (pure geometry: built here) ----
  /** The strip's frames, each with its word, its street drawing, and its window's centre in world x (its shot's). */
  const frames = FRAMES.map((f, k) => {
    const c = onPage(f.x + WINDOW.w / 2);
    return { ...f, word: L2.words[k]!, street: artDrawings(f.art, 300 + 17 * k), wx: pageToWorld(c.side, c.u, 0).x };
  });
  /** The frames whose window lies on a face (their words key it: him appearing, their captions cut). */
  const faceFrames = (side: Side) => frames.filter((f) => onFace(side, f.x, WINDOW.w));
  /** Him walking the strip: the jacket's outline, lapels and pockets only (at 0.171 its stitches and hatching would be
   *  grey fuzz), in the animatic's weights (its units: 7, 5.3, 4.5 → ~1.2, 0.9, 0.8 pu). */
  const him: ArtDrawing[] = artDrawings(ART.jacket, 200).slice(0, 3).map((g, k) => ({ ...g, width: [7, 5.3, 4.5][k]! }));
  const herLine = artDrawings(ART.her, 210), snips = artDrawings(ART.scissors, 220), herJacket = artDrawings(ART.jacket, 230);
  /** The jacket goes on her group by group over "but can't you see?", each group over a share of the line as long as
   *  its share of the drawing (the pen moving at one speed), each stroked on an ease-out, as the cover's. */
  const jkWin = (() => {
    const a = but.start, b = L3.end, lens = herJacket.map((g) => g.d.total), sum = lens.reduce((x, y) => x + y, 0);
    let acc = 0;
    return lens.map((len) => { const w: [number, number] = [a + ((b - a) * acc) / sum, a + ((b - a) * (acc + len)) / sum]; acc += len; return w; });
  })();
  /** The underline under the printed "better on me": in a touch before the b, sagging, and lifting off past the e
   *  (the animatic's curve). */
  const underline = (() => {
    const { b, e } = BETTER_AT, y = L4_AT.ul;
    const d = makeDrawing([`M${b - 3} ${y} C${b + (e - b) * 0.33} ${y + 8} ${b + (e - b) * 0.75} ${y + 7} ${e + 3} ${y - 2}`]);
    return { pts: d.strokes[0]!, len: d.total };
  })();

  // ---- lazily built (font-dependent, DOM); and what the factory derived without the fonts, checked against them ----
  let cache: { herPath: Path2D; jacketPath: Path2D; write: StrokeText } | null = null;
  const lazy = () => {
    if (cache) return cache;
    const write = strokeText(LIP_TEXT, WRITE.font, WRITE.size);
    const ink = turnedExtent(write.strokes, WRITE.rot), K = WRITE.size, sides = ['x0', 'y0', 'x1', 'y1'] as const;
    if (sides.some((k) => Math.abs(ink[k] - WRITE_INK[k] * K) > 0.5)) {
      throw new Error(`coverstory: the lipstick's "${LIP_TEXT}" now lies at [${sides.map((k) => (ink[k] / K).toFixed(4)).join(', ')}] per pu of WRITE.size, not WRITE_INK's [${sides.map((k) => WRITE_INK[k]).join(', ')}]: measure it again (the camera's box for it is derived from it)`);
    }
    const b = L4_AT.x + measure('That you definitely look ', TEXT, L4_AT.size), e = b + measure(LIP_TEXT, TEXT, L4_AT.size);
    if (Math.abs(b - BETTER_AT.b) > 0.5 || Math.abs(e - BETTER_AT.e) > 0.5) {
      throw new Error(`coverstory: lyric 4's "${LIP_TEXT}" now prints from x ${b.toFixed(1)} to ${e.toFixed(1)}, not BETTER_AT's ${BETTER_AT.b} to ${BETTER_AT.e}: measure it again (the underline is drawn under it)`);
    }
    // the right face's key leaves EXTREME out at its first step: its narrowest must stay on the left page
    if (EXTREME.x + measure(extremeText, stretchFamily(0), EXTREME.size) > PAGE.w) throw new Error('coverstory: EXTREME at its narrowest crosses the gutter, which key() says it does not');
    return (cache = { herPath: new Path2D(HER[0]), jacketPath: new Path2D(OUTLINE[0]), write });
  };

  // ---- the camera: the animatic's Snap, each move a quarter-second snap from a word's cue, looking down ----
  const P = (x: number, y: number, dist: number, tilt: number, roll: number) => ({ pose: { x, y, dist, tilt, roll } });
  /** Her on the page (ART.her's box placed by HER_AT), and the scissors' reach about the point of her cut line they
   *  ride (their art's box about its root, scaled, at any turn): where they cut her out. */
  const herBox = (() => {
    const [a, b, c, d] = ART.her.box, [p, q, r, s] = ART.scissors.box, k = HER_AT.k;
    const reach = Math.max(...[[p, q], [r, q], [p, s], [r, s]].map(([x, y]) => Math.hypot(x! - SCISSORS_ROOT.x, y! - SCISSORS_ROOT.y))) * SNIP.scale * k;
    return outward([HER_AT.x - reach, HER_AT.y - reach, HER_AT.x + (c - a) * k + reach, HER_AT.y + (d - b) * k + reach]);
  })();
  /** Lyric 3's two rows (right page). */
  const l3Box: Box = [66, 98, 406, 190];
  /** "extreme" lands on the downbeat as it stretches (the animatic's longer move), if that downbeat comes before the
   *  strip's first shot starts; if it doesn't (the word sung just after a downbeat, so the next is a bar away), it's a
   *  plain snap. */
  const extremeDown = downbeatAtOrAfter(audio, extreme.start);
  /** Back to the spread a bar before the turn (the turn is on a section's downbeat): the last downbeat at least a beat
   *  before it, landing on the beat after. */
  const back = downbeatAtOrBefore(audio, turnAt - beat);
  const shots: Shot[] = [
    { at: i, frame: P(-0.4, 0.8, 1.15, 0.1, -0.02) }, // "I": close on I LIKE
    { at: your, frame: P(0, 0.58, 1.8, 0.1, 0) }, // "your": wide on YOUR LOOK (the animatic's 1.75 put LOOK's K inside the 3% margin on the downbeat's punch)
    { at: its, frame: P(-0.58, 0.45, 0.95, 0.1, 0.02) }, // "it's": close on it's so
    { at: extreme, frame: P(0, 0.34, 1.95, 0.1, 0), ...(extremeDown < resolveAt(frames[0]!.word) ? { until: extremeDown } : {}) }, // "extreme": wide as it stretches
    ...frames.map((f): Shot => ({ at: f.word, frame: P(f.wx, 0.16, 0.9, 0.1, 0) })), // one film frame per word
    // "She": her whole, being cut out, and lyric 3 (the animatic's close pose lost her legs, and the scissors with them)
    { at: she, frame: { side: 'R', box: [Math.min(l3Box[0], herBox[0]), Math.min(l3Box[1], herBox[1]), Math.max(l3Box[2], herBox[2]), Math.max(l3Box[3], herBox[3])] }, angle: 0.1, roll: 0.02 },
    { at: but, frame: P(0.3, 0.8, 0.95, 0.1, -0.01) }, // "but": close on lyric 3, the jacket going on
    { at: that, frame: P(0.36, 0.3, 1.7, 0.1, 0) }, // "That": wide on the right page, lyric 4
    { at: better, frame: P(0.47, 0.64, 1.0, 0.1, -0.02) }, // "better": close on the lipstick
    { at: back, frame: 'spread', move: 'land' }, // back to the spread
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt }); // (the same plan: when each shot starts and lands)
  /** The move a shot's cue starts (as planned: a word cue leads its word by LEAD). */
  const moveOn = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.findLast((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`coverstory: no shot starts on ${typeof cue === 'number' ? cue.toFixed(3) : `"${(cue as Word).w}"`}`);
    return m;
  };
  /** When words can first be read: their first word's start, or, if the camera is still moving then, where that move
   *  lands, but never later than their second word's start (for a single word, its end). (The move in flight is the
   *  last one started, as the director evaluates them.) */
  const settled = (ws: readonly Word[]) => {
    const w0 = ws[0]!, m = moves.findLast((x) => x.at <= w0.start), latest = ws[1]?.start ?? w0.end;
    return m && w0.start < m.land ? Math.min(m.land, latest) : w0.start;
  };
  /** When the camera next leaves, after t: the next move's start. */
  const leaves = (t: number) => moves.find((m) => m.at > t)?.at ?? turnAt;
  /** The underline is drawn back on the spread: from the first beat or eighth at or after the pull-back lands. */
  const ulFrom = eighthAtOrAfter(audio, moveOn(back).land), ulTo = Math.min(ulFrom + LIP.ulS, turnAt);

  // ---- every animated value, as whole steps (the keys and the drawing share them) ----
  const steps = (x: number, n: number) => Math.round(x * n);
  /** EXTREME's width step: on "extreme", one a sixteenth, 0 → the last. */
  const stepAt = (t: number) => (t >= extreme.start ? clamp(Math.floor((t - extreme.start) / (beat / 4)), 0, STRETCH_STEPS) : 0);
  const state = (t: number) => ({
    step: stepAt(t),
    cut: steps(prog(t, she.start, well.start), STEPS.cut),
    knock: steps(prog(t, well.start, well.start + KNOCK_S), STEPS.knock),
    jacket: jkWin.map(([a, b]) => steps(prog(t, a, b, ease.outCubic), STEPS.jacket)),
  });
  const marksAt = (t: number) => {
    const w = lazy().write;
    return { write: steps(writtenLength(w, writeTimes, t) / w.total, STEPS.write), ul: steps(prog(t, ulFrom, ulTo), STEPS.ul) };
  };

  // ---- drawing ----
  /** A giant word printed at its ink, condensed or widened by `kx` from its natural advance. */
  const drawGiant = (c: CanvasRenderingContext2D, text: string, ink: number, x: number, y: number, size: number, kx: number) => {
    c.save();
    c.translate(x, y);
    c.scale(kx, 1);
    c.font = font(GIANT, size);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink', ghostAlpha(ink));
    c.fillText(text, 0, 0);
    c.restore();
  };
  const drawGiants = (c: CanvasRenderingContext2D, side: Side, t: number) => {
    if (side === 'L') {
      // "I LIKE" condensed as one line: both words by the same factor, so the I's stem matches the L's, and the gap
      // between them a word space at that scale
      const nI = measure(caps(i), GIANT, ILIKE.size), nL = measure(caps(like), GIANT, ILIKE.size), k = (ILIKE.w - ILIKE.gap) / (nI + nL);
      drawGiant(c, caps(i), inkAt(i, t), ILIKE.x, ILIKE.y, ILIKE.size, k);
      drawGiant(c, caps(like), inkAt(like, t), ILIKE.x + nI * k + ILIKE.gap, ILIKE.y, ILIKE.size, k);
    }
    for (const [w, g] of [[your, YOUR], [look, LOOK]] as const) {
      const p = onPage(g.x);
      if (p.side !== side) continue;
      drawGiant(c, caps(w), inkAt(w, t), p.u, g.y, g.size, g.width / measure(caps(w), GIANT, g.size));
    }
  };
  const drawExtreme = (c: CanvasRenderingContext2D, side: Side, step: number, t: number) => {
    c.fillStyle = rgba('ink', ghostAlpha(inkAt(extreme, t)));
    drawStretch(c, extremeText, EXTREME.x - offOf(side), EXTREME.y, EXTREME.size, step, { width: EXTREME.width });
  };
  /** The strip on a face: the band and its windows, each window's street, him in the frames whose word has started,
   *  and the captions cut out under them. */
  const drawStrip = (c: CanvasRenderingContext2D, side: Side, t: number) => {
    const off = offOf(side);
    filmStrip(c, -off, STRIP.y, 2 * PAGE.w, STRIP.h, frames.map((f) => ({ x: f.x - off, y: WINDOW.y, w: WINDOW.w, h: WINDOW.h })));
    c.strokeStyle = rgba('ink');
    for (const [k, f] of frames.entries()) {
      if (!onFace(side, f.x, WINDOW.w)) continue;
      const x = f.x - off, s = WINDOW.w / (f.art.box[2] - f.art.box[0]);
      c.save();
      c.translate(x, WINDOW.y);
      c.scale(s, s);
      drawArt(c, f.street, [1, 1, 1, 1], STREET_WEIGHT);
      c.restore();
      if (inkAt(f.word, t) > 0) {
        c.save();
        c.translate(x + f.walk * WINDOW.w, HIM.y - (k % 2 ? HIM.rise : 0)); // (passing: up on the standing leg)
        c.rotate(HIM.swing * [1, 0, -1, 0][k % 4]!); // (each stride the hem swings back the other way)
        c.scale(HIM.k, HIM.k);
        c.translate(-JACKET_NECK.x, -JACKET_NECK.y);
        c.fillStyle = rgba('paper'); // (opaque: the street stops behind him)
        c.fill(lazy().jacketPath);
        drawArt(c, him, [1, 1, 1]);
        c.restore();
      }
    }
    setRows(c, L2, t, frames.map((f, k) => ({ x: f.x + WINDOW.w / 2 - off, y: CAPTION.y, words: [k, k + 1] as const })), { family: CAPTION.family, size: CAPTION.size, align: 'center', cut: true });
  };
  /** Her on the right page: cut out of the print under her, her cut line (the scissors at its head while it's cut),
   *  and the jacket going on, all in HER's units. */
  const drawHer = (c: CanvasRenderingContext2D, s: ReturnType<typeof state>) => {
    c.save();
    c.translate(HER_AT.x, HER_AT.y);
    c.scale(HER_AT.k, HER_AT.k);
    c.translate(-ART.her.box[0], -ART.her.box[1]);
    if (s.knock > 0) {
      const path = lazy().herPath;
      knockout(c, (k) => { k.fillStyle = `rgba(0,0,0,${s.knock / STEPS.knock})`; k.fill(path); });
    }
    if (s.cut > 0) {
      c.strokeStyle = rgba('graphite');
      c.save();
      if (s.jacket[0]! >= STEPS.jacket) { // the jacket on: its outline drawn whole, it hides her line where it covers her
        const her = c.getTransform(), p = new Path2D();
        c.translate(HER_AT.neck.x, HER_AT.neck.y);
        c.scale(HER_AT.jacket, HER_AT.jacket);
        c.translate(-JACKET_NECK.x, -JACKET_NECK.y);
        p.rect(-1e4, -1e4, 2e4, 2e4);
        p.addPath(lazy().jacketPath);
        c.clip(p, 'evenodd');
        c.setTransform(her);
      }
      drawArt(c, herLine, [s.cut / STEPS.cut]);
      c.restore();
      if (s.cut < STEPS.cut) {
        const d = herLine[0]!.d, segs = partial(d, (s.cut / STEPS.cut) * d.total), seg = segs[segs.length - 1]!, head = seg[seg.length - 1]!;
        // its direction: back along the line a few units (the last piece partial cut can be a sliver)
        let k = seg.length - 2;
        while (k > 0 && Math.hypot(head.x - seg[k]!.x, head.y - seg[k]!.y) < 3) k--;
        const from = seg[Math.max(0, k)]!, dir = Math.atan2(head.y - from.y, head.x - from.x);
        c.save();
        c.translate(head.x, head.y);
        c.rotate(dir - SCISSORS_AXIS);
        c.scale(SNIP.scale, SNIP.scale);
        c.translate(-SCISSORS_ROOT.x, -SCISSORS_ROOT.y);
        drawArt(c, snips, [1], 1 / SNIP.scale);
        c.restore();
      }
    }
    if (s.jacket.some((p) => p > 0)) {
      c.save();
      c.translate(HER_AT.neck.x, HER_AT.neck.y);
      c.scale(HER_AT.jacket, HER_AT.jacket);
      c.translate(-JACKET_NECK.x, -JACKET_NECK.y);
      c.strokeStyle = rgba('ink');
      drawArt(c, herJacket, s.jacket.map((p) => p / STEPS.jacket), 1 / (HER_AT.jacket * HER_AT.k)); // (the cover's line weights, in pu)
      c.restore();
    }
    c.restore();
  };

  // ---- what must read when (spec §3.3): each group of words from when it can first be read (settled) until its words
  // give way to the next group's or the camera leaves, whichever is first; and the drawings the lines are about (her
  // cut out, the strip's frames, the jacket on her, the lipstick's line and its underline) over their own spans. Type
  // gives its size (display type, its cap height); a drawing gives none. ----
  const read = (ws: readonly Word[], next: number, size: number, side: Side, box: Box): FocusBox => {
    const from = settled(ws);
    return { from, to: Math.min(next, leaves(from)), side, box, size };
  };
  /** The lipstick's line: WRITE_INK, placed and scaled by WRITE, with half the brush round it. */
  const writeBox: Box = (() => {
    const r = LIP.width / 2, K = WRITE.size;
    return outward([WRITE.x + WRITE_INK.x0 * K - r, WRITE.y + WRITE_INK.y0 * K - r, WRITE.x + WRITE_INK.x1 * K + r, WRITE.y + WRITE_INK.y1 * K + r]);
  })();
  /** The jacket on her: ART.jacket's box placed on her (its neck at HER_AT.neck, scaled), on the page, with half its
   *  widest line round it. */
  const jacketBox: Box = (() => {
    const [a, b, c, d] = ART.jacket.box, j = HER_AT.jacket, k = HER_AT.k;
    const page = (x: number, y: number) => ({ x: HER_AT.x + (HER_AT.neck.x + (x - JACKET_NECK.x) * j - ART.her.box[0]) * k, y: HER_AT.y + (HER_AT.neck.y + (y - JACKET_NECK.y) * j - ART.her.box[1]) * k });
    return boxOf([page(a, b), page(c, d)], Math.max(...ART.jacket.groups.map((g) => g.width)) / 2);
  })();
  /** Display type's size for the guards: its cap height (Bodoni's display cut; Archivo for EXTREME). */
  const capOf = (size: number) => size * CAP.bodoni, extremeSize = EXTREME.size * CAP.archivo;
  const l3From = settled(L3.words), l3To = Math.min(that.start, moveOn(that).at);
  const focus: FocusBox[] = [
    read([cause], i.start, capOf(CAUSE.size), 'L', [44, 38, 180, 80]),
    read([i, like], your.start, capOf(ILIKE.size), 'L', [36, 92, 734, 272]),
    read([your], look.start, capOf(YOUR.size), 'L', [10, 330, 742, 504]),
    read([look], its.start, capOf(LOOK.size), 'R', [24, 330, 760, 504]),
    read([its, so], extreme.start, capOf(ITS_SO.size), 'L', [44, 540, 230, 596]),
    read([extreme], L2.start, extremeSize, 'L', [44, 610, 770, 726]),
    read([extreme], L2.start, extremeSize, 'R', [0, 610, 726, 726]),
    ...frames.flatMap((f, k): FocusBox[] => {
      const w = onPage(f.x), next = L2.words[k + 1]?.start ?? she.start; // (a caption lies under its window, on its page)
      const caption = read([f.word], next, CAPTION.size, w.side, outward([w.u, CAPTION.y - CAPTION.size, w.u + WINDOW.w, CAPTION.y + CAPTION.size / 3]));
      return [caption, { from: caption.from, to: caption.to, side: w.side, box: [w.u, WINDOW.y, w.u + WINDOW.w, WINDOW.y + WINDOW.h] }]; // (him in his frame: a drawing)
    }),
    { from: l3From, to: l3To, side: 'R', box: l3Box, size: capOf(L3_AT.size) },
    { from: l3From, to: moveOn(but).at, side: 'R', box: herBox }, // her, cut out: the scissors' path, and the hole on "well," (a drawing)
    { from: settled([but, cant]), to: l3To, side: 'R', box: jacketBox }, // the jacket going on her (a drawing)
    read([that, you], better.start, L4_AT.size, 'R', [54, 932, 656, 972]),
    { from: settled([better, on]), to: moveOn(back).at, side: 'R', box: writeBox, size: WRITE.size }, // "better on me", written
    { from: moveOn(back).land, to: Math.min(L4.end, turnAt), side: 'R', box: [54, 932, 656, 972], size: L4_AT.size },
    { from: ulFrom, to: ulTo, side: 'R', box: boxOf(underline.pts, LIP.width / 2) }, // its underline, drawn (a drawing)
  ];

  return {
    id: 'coverstory', section, pages,
    drawPrint(side, c, t) {
      const s = state(t);
      c.textBaseline = 'alphabetic';
      if (side === 'L') {
        c.fillStyle = rgba('ink');
        c.font = font(F.mono(600), HEAD.size);
        c.textAlign = 'left';
        c.letterSpacing = `${HEAD.tracking}px`;
        c.fillText('THE COVER STORY', HEAD.x, HEAD.y);
        c.letterSpacing = '0px';
        setLine(c, causeLine, t, CAUSE.x, CAUSE.y, { family: ITALIC, size: CAUSE.size, hairline: true });
        setLine(c, itsSo, t, ITS_SO.x, ITS_SO.y, { family: ITALIC, size: ITS_SO.size, hairline: true });
      }
      drawGiants(c, side, t);
      // EXTREME: from its first step on, it reaches across the gutter (step 0 is the left page's alone: see key, lazy)
      if (side === 'L' || s.step >= 1) drawExtreme(c, side, s.step, t);
      if (side === 'R') {
        drawHer(c, s);
        setRows(c, L3, t, [{ x: L3_AT.x, y: L3_AT.rows[0], words: [0, 4] }, { x: L3_AT.x, y: L3_AT.rows[1], words: [4, 8] }], { family: ITALIC, size: L3_AT.size, hairline: true });
        setLine(c, L4, t, L4_AT.x, L4_AT.y, { family: TEXT, size: L4_AT.size });
      }
      drawStrip(c, side, t);
      // the right page's running head would run into L4 (the folio's line): its folio is the page number alone
      drawFolio(c, side, pages[side === 'L' ? 0 : 1], side === 'L' ? undefined : '');
    },
    drawMarks(side, c, t) {
      if (side !== 'R') return;
      const m = marksAt(t), z = lazy();
      if (m.write > 0) {
        c.save();
        c.translate(WRITE.x, WRITE.y);
        c.rotate(WRITE.rot);
        lipstickWrite(c, z.write, (m.write / STEPS.write) * z.write.total, { width: LIP.width, seed: LIP.seed });
        c.restore();
      }
      if (m.ul > 0) lipstickStroke(c, underline.pts, (m.ul / STEPS.ul) * underline.len, { width: LIP.width, seed: LIP.ulSeed });
    },
    key(side, layer, t) {
      if (layer === 'marks') { if (side !== 'R') return ''; const m = marksAt(t); return `${m.write},${m.ul}`; }
      const s = state(t), inks = (ws: readonly Word[]) => ws.map((w) => wordInkKey(w, t)).join('');
      const strip = inks(faceFrames(side).map((f) => f.word));
      if (side === 'L') return [inks([cause, i, like, your, its, so, extreme]), s.step, strip].join('|');
      return [
        inks([look]), s.step >= 1 ? `${s.step}${inks([extreme])}` : '-', s.cut, s.knock, s.jacket.join(','),
        karaokeKey([L3], t), strip, karaokeKey([L4], t),
      ].join('|');
    },
    camera, focus,
  };
};
