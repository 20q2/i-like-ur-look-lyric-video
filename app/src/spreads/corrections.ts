// Spread 6, Corrections (pre-chorus 2; pp. 12–13 in the flatplan): the magazine's corrections column, setting the
// record straight on its own obituary and SPLIT notice (spread 2, In Memoriam, pp. 4–5), in house style B.
// CORRECTIONS across the top of both pages, cut by both
// outer edges; under it the corrections, each quoting what the magazine printed (the pre-chorus again, as quotations)
// and correcting it, deadpan: correction 1 on the left page ("She is not. We regret the error."), correction 2 on the
// right ("They are not."), and correction 3, the Editors' last word, cut out of a black band across the foot of the
// spread. The narrator won't have it: she strikes "She is not." on "dead" and "They are not." on "done", and on "fun"
// slashes one heavy diagonal through the whole of correction 3, which the turning leaf carries away.
import { F, font, glyphX, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { PAGE, type Side, drawFolio, karaokeKey, setLine, setRows } from '../engine/layout';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { knockout } from '../engine/print';
import { lipstickStroke } from '../engine/lipstick';
import { type V2, ease, noise1, polylineLengths, prog } from '../engine/util';
import { sectionLine } from './cues';
import { ANGLES, type Box, type Shot, beatAtOrBefore, director, eighthAtOrAfter, fit, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';

// ---- the layout (page units, each face's own; "spread x" runs on across the gutter, the right face at x − 770) ----
// Three tiers, the camera's framings fitted to their gaps: the head across the top, the corrections in the middle, the
// band across the foot. Every hold's top and bottom edges fall in gaps between lines of type through the groove's
// punches and the hand (measured at every frame of each hold: a hold's top edge rides 2–29 pu below where it rests, its
// bottom 13 above to 3 below). Close framings are 860–950 pu across, wider than a page: on the outer side they take in
// a decisive strip of the bed past the page's edge, on the inner side the clear tier about the gutter.
/** The head, Bodoni 900, its baseline at y: CORRECTIONS set so its E|C join falls on the gutter (spread x 770: no
 *  letter is creased), measured on first draw; so set, the outer edges cut its C (~20 pu) and its S (to a quarter). */
const HEAD = Object.freeze({ text: 'CORRECTIONS', size: 210, y: 236, join: 5, at: 770 });
/** A hairline under the head, margin to margin across the spread (spread x). */
const RULE = Object.freeze({ y: 252, x0: 48, x1: 2 * PAGE.w - 48, w: 0.8 });
/** Under it: the strap, left (mono), and "& CLARIFICATIONS", right (the text cut's italic, tracked, flush right). */
const STRAP = Object.freeze({ text: 'THE RECORD, SET STRAIGHT', x: 48, y: 288, track: 3 });
const AMP = Object.freeze({ text: '& CLARIFICATIONS', x: 722, y: 288, size: 30, track: 2 });
/** The corrections' columns: correction 1 flush left on the left page's outer margin; corrections 2 and 3 at x 150 on
 *  the right page, centred under the right page's framings. The quotations' opening marks hang in the margin. About the
 *  gutter the middle tier stays clear (lyric 2, the longest line, ends at x 637): a left-page framing's right edge
 *  finds paper there, short of correction 2, and a right-page framing's left edge finds it past lyric 2. */
const COL = Object.freeze({ L: 48, R: 150 });
/** Corrections 1 and 2 share their baselines: the lead-in, the quotation's two rows, the correction. */
const ROW = Object.freeze({ lead: 384, quote: [460, 524] as const, deny: 614 });
/** The band: solid ink from here to the foot of both pages, bleeding off the outer edges. */
const BAND = Object.freeze({ y: 720 });
/** In it, cut, below the strip of band the close framings take in: the corrections policy (left page) and correction 3
 *  (right page: the quotation and the sign-off). */
const POLICY = Object.freeze({ x: 48, y: 838, gap: 24, lead: 16 });
const C3 = Object.freeze({ quote: 870, sign: 914 });
/** Type (pu). The quotations are the display italic, and their focus boxes give its cap height (Bodoni Moda's OS/2
 *  sCapHeight, 0.75 em), as the guard takes display type (FocusBox.size). */
const SIZE = Object.freeze({ quote: 52, lead: 20, deny: 30, sign: 20, cap: 0.75 * 52 });
/** Small mono meant to be read: Plex Mono 600 at 10.5 pu or more (TREATMENT §6). */
const SMALL = Object.freeze({ family: F.mono(600), size: 10.5 });

const GIANT = F.bodoni(900), ITALIC = F.bodoni(400, { italic: true });
const TEXT = F.bodoni(400, { text: true }), TEXT_ITALIC = F.bodoni(400, { italic: true, text: true });

/** The deadpan small print in the band: its head, then the policy. */
const POLICY_LINES = Object.freeze([
  'CORRECTIONS POLICY',
  'EFFORTLESS CORRECTS ERRORS OF FACT IN THE',
  'NEXT AVAILABLE ISSUE. LETTERS MAY BE',
  'EDITED FOR LENGTH AND CLARITY.',
  'WRITE TO THE EDITORS, BOX 47.',
]);

// ---- the camera's framings: page boxes, fitted without padding, so their edges are placed (see the layout) ----
/** The glide along the head and in under it: from the head whole (its tops clear, the satin past the page's outer
 *  edge, the C running off the paper; dist 1.17) to correction 1 (dist 1.0), the frame's top through the letters; its
 *  foot over the paper above the band, its right edge short of correction 2 throughout. */
const GLIDE_FROM: Box = [-200, 70, 820, 630], GLIDE_TO: Box = [-50, 180, 820, 640];
/** Correction 1 and its strike, close (dist 0.9): the top between the strap and the lead-in, the foot a strip of the
 *  band, above the policy. */
const C1_FRAME: Box = [-40, 345, 780, 775];
/** Across to correction 2 under the head's end and "& CLARIFICATIONS", the S running off the page: the top through the
 *  letters, the foot over the paper above the band. */
const C2_FRAME: Box = [-60, 180, 820, 640];
/** Correction 2's strike, close: as correction 1's. */
const STRIKE_FRAME: Box = [0, 345, 820, 775];
/** Correction 3 in the band, the struck correction above it: the top between the quotation and the correction, the foot
 *  past the page's (a strip of the bed). */
const C3_FRAME: Box = [-40, 580, 800, 1040];

// ---- the lipstick: hard strike-throughs, the narrator's (Markup) ----
/** A strike: from `a` to `b` (its face's pu), bowed `bow` pu off the chord at its middle (+ to the right of the way
 *  it's drawn), at `width`, with its brush's seed. */
interface Strike { side: Side; a: V2; b: V2; bow: number; width: number; seed: number }
/** "She is not." (Bodoni text 30 at (48, 614): 139 pu, its x-height 14) and "They are not." (181 pu at (150, 614)),
 *  each struck through its lowercase from a little before it to a little past it, rising as a hand's stroke does. */
const STRIKE_SHE: Strike = { side: 'L', a: { x: 38, y: 608 }, b: { x: 198, y: 603 }, bow: -1.5, width: 8, seed: 61 };
const STRIKE_THEY: Strike = { side: 'R', a: { x: 140, y: 608 }, b: { x: 342, y: 602 }, bow: -1.5, width: 8, seed: 62 };
/** The heavy diagonal through the whole of correction 3, from above its label to past the sign-off. */
const SLASH: Strike = { side: 'R', a: { x: 100, y: 806 }, b: { x: 585, y: 948 }, bow: 6, width: 16, seed: 63 };
/** The slash is drawn over "fun" as it's sung up to the turn, and needs at least this long (s). */
const SLASH_MIN_S = 0.25;
/** Quantisation steps: every animated value is one of these many levels (the keys and the drawing share them). */
const STEPS = Object.freeze({ strike: 16, slash: 24 });

/** A strike's polyline: the chord bowed into a shallow arc, with a hand's slight tremor (deterministic in its seed). */
function strikePath(s: Strike, n = 32): V2[] {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n, off = s.bow * 4 * u * (1 - u) + 0.6 * noise1(u * 4, s.seed);
    return { x: s.a.x + dx * u + nx * off, y: s.a.y + dy * u + ny * off };
  });
}
const pad = (b: Box, r: number): Box => [b[0] - r, b[1] - r, b[2] + r, b[3] + r];
const bounds = (pts: readonly V2[]): Box => [
  Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)),
];

