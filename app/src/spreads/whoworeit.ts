// Spread 9, Who Wore It Better? (bridge, pp. 18–19): the video's climax, in house style B
// A tabloid poll across the open spread: HER (right,
// the cover's cut line in the jacket, 51%) against ME (left, an empty frame where a photo would be, 49%), under a
// tilted "WHO WORE / IT BETTER?" banner. The hook ("He looks better, b-better on, on me", sung four times) prints as
// four tabloid captions stacking down the left page, each bigger than the last. The narrator can't let HER win: a
// tally mark for every "better"/"b-better", a harder circle round ME on every "on me", then she crosses out HER's
// 51%, writes ME 100%, and through the ad-lib stutters the marks go frantic — loops, cross-hatching, "ME ME ME" —
// until the rip (134 s before this spread for the engine's leaf-tear, wired up in the flatplan/book already: this
// module only has to leave the camera turn-ready).
import { HAIRLINE_PU, PAGE, type Row, type Side, drawFolio, ghostAlpha, inkAt, karaokeKey, setRows, subLine, textCutDashes } from '../engine/layout';
import { lipstickStroke, lipstickWrite } from '../engine/lipstick';
import type { Line } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { drawStretch } from '../engine/print';
import { strokeText, type StrokeText } from '../engine/stroke';
import { F, font } from '../engine/type';
import { type V2, clamp, ease, hash, noise1, polylineLengths, prog } from '../engine/util';
import { ART, artDrawings, drawArt, JACKET_NECK } from './art';
import { loopAround } from './marks';
import { type Box, type Shot, director, plan, resolveAt } from './shots';
import { type FocusBox, type Layer, type SpreadCtx, type SpreadFactory, turnOut } from './spread';

// ======================================================================== the layout (page units; spread x across
// the gutter, the right face at x − PAGE.w) ========================================================================

/** The banner, tilted, across both pages: "WHO WORE" in ink, then "IT BETTER?" cut out of a black bar beneath it
 *  (a tabloid masthead). Both lines stretched (Archivo, step 1: ARCHIVO_WIDTHS[1] = 75%) to the same width, edge to
 *  edge (spread x 48..1492), so the bar's width is exactly the stretch target: no text measurement needed for it. */
const BANNER = Object.freeze({
  tilt: (-3 * Math.PI) / 180, x0: 48, width: 1444, size: 170,
  y1: 170, y2: 349, barTop: 223, barBottom: 383,
});

/** Her: the cover's cut line (art.ts ART.her), scaled up (the cover's own 144 pu wide by HER_SCALE) and placed so her
 *  crown clears the banner; she bleeds off the page's foot (cropped at the canvas edge, upper-thigh), the "Grand"
 *  style's deliberate bleed, same idea as spread 1's boots filling the page. The jacket (ART.jacket) goes on her at
 *  the same ratio coverstory used (0.47) of her own scale. */
const HER_SCALE = 1.5, JACKET_SCALE = 0.47;
const HER_ORIGIN = { x: 283, y: 400 } as const;
/** Her neckline, in ART.her's own units (where coverstory's jacket anchors too): shared landmark, not re-measured. */
const HER_NECK = { x: 608, y: 360 } as const;
const HER_LABEL = { x: 58, y: 845, size: 74 } as const;
const HER_POLL = { x: 58, y: 878, size: 13, text: 'HER — 51%' } as const;

/** Me: an empty frame (just its rule), "ME" under it, the poll, and a tally cluster beside the frame — all a compact
 *  header, so the growing captions below can dominate the page (TREATMENT §6: lyric-heavy layouts lean toward the
 *  lamp, i.e. big). */
const FRAME: Box = [60, 400, 190, 470];
// "ME" at 50 pu (not 40): below ~45 pu the display cut's hairlines go sub-pixel (TREATMENT §2) — at 40 its bold
// italic M, mostly thick-thin contrast and no crossbar to restore, came out reading as "VIE".
const ME_LABEL = { x: 60, y: 517, size: 50 } as const;
const ME_POLL = { x: 60, y: 542, size: 11, text: 'ME — 49%' } as const;
/** The tally cluster: vertical strokes in gates of five (four bars, then a diagonal closing the gate), beside the
 *  frame. 8 marks: two per repeat (the comma "better," and "b-better"), so the second gate stays at three. */
