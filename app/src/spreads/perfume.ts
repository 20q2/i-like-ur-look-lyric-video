// Spread 4, Perfume ad (verse 2a, pp. 8-9): an invented fragrance ad in house style B.
// The left page is solid ink: LUI, a faceted flacon drawn huge in paper-white
// line art cut out of the black, drawing itself on "Acqua Di Gio" (the lyric names a real one; the ad never does). The
// right page is the ad's tagline, lyric 1 set over three rows of giant italic, the last the largest, with the scent
// strip low in the corner: a paper strip that peels up on "sheets" and tears off at its perforation, flung away (a piece
// of paper of its own: engine/cutout.ts), revealing the narrator's kiss underneath. Lyric 2
// runs beside it. The narrator underlines "just for me" on "me".
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { drawFolio, karaokeKey, setLine, setRows, subLine, type Row, type Side } from '../engine/layout';
import { STRETCH_STEPS, drawStretch, knockout } from '../engine/print';
import { kiss, lipstickStroke } from '../engine/lipstick';
import { makeDrawing } from '../engine/drawing';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { ease, prog } from '../engine/util';
import { ART, artDrawings, drawArt } from './art';
import { kicksAcross, sectionLine } from './cues';
import { type Box, type Shot, director, plan, resolveAt } from './shots';
import { drawCutShadow } from '../engine/cutout';
import { type Cutout, type FocusBox, type SpreadFactory, turnOut } from './spread';

// ---- the layout (page units, each face's own) ----
/** The flacon, placed huge on the black page: ART.flacon's box (local units) at (x, y), times `scale`. */
const FLACON_PLACE = { x: 235, y: 60, scale: 1.25 } as const;
/** Its placed box (ART.flacon.box times FLACON_PLACE, for the focus guard): a drawing, so no size. */
const FLACON_BOX: Box = [278, 54, 492, 542];
/** LUI, cut, low on the page, centred; EAU DE PARFUM under it, tracked mono. */
const LUI = { x: 385, y: 860, size: 300 } as const;
const EAU = { x: 385, y: 935, size: 13, track: 4 } as const;
/** Small mono meant to be read: Plex Mono 600 at >= 10.5 pu (TREATMENT §6). */
const SMALL = { family: F.mono(600), size: 11 } as const;
const ITALIC = F.bodoni(400, { italic: true });
/** The right page's title, the ad's headline over the tagline: a tracked mono kicker, then a heavy grotesque in caps
 *  stretched to the column — set apart from the lyrics' italic Didone, so it never reads as one. */
const TITLE = { kicker: 'ADVERTISEMENT · LUI, EAU DE PARFUM', kx: 58, ky: 104, text: 'WORN CLOSE.', x: 54, y: 206, size: 104, step: STRETCH_STEPS, w: 662 } as const;
/** Bodoni Moda's display-cut cap height, per pu of size (TREATMENT §6, FocusBox.size). */
const CAP = 0.75;

/** The tagline: lyric 1 over three rows, ascending, the last the largest ("I want you to" / "dress" / "just for me"),
 *  its word range into L1 [from, to). */
const ROW1 = { x: 58, y: 330, size: 58, words: [0, 4] as const };
const ROW2 = { x: 58, y: 480, size: 102, words: [4, 5] as const };
const ROW3 = { x: 58, y: 700, size: 130, words: [5, 8] as const };
/** Lyric 2, beside the strip, in italic at 34 pu, over two rows. */
const L2_SIZE = 34;
const L2_ROWS: readonly Row[] = [{ x: 58, y: 870, words: [0, 4] }, { x: 58, y: 912, words: [4, 7] }];

/** The scent strip: a paper strip, perforated along its top (hinge) edge, "LIFT TO SAMPLE" on its face. On "sheets"
 *  it peels up about the perforation over `peelS`, easing up, then tears off along it and is flung out of frame over
 *  `flyS` (spread.ts Cutout; engine/cutout.ts CUT's motion), leaving its kiss bare. */
const STRIP = { x0: 410, y0: 830, x1: 710, y1: 940, peelS: 0.3, flyS: 0.45 } as const;
/** Its shadow while it's loose (engine/cutout.ts drawCutShadow). */
const SHADOW = { amt: 0.4, fadeH: 0.3, pts: 48 } as const;
/** Her kiss, under the strip: centred in it, already pressed (press 1, lift 0) — it's been there a while. */
const KISS = { x: 560, y: 885, size: 85, rot: -0.08, seed: 51 } as const;

