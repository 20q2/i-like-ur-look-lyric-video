// Spread 11, Classifieds (post-chorus 2, pp. 22-23): the issue's small-ads page, in house style B
// CLASSIFIEDS across the top in Bodoni 900, cut off at
// both outer page edges; under it a dense grid of boxed small ads, printed at once, deadpan. The lyrics are display
// ads among them: "So extreme" stretched huge in Archivo on the left page, printing on its words; "So effortlessly"
// set huge in Bodoni italic on the right, printed in full from the start. Between the two lines the ad-libs ("Looks
// better" x2, stuttering into "b-b-better", "Woo", then "Looks best") stamp in as new small listings, a beat apart,
// each hitting harder than the last, with the camera holding the grid; on "So" it pans up to the waiting headline. The last line isn't
// printed: the lipstick writes it big, in script, in two heavy lines across the whole spread and over the ads — the
// narrator, past caring whose page it is, writing her last line across all of them.
import { ghostAlpha, inkAt, karaokeKey, PAGE, type Side, drawFolio } from '../engine/layout';
import { F, font, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { stretchFamily } from '../engine/print';
import { lipstickWrite } from '../engine/lipstick';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { charTimes } from './marks';
import { strokeText, writtenLength } from '../engine/stroke';
import { ease, prog } from '../engine/util';
import { sectionLine } from './cues';
import { type Box, type Shot, beatAtOrAfter, director, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';

// ---- the layout (page units, each face's own) ----
/** CLASSIFIEDS, Bodoni 900, centred on the spread so both outer page edges cut it (measured on first draw: lazy). */
const HEAD = { text: 'CLASSIFIEDS', size: 190, y: 222 } as const;
/** A hairline under it, margin to margin across the spread (spread x), and a deadpan strap under that. */
const RULE = { y: 250, x0: 48, x1: 2 * PAGE.w - 48, w: 0.8 } as const;
const STRAP = { text: 'LOST & FOUND · FOR SALE · PERSONALS · NOTICES', x: 48, y: 276, track: 2 } as const;

/** The two display ads: a boxed headline ad per page, the same width as the grid below (DISPLAY_W). */
/** The camera holding the grid while the stamps punch in: both pages' small ads, the display ads along the top. */
const GRID_POSE = Object.freeze({ x: 0, y: 0.36, dist: 1.75, tilt: 0.1, roll: 0 });
const DISPLAY_W = 664;
const DISPLAY = { y0: 284, y1: 436 } as const;
const LEFT_DISPLAY: Box = [48, DISPLAY.y0, 48 + DISPLAY_W, DISPLAY.y1];
const RIGHT_DISPLAY: Box = [58, DISPLAY.y0, 58 + DISPLAY_W, DISPLAY.y1];
const EXTREME_SIZE = 120, EXTREME_STEP = 5; // Archivo 900 at its widest step
const EFFORTLESS_SIZE = 110; // Bodoni italic

/** The small-ads grid below the displays: 2 columns per page, each DISPLAY_W/2 less a gap wide, 4 rows a page. */
const GRID = { y0: 452, rowH: 111, rowGap: 16, colW: 324, colGap: 16 } as const;
const LEFT_COL_X = [48, 48 + GRID.colW + GRID.colGap] as const;
const RIGHT_COL_X = [58, 58 + GRID.colW + GRID.colGap] as const;
const cellBox = (colX: number, row: number): Box => {
  const y = GRID.y0 + row * (GRID.rowH + GRID.rowGap);
  return [colX, y, colX + GRID.colW, y + GRID.rowH];
};

/** Type. Small mono meant to be read (a listing's category) is Plex Mono 600 at >= 10.5 pu (TREATMENT §6); the ads'
 *  own deadpan copy is Bodoni text at 15 pu, fine as small print (not meant to clear the 4.5:1 floor from a distance,
 *  but legible close, per the spec). */
const SMALL = { family: F.mono(600), size: 10.5 } as const;
const BODY = { family: F.bodoni(400, { text: true }), size: 15, lh: 19 } as const;
const PAD = 14;
/** Cap heights per pu of size (the fonts' own OS/2 sCapHeight): the guards' FocusBox.size. */
const CAP = { bodoni: 0.75, archivo: 0.686 } as const;

/** A listing's content: a deadpan small ad (always printed), or an ad-lib stamp (pops in on its cue). */
type Listing =
  | { kind: 'static'; label: string; lines: readonly string[] }
  | { kind: 'adlib'; index: number; text: string };
interface Cell { side: Side; col: 0 | 1; row: number; item: Listing }
const LEFT_GRID: readonly Cell[] = [
  { side: 'L', col: 0, row: 0, item: { kind: 'static', label: 'WANTED', lines: ['Boyfriend, one day only, for a video', 'shoot. Must photograph well. Lunch', 'provided. Box 47.'] } },
  { side: 'L', col: 0, row: 1, item: { kind: 'static', label: 'LOST', lines: ['Contact lens, hazel, Sat. night, near', 'the station. Reward.'] } },
  { side: 'L', col: 0, row: 2, item: { kind: 'adlib', index: 0, text: 'LOOKS BETTER.' } },
  { side: 'L', col: 0, row: 3, item: { kind: 'static', label: 'FOR SALE', lines: ['leash, brass clasp. SOLD.'] } },
  { side: 'L', col: 1, row: 0, item: { kind: 'static', label: 'PERSONALS', lines: ['F, 34, from Cologne, into vintage and', 'late nights. ISO the same. Box 27.'] } },
  { side: 'L', col: 1, row: 1, item: { kind: 'adlib', index: 1, text: 'LOOKS BETTER.' } },
  { side: 'L', col: 1, row: 2, item: { kind: 'static', label: 'FOUND', lines: ['Pink hair tie, left at the ballet', 'studio Tues. Ask at the front desk.'] } },
  { side: 'L', col: 1, row: 3, item: { kind: 'static', label: 'SERVICES', lines: ['Clock & watch repair. All makes.', 'Sat. 9 till 4:15.'] } },
];
const RIGHT_GRID: readonly Cell[] = [
  { side: 'R', col: 0, row: 0, item: { kind: 'adlib', index: 2, text: 'LOOKS B-B-BETTER.' } },
  { side: 'R', col: 0, row: 1, item: { kind: 'static', label: 'REWARD', lines: ['information on his whereabouts,', 'Thursdays only.'] } },
  { side: 'R', col: 0, row: 2, item: { kind: 'static', label: 'SWAP', lines: ['Back issues, German edition, ’06–’09,', 'for pocket money.'] } },
  { side: 'R', col: 1, row: 0, item: { kind: 'adlib', index: 3, text: '(WOO)' } },
  { side: 'R', col: 1, row: 1, item: { kind: 'adlib', index: 4, text: 'LOOKS BEST.' } },
  { side: 'R', col: 1, row: 2, item: { kind: 'static', label: 'NOTICE', lines: ['Road closed for works until May 29.', 'Follow the pink detour signs.'] } },
  { side: 'R', col: 0, row: 3, item: { kind: 'static', label: 'HELP WANTED', lines: ['Exterminator, nights. Australian', 'applicants welcome.'] } },
  { side: 'R', col: 1, row: 3, item: { kind: 'static', label: 'MISSED CONNECTIONS', lines: ['You: the jacket, corner booth at', 'Luca’s, 12:01 a.m. Me: staring.', 'Coffee?'] } },
];
const ALL_GRID = [...LEFT_GRID, ...RIGHT_GRID];
const boxOf = (cell: Cell): Box => cellBox(cell.side === 'L' ? LEFT_COL_X[cell.col] : RIGHT_COL_X[cell.col], cell.row);

/** An ad-lib stamp: Archivo 900 (its own width), a punch (grow then settle, as memoriam's SPLIT). Each hits harder
 *  than the last (STAMP.by, by index): at `size` (or smaller, to fit its box within PAD), and the stutter knocked out
 *  of a solid box (`solid`). */
const STAMP = {
  family: F.archivo(100, 900), grow: 0.05, settleS: 0.2,
  by: [{ size: 30, solid: false }, { size: 38, solid: false }, { size: 32, solid: true }, { size: 66, solid: false }, { size: 48, solid: true }],
} as const;
const STEPS = { ink: 16, settle: 24, write: 96 } as const;

/** The big script: the last line up to "me" ("yeah" goes unwritten, so the whole of it reads a beat before the
 *  turn), in the narrator's hand (hscript, as coverstory.ts writes "better on me") as two lines across the spread,
 *  `words` [from, to) of the line each: each stroke text's origin (its left baseline) at (x, y) in spread x, rotated
 *  `rot` about it, at `size` pu with a `width` brush — big and heavy enough that the ads it crosses read as ground.
 *  Sung, "me" ends half a second before the turn: too close to take it in, so her hand runs ahead of the voice, the
 *  line's timing squeezed from its start to finish `holdS` before the turn, and holds there. */
const WRITE = Object.freeze({
  lines: Object.freeze([
    Object.freeze({ text: 'cause you definitely', words: [0, 3] as const, x: 70, y: 735, size: 165, width: 12, seed: 71 }),
    Object.freeze({ text: 'look better on me', words: [3, 7] as const, x: 280, y: 930, size: 170, width: 13, seed: 72 }),
  ]),
  rot: (-5 * Math.PI) / 180, holdS: 1.4,
});
/** The script's ink (spread x, generous: its strokes and brush), split at the gutter for the guards. */
const WRITE_BOX: Box = [40, 470, 1530, 990];

const offOf = (side: Side) => (side === 'R' ? PAGE.w : 0);
/** A box, rounded outward to whole pu. */
const outward = (b: readonly [number, number, number, number]): Box => [Math.floor(b[0]), Math.floor(b[1]), Math.ceil(b[2]), Math.ceil(b[3])];
/** A line of `section`, its word count checked (a re-alignment that split or merged words would move every cue). */
function lineOf(lyrics: Lyrics, section: string, text: string, words: number): Line {
  const l = sectionLine(lyrics, section, text);
  if (l.words.length !== words) throw new Error(`classifieds: "${l.text}" has ${l.words.length} words, expected ${words}`);
  return l;
}

export const classifieds: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages, start } = ctx, turnAt = turnOut(ctx);
  const L1 = lineOf(lyrics, section, 'So extreme', 2);
  const L2 = lineOf(lyrics, section, 'So effortlessly', 2);
  const L3 = lineOf(lyrics, section, "'Cause you definitely look better on me, yeah", 8);
  const so1 = L1.words[0]!, extreme = L1.words[1]!, so2 = L2.words[0]!, effortlessly = L2.words[1]!;

  // ---- the ad-libs' stamps: a beat apart on the beat grid, in the gap between "extreme" and "So effortlessly", from
  // the second beat after "extreme" ends ----
  const idx0 = audio.beatAt(beatAtOrAfter(audio, extreme.end)) + 1;
  const adlibAt = [0, 1, 2, 3, 4].map((i) => audio.timeOfBeat(idx0 + i));
  if (!(adlibAt[4]! + 0.5 < L2.start)) {
    throw new Error(`classifieds: the last ad-lib stamp (${adlibAt[4]!.toFixed(3)}) comes under half a second before "So effortlessly" (${L2.start})`);
  }
  /** On "So", the pan up to its headline lands this beat after its cue. */
  const panLands = beatAtOrAfter(audio, resolveAt(so2) + 0.8);

  // ---- the camera: Snap, a shot per set piece, then out to the spread for the last line ----
  const shots: Shot[] = [
    { at: start, frame: 'spread', roll: 0.02 }, // low, under CLASSIFIEDS
    { at: so1, frame: { side: 'L', box: LEFT_DISPLAY } }, // "So": the SO EXTREME. display ad
    { at: adlibAt[0]!, frame: { pose: GRID_POSE } }, // the grid, held while the stamps punch in
    { at: so2, frame: { side: 'R', box: RIGHT_DISPLAY }, move: 'glide', until: panLands }, // "So": up to its headline
    { at: L3.words[0]!, frame: 'spread' }, // out to the spread with her first word: the lipstick crosses all of it
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  /** When the move a cue starts has landed, as the director plans it. */
  const landed = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`classifieds: no shot starts at ${at.toFixed(3)}`);
    return m.land;
  };
  /** The next move's start after t (the end of a camera's dwell on whatever came up at t), or turnAt past the last. */
  const leaves = (t: number) => moves.find((m) => m.at > t)?.at ?? turnAt;
  /** A line reads from its start, or, if the camera is still travelling then, from where that move lands. */
  const settled = (w0: Word) => { const m = moves.findLast((x) => x.at <= w0.start); return m && w0.start < m.land ? m.land : w0.start; };
  /** Each ad-lib's stamp punches in on its beat — the first once the camera has landed on the grid, so it's seen
   *  happen, not finished off-screen. */
  const stampAt = adlibAt.map((a, i) => (i === 0 ? landed(a) : a));

  // ---- the last line, written from "'Cause" and done WRITE.holdS before the turn (ahead of "me" if it must) ----
  const meEnd = L3.words[6]!.end, writeEnd = Math.min(meEnd, turnAt - WRITE.holdS);
  if (!(writeEnd > L3.start + 2)) throw new Error(`classifieds: the lipstick has ${(writeEnd - L3.start).toFixed(3)} s to write the last line before its hold; it needs 2`);
  const squeeze = (x: number) => L3.start + ((x - L3.start) * (writeEnd - L3.start)) / (meEnd - L3.start);
  const writeTimes = WRITE.lines.map((l) => charTimes(l.text, L3.words.slice(l.words[0], l.words[1]).map((w) => ({ ...w, start: squeeze(w.start), end: squeeze(w.end) }))));

  // ---- font-dependent measures, built on first use (the factory must not touch the DOM) ----
  let cache: { headX: number; write: ReturnType<typeof strokeText>[] } | null = null;
  const lazy = () => {
    if (cache) return cache;
    const headW = measure(HEAD.text, F.bodoni(900), HEAD.size);
    const headX = PAGE.w - headW / 2; // centred on the spread (spread x 770), bleeding off both pages' outer edges
    return (cache = { headX, write: WRITE.lines.map((l) => strokeText(l.text, 'hscript', l.size)) });
  };
  const writeBoxL: Box = [WRITE_BOX[0], WRITE_BOX[1], PAGE.w, WRITE_BOX[3]];
  const writeBoxR: Box = [0, WRITE_BOX[1], WRITE_BOX[2] - PAGE.w, WRITE_BOX[3]];

  // what must read when: the two display lines over their own words, each ad-lib stamp while its shot holds it, and
  // the last line — small, in its box, then (once the glide has landed) its written-large self, split at the gutter
  const focus: FocusBox[] = [
    { from: settled(so1), to: L1.end, side: 'L', box: LEFT_DISPLAY, size: CAP.archivo * EXTREME_SIZE },
    { from: settled(so2), to: L2.end, side: 'R', box: RIGHT_DISPLAY, size: CAP.bodoni * EFFORTLESS_SIZE },
    ...[0, 1, 2, 3, 4].map((i): FocusBox => {
      const cell = ALL_GRID.find((c) => c.item.kind === 'adlib' && c.item.index === i)!;
      return { from: stampAt[i]!, to: leaves(stampAt[i]!), side: cell.side, box: boxOf(cell), size: CAP.archivo * STAMP.by[i]!.size };
    }),
    { from: landed(L3.words[0]!), to: turnAt, side: 'L', box: writeBoxL, size: WRITE.lines[0]!.size },
    { from: landed(L3.words[0]!), to: turnAt, side: 'R', box: writeBoxR, size: WRITE.lines[0]!.size },
  ];

  // Every animated value, quantised once: the keys encode exactly these, and the faces draw exactly these.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  const sixteenth = 60 / audio.bpm / 4;
  const stampState = (t: number, at: number) => ({
    ink: t < at ? 0 : q(prog(t, at, at + sixteenth, ease.outCubic), STEPS.ink),
    settle: t < at ? 1 : q(prog(t, at, at + STAMP.settleS, ease.outCubic), STEPS.settle),
  });
  const writeAt = (t: number) => lazy().write.map((st, i) => q(writtenLength(st, writeTimes[i]!, t) / st.total, STEPS.write));

  // ---- drawing ----
  const drawBoxRule = (c: CanvasRenderingContext2D, box: Box, alpha = 0.55) => {
    c.strokeStyle = rgba('ink', alpha);
    c.lineWidth = 0.8;
    c.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  };
  const drawStatic = (c: CanvasRenderingContext2D, box: Box, label: string, lines: readonly string[]) => {
    drawBoxRule(c, box);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink');
    c.font = font(SMALL.family, SMALL.size);
    c.letterSpacing = '1px';
    c.fillText(label, box[0] + PAD, box[1] + PAD + SMALL.size);
    c.letterSpacing = '0px';
    c.font = font(BODY.family, BODY.size);
    lines.forEach((l, i) => c.fillText(l, box[0] + PAD, box[1] + PAD + SMALL.size + 6 + (i + 1) * BODY.lh));
  };
  const drawStamp = (c: CanvasRenderingContext2D, box: Box, text: string, index: number, s: ReturnType<typeof stampState>) => {
    if (s.ink <= 0) return;
    const by = STAMP.by[index]!;
    c.save();
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, k = 1 + STAMP.grow * (1 - s.settle);
    c.translate(cx, cy);
    c.scale(k, k);
    if (by.solid) { // the box itself, solid ink, punching in with its type
      c.fillStyle = rgba('ink', s.ink);
      c.fillRect(box[0] - cx, box[1] - cy, box[2] - box[0], box[3] - box[1]);
    }
    const w = measure(text, STAMP.family, by.size), size = Math.min(by.size, (by.size * (box[2] - box[0] - 2 * PAD)) / w);
    c.font = font(STAMP.family, size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = by.solid ? rgba('paper', s.ink) : rgba('ink', s.ink);
    c.fillText(text, 0, 0);
    c.restore();
    if (!by.solid) drawBoxRule(c, box, 0.55 * s.ink);
  };
  /** A giant display word at its ink, horizontally scaled (with its neighbour, by the same factor) to the display's
   *  own target width (DISPLAY_W): a wider weight than Bodoni's 400 lyrics, cut off by nothing (the house's giant
   *  type is for bleeding off the page; these two sit inside their boxed ad, as the spec's "boxed ad" calls for). */
  const drawDisplay = (c: CanvasRenderingContext2D, box: Box, fam: string, size: number, w0: Word, w1: Word, t: number, printed = false) => {
    drawBoxRule(c, box);
    const text0 = w0.w.toUpperCase(), text1 = `${w1.w.replace(/[^\p{L}]/gu, '').toUpperCase()}.`;
    const full = `${text0} ${text1}`, natural = measure(full, fam, size), k = DISPLAY_W / natural;
    const gap0 = measure(`${text0} `, fam, size);
    c.save();
    c.font = font(fam, size);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.translate(box[0], (box[1] + box[3]) / 2 + size * 0.36);
    c.scale(k, 1);
    c.fillStyle = rgba('ink', printed ? 1 : ghostAlpha(inkAt(w0, t)));
    c.fillText(text0, 0, 0);
    c.fillStyle = rgba('ink', printed ? 1 : ghostAlpha(inkAt(w1, t)));
    c.fillText(text1, gap0, 0);
    c.restore();
  };
  const drawCell = (c: CanvasRenderingContext2D, t: number, cell: Cell) => {
    const box = boxOf(cell);
    if (cell.item.kind === 'static') drawStatic(c, box, cell.item.label, cell.item.lines);
    else drawStamp(c, box, cell.item.text, cell.item.index, stampState(t, stampAt[cell.item.index]!));
  };
  const drawHead = (c: CanvasRenderingContext2D, side: Side) => {
    const off = offOf(side);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink');
    c.font = font(F.bodoni(900), HEAD.size);
    c.fillText(HEAD.text, lazy().headX - off, HEAD.y);
    const x0 = Math.max(0, RULE.x0 - off), x1 = Math.min(PAGE.w, RULE.x1 - off);
    if (x1 > x0) c.fillRect(x0, RULE.y - RULE.w / 2, x1 - x0, RULE.w);
    if (side === 'L') {
      c.font = font(SMALL.family, SMALL.size);
      c.letterSpacing = `${STRAP.track}px`;
      c.fillText(STRAP.text, STRAP.x, STRAP.y);
      c.letterSpacing = '0px';
    }
  };
  const drawWrite = (c: CanvasRenderingContext2D, side: Side, t: number) => {
    writeAt(t).forEach((f, i) => {
      if (f <= 0) return;
      const l = WRITE.lines[i]!, st = lazy().write[i]!;
      c.save();
      c.translate(l.x - offOf(side), l.y);
      c.rotate(WRITE.rot);
      lipstickWrite(c, st, f * st.total, { width: l.width, seed: l.seed });
      c.restore();
    });
  };

  const step = (x: number, n: number) => Math.round(x * n);
  const stampKey = (t: number, i: number) => { const s = stampState(t, stampAt[i]!); return `${step(s.ink, STEPS.ink)},${step(s.settle, STEPS.settle)}`; };
  return {
    id: 'classifieds', section, pages,
    drawPrint(side, c, t) {
      drawHead(c, side);
      if (side === 'L') drawDisplay(c, LEFT_DISPLAY, stretchFamily(EXTREME_STEP, 900), EXTREME_SIZE, so1, extreme, t);
      else drawDisplay(c, RIGHT_DISPLAY, F.bodoni(700, { italic: true }), EFFORTLESS_SIZE, so2, effortlessly, t, true); // (printed in full, waiting)
      for (const cell of side === 'L' ? LEFT_GRID : RIGHT_GRID) drawCell(c, t, cell);
      drawFolio(c, side, pages[side === 'L' ? 0 : 1]);
    },
    drawMarks(side, c, t) {
      drawWrite(c, side, t);
    },
    key(side, layer, t) {
      if (layer === 'marks') return writeAt(t).map((f) => step(f, STEPS.write)).join(',');
      const grid = side === 'L' ? LEFT_GRID : RIGHT_GRID;
      const stamps = grid.filter((c) => c.item.kind === 'adlib').map((c) => stampKey(t, (c.item as { index: number }).index)).join('|');
      return side === 'L' ? `${karaokeKey([L1], t)}|${stamps}` : stamps;
    },
    camera, focus,
  };
};