const TALLY = { x: 210, y: 405, h: 38, gw: 7, gap: 11, width: 5 } as const;
/** Where the circle (loopAround) round "ME" lands: the label and poll, padded. */
const CIRCLE_ZONE: Box = [46, 468, 215, 552];
/** How much the circles round ME differ, one from the next (whoworeit's circleMarks). */
const CIRCLE_VARY = Object.freeze({ shift: 22, stretch: 0.22, grow: 0.45, turns: 0.4, width: 0.25 });

/** The four repeats of the hook, each set as two rows ("He looks better," / "b-better on, on me"), growing: 34, 40,
 *  48, 56 pu, stacking down the page. Computed from a running cursor (not hand-placed), so the gaps scale with the
 *  size and the whole stack is checked to fit above the bottom margin. */
const CAP_SIZES = [34, 40, 48, 56] as const;
const CAP_ROWGAP = 0.85, CAP_LEAD = 1.15, CAP_START_Y = 580, CAP_X = 58, CAP_BOTTOM_MAX = 928;
interface CapRow { size: number; y1: number; y2: number }
const CAPTION_ROWS: readonly CapRow[] = (() => {
  let y = CAP_START_Y;
  const out: CapRow[] = [];
  for (const size of CAP_SIZES) {
    const y1 = y, y2 = y1 + size * CAP_ROWGAP;
    out.push({ size, y1, y2 });
    y = y2 + size * CAP_LEAD;
  }
  return out;
})();
{
  const last = CAPTION_ROWS[CAPTION_ROWS.length - 1]!, bottom = last.y2 + last.size * 0.3;
  if (bottom > CAP_BOTTOM_MAX) throw new Error(`whoworeit: the captions reach y ${bottom.toFixed(1)}, past the bottom margin (${CAP_BOTTOM_MAX})`);
}
/** A caption's rows, cut out the words as setRows wants: "He looks better," (0..3), "b-better on, on me" (3..7). */
const capRows = (y1: number, y2: number): Row[] => [{ x: CAP_X, y: y1, words: [0, 3] }, { x: CAP_X, y: y2, words: [3, 7] }];
/** A caption's box: generous (no DOM measurement in the factory), the wider row's rough width at ~11 pu/char (actual
 *  Bodoni italic prose runs under that), capped to the page's text width. */
const capBox = (r: CapRow): Box => [CAP_X, r.y1 - r.size * 0.75, CAP_X + Math.min(664, r.size * 11), r.y2 + r.size * 0.3];

/** The cameras' zones: everything below the banner, on each page — generous, so every box above sits inside it. */
const ME_ZONE: Box = [45, 390, 715, 928];
const HER_ZONE: Box = [45, 390, 715, 1000];

// ======================================================================== the lipstick (Takeover) ===================

/** Quantisation steps for the pre-frantic marks' reveal progress (the keys and the drawing share them). */
const STEPS = Object.freeze({ tally: 16, circle: 24, strike: 16, write: 24 });
const TALLY_REVEAL_S = 0.18;
/** The crossing-out of HER's 51% and the rewrite of ME's 100%: back to back, between the last "me" and the ad-libs. */
const CROSS_WRITE = { crossFrom: 126.82, crossTo: 127.0, writeFrom: 127.0, writeTo: 127.3 } as const;
/** The frantic phase (batch-2 spec §4.6; the groove's own full-bounce window, TREATMENT/ENGINE's reading-calm note):
 *  a mark every sixteenth, tied to the beat grid so it doesn't depend on the ad-libs' (unlisted) word timing. */
const FRANTIC = { from: 127.3, to: 133.6 } as const;
/** The brush, throughout. */
const LIP = { width: 6 } as const;

/** A box, padded. */
const pad = (b: Box, r: number): Box => [b[0] - r, b[1] - r, b[2] + r, b[3] + r];
/** The smallest box round points. */
const bounds = (pts: readonly V2[]): Box => [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];

/** The i-th tally mark's path: a vertical bar in a gate of five, or (the fifth) a diagonal closing the gate. Gate 0 is
 *  the first five marks (whole: the four repeats give 8), gate 1 the rest (three, no closing diagonal yet). */