/** The underline under "just for me", roughly below row 3's extent: a hand's sagging stroke, lifting off at the end
 *  (as the cover story's underline does). Fixed coordinates (not measured: the factory must not touch the DOM). */
const UL = (() => {
  const x0 = 50, x1 = 648, y = 724;
  const d = makeDrawing([`M${x0} ${y} C${x0 + (x1 - x0) * 0.33} ${y + 10} ${x0 + (x1 - x0) * 0.75} ${y + 9} ${x1} ${y - 4}`]);
  return { pts: d.strokes[0]!, len: d.total };
})();
const UL_BOX: Box = [44, 706, 660, 748];
const UL_S = 0.35;

/** Each stroke group of the flacon inks over GROUP_S (s) from its kick, across "Acqua Di Gio" (kicksAcross). */
const GROUP_S = 0.4;
/** Quantisation steps (the keys and the drawing share them). */
const STEPS = { flacon: 48, shadow: 48, ul: 24 } as const;

/** A line of `section`, its word count checked (a re-alignment that split or merged words would move every cue). */
function lineOf(lyrics: Lyrics, section: string, text: string, words: number): Line {
  const l = sectionLine(lyrics, section, text);
  if (l.words.length !== words) throw new Error(`perfume: "${l.text}" has ${l.words.length} words, expected ${words}`);
  return l;
}