/** A line of `section`, its word count checked (a re-alignment that split or merged words would move every cue). */
function lineOf(lyrics: Lyrics, section: string, text: string, words: number): Line {
  const l = sectionLine(lyrics, section, text);
  if (l.words.length !== words) throw new Error(`corrections: "${l.text}" has ${l.words.length} words, expected ${words}`);
  return l;
}
/** The line as quoted: its first word printed after an opening quotation mark, its last before a closing one (each
 *  as asked). The marks are print, not lyric, but they ink with the words they're set against. */
function quoted(l: Line, open: boolean, close: boolean): Line {
  const n = l.words.length;
  const words = l.words.map((w, i) => ({ ...w, w: `${open && i === 0 ? '“' : ''}${w.w}${close && i === n - 1 ? '”' : ''}` }));
  return { ...l, words, text: words.map((w) => w.w).join(' ') };
}

export const corrections: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = lineOf(lyrics, section, 'Tonight, just pretend', 3);
  const L2 = lineOf(lyrics, section, "That she's dead and gone", 5);
  const L3 = lineOf(lyrics, section, "Tell me y'all are done", 5);
  const L4 = lineOf(lyrics, section, 'It could be so fun', 5);
  // the words things happen on, by name: a shot's cue and every lookup of it use the same one
  const tonight = L1.words[0]!, thatShes = L2.words[0]!, dead = L2.words[2]!;
  const tellMe = L3.words[0]!, done = L3.words[4]!, itCould = L4.words[0]!, fun = L4.words[4]!;
  const Q1 = quoted(L1, true, false), Q2 = quoted(L2, false, true), Q3 = quoted(L3, true, true), Q4 = quoted(L4, true, true);
  const eighth = 30 / audio.bpm;

  // ---- the camera: Snap, a framing per correction, looking down ----
  // The glide starts on "Tonight" from where the turn has brought the camera (the director's start) and lands on the
  // last beat before the snap to correction 1. Correction 3's framing is cued on "It" (L3's "done" has already ended:
  // they're back to back at 78.64), so lyric 4 reads from its first word once the snap lands. The camera goes out on
  // "fun" as she slashes, to the whole spread for the turn.
  const start = fit({ side: 'L', box: GLIDE_FROM }, ANGLES.top, 0, 0);
  const glideLands = beatAtOrBefore(audio, resolveAt(thatShes));
  if (!(glideLands - resolveAt(tonight) >= 1.5)) throw new Error(`corrections: the glide from "Tonight" (${resolveAt(tonight).toFixed(3)}) to the beat before "That" (${glideLands.toFixed(3)}) is under 1.5 s`);
  const shots: Shot[] = [
    { at: tonight, frame: { side: 'L', box: GLIDE_TO }, pad: 0, move: 'glide', until: glideLands }, // along the head
    { at: thatShes, frame: { side: 'L', box: C1_FRAME }, pad: 0 }, // correction 1 and its strike
    { at: tellMe, frame: { side: 'R', box: C2_FRAME }, pad: 0 }, // across to correction 2
    { at: done, frame: { side: 'R', box: STRIKE_FRAME }, pad: 0 }, // a snap to its strike
    { at: itCould, frame: { side: 'R', box: C3_FRAME }, pad: 0 }, // correction 3
    { at: fun, frame: 'spread' }, // out as she slashes it, to the whole spread (turn-ready: the right page in frame, dist 1.98)
  ];
  const camera = director(audio, shots, { turnAt, start });
  const moves = plan(audio, shots, { turnAt, start });
  /** When the move a cue starts has landed, as the director plans it. */
  const landed = (cue: Word) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`corrections: no shot starts on "${cue.w}" (${at})`);
    return m.land;
  };
  /** A line reads from its start, or, if the camera is still moving as it starts, from where that move lands — from its
   *  second word at the latest. (The move in flight is the last one started, as the director evaluates them.) */
  const settled = (l: Line) => {
    const m = moves.findLast((x) => x.at <= l.start);
    return m && l.start < m.land ? Math.min(m.land, l.words[1]!.start) : l.start;
  };

  // ---- the lipstick's timing: each strike inside the hold that frames it, so it's seen being made ----
  // "dead" on the eighth it starts on; "done" is held 1.8 s, and she strikes on the first eighth after the snap to it
  // lands; "fun" is sung past the turn (to 80.40, the leaf lifting from 79.94), so the slash is drawn over the word as
  // sung up to the turn: it's whole as the page goes, and the turn takes it (as In Memoriam's "fun").
  const slashEnd = Math.min(fun.end, turnAt);
  if (!(slashEnd - fun.start >= SLASH_MIN_S)) {
    throw new Error(`corrections: the slash has ${(slashEnd - fun.start).toFixed(3)} s, from "fun" (${fun.start}) to ${slashEnd === turnAt ? `the turn (${turnAt})` : `its end (${fun.end})`}; it needs ${SLASH_MIN_S}`);
  }
  const strikes = {
    she: { ...STRIKE_SHE, pts: strikePath(STRIKE_SHE), from: eighthAtOrAfter(audio, dead.start), dur: eighth },
    they: { ...STRIKE_THEY, pts: strikePath(STRIKE_THEY), from: eighthAtOrAfter(audio, landed(done)), dur: eighth },
    slash: { ...SLASH, pts: strikePath(SLASH), from: fun.start, dur: slashEnd - fun.start },
  };
  for (const [k, hold, leaves] of [['she', landed(thatShes), resolveAt(tellMe)], ['they', landed(done), resolveAt(itCould)]] as const) {
    const s = strikes[k];
    if (!(s.from >= hold && s.from + s.dur <= leaves)) throw new Error(`corrections: the strike "${k}" (${s.from.toFixed(3)}–${(s.from + s.dur).toFixed(3)}) isn't inside the hold that frames it (${hold.toFixed(3)}–${leaves.toFixed(3)})`);
  }
  const strikeLen = Object.fromEntries((['she', 'they', 'slash'] as const).map((k) => {
    const L = polylineLengths(strikes[k].pts);
    return [k, L[L.length - 1]!];
  })) as Record<keyof typeof strikes, number>;

  // what must read when: each line while it's sung (the glide keeps lyric 1 in frame from its first word), and each
  // strike, whole, while it's drawn
  const focus: FocusBox[] = [
    { from: L1.start, to: L1.end, side: 'L', box: [22, 418, 522, 474], size: SIZE.cap },
    { from: settled(L2), to: L2.end, side: 'L', box: [44, 482, 642, 538], size: SIZE.cap },
    // L3 ends exactly as L4 starts ("done"|"It" back to back): the snap to correction 3 (a different framing, not a
    // superset of this one, unlike L1's into C1_FRAME) is cued LEAD early, so the pan is already well under way by
    // L3.end; clipped to where that move starts, matching the lead it's given.
    { from: settled(L3), to: Math.min(L3.end, resolveAt(itCould)), side: 'R', box: [124, 418, 497, 538], size: SIZE.cap },
    { from: settled(L4), to: slashEnd, side: 'R', box: [124, 828, 556, 884], size: SIZE.cap },
    ...(['she', 'they', 'slash'] as const).map((k): FocusBox => {
      const s = strikes[k];
      return { from: s.from, to: s.from + s.dur, side: s.side, box: pad(bounds(s.pts), s.width) };
    }),
  ];

  // Every animated value is quantised once, here; the keys encode exactly these values and the draws draw exactly them.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  const marks = (t: number) => ({
    she: q(prog(t, strikes.she.from, strikes.she.from + strikes.she.dur, ease.outQuad), STEPS.strike),
    they: q(prog(t, strikes.they.from, strikes.they.from + strikes.they.dur, ease.outQuad), STEPS.strike),
    slash: q(prog(t, strikes.slash.from, strikes.slash.from + strikes.slash.dur, ease.outQuad), STEPS.slash),
  });

  // ---- font-dependent measures, made on first draw (the factory must not touch the DOM) ----
  let cache: { headX: number; hang: number } | null = null;
  const lazy = () => (cache ??= {
    headX: HEAD.at - glyphX(HEAD.text, HEAD.join, GIANT, HEAD.size),
    hang: measure('“', ITALIC, SIZE.quote),
  });

  // ---- the faces ----
  /** The head and its rule on a face (spread x: each canvas clips its own half). */
  const drawHead = (c: CanvasRenderingContext2D, side: Side) => {
    const off = side === 'R' ? PAGE.w : 0, x0 = Math.max(0, RULE.x0 - off), x1 = Math.min(PAGE.w, RULE.x1 - off);
    c.font = font(GIANT, HEAD.size);
    c.fillStyle = rgba('ink');
    c.fillText(HEAD.text, lazy().headX - off, HEAD.y);
    c.fillRect(x0, RULE.y - RULE.w / 2, x1 - x0, RULE.w);
  };
  /** Small mono at (x, baseline y), tracked `track` px, flush left on x or flush right on its last letter. */
  const mono = (c: CanvasRenderingContext2D, text: string, x: number, y: number, track: number, align: 'left' | 'right' = 'left') => {
    c.font = font(SMALL.family, SMALL.size);
    c.letterSpacing = `${track}px`;
    // (the canvas's spacing trails the last letter too)
    c.fillText(text, align === 'right' ? x - (c.measureText(text).width - track) : x, y);
    c.letterSpacing = '0px';
  };
  const quote = { family: ITALIC, size: SIZE.quote, hairline: true } as const;

  const printLeft = (c: CanvasRenderingContext2D, t: number) => {
    const z = lazy();
    drawHead(c, 'L');
    mono(c, STRAP.text, STRAP.x, STRAP.y, STRAP.track);
    // correction 1
    c.font = font(TEXT, SIZE.lead);
    c.fillText('On p. 4 of this issue we printed:', COL.L, ROW.lead);
    setLine(c, Q1, t, COL.L - z.hang, ROW.quote[0], quote);
    setLine(c, Q2, t, COL.L, ROW.quote[1], quote);
    c.fillStyle = rgba('ink');
    c.font = font(TEXT, SIZE.deny);
    c.fillText('She is not. We regret the error.', COL.L, ROW.deny);
    // the band, the policy and the folio cut out of it
    c.fillRect(0, BAND.y, PAGE.w, PAGE.h - BAND.y);
    knockout(c, (k) => {
      POLICY_LINES.forEach((l, i) => mono(k, l, POLICY.x, POLICY.y + (i && POLICY.gap + (i - 1) * POLICY.lead), i ? 1 : 3));
      drawFolio(k, 'L', pages[0]);
    });
  };
  const printRight = (c: CanvasRenderingContext2D, t: number) => {
    const z = lazy();
    drawHead(c, 'R');
    c.font = font(TEXT_ITALIC, AMP.size);
    c.letterSpacing = `${AMP.track}px`;
    c.fillText(AMP.text, AMP.x - (c.measureText(AMP.text).width - AMP.track), AMP.y);
    c.letterSpacing = '0px';
    // correction 2
    c.font = font(TEXT, SIZE.lead);
    c.fillText('We also reported a split:', COL.R, ROW.lead);
    setRows(c, Q3, t, [{ x: COL.R - z.hang, y: ROW.quote[0], words: [0, 2] }, { x: COL.R, y: ROW.quote[1], words: [2, 5] }], quote);
    c.fillStyle = rgba('ink');
    c.font = font(TEXT, SIZE.deny);
    c.fillText('They are not. We regret the error.', COL.R, ROW.deny);
    // the band, correction 3 and the folio cut out of it
    c.fillRect(0, BAND.y, PAGE.w, PAGE.h - BAND.y);
    knockout(c, (k) => {
      k.font = font(TEXT, SIZE.sign);
      k.fillText('It could not. — The Editors', COL.R, C3.sign);
      drawFolio(k, 'R', pages[1]);
    });
    setLine(c, Q4, t, COL.R - z.hang, C3.quote, { ...quote, cut: true });
  };
  const drawStrike = (c: CanvasRenderingContext2D, k: keyof typeof strikes, p: number) => {
    if (!(p > 0)) return;
    const s = strikes[k];
    lipstickStroke(c, s.pts, p * strikeLen[k], { width: s.width, seed: s.seed });
  };

  /** A quantised value as its step index, for the keys (short, and exactly as distinct as the values). */
  const step = (x: number, n: number) => Math.round(x * n);
  return {
    id: 'corrections', section, pages,
    drawPrint(side, c, t) {
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      if (side === 'L') printLeft(c, t); else printRight(c, t);
    },
    drawMarks(side, c, t) {
      const m = marks(t);
      if (side === 'L') drawStrike(c, 'she', m.she);
      else { drawStrike(c, 'they', m.they); drawStrike(c, 'slash', m.slash); }
    },
    key(side, layer, t) {
      if (layer === 'marks') {
        const m = marks(t);
        return side === 'L' ? `${step(m.she, STEPS.strike)}` : `${step(m.they, STEPS.strike)},${step(m.slash, STEPS.slash)}`;
      }
      return side === 'L' ? karaokeKey([L1, L2], t) : karaokeKey([L3, L4], t);
    },
    camera, focus,
  };
};