function tallyPath(i: number): V2[] {
  const gate = Math.floor(i / 5), pos = i % 5, gx = TALLY.x + gate * (4 * TALLY.gw + TALLY.gap);
  if (pos < 4) { const x = gx + pos * TALLY.gw; return [{ x, y: TALLY.y }, { x, y: TALLY.y + TALLY.h }]; }
  return [{ x: gx - 5, y: TALLY.y + TALLY.h + 6 }, { x: gx + 4 * TALLY.gw + 5, y: TALLY.y - 6 }];
}

/** One lipstick mark: a side, a window it's revealed over, a box it must read in while drawn, and how to draw it at
 *  progress 0..1. */
interface Mark { side: Side; from: number; to: number; box: Box; draw: (c: CanvasRenderingContext2D, p: number) => void; }

/** A part of a face that, once drawn, never changes: painted once (on first stamp) into a canvas over its own
 *  region and blitted back on every later redraw — the lipstick brush's cost (~3 ms a stroke) paid once per mark,
 *  not on every redraw of a face that holds many (a trimmed copy of getthelook.ts's Held: our boxes are always
 *  plain, known tuples, no DOM measurement needed to find them). */
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

/** A strike-through: the chord between a and b, bowed and given a hand's tremor (deterministic in seed). */
function strikePath(a: V2, b: V2, bow: number, seed: number, n = 24): V2[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n, off = bow * 4 * u * (1 - u) + 0.6 * noise1(u * 4, seed);
    return { x: a.x + dx * u + nx * off, y: a.y + dy * u + ny * off };
  });
}

/** A chaotic polyline that covers `box` (both pages): a sweep across a handful of waypoints spanning it corner to
 *  corner (so it reliably reaches both pages, not left to a random walk's luck), each gap filled with a noisy wobble
 *  — loops and cross-hatching, read from one continuous stroke revealed by length, far cheaper than re-stamping many
 *  short marks (the lipstick brush costs ~1 µs/pu: engine/lipstick.ts). */
function scribblePath(seed: number, box: Box): V2[] {
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
  const at = (u: number, v: number): V2 => ({ x: x0 + u * w, y: y0 + v * h });
  // a sweep spanning both pages several times over, visiting low and high, left and right, so the full stroke (at
  // the frantic phase's end) reads as scribbles over both of them, not a knot in one spot
  const waypoints: V2[] = [at(0.08, 0.2), at(0.92, 0.3), at(0.2, 0.75), at(0.78, 0.15), at(0.08, 0.55), at(0.95, 0.8), at(0.35, 0.9), at(0.6, 0.35), at(0.15, 0.1)];
  const pts: V2[] = [];
  const perLeg = 26;
  for (let leg = 0; leg < waypoints.length - 1; leg++) {
    const a = waypoints[leg]!, b = waypoints[leg + 1]!;
    const nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1; // the leg's normal, for the wobble
    for (let i = leg === 0 ? 0 : 1; i <= perLeg; i++) {
      const u = i / perLeg, s = leg * perLeg + i;
      // tapered off at each waypoint (u near 0 or 1) so the path still passes through all of them, wildest mid-leg
      const wob = Math.sin(Math.PI * u) * (28 + 14 * noise1(s * 0.3, seed));
      const jit = (noise1(s * 0.9, seed + 3) - 0.5) * 16;
      pts.push({ x: a.x + (b.x - a.x) * u + (nx / len) * (wob + jit), y: a.y + (b.y - a.y) * u + (ny / len) * (wob + jit) });
    }
  }
  return pts;
}

// ======================================================================== fonts =====================================
const GIANT_HEAD = F.bodoni(900, { italic: true });
const ITALIC = F.bodoni(400, { italic: true });
const ITALIC_DASH = F.bodoni(400, { italic: true, text: true }); // the text cut's hyphen (TREATMENT §2): "b-better" read "b better"
const SMALL = { family: F.mono(600) } as const; // >= 10.5 pu, read full ink (TREATMENT §6)
const CAP_FRAC = 0.75; // Bodoni Moda's display cap height, in em

/** A line of `section` matching `text`, its n-th occurrence (all four repeats of the hook are textually identical:
 *  cues.ts's sectionLine can't tell them apart, since it throws on more than one hit). */