export const perfume: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = lineOf(lyrics, section, 'I want you to dress just for me', 8);
  const L2 = lineOf(lyrics, section, 'Your Acqua Di Gio on my sheets', 7);
  const w = (l: Line, i: number) => l.words[i]!;
  const [iWord, want, , , dress, just, forWord, me] = L1.words as [Word, Word, Word, Word, Word, Word, Word, Word];
  const [your, acqua, , gio, , , sheets] = L2.words as [Word, Word, Word, Word, Word, Word, Word];

  // ---- the flacon: a technical flat, new in art.ts, inking group by group across "Acqua Di Gio" ----
  const flacon = artDrawings(ART.flacon, 401);
  const flaconAt = kicksAcross(audio, flacon.length, acqua.start, gio.end);

  // ---- the camera: Snap, looking down. The tagline reads over three holds (its rows each a size), a push to the
  // underline on "for me" — held wide enough at the foot to keep "Your" (lyric 2's first word) readable too, since it
  // sings right on L1's heel. On "Acqua" (not "Your") it pulls out to the spread: the flacon draws itself on "Acqua Di
  // Gio" (the brief's own pairing), on the left, while the words it draws on are sung in the right page's corner, both
  // in view, and it holds there to the turn: the flacon finishes, "sheets" lifts the strip's end in the corner. ----
  const shots: Shot[] = [
    { at: iWord, frame: { side: 'R', box: [40, 60, 740, 800] } }, // the title and the tagline whole, after the turn lands
    { at: dress, frame: { side: 'R', box: [40, 400, 740, 800] } }, // "dress": a snap closer (dress, and just for me)
    { at: forWord, frame: { side: 'R', box: [40, 610, 740, 935] } }, // "for me": closer, the underline, "Your" at the foot
    { at: acqua, frame: 'spread' }, // "Acqua": out to the spread, the flacon drawing on the left, the words in the corner
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  /** A word reads from its start, or, if the camera is still travelling then, from where that move lands — but never
   *  later than a second word (a single word: its own end). */
  const settledAt = (w0: Word, w1?: Word) => {
    const m = moves.findLast((x) => x.at <= w0.start), latest = w1 ? w1.start : w0.end;
    return m && w0.start < m.land ? Math.min(m.land, latest) : w0.start;
  };
  /** When the move a cue starts has landed, as the director plans it. */
  const landed = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`perfume: no shot starts at ${at.toFixed(3)}`);
    return m.land;
  };

  // ---- the underline: drawn over UL_S from "me", as it's sung ----
  const ulFrom = me.start, ulTo = Math.min(ulFrom + UL_S, L1.end);

  // what must read when: each row of the tagline over its own span (row 2 and row 3 stay in frame from the "dress"
  // snap on; row 1 is zoomed past once that snap lands); the underline, drawn; lyric 2's "Your", still at the foot of
  // the "for me" hold, then "on my sheets" once the camera is back from the flacon (the words it draws on, "Acqua Di
  // Gio", are what it's about instead — the flacon's own box, below, covers them); the strip (and the kiss it
  // reveals), while it peels.
  const row1To = Math.min(w(L1, ROW1.words[1] - 1).end, resolveAt(dress));
  const focus: FocusBox[] = [
    { from: settledAt(iWord, want), to: row1To, side: 'R', box: [40, 280, 560, 350], size: CAP * ROW1.size },
    { from: settledAt(dress), to: dress.end, side: 'R', box: [40, 400, 360, 515], size: CAP * ROW2.size },
    { from: settledAt(just, forWord), to: me.end, side: 'R', box: [40, 595, 730, 745], size: CAP * ROW3.size },
    { from: ulFrom, to: ulTo, side: 'R', box: UL_BOX },
    { from: settledAt(your, acqua), to: resolveAt(acqua), side: 'R', box: [40, 840, 170, 900], size: CAP * L2_SIZE },
    { from: landed(acqua), to: turnAt, side: 'L', box: FLACON_BOX },
    { from: settledAt(acqua, gio), to: L2.end, side: 'R', box: [40, 840, 410, 935], size: CAP * L2_SIZE },
    { from: sheets.start, to: turnAt, side: 'R', box: [400, 815, 715, 955] },
  ];

  // Every animated value, quantised once: the keys encode exactly these, and the faces draw exactly these.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  /** The strip coming loose (spread.ts Cutout.loose): null before "sheets" and once it's gone. Unquantised: the mesh
   *  moves smoothly; its shadow, on the face, is quantised (state). */
  const tearAt = sheets.start + STRIP.peelS, goneAt = tearAt + STRIP.flyS;
  if (!(goneAt <= turnAt)) throw new Error(`perfume: the strip is still flying at ${goneAt.toFixed(3)}, past the turn (${turnAt})`);
  const loose = (t: number) => (t < sheets.start || t >= goneAt ? null : {
    peel: ease.outCubic(prog(t, sheets.start, tearAt)), fly: ease.inQuad(prog(t, tearAt, goneAt)),
  });
  const cutout: Cutout = {
    side: 'R', shape: 'rect', x: (STRIP.x0 + STRIP.x1) / 2, y: (STRIP.y0 + STRIP.y1) / 2, rx: (STRIP.x1 - STRIP.x0) / 2, ry: (STRIP.y1 - STRIP.y0) / 2,
    tab: -Math.PI / 2, loose, // (hinged on its top edge, the perforation)
  };
  const state = (t: number) => {
    const lo = loose(t);
    return {
      flacon: flaconAt.map((a) => q(prog(t, a, a + GROUP_S, ease.outCubic), STEPS.flacon)),
      /** The strip: 0 on the page, 1 peeling (its kiss bare under it), 2 torn off. */
      strip: t < sheets.start ? 0 : t < tearAt ? 1 : 2,
      /** While it's loose, for its shadow: its peel and fly, quantised (-1 otherwise). */
      peel: lo ? q(lo.peel, STEPS.shadow) : -1, fly: lo ? q(lo.fly, STEPS.shadow) : -1,
      ul: q(prog(t, ulFrom, ulTo, ease.outQuad), STEPS.ul),
    };
  };

  // ---- the left page: LUI, solid ink, the flacon cut out of it ----
  const drawLeft = (c: CanvasRenderingContext2D, s: ReturnType<typeof state>) => {
    c.fillStyle = rgba('ink');
    c.fillRect(0, 0, 770, 1000);
    knockout(c, (k) => {
      k.save();
      k.translate(FLACON_PLACE.x, FLACON_PLACE.y);
      k.scale(FLACON_PLACE.scale, FLACON_PLACE.scale);
      drawArt(k, flacon.slice(0, 2), s.flacon.slice(0, 2), 1 / FLACON_PLACE.scale);
      k.globalAlpha = 0.55; // the hatched glints: a lighter cut, a reflection rather than a line
      drawArt(k, flacon.slice(2), s.flacon.slice(2), 1 / FLACON_PLACE.scale);
      k.restore();
    });
    knockout(c, (k) => {
      k.textAlign = 'center';
      k.textBaseline = 'alphabetic';
      k.font = font(F.bodoni(900), LUI.size);
      k.fillText('LUI', LUI.x, LUI.y);
      k.font = font(SMALL.family, EAU.size);
      k.letterSpacing = `${EAU.track}px`;
      k.fillText('EAU DE PARFUM', EAU.x, EAU.y);
      k.letterSpacing = '0px';
      drawFolio(k, 'L', pages[0]);
    });
  };

  // ---- the strip: printed on the page until it comes loose (and as the loose piece's own face, 'C') ----
  const drawStrip = (c: CanvasRenderingContext2D) => {
    const { x0, y0, x1, y1 } = STRIP;
    c.fillStyle = rgba('paper2'); // (a tinted stock: TREATMENT §6)
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = rgba('graphite');
    c.lineWidth = 1;
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // the perforation along its top, as filled dashes: a dashed stroke here painted differently from one draw to the
    // next (the keys check: 9 levels along it, at one t)
    c.fillStyle = rgba('graphite');
    for (let x = x0 + 1.5; x + 3 <= x1; x += 6) c.fillRect(x, y0 + 3.5, 3, 1);
    c.fillStyle = rgba('ink', 0.85);
    c.font = font(SMALL.family, SMALL.size);
    c.textAlign = 'center';
    c.fillText('LIFT TO SAMPLE', (x0 + x1) / 2, y0 + 34);
  };

  /** Where it was: a faint dotted outline (filled dots: a dashed stroke here painted differently draw to draw), and once
   *  it's torn off, the perforation's stubs along its top. */
  const drawStripGone = (c: CanvasRenderingContext2D, torn: boolean) => {
    const { x0, y0, x1, y1 } = STRIP;
    c.fillStyle = rgba('graphite', 0.5);
    for (let x = x0; x + 3 <= x1; x += 6) { c.fillRect(x, y0 - 0.5, 3, 1); c.fillRect(x, y1 - 0.5, 3, 1); }
    for (let y = y0; y + 3 <= y1; y += 6) { c.fillRect(x0 - 0.5, y, 1, 3); c.fillRect(x1 - 0.5, y, 1, 3); }
    if (torn) {
      c.fillStyle = rgba('paper2');
      for (let x = x0; x < x1; x += 6) c.fillRect(x, y0, 3, 4);
    }
  };
  const drawRight = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink');
    c.textAlign = 'left';
    c.font = font(SMALL.family, SMALL.size);
    c.letterSpacing = '2px';
    c.fillText(TITLE.kicker, TITLE.kx, TITLE.ky);
    c.letterSpacing = '0px';
    // (the ad's own voice, a heavy grotesque in caps stretched to the column: never the lyrics' italic Didone, or it
    // reads as one)
    drawStretch(c, TITLE.text, TITLE.x, TITLE.y, TITLE.size, TITLE.step, { weight: 900, width: TITLE.w });
    c.fillStyle = rgba('ink');
    setLine(c, subLine(L1, ROW1.words[0], ROW1.words[1]), t, ROW1.x, ROW1.y, { family: ITALIC, size: ROW1.size, hairline: true });
    setLine(c, subLine(L1, ROW2.words[0], ROW2.words[1]), t, ROW2.x, ROW2.y, { family: ITALIC, size: ROW2.size, hairline: true });
    setLine(c, subLine(L1, ROW3.words[0], ROW3.words[1]), t, ROW3.x, ROW3.y, { family: ITALIC, size: ROW3.size, hairline: true });
    setRows(c, L2, t, L2_ROWS, { family: ITALIC, size: L2_SIZE, hairline: true });
    if (s.strip === 0) drawStrip(c);
    else drawStripGone(c, s.strip === 2);
    drawFolio(c, 'R', pages[1]);
    if (s.peel >= 0) drawCutShadow(c, { ...cutout, peel: s.peel, fly: s.fly }, (a) => rgba('ink', a), SHADOW);
  };

  const step = (x: number, n: number) => Math.round(x * n);
  return {
    id: 'perfume', section, pages,
    drawPrint(side, c, t) {
      if (side === 'L') drawLeft(c, state(t));
      else if (side === 'R') drawRight(c, t, state(t));
      else drawStrip(c); // 'C': the strip, loose
    },
    drawMarks(side, c, t) {
      if (side !== 'R') return; // (the strip, 'C', has none)
      const s = state(t);
      if (s.ul > 0) lipstickStroke(c, UL.pts, s.ul * UL.len, { width: 7, seed: 81 });
      if (s.strip > 0) kiss(c, KISS.x, KISS.y, KISS.size, KISS.rot, 1, 0, KISS.seed); // (bare once the strip lifts)
    },
    key(side, layer, t) {
      if (side === 'L') return layer === 'marks' ? '' : state(t).flacon.map((x) => step(x, STEPS.flacon)).join(',');
      if (side === 'R') {
        const s = state(t);
        if (layer === 'marks') return `${step(s.ul, STEPS.ul)},${s.strip > 0 ? 1 : 0}`;
        return `${karaokeKey([L1, L2], t)}|${s.strip},${step(s.peel, STEPS.shadow)},${step(s.fly, STEPS.shadow)}`;
      }
      return 'strip'; // 'C': it doesn't change
    },
    camera, focus, cutout,
  };
};
