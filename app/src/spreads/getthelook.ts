// Spread 1, Get the Look (verse 1, pp. 2–3): the issue's shopping page in house style B, "Grand".
// "Get the Look" set huge across the spread, one hero object per page: patent boots on the left, a blush compact and a
// rat-tail comb on the right, each drawing itself across its words, captioned by its lyric and a price credit that snaps
// in on the kick after it. A black band down the left page's outer edge is the where-to-be-seen column: "HOW TO BE
// SEEN", lyric 2 and four deadpan stalker listings, all cut out of the ink. The narrator loops each object in lipstick
// while the camera holds on it whole, so her marks are seen being made. Every cue comes from the data (sung words,
// kicks, beats).
import type { Line } from '../engine/lyrics';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { HAIRLINE_PU, MARGIN, type Row, type Side, drawFolio, karaokeKey, setRows } from '../engine/layout';
import { knockout } from '../engine/print';
import { lipstickStroke } from '../engine/lipstick';
import { type V2, ease, polylineLengths, prog } from '../engine/util';
import { ART, type Art, artDrawings, drawArt } from './art';
import { kicksAcross, sectionLine } from './cues';
import { loopAround } from './marks';
import { type Box, SNAP_S, type Shot, beatAtOrAfter, director, eighthAtOrAfter, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';

/** Where a piece sits (page units, its face's): its art's origin at (x, y), rotated (radians), then scaled. */
interface Placement { x: number; y: number; scale: number; rot: number }
const BOOT: Placement = { x: 330, y: 236, scale: 1.909, rot: 0 }; // its art box spans x 330–750, y 236–904: the toe near the gutter
const COMPACT: Placement = { x: 300, y: 341.3, scale: 1.3, rot: 0 }; // its art box (from y −1, the lid's thickness) spans x 300–690, y 340–717
const COMB: Placement = { x: 58, y: 800, scale: 1.162, rot: (-7 * Math.PI) / 180 }; // 430 long, its tail rising
/** Each stroke group inks over GROUP_S (s) from its kick. */
const GROUP_S = 0.4;
const ITALIC = F.bodoni(400, { italic: true });
/** The lyrics' sizes (pu), in the display italic. */
const LYRIC = { L1: 34, L2: 30, L3: 34, L4: 30 } as const;
/** The display italic's cap height, in em (Bodoni Moda's OS/2 sCapHeight, 1500 of 2000): a lyric box's type size, as
 *  the guard takes it for display type (FocusBox.size). */
const ITALIC_CAP = 0.75;
const HEAD = F.bodoni(700, { italic: true });
/** Small mono meant to be read (the house rule): Plex Mono 600, 10.5 pu or more, full ink — or cut, on the band. */
const SMALL = { family: F.mono(600), size: 10.5 } as const;
/** The band down the left page's outer edge, bleeding off it. */
const BAND_W = 196;
/** The left page's column beside the band: lyric 1, its credit, the folio. */
const COL_L = 226;
/** The stalker listings in the band: place, then when. */
const LISTINGS: readonly (readonly [string, string])[] = [
  ['GALLERY OPENING', 'THURSDAY, 7 PM'],
  ['HIS GYM', '6.15 AM, DAILY'],
  ['LUCA’S, FRIDAYS', 'THE CORNER BOOTH'],
  ['HER BIRTHDAY', 'DINNER (UNINVITED)'],
];
/** A headline: display-cut italic at (x, baseline y); `hairline` outlines it by HAIRLINE_PU (its italic t's crossbars
 *  are sub-pixel in the display cut: TREATMENT §2). */
interface Headline { text: string; x: number; y: number; size: number; hairline: boolean }
const GET_THE: Headline = { text: 'Get the', x: 222, y: 200, size: 142, hairline: true };
const LOOK: Headline = { text: 'Look', x: 18, y: 292, size: 300, hairline: false };
/** The brush the narrator loops with. */
const LIP_W = 6;

/**
 * A part of a face that no longer changes — the band and its cuts, a headline, a drawing once it has fully inked, a
 * finished lipstick loop that later marks are drawn over — kept as pixels: painted once into a canvas over just its
 * region (`box`, or the box `box(c)` measures on first use, in the face's device pixels snapped out to whole ones) and
 * copied back in on each redraw, source-over, so a redraw pays only for what moves. Hold only what later redraws of
 * the same layer reuse: a held copy costs its region's pixels for as long as the spread lives.
 *
 * The canvas is backed as the face is (on the CPU for a face made willReadFrequently, as the keys check makes its
 * faces; on the GPU otherwise): the two raster type differently, by up to ~200 levels on a glyph's edge. On the face's
 * own kind, shifted by whole device pixels, a held part's type comes out as painting it in place would, and on a GPU
 * face (the scene's) so does its line art, to 2 levels; on a CPU face its line art can differ by up to ~60 levels on a
 * few dozen edge pixels. Lipstick, inked through the brush's own scratch canvases (sized to their target: lipstick.ts),
 * can differ by up to 255 levels at a few dozen pixels along a stroke. (Measured, held against in place: the left and
 * right print and marks, both backings.) None of it changes what a key shows: a part is held under every key that
 * holds it, so no face mixes the two, and a key's pixels are the same each time (the keys check).
 *
 * The copy goes on source-over, which for ink and lipstick (laid source-over themselves) composes over whatever lies
 * under them as painting them there would; a part with cuts (the band) would cut only itself, so it must be the first
 * thing a redraw puts in its region. A face's transform is a positive
 * scale and a translation; under any other (a rotation, a flip) it paints in place. Made on first use, so the factory
 * never touches the DOM; remade if the face's resolution or backing changes.
 */
class Held {
  private kept: { cv: HTMLCanvasElement; at: string; cpu: boolean } | null = null;
  private measured: Box | null = null;
  constructor(private readonly box: Box | ((c: CanvasRenderingContext2D) => Box), private readonly paint: (c: CanvasRenderingContext2D) => void) {}
  stamp(c: CanvasRenderingContext2D) {
    // (the prototype's transform calls: a Layer2D's own report and reset its logical scale, not the device's)
    const proto = CanvasRenderingContext2D.prototype, T = proto.getTransform.call(c);
    if (!(T.b === 0 && T.c === 0 && T.a > 0 && T.d > 0)) { c.save(); try { this.paint(c); } finally { c.restore(); } return; }
    const box = typeof this.box === 'function' ? (this.measured ??= this.box(c)) : this.box, [u0, v0, u1, v1] = box;
    const W = c.canvas.width, H = c.canvas.height;
    const X0 = Math.max(0, Math.floor(T.a * u0 + T.e)), Y0 = Math.max(0, Math.floor(T.d * v0 + T.f));
    const X1 = Math.min(W, Math.ceil(T.a * u1 + T.e)), Y1 = Math.min(H, Math.ceil(T.d * v1 + T.f));
    if (!(X1 > X0 && Y1 > Y0)) return;
    const cpu = c.getContextAttributes?.().willReadFrequently === true;
    const at = `${T.a},${T.d},${T.e},${T.f}|${X0},${Y0},${X1},${Y1}|${cpu}`;
    if (this.kept?.at !== at) {
      // (a canvas's backing is fixed by its first getContext: another kind of face needs a canvas of its own)
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

/** The smallest box holding all of these. */
const union = (...bs: Box[]): Box => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
/** The smallest box holding these points. */
const bounds = (pts: readonly V2[]): Box => {
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
/** The page box of points in a piece's own units, placed. */
const placed = (p: Placement, pts: readonly V2[]): Box => {
  const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
  return bounds(pts.map((q) => ({ x: p.x + p.scale * (q.x * cos - q.y * sin), y: p.y + p.scale * (q.x * sin + q.y * cos) })));
};
const pad = (b: Box, r: number): Box => [b[0] - r, b[1] - r, b[2] + r, b[3] + r];

export const getthelook: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = sectionLine(lyrics, section, 'I wear my patent leather boots');
  const L2 = sectionLine(lyrics, section, 'I know that I’ll run into you');
  const L3 = sectionLine(lyrics, section, 'I wear my blush ’cause I’m a doll');
  const L4 = sectionLine(lyrics, section, 'And then I tease my hair all tall, baby');
  for (const [l, n] of [[L1, 6], [L2, 7], [L3, 8], [L4, 9]] as const) {
    if (l.words.length !== n) throw new Error(`getthelook: "${l.text}" has ${l.words.length} words, its rows are set for ${n}`);
  }
  const w = (l: Line, i: number) => l.words[i]!;
  const rows = (x: number, ys: readonly number[], cuts: readonly number[]): Row[] =>
    ys.map((y, i) => ({ x, y, words: [cuts[i]!, cuts[i + 1]!] as const }));
  const R1 = rows(COL_L, [342, 382, 422, 462], [0, 3, 4, 5, 6]); // I wear my / patent / leather / boots
  const R2 = rows(22, [214, 252, 290, 328], [0, 2, 4, 6, 7]); // I know / that I'll / run into / you
  const R3 = rows(58, [420, 460, 500, 540], [0, 2, 4, 5, 8]); // I wear / my blush / 'cause / I'm a doll
  const R4 = rows(512, [800, 838, 876, 914], [0, 2, 5, 8, 9]); // And then / I tease my / hair all tall, / baby
  const L3_BOX: Box = [54, 392, 262, 548];

  // ---- the drawings, inking group by group on kicks spread across their words (the first word to the last), each
  // captioned by its credit on the first kick once its last group has inked ----
  const kickFrom = (x: number) => audio.events('kick', x, x + 1)[0]?.[0] ?? x;
  const piece = (art: Art, seed: number, p: Placement, words: readonly [from: number, to: number], credit: readonly (readonly [string, number, number])[]) => {
    const ds = artDrawings(art, seed), at = kicksAcross(audio, ds.length, words[0], words[1]);
    const draw = (c: CanvasRenderingContext2D, progress: readonly number[]) => {
      c.save();
      c.translate(p.x, p.y);
      if (p.rot) c.rotate(p.rot);
      c.scale(p.scale, p.scale);
      c.strokeStyle = rgba('ink');
      drawArt(c, ds, progress, 1 / p.scale); // (its own line widths kept in page units)
      c.restore();
    };
    // kept once inked over its strokes' extent, padded by its widest line and a little; it must read over its art box
    const strokes = placed(p, ds.flatMap((g) => g.d.strokes.flat()));
    const [b0, b1, b2, b3] = art.box, frame = placed(p, [{ x: b0, y: b1 }, { x: b2, y: b1 }, { x: b0, y: b3 }, { x: b2, y: b3 }]);
    const held = new Held(pad(strokes, Math.max(...ds.map((g) => g.width)) / 2 + 2), (c) => draw(c, ds.map(() => 1)));
    return { at, creditAt: kickFrom(Math.max(...at) + GROUP_S), credit, draw, held, frame };
  };
  const boot = piece(ART.boot, 101, BOOT, [w(L1, 3).start, L1.end], [['01 · PATENT LEATHER', COL_L, 504], ['BOOTS · $1,290', COL_L, 519]]); // "patent" → "boots"
  const compact = piece(ART.compact, 202, COMPACT, [w(L3, 3).start, L3.end], [['02 · BLUSH COMPACT', 58, 582], ['ROSE · $68', 58, 597]]); // "blush" → "doll"
  const comb = piece(ART.comb, 303, COMB, [w(L4, 3).start, w(L4, 5).end], [['03 · RAT-TAIL COMB · $24', 58, 894]]); // "tease" → "hair"

  // ---- the lipstick: a loop round each object, half a beat long, drawn while the camera holds on the object whole —
  // from the beat after its shot lands, done before the next snap — so her marks are seen being made ----
  const half = 30 / audio.bpm;
  /** Where a snap cued at `cue` lands (snaps are fixed-length: SNAP_S from their cue; checked against the plan below). */
  const lands = (cue: Shot['at']) => resolveAt(cue) + SNAP_S;
  const bootsCue = w(L1, 5), dollCue = w(L3, 7), combCue = w(L4, 0);
  // the boot's on the beat after the "boots" wide shot lands; the snap into the band waits for it, to the beat after it's
  // drawn (a downbeat, during "know"): on "I know" it would start 30 ms before the loop is done, and the eighth after the
  // landing instead would loop the boot before its last strokes are down
  const bootLoopAt = beatAtOrAfter(audio, lands(bootsCue));
  const bandAt = beatAtOrAfter(audio, bootLoopAt + half);
  // the compact's in the "doll" push-in, before the snap to the comb, which can't wait (lyric 4 must read by its second
  // word): the beat after the landing is too late for it (the snap would cut it short), so the eighth after it
  const dollLands = lands(dollCue), combSnap = resolveAt(combCue);
  const compactLoopAt = [beatAtOrAfter(audio, dollLands), eighthAtOrAfter(audio, dollLands)].find((t) => t + half <= combSnap);
  if (compactLoopAt === undefined) throw new Error(`getthelook: no beat or eighth after "doll"'s shot lands (${dollLands.toFixed(3)}) leaves half a beat for the compact's loop before the snap to the comb (${combSnap.toFixed(3)})`);
  // the comb's on "tall,", as the camera lands on the spread for the turn, which shows it whole
  const combLoopAt = w(L4, 7).start;
  if (combLoopAt + half > turnAt) throw new Error(`getthelook: the comb's loop (from "tall," at ${combLoopAt}) runs into the turn at ${turnAt}`);
  /** A loop round an object's core (`core`: loopAround draws 1.39x a box's half-sizes out from its centre, so the
   *  loops land like the mock's, round each object and on its own page — round the objects' own boxes they ran off the
   *  pages), from `at` over half a beat. `box`: what it covers, the brush's width out. */
  const loop = (side: Side, core: Box, seed: number, at: number) => {
    const pts = loopAround(core, seed), L = polylineLengths(pts), total = L[L.length - 1]!;
    const draw = (c: CanvasRenderingContext2D, p: number) => lipstickStroke(c, pts, p * total, { width: LIP_W, seed });
    return { side, seed, from: at, to: at + half, box: pad(bounds(pts), LIP_W), draw };
  };
  const bootLoop = loop('L', [372, 330, 690, 820], 11, bootLoopAt);
  const compactLoop = loop('R', [338, 382, 652, 680], 12, compactLoopAt);
  const combLoop = loop('R', [80, 762, 400, 846], 13, combLoopAt);
  /** The loops in the order they're drawn, each over the ones before it on its face. A finished loop is held only when
   *  a later one is drawn over it (the compact's, under the comb's): the last mark on its face is drawn finished once
   *  per binding of the face, so held it would only cost its pixels (and its brush's scratch canvases, sized to it). */
  const loops = [bootLoop, compactLoop, combLoop].map((l, i, all) => ({
    ...l, held: all.slice(i + 1).some((m) => m.side === l.side) ? new Held(l.box, (c) => l.draw(c, 1)) : null,
  }));

  // Every animated value, quantised once: the keys encode exactly these, and the faces draw exactly these.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  const inked = (pc: typeof boot, t: number) => ({ ink: pc.at.map((a) => q(prog(t, a, a + GROUP_S, ease.outCubic), 48)), credit: t >= pc.creditAt });
  const state = (t: number) => ({ boot: inked(boot, t), compact: inked(compact, t), comb: inked(comb, t) });
  const marks = (t: number) => loops.map((l) => q(prog(t, l.from, l.to, ease.inOutQuad), 32));

  // ---- the camera: Snap, hold and jump (each starting just before its word, or on a beat), looking down ----
  const shots: Shot[] = [
    // lyric 1 and the boot's top, from the flip: the camera's move off the cover lands on it (the song's already on
    // "I wear my"; a full-page hold first, then a snap in on "patent", left the eye behind)
    { at: ctx.start, frame: { side: 'L', box: [210, 290, 760, 560] }, roll: -0.02 },
    { at: bootsCue, frame: { side: 'L', box: union([210, 230, 770, 920], bootLoop.box) } }, // "boots": the whole boot, her loop
    { at: bandAt, frame: { side: 'L', box: [0, 90, 230, 560] }, roll: 0.02 }, // into the band, on the beat after the loop
    // "I wear my blush": across to the right page, the compact and lyric 3 (wide enough that "doll" can push in: both
    // boxes the plan gave fit at the nearest distance, 0.9, so its "closer" was only a pan, which lost lyric 3)
    { at: w(L3, 0), frame: { side: 'R', box: [0, 280, 770, 820] }, roll: 0.02 },
    { at: dollCue, frame: { side: 'R', box: union(L3_BOX, compactLoop.box) } }, // "doll": closer, the compact, her loop, lyric 3
    { at: combCue, frame: { side: 'R', box: [40, 720, 740, 930] }, roll: -0.02 }, // "And then I tease": the comb, lyric 4
    { at: w(L4, 6), frame: 'spread' }, // "all": out to the spread for the turn
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  /** Where the move a shot starts lands (the plan's). */
  const landing = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`getthelook: no shot starts at ${at.toFixed(3)} (its cue moved, or was dropped from the shots?)`);
    return m.land;
  };
  for (const cue of [bootsCue, dollCue]) {
    if (Math.abs(landing(cue) - lands(cue)) > 1e-9) throw new Error(`getthelook: the shot at ${resolveAt(cue).toFixed(3)} lands at ${landing(cue).toFixed(3)}, not ${lands(cue).toFixed(3)}: a loop's cue is set for a snap there (SNAP_S from its cue)`);
  }
  /** The move under way at t, if any: the last one started (a later move takes over from an earlier one, as evaluate
   *  does), until it lands. */
  const movingAt = (t: number) => { const m = moves.findLast((x) => x.at <= t); return m && t < m.land ? m : undefined; };
  /** A line must read from its start, or, if the camera is still moving onto it then, from where that move lands — but
   *  from its second word at the latest. */
  const settled = (l: Line) => { const m = movingAt(l.start); return m ? Math.min(m.land, w(l, 1).start) : l.start; };
  /** An object must read, whole, from `from` to the end of its words, or until the camera snaps away from it, whichever
   *  is first (`leaves`: the start of the first shot that doesn't frame it, or the turn). */
  const whole = (side: Side, box: Box, from: number, wordsEnd: number, leaves: number): FocusBox => ({ from, to: Math.min(wordsEnd, leaves), side, box });
  const focus: FocusBox[] = [
    // each line over its sung span (type: as soft as its cap height on screen allows)
    { from: w(L1, 2).start, to: L1.end, side: 'L', box: [220, 312, 400, 470], size: ITALIC_CAP * LYRIC.L1 }, // (its first two words are sung on the flip)
    { from: settled(L2), to: L2.end, side: 'L', box: [16, 186, 196, 336], size: ITALIC_CAP * LYRIC.L2 },
    { from: settled(L3), to: L3.end, side: 'R', box: L3_BOX, size: ITALIC_CAP * LYRIC.L3 },
    { from: settled(L4), to: L4.end, side: 'R', box: [508, 772, 722, 922], size: ITALIC_CAP * LYRIC.L4 },
    // the object it's about, over its art box (a drawing: as soft as FADE), the boot from the "boots" shot (on "patent"
    // the camera is close on its top), the compact and the comb from their first strokes
    whole('L', boot.frame, landing(bootsCue), L1.end, bandAt),
    whole('R', compact.frame, compact.at[0]!, L3.end, combSnap),
    whole('R', comb.frame, comb.at[0]!, w(L4, 5).end, turnAt),
    // and each lipstick loop, whole, while it's drawn
    ...loops.map((l): FocusBox => ({ from: l.from, to: l.to, side: l.side, box: l.box })),
  ];

  // ---- the faces ----
  /** A headline in opaque ink, outlined by HAIRLINE_PU when it has hairlines that would vanish. */
  const headline = (c: CanvasRenderingContext2D, h: Headline) => {
    c.font = font(HEAD, h.size);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = c.strokeStyle = rgba('ink');
    c.fillText(h.text, h.x, h.y);
    if (h.hairline) {
      c.lineWidth = HAIRLINE_PU;
      c.lineJoin = 'round';
      c.strokeText(h.text, h.x, h.y);
    }
  };
  /** A headline, held over its glyphs' own extent as measured (italic overhangs included), out by its outline's half
   *  and a margin. */
  const heldHeadline = (h: Headline) => new Held((c) => {
    c.save();
    c.font = font(HEAD, h.size);
    const m = c.measureText(h.text);
    c.restore();
    return pad([h.x - m.actualBoundingBoxLeft, h.y - m.actualBoundingBoxAscent, h.x + m.actualBoundingBoxRight, h.y + m.actualBoundingBoxDescent], HAIRLINE_PU / 2 + 2);
  }, (c) => headline(c, h));
  // what's printed and stays: the band with its cuts; the headlines
  const band = new Held([0, 0, BAND_W, 1000], (c) => {
    c.fillStyle = rgba('ink');
    c.fillRect(0, 0, BAND_W, 1000);
    knockout(c, (k) => {
      k.textAlign = 'left';
      k.textBaseline = 'alphabetic';
      k.font = font(F.archivo(75, 900), 26);
      // tracked out a little, its word spaces opened: the condensed black runs "HOW TO" together at this size
      k.letterSpacing = '0.8px';
      k.wordSpacing = '3px';
      k.fillText('HOW TO', 22, 112);
      k.fillText('BE SEEN', 22, 142);
      k.letterSpacing = '0px';
      k.wordSpacing = '0px';
      k.fillRect(22, 160, 152, 1.2);
      k.font = font(SMALL.family, SMALL.size);
      LISTINGS.forEach(([a, b], i) => {
        const y = 390 + i * (2 * 13.5 + 14);
        k.fillText(a, 22, y);
        k.fillText(b, 22, y + 13.5);
      });
    });
  });
  const getThe = heldHeadline(GET_THE), look = heldHeadline(LOOK);
  /** A drawing to its progress (kept once it has fully inked, live while it inks), then its credit once due. */
  const inkPiece = (c: CanvasRenderingContext2D, pc: typeof boot, s: ReturnType<typeof inked>) => {
    if (s.ink.every((x) => x >= 1)) pc.held.stamp(c);
    else if (s.ink.some((x) => x > 0)) pc.draw(c, s.ink);
  };
  const credit = (c: CanvasRenderingContext2D, pc: typeof boot, s: ReturnType<typeof inked>) => {
    if (!s.credit) return;
    c.font = font(SMALL.family, SMALL.size);
    c.textAlign = 'left';
    c.fillStyle = rgba('ink');
    for (const [text, x, y] of pc.credit) c.fillText(text, x, y);
  };

  const printLeft = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    band.stamp(c);
    setRows(c, L2, t, R2, { family: ITALIC, size: LYRIC.L2, cut: true, hairline: true }); // cut out of the band
    getThe.stamp(c);
    inkPiece(c, boot, s.boot);
    setRows(c, L1, t, R1, { family: ITALIC, size: LYRIC.L1, hairline: true });
    credit(c, boot, s.boot);
    // the folio, on the paper beside the band: drawFolio's own layout, moved from the outer margin to the column
    c.save();
    c.translate(COL_L - MARGIN.outer, 0);
    drawFolio(c, 'L', pages[0]);
    c.restore();
  };
  const printRight = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    look.stamp(c);
    inkPiece(c, compact, s.compact);
    setRows(c, L3, t, R3, { family: ITALIC, size: LYRIC.L3, hairline: true });
    credit(c, compact, s.compact);
    inkPiece(c, comb, s.comb);
    setRows(c, L4, t, R4, { family: ITALIC, size: LYRIC.L4, hairline: true });
    credit(c, comb, s.comb);
    drawFolio(c, 'R', pages[1]);
  };

  const steps = (p: number[]) => p.map((x) => Math.round(x * 48)).join(',');
  const pieceKey = (s: ReturnType<typeof inked>) => `${steps(s.ink)}${s.credit ? '+' : ''}`;
  return {
    id: 'getthelook', section, pages,
    drawPrint(side, c, t) {
      const s = state(t);
      if (side === 'L') printLeft(c, t, s); else printRight(c, t, s);
    },
    drawMarks(side, c, t) {
      const m = marks(t);
      loops.forEach((l, i) => {
        if (l.side !== side || !(m[i]! > 0)) return;
        if (m[i]! >= 1 && l.held) l.held.stamp(c); else l.draw(c, m[i]!);
      });
    },
    key(side, layer, t) {
      if (layer === 'marks') {
        const m = marks(t);
        return loops.map((l, i) => (l.side === side ? Math.round(m[i]! * 32) : '')).join(',');
      }
      const s = state(t);
      return side === 'L'
        ? `${pieceKey(s.boot)}|${karaokeKey([L1, L2], t)}`
        : `${pieceKey(s.compact)}|${pieceKey(s.comb)}|${karaokeKey([L3, L4], t)}`;
    },
    camera, focus,
  };
};