function lineN(lyrics: { find(s: string): Line[] }, section: string, text: string, n: number): Line {
  const hits = lyrics.find(text).filter((l) => l.section === section);
  const l = hits[n];
  if (!l) throw new Error(`whoworeit: no occurrence ${n} of "${text}" in ${section} (found ${hits.length})`);
  return l;
}

export const whoworeit: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages, start } = ctx, turnAt = turnOut(ctx);
  const lines = [0, 1, 2, 3].map((n) => lineN(lyrics, section, 'He looks better, b-better on, on me', n));
  for (const l of lines) if (l.words.length !== 7) throw new Error(`whoworeit: "${l.text}" has ${l.words.length} words, expected 7`);
  const [L1, L2, L3, L4] = lines as [Line, Line, Line, Line];
  if (!(L4.end <= CROSS_WRITE.crossFrom + 1e-6)) throw new Error(`whoworeit: line 4 ends at ${L4.end}, after the cross-out starts (${CROSS_WRITE.crossFrom})`);
  const beat = 60 / audio.bpm, sixteenth = beat / 4;
  const franticSteps = Math.max(1, Math.round((FRANTIC.to - FRANTIC.from) / sixteenth));
  const franticStep = (t: number) => clamp(Math.ceil((t - FRANTIC.from) / sixteenth), 0, franticSteps);

  // ---- drawings (pure geometry: built here) ----
  const herLine = artDrawings(ART.her, 910), herJacket = artDrawings(ART.jacket, 920);

  // ---- the lipstick's marks, in time order: a tally mark on "better," and "b-better" of each repeat, a circle on
  // each "on me", then the cross-out and the rewrite. All but the cross-out are on the left (ME); the cross-out
  // alone is on the right (HER). ----
  const tallyMarks: Mark[] = lines.flatMap((L, li) => [2, 3].map((wi, k): Mark => {
    const i = li * 2 + k, w = L.words[wi]!, pts = tallyPath(i), box = pad(bounds(pts), TALLY.width);
    return { side: 'L', from: w.start, to: w.start + TALLY_REVEAL_S, box, draw: (c, p) => lipstickStroke(c, pts, p * polylineLengths(pts).at(-1)!, { width: TALLY.width, seed: 501 + i }) };
  }));
  const circleMarks: Mark[] = lines.map((L, i): Mark => {
    // each its own (the user found them too alike): its zone shifted up to CIRCLE_VARY.shift pu and stretched up to
    // `stretch` either way, looser by up to `grow`, round more or fewer times, and a heavier or lighter hand
    const on = L.words[5]!, me = L.words[6]!, sd = 601 + i, j = (k: number) => hash(sd, 20 + k) - 0.5, V = CIRCLE_VARY;
    const [u0, v0, u1, v1] = CIRCLE_ZONE, cx = (u0 + u1) / 2 + 2 * j(1) * V.shift, cy = (v0 + v1) / 2 + j(2) * V.shift;
    const hw = ((u1 - u0) / 2) * (1 + 2 * j(3) * V.stretch), hh = ((v1 - v0) / 2) * (1 + 2 * j(4) * V.stretch);
    const pts = loopAround([cx - hw, cy - hh, cx + hw, cy + hh], sd, { grow: 1.22 + (j(5) + 0.5) * V.grow, turns: 1.08 + (j(6) + 0.5) * V.turns });
    const width = LIP.width * (1 + 2 * j(7) * V.width), box = pad(bounds(pts), width);
    return { side: 'L', from: on.start, to: me.end, box, draw: (c, p) => lipstickStroke(c, pts, p * polylineLengths(pts).at(-1)!, { width, seed: sd }) };
  });
  // HER_POLL's box: a generous estimate (9 chars of Plex Mono 600 run under 0.65 em each), no DOM measurement in the
  // factory (the guards build every spread under bun: stroke fonts and canvas text metrics need the browser).
  const herPollBox: Box = [HER_POLL.x - 4, HER_POLL.y - HER_POLL.size * 0.85, HER_POLL.x + HER_POLL.size * 6.5, HER_POLL.y + HER_POLL.size * 0.3];
  const crossPts = strikePath({ x: herPollBox[0] + 2, y: (herPollBox[1] + herPollBox[3]) / 2 + 2 }, { x: herPollBox[2] - 2, y: (herPollBox[1] + herPollBox[3]) / 2 - 2 }, 3, 701);
  const crossMark: Mark = {
    side: 'R', from: CROSS_WRITE.crossFrom, to: CROSS_WRITE.crossTo, box: pad(herPollBox, LIP.width),
    draw: (c, p) => lipstickStroke(c, crossPts, p * polylineLengths(crossPts).at(-1)!, { width: LIP.width, seed: 702 }),
  };
  /** Written on the poll's line, clear of the loops round ME, big enough to read, before "ME ME ME" (MEME) runs on from its end. */
  const WRITE100 = { x: ME_POLL.x + 230, y: ME_POLL.y - 2, rot: -0.06, size: 62 } as const;
  /** "100%" in hscript at WRITE100.size: built on first real draw (strokeText needs the browser's stroke fonts). */
  let write100: StrokeText | null = null;
  const getWrite100 = () => (write100 ??= strokeText('100%', 'hscript', WRITE100.size));
  // its box: a generous estimate (4 glyphs at WRITE100.size), not measured (no fonts in the factory)
  const writeBox: Box = pad([WRITE100.x, WRITE100.y - WRITE100.size, WRITE100.x + WRITE100.size * 3.2, WRITE100.y + WRITE100.size * 0.3], LIP.width);
  const writeMark: Mark = {
    side: 'L', from: CROSS_WRITE.writeFrom, to: CROSS_WRITE.writeTo, box: writeBox,
    draw: (c, p) => { const z = getWrite100(); c.save(); c.translate(WRITE100.x, WRITE100.y); c.rotate(WRITE100.rot); lipstickWrite(c, z, p * z.total, { width: LIP.width, seed: 703 }); c.restore(); },
  };
  const allMarks: Mark[] = [...tallyMarks, ...circleMarks, crossMark, writeMark];
  const marksHeld = allMarks.map((m) => ({ ...m, held: new Held(m.box, (c) => m.draw(c, 1)) }));
  const markProgress = (m: Mark, t: number, steps: number) => Math.round(clamp(prog(t, m.from, m.to, ease.outQuad)) * steps) / steps;

  // ---- the frantic phase: one long wandering scribble and "ME ME ME", revealed by length on the sixteenth grid,
  // on both faces (they cross the gutter) ----
  const SCRIBBLE_BOX: Box = [60, 400, 2 * PAGE.w - 60, 960];
  const scribblePts = scribblePath(801, SCRIBBLE_BOX);
  const scribbleTotal = polylineLengths(scribblePts).at(-1)!;
  const MEME = { x: WRITE100.x + WRITE100.size * 3.2 + 24, y: 540, rot: -0.12, size: 92 } as const; // (from 100%'s end)
  let memeST: StrokeText | null = null;
  const getMeme = () => (memeST ??= strokeText('ME ME ME ME ME ME', 'hscript', MEME.size));

  // ---- the camera: Snap, holding the ME column through each repeat, whipping out to the whole spread on its
  // "b-better" (so HER is glimpsed too — never a HER-only box, which would drop the repeat's own caption, still
  // sung, out of frame), then alternating ME/HER through the ad-lib stutters, on every beat, groove at full ----
  const franticBeats = audio.beats.filter((b) => b > FRANTIC.from + 1e-6 && b < 132.5);
  const pullBackAt = 132.773; // a beat; lands (default 'land') on the next beat, 133.221, well before the rip (133.669)
  const shots: Shot[] = [
    { at: start, frame: { pose: { x: 0, y: 0.79, dist: 1.75, tilt: 0.55, roll: 0 } } }, // low along the banner, the reveal
    ...lines.flatMap((L): Shot[] => [
      { at: L.words[0]!, frame: { side: 'L', box: ME_ZONE } }, // "He looks": the ME column, its caption inking in
      { at: L.words[3]!, frame: 'spread' }, // "b-better": whip out to the whole spread (HER glimpsed)
    ]),
    ...franticBeats.map((b, i): Shot => ({ at: b, frame: { side: i % 2 === 0 ? 'R' : 'L', box: i % 2 === 0 ? HER_ZONE : ME_ZONE } })),
    { at: pullBackAt, frame: 'spread', move: 'land' }, // out to the spread for the rip
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  const landingAt = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`whoworeit: no shot starts at ${at.toFixed(3)}`);
    return m.land;
  };
  /** A line reads from its start, or, if the camera is still moving onto it, from where that move lands — never
   *  later than its second word. */
  const settled = (L: Line) => Math.min(landingAt(L.words[0]!), L.words[1]!.start);

  // ---- what must read when: each repeat's caption over its sung span, and each mark, whole, while it's drawn ----
  const focus: FocusBox[] = [
    ...lines.map((L, i): FocusBox => ({ from: settled(L), to: L.end, side: 'L', box: capBox(CAPTION_ROWS[i]!), size: CAPTION_ROWS[i]!.size * CAP_FRAC })),
    ...allMarks.map((m): FocusBox => ({ from: m.from, to: m.to, side: m.side, box: m.box })),
  ];

  // ---- the faces: print (banner, frame, her + jacket, labels, polls, folios, captions) and marks ----
  const offOf = (side: Side) => (side === 'R' ? PAGE.w : 0);
  const drawBanner = (c: CanvasRenderingContext2D, side: Side) => {
    c.save();
    c.translate(BANNER.x0 - offOf(side), 0);
    c.rotate(BANNER.tilt);
    c.fillStyle = rgba('ink');
    drawStretch(c, 'WHO WORE', 0, BANNER.y1, BANNER.size, 1, { width: BANNER.width });
    c.fillRect(0, BANNER.barTop, BANNER.width, BANNER.barBottom - BANNER.barTop);
    c.fillStyle = '#000';
    drawStretch(c, 'IT BETTER?', 0, BANNER.y2, BANNER.size, 1, { width: BANNER.width, cut: true });
    c.restore();
  };
  const drawHerFigure = (c: CanvasRenderingContext2D) => {
    c.save();
    c.translate(HER_ORIGIN.x, HER_ORIGIN.y);
    c.scale(HER_SCALE, HER_SCALE);
    c.translate(-ART.her.box[0], -ART.her.box[1]);
    c.strokeStyle = rgba('graphite');
    drawArt(c, herLine, herLine.map(() => 1));
    c.translate(HER_NECK.x, HER_NECK.y);
    c.scale(JACKET_SCALE, JACKET_SCALE);
    c.translate(-JACKET_NECK.x, -JACKET_NECK.y);
    c.strokeStyle = rgba('ink');
    drawArt(c, herJacket, herJacket.map(() => 1), 1 / (JACKET_SCALE * HER_SCALE));
    c.restore();
  };
  const mono = (c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) => {
    c.font = font(SMALL.family, size);
    c.fillStyle = rgba('ink');
    c.textAlign = 'left';
    c.fillText(text, x, y);
  };
  const label = (c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) => {
    c.font = font(GIANT_HEAD, size);
    c.fillStyle = rgba('ink');
    c.textAlign = 'left';
    c.fillText(text, x, y);
    // outlined by HAIRLINE_PU: the display cut's bold italic M is mostly thick diagonal wedges with a near-vanishing
    // middle, which read as a stray "VI" at a caption's scale without it (TREATMENT §2's hairline fix, same as a
    // lyric's fully-inked words)
    c.strokeStyle = rgba('ink');
    c.lineWidth = HAIRLINE_PU;
    c.lineJoin = 'round';
    c.strokeText(text, x, y);
  };
  const printLeft = (c: CanvasRenderingContext2D, t: number) => {
    drawBanner(c, 'L');
    c.strokeStyle = rgba('ink');
    c.lineWidth = 2;
    c.strokeRect(FRAME[0], FRAME[1], FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]);
    label(c, 'ME', ME_LABEL.x, ME_LABEL.y, ME_LABEL.size);
    mono(c, ME_POLL.text, ME_POLL.x, ME_POLL.y, ME_POLL.size);
    lines.forEach((L, i) => {
      const r = CAPTION_ROWS[i]!;
      setRows(c, L, t, capRows(r.y1, r.y2), { family: ITALIC, size: r.size, hairline: true });
      // the hyphen in "b-better" (row 2, word 3): the display cut's is sub-pixel at any size (TREATMENT §2), so
      // reprint it from the text cut, at the word's own ink (ghost until sung, then full with its hairline outline)
      const bbetter = L.words[3]!, ink = inkAt(bbetter, t);
      c.fillStyle = rgba('ink', ghostAlpha(ink));
      c.strokeStyle = rgba('ink');
      c.lineWidth = HAIRLINE_PU;
      c.lineJoin = 'round';
      textCutDashes(c, subLine(L, 3, 7).text, CAP_X, r.y2, ITALIC, ITALIC_DASH, r.size, ink >= 1);
    });
    drawFolio(c, 'L', pages[0]);
  };
  const printRight = (c: CanvasRenderingContext2D, t: number) => {
    void t;
    drawBanner(c, 'R');
    drawHerFigure(c);
    label(c, 'HER', HER_LABEL.x, HER_LABEL.y, HER_LABEL.size);
    mono(c, HER_POLL.text, HER_POLL.x, HER_POLL.y, HER_POLL.size);
    drawFolio(c, 'R', pages[1]);
  };
  /** Each mark's own quantisation step count (tallies, circles, the cross-out and the rewrite each have their own). */
  const stepsOf = (m: (typeof marksHeld)[number]) => (tallyMarks.includes(m) ? STEPS.tally : circleMarks.includes(m) ? STEPS.circle : m === crossMark ? STEPS.strike : STEPS.write);
  const drawMarksSide = (side: Side, c: CanvasRenderingContext2D, t: number) => {
    for (const m of marksHeld) {
      if (m.side !== side) continue;
      const p = markProgress(m, t, stepsOf(m));
      if (p <= 0) continue;
      if (p >= 1) m.held.stamp(c); else m.draw(c, p);
    }
    const step = franticStep(t);
    if (step <= 0) return;
    const off = offOf(side), len = (step / franticSteps) * scribbleTotal;
    c.save();
    c.translate(-off, 0);
    lipstickStroke(c, scribblePts, len, { width: 7, seed: 802 });
    c.restore();
    const z = getMeme(), meLen = (step / franticSteps) * z.total;
    c.save();
    c.translate(MEME.x - off, MEME.y);
    c.rotate(MEME.rot);
    lipstickWrite(c, z, meLen, { width: LIP.width, seed: 803 });
    c.restore();
  };

  return {
    id: 'whoworeit', section, pages,
    drawPrint(side, c, t) {
      c.textBaseline = 'alphabetic';
      if (side === 'L') printLeft(c, t); else printRight(c, t);
    },
    drawMarks(side, c, t) { drawMarksSide(side, c, t); },
    key(side, layer, t) {
      if (layer === 'marks') {
        const own = marksHeld.filter((m) => m.side === side);
        const vals = own.map((m) => Math.round(markProgress(m, t, stepsOf(m)) * stepsOf(m)));
        return `${vals.join(',')}|${franticStep(t)}`;
      }
      return side === 'L' ? karaokeKey(lines, t) : '-';
    },
    camera, focus,
  };
};

/**
 * For spread 10 (ransom): its left page is whoworeit's left page at its final state (the rip leaves it on screen
 * unchanged), with a collage added on top. Built from the same factory, so ransom's own ctx never has to fake
 * whoworeit's leaves or pages: resolve whoworeit's own ctx from the flatplan (`spreadCtx(audio, lyrics, plan, 9)`,
 * `plan = resolveFlatplan(audio, lyrics)` — index 9 is this entry, `whoworeit`) and pass it here.
 *
 * `whoworeitLeft(ctx).draw(c, t)` draws the print then the marks layer (both already on the left), for any t —
 * ransom wants it at t >= turnAt, where every mark is long since Held (stamped, not re-stroked) and the frantic
 * scribble has reached its fixed final length, so this costs one blit per held mark plus two short lipstick calls
 * at their full length: cheap, and the same every time (the marks are pure functions of t, same as everywhere else).
 * `.key(t)` combines this module's own print+marks keys for the left face, for ransom to fold into its own key.
 */
export function whoworeitLeft(ctx: SpreadCtx) {
  const sp = whoworeit(ctx);
  // per layer: the print goes on the ransom's print layer and the lipstick on its marks layer, so the wax keeps its
  // gloss (paper.ts) and nothing changes when the ransom's left face replaces this one at the rip's end
  return {
    drawPrint(c: CanvasRenderingContext2D, t: number) { sp.drawPrint('L', c, t); },
    drawMarks(c: CanvasRenderingContext2D, t: number) { sp.drawMarks('L', c, t); },
    key(layer: Layer, t: number) { return sp.key('L', layer, t); },
  };
}
