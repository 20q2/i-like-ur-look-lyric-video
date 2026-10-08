// Spread 8, Specimen fold-out (`specimen`, post-chorus 1, pp. 16-17 and the panels): the issue's centrefold, a real
// four-page gatefold (the engine's fold-out). The engine's own
// mapping (ENGINE.md "The fold-out") makes the folded right page panel A's outside, 'AO': so AO carries the folded
// teaser, "EXTREME" cut tall and narrow (Archivo step 0) with "UNFOLD ▸" down its outer edge, while the left page holds
// a huge cut "SO". On the downbeat after "extreme", panel A swings open: the centrefold page (R) is exposed, and
// EXTREME grows across it and the opening panel (step 3). A bar later panel B opens too, and EXTREME reaches its full
// step (5), across R, A's inside (AI) and B's inside (BI) — the type specimen's moment — with a grid of the word in
// every Archivo width x weight underneath. "So effortlessly" prints along the foot of all four pages in giant Bodoni
// italic, "effortlessly" inking syllable by syllable (it has no Word.syl: its span is split evenly into ef-fort-less-
// ly). As B lands, the black left page — a flap hinged on its outer edge (engine/cutout.ts: a page-sized cut-out) —
// folds out too, off the left of the frame, uncovering the white page under it, where "So effortlessly" starts. On the
// held note the lipstick underlines it the width of the whole centrefold. The panels and the flap fold back in (B and
// the flap, then A) before the turn.
//
// A black cover opens onto a white sheet: the left page and AO (the folded teaser) stay solid ink, their type cut out
// of the black (TREATMENT.md §6); the inside surfaces (R, AI, BI, and BO — A's back while B is folded on it) are bare
// paper with the specimen printed on it in ordinary ink, so the open centrefold reads as paper spread on the bed, not
// another black flap.
//
// ---- the layout (page units; a face beyond 'R' (BO/AI/BI) is drawn in the same local 0..770 box the engine positions
// wherever its panel currently is, so type crossing several faces is drawn on each at its own multiple of PAGE.w, as
// the gutter-crossing spreads draw across two — see EX and FOOT below). Sizes are fixed (not fit to the text at
// runtime): a FocusBox's `size` must be known without touching a font (the factory builds under bun), and the
// elements that do want to measure for position only (FOOT's syllable splits) are free to, in drawPrint (never
// called under bun: see tests/* — only the factory and camera/focus are). ----
const SO = Object.freeze({ x: 48, y: 1030, size: 420 }); // left page, Bodoni 900, bottom-cropped by the page edge
const AO_EXTREME = Object.freeze({ cx: 385, y: 560, size: 185 }); // AO, folded: EXTREME tall and narrow, step 0
const UNFOLD = Object.freeze({ x: 714, y: 900, size: 17, track: 3 }); // down AO's outer edge, reading bottom to top
// EXTREME once open: left-anchored near the gutter, its step rising 0 -> 3 (A open) -> 5 (B open) and its target width
// growing with it (wA: the 2-page reach once A alone is open, wB: the 3-page reach once B opens too).
const EX = Object.freeze({ x: 58, y: 340, size: 345, w0: 520, wA: 1450, wB: 2260 });
const CAP_ARCHIVO = 0.686; // Archivo 900's cap height, as a fraction of its size (coverstory.ts CAP.archivo)
// The specimen grid: 2 columns (the page's own two widths) x 4 rows (every weight), a mono label ("62 / 300") then the
// sample words at the row's own width and weight.
const GRID = Object.freeze({ colX: [58, 420], y0: 430, rowH: 36, labelSize: 12, sampleSize: 22 });
// "So effortlessly" along the foot of all four pages, giant Bodoni italic.
const FOOT = Object.freeze({ x: 54, y: 940, size: 450 });
// The underline: one long lipstick stroke under "effortlessly", the width of the whole centrefold (not just the word).
const UNDERLINE = Object.freeze({ x0: 30, x1: 4 * 770 - 30, y: 968, width: 9, seed: 71 });

import { PAGE } from '../engine/layout';
import { ghostAlpha, inkAt, INK_STEPS } from '../engine/layout';
import { Lyrics, type Word } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { lipstickStroke } from '../engine/lipstick';
import { ARCHIVO_WEIGHTS, ARCHIVO_WIDTHS, F, font, glyphX, measure } from '../engine/type';
import { stretchFamily } from '../engine/print';
import { type V2, clamp, ease, noise1, polylineLengths } from '../engine/util';
import { sectionLine } from './cues';
import { type Shot, beatAtOrAfter, director, downbeatAtOrAfter } from './shots';
import { type CameraPose, type Cutout, type FocusBox, type Panels, type SpreadFactory, FRAME_SPREAD, turnOut } from './spread';
import { drawCutShadow } from '../engine/cutout';

const GIANT = F.bodoni(900), ITALIC = F.bodoni(400, { italic: true });
const MONO = F.mono(600);

/** The whole centrefold's pose: the pages' own two-page framing widened by a page per open panel — pose(2, dist) is
 *  plain FRAME_SPREAD at a different distance, pose(4, 3.55) centres at world x 0.77, as the engine note gives it. */
const pose = (pageCount: number, dist: number): CameraPose => ({ ...FRAME_SPREAD, x: (0.77 * (pageCount - 2)) / 2, dist });

export const specimen: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = sectionLine(lyrics, section, 'So extreme');
  const L2 = sectionLine(lyrics, section, 'So effortlessly');
  if (L1.words.length !== 2 || L2.words.length !== 2) throw new Error('specimen: "So extreme" / "So effortlessly" are expected to be two words each');
  const [so1, extreme] = L1.words as [Word, Word];
  const [so2, effortlessly] = L2.words as [Word, Word];

  // ---- the panels: A opens on the downbeat after "extreme", B a bar later; B folds back on the downbeat at or after
  // 108.5 (108.593), A half a bar after it, each fold-back in a beat; the turn is at turnAt (110.385) ----
  const beat = 60 / audio.bpm;
  const A_OPEN = downbeatAtOrAfter(audio, extreme.end);
  const B_OPEN = audio.timeOfBeat(audio.beatAt(A_OPEN) + 4); // one bar later
  const OPEN_S = 0.55; // the panels' own open move (foldtest.ts's MOVE_S)
  const B_CLOSE = downbeatAtOrAfter(audio, 108.5);
  const A_CLOSE = audio.timeOfBeat(audio.beatAt(B_CLOSE) + 2); // half a bar later
  const CLOSE_S = beat; // "each in a beat"
  /** Once B has finished opening: the type specimen's moment arrives all at once (the grid, and "So effortlessly"
   *  along the foot) rather than leaking in while only A is open, where R (and the opening panel) are already
   *  composited and would otherwise show it early. */
  const OPEN_DONE = B_OPEN + OPEN_S;
  /** From OPEN_DONE, the grid's four rows and then the foot drop down into place out from under EXTREME (clipped to
   *  below its baseline, so they come from behind it), one after another `stagger` apart, each over `s` with a little
   *  bounce — rather than blinking in. Each falls from wholly behind EXTREME: its top (`tops`: a row's label's, the
   *  foot's ascenders) `clear` pu above the clip. Quantised to `steps`. */
  const DROP = Object.freeze({ stagger: 0.07, s: 0.38, steps: 24, clipBelow: EX.y + 12, clear: 10 });
  const dropTop = (i: number) => (i < ARCHIVO_WEIGHTS.length ? GRID.y0 + i * GRID.rowH - GRID.labelSize : FOOT.y - 0.8 * FOOT.size);
  const fallOf = (i: number) => dropTop(i) - DROP.clipBelow + DROP.clear;
  const dropAt = (t: number, i: number) => {
    const a = OPEN_DONE + i * DROP.stagger;
    return Math.round(ease.outBack(clamp((t - a) / DROP.s), 1.2) * DROP.steps) / DROP.steps;
  };
  /** Draw element i (dropAt's) as it drops: clipped below EXTREME, lifted (1 - d) of its fall; nothing before it starts. */
  const dropped = (c: CanvasRenderingContext2D, t: number, i: number, draw: () => void) => {
    const d = dropAt(t, i), fall = fallOf(i);
    if (d <= 0) return;
    if (d === 1) { draw(); return; }
    c.save();
    c.beginPath();
    c.rect(-10, DROP.clipBelow, PAGE.w + 20, PAGE.h);
    c.clip();
    c.translate(0, -(1 - d) * fall);
    draw();
    c.restore();
  };
  if (!(A_OPEN < B_OPEN && B_CLOSE < A_CLOSE && A_CLOSE + CLOSE_S < turnAt)) {
    throw new Error(`specimen: the panels' timing doesn't hold: open ${A_OPEN.toFixed(3)}/${B_OPEN.toFixed(3)}, close ${B_CLOSE.toFixed(3)}/${A_CLOSE.toFixed(3)}, turn ${turnAt.toFixed(3)}`);
  }
  /** A panel's progress: eases open from `on` (clamped at 1 once OPEN_S has passed — the plateau before the other
   *  panel moves), eases shut from `off` over CLOSE_S. Both panels are 0 from the spread's start (A_OPEN is well after
   *  the turn in lands) and from `off` + CLOSE_S on (checked above, clear of turnAt): foldtest.ts's `move`. */
  const fold = (t: number, on: number, off: number) =>
    t < off ? ease.outQuart(clamp((t - on) / OPEN_S)) : 1 - ease.outQuart(clamp((t - off) / CLOSE_S));
  const panels = (t: number): Panels => ({ a: fold(t, A_OPEN, A_CLOSE), b: fold(t, B_OPEN, B_CLOSE) });
  /** The left page's flap (spread.ts Cutout: the whole page, hinged on its outer edge): it folds out as B lands, over
   *  FLAP_S, to lie face down off the left of the book — a hair past flat (`lie` rad), its free edge down on the
   *  sheets — and folds back with B. Loose (its own mesh, the 'C' face its front) from its first lift until it's back:
   *  under it, the left page is the white sheet's. */
  const FLAP_S = 0.6, FLAP_LIE = Math.PI + 0.016;
  const flapAt = (t: number) => (t < OPEN_DONE || t >= B_CLOSE + CLOSE_S ? null
    : t < B_CLOSE ? ease.inOutCubic(clamp((t - OPEN_DONE) / FLAP_S)) : 1 - ease.inOutCubic(clamp((t - B_CLOSE) / CLOSE_S)));
  const cutout: Cutout = {
    side: 'L', shape: 'rect', x: PAGE.w / 2, y: 500, rx: PAGE.w / 2, ry: 500, tab: Math.PI, // (hinged on its outer edge)
    motion: { peel: FLAP_LIE, bend: 0, flip: 0, roll: 0, flyBend: 0, move: [0, 0, 0] },
    loose: (t) => { const p = flapAt(t); return p === null ? null : { peel: p, fly: 0 }; },
  };
  /** The flap's progress for its shadow on the page under it, quantised (null: it lies on the page). */
  const flapStep = (t: number) => { const p = flapAt(t); return p === null ? null : Math.round(p * 48) / 48; };
  /** EXTREME's current width step (0..5) and target width (pu), quantised here (and only here: drawExtremeSlot and
   *  the keys both read this, so they can't drift apart) — 0 -> 3 (and EX.w0 -> EX.wA) as A opens and holds, 3 -> 5
   *  (and EX.wA -> EX.wB) as B opens and holds. */
  const extremeAt = (t: number) => {
    const p = panels(t);
    const raw = p.b > 0 ? { step: 3 + 2 * p.b, width: EX.wA + (EX.wB - EX.wA) * p.b } : { step: 3 * p.a, width: EX.w0 + (EX.wA - EX.w0) * p.a };
    return { step: Math.max(0, Math.min(5, Math.round(raw.step))), width: Math.round(raw.width) };
  };

  // ---- "effortlessly", syllable by syllable (no Word.syl on this word: its span split evenly into ef-fort-less-ly) ----
  const SYL = ['ef', 'fort', 'less', 'ly'] as const;
  if (SYL.join('') !== 'effortlessly') throw new Error('specimen: the syllables don\'t spell "effortlessly"');
  const sylSpan = (i: number): [number, number] => {
    const d = (effortlessly.end - effortlessly.start) / SYL.length;
    return [effortlessly.start + i * d, effortlessly.start + (i + 1) * d];
  };
  const sylInk = (i: number, t: number) => {
    const [a, b] = sylSpan(i);
    return Math.round(Lyrics.wordProgress({ ...effortlessly, start: a, end: b }, t) * INK_STEPS) / INK_STEPS;
  };

  // ---- "So effortlessly"'s syllable x-offsets: font-dependent (glyphX), measured on first draw — in drawPrint, never
  // called under bun (only the factory and camera/focus are: tests/sung.test.ts, tests/schedule.test.ts) ----
  let cache: { sylX: number[] } | null = null;
  const lazy = () => (cache ??= {
    sylX: [0, 2, 6, 10, 12].map((b) => measure('So ', ITALIC, FOOT.size) + glyphX('effortlessly', b, ITALIC, FOOT.size)),
  });

  // ---- the underline: one long stroke the width of the centrefold, under "effortlessly" as it's held ----
  const ulPts: V2[] = Array.from({ length: 9 }, (_, i) => {
    const u = i / 8, x = UNDERLINE.x0 + (UNDERLINE.x1 - UNDERLINE.x0) * u;
    return { x, y: UNDERLINE.y + 3 * noise1(u * 3, UNDERLINE.seed) };
  });
  const ulLens = polylineLengths(ulPts), ulTotal = ulLens[ulLens.length - 1]!;
  /** Quantised once (64 steps): drawUnderline's `len` and the marks key both read this, so they can't drift apart —
   *  a single key shared by every face is always safe (any tick could move ink on any of them); it costs a few extra
   *  redraws on faces the stroke hasn't reached yet, over the ~2.4 s "effortlessly" is held. */
  const ulProg = (t: number) => Math.round(Lyrics.wordProgress(effortlessly, t) * 64);

  // ---- the camera: Snap, holding across the panels' own moves, looking down (FRAME_SPREAD's tilt throughout: house
  // precedent keeps "low"/"along" in spec prose as flavour, not a literal angle — contactsheet.ts's loupe is ANGLES.top
  // despite "low and close over the strips") ----
  const openLandA = beatAtOrAfter(audio, A_OPEN + OPEN_S);
  const openLandB = beatAtOrAfter(audio, B_OPEN + OPEN_S);
  const glideLand = downbeatAtOrAfter(audio, openLandB + 0.1); // the downbeat just before "So effortlessly"
  const closeLand = beatAtOrAfter(audio, B_CLOSE + CLOSE_S + 0.1); // two beats clear of the turn
  const shots: Shot[] = [
    { at: so1, frame: { pose: pose(2, 2.1) } }, // across SO / EXTREME, folded
    { at: A_OPEN, frame: { pose: pose(3, 2.6) }, move: 'glide', until: openLandA }, // pulling back as A opens
    { at: B_OPEN, frame: { pose: pose(4, 3.4) }, move: 'glide', until: openLandB }, // and as B opens
    { at: openLandB, frame: { pose: pose(4, 3.6) }, move: 'glide', until: glideLand }, // the whole centrefold: the glide along EXTREME
    { at: effortlessly, frame: { pose: { ...pose(4, 3.6), y: 0.3 } } }, // along effortlessly, following the underline
    { at: B_CLOSE, frame: 'spread', move: 'glide', until: closeLand }, // back to the right page for the fold-in and the turn
  ];
  const camera = director(audio, shots, { turnAt, dist: { min: 0.9, max: 3.6 } });

  // what must read while sung. AO maps onto 'R' while folded (a = 0 throughout "So extreme": A doesn't open until
  // A_OPEN, well after extreme.end), so its box is a normal 'R' box. Once both panels are open, "effortlessly" also
  // prints on AI/BI — world positions the guard's FocusBox (side: 'L' | 'R' only) can't address — so only its L and R
  // slices are boxed here; AI/BI's are checked by eye (stills + legibility.py), noted in the report.
  const SO_CAP = SO.size * 0.75, FOOT_CAP = FOOT.size * 0.75;
  const focus: FocusBox[] = [
    { from: L1.start, to: L1.end, side: 'L', box: [SO.x, SO.y - SO_CAP, SO.x + 650, 1000], size: SO_CAP },
    { from: L1.start, to: L1.end, side: 'R', box: [30, 0, 740, 580], size: AO_EXTREME.size * CAP_ARCHIVO },
    { from: L2.start, to: L2.end, side: 'L', box: [FOOT.x, FOOT.y - FOOT_CAP, FOOT.x + 620, 955], size: FOOT_CAP },
    { from: effortlessly.start, to: effortlessly.end, side: 'R', box: [0, FOOT.y - FOOT_CAP, PAGE.w, 970], size: FOOT_CAP },
    { from: effortlessly.start, to: Math.min(effortlessly.end + 0.3, turnAt), side: 'R', box: [0, UNDERLINE.y - 20, PAGE.w, UNDERLINE.y + 20] },
  ];

  // ---- the faces ----
  /** Cut `draw` out of solid ink at `alpha` (destination-out, as layout.ts setLine's cut words: a ghost cuts at reduced
   *  alpha, a sung word to bare paper): the left page's SO and AO's folded teaser, which stay solid ink. */
  const cut = (c: CanvasRenderingContext2D, alpha: number, draw: (c: CanvasRenderingContext2D) => void) => {
    c.save();
    try {
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = c.strokeStyle = `rgba(0,0,0,${alpha})`;
      draw(c);
    } finally {
      c.restore();
    }
  };
  const black = (c: CanvasRenderingContext2D) => {
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(0,0,0,1)';
    c.fillRect(0, 0, PAGE.w, 1000);
  };
  /** Paint `draw` in ordinary ink at `alpha` (source-over, on bare paper: the face is left transparent, so the paper
   *  shader's own page shows through): the inside surfaces, R/AI/BI/BO, print on paper rather than cutting from black
   *  (the coordinator's fix — a black flap folding onto another black flap never read as paper on the bed). */
  const paper = (c: CanvasRenderingContext2D, alpha: number, draw: (c: CanvasRenderingContext2D) => void) => {
    c.save();
    try {
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = c.strokeStyle = rgba('ink', alpha);
      draw(c);
    } finally {
      c.restore();
    }
  };
  /** EXTREME's slot (0: R; 1: the opening panel, BO then AI; 2: BI) at its current step and target width, printed in
   *  ink on the bare paper. The width is hit exactly (not drawStretch's own width option, whose interpolation runs
   *  0..STRETCH_STEPS — wrong here, where the target itself changes between A's and B's phases). */
  const drawExtremeSlot = (c: CanvasRenderingContext2D, slot: number, t: number) => {
    const { step, width } = extremeAt(t), fam = stretchFamily(step, 900), w = measure('EXTREME', fam, EX.size);
    if (w <= 0) return;
    paper(c, ghostAlpha(inkAt(extreme, t)), (k) => {
      k.save();
      k.translate(EX.x - slot * PAGE.w, EX.y);
      k.scale(width / w, 1);
      k.font = font(fam, EX.size);
      k.textAlign = 'left';
      k.fillText('EXTREME', 0, 0);
      k.restore();
    });
  };
  /** The specimen grid's 2 columns (width indices w0, w0+1) x every weight, in ink on paper. Printed at once (no
   *  animation): the engine shows it only once it's actually composited (R from A_OPEN on, AI/BI only once B opens). */
  const drawGrid = (c: CanvasRenderingContext2D, w0: number, t: number) => {
    ARCHIVO_WEIGHTS.forEach((wt, row) => dropped(c, t, row, () => paper(c, 1, (k) => {
      k.textAlign = 'left';
      k.textBaseline = 'alphabetic';
      for (let col = 0; col < 2; col++) {
        const w = w0 + col, x = GRID.colX[col]!, y = GRID.y0 + row * GRID.rowH;
        k.font = font(MONO, GRID.labelSize);
        k.fillText(`${ARCHIVO_WIDTHS[w]! / 10} / ${wt}`, x, y);
        k.font = font(stretchFamily(w, wt), GRID.sampleSize);
        k.fillText('SO EXTREME', x, y + 20);
      }
    })));
  };
  /** "So effortlessly" along the foot, slot `slot` (0: L, 1: R, 2: AI, 3: BI) of the virtual run starting at FOOT.x:
   *  "So " plain ink, "effortlessly" inked syllable by syllable, in ink on paper (every slot: once L reaches this, its
   *  "SO" era is over and it's paper too, matching the rest of the open sheet). */
  const drawFoot = (c: CanvasRenderingContext2D, slot: number, t: number) => {
    dropped(c, t, ARCHIVO_WEIGHTS.length, () => drawFootIn(c, slot, t));
  };
  const drawFootIn = (c: CanvasRenderingContext2D, slot: number, t: number) => {
    const z = lazy(), off = slot * PAGE.w;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    paper(c, ghostAlpha(inkAt(so2, t)), (k) => {
      k.font = font(ITALIC, FOOT.size);
      k.fillText('So ', FOOT.x - off, FOOT.y);
    });
    for (let i = 0; i < SYL.length; i++) {
      paper(c, ghostAlpha(sylInk(i, t)), (k) => {
        k.font = font(ITALIC, FOOT.size);
        k.fillText(SYL[i]!, FOOT.x + z.sylX[i]! - off, FOOT.y);
      });
    }
  };
  /** The left page as it lies folded: solid ink, SO cut out of it. */
  const drawSoPage = (c: CanvasRenderingContext2D, t: number) => {
    black(c);
    cut(c, ghostAlpha(inkAt(so1, t)), (k) => { k.font = font(GIANT, SO.size); k.fillText('SO', SO.x, SO.y); });
  };
  const drawUnderline = (c: CanvasRenderingContext2D, slot: number, t: number) => {
    const off = slot * PAGE.w, len = (ulProg(t) / 64) * ulTotal; // arc length along ulPts is unchanged by the shift below
    if (len <= 0) return;
    const pts = ulPts.map((p) => ({ x: p.x - off, y: p.y }));
    lipstickStroke(c, pts, len, { width: UNDERLINE.width, seed: UNDERLINE.seed });
  };

  return {
    id: 'specimen', section, pages,
    panels,
    drawPrint(side, c, t) {
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      if (side === 'L') {
        const f = flapStep(t);
        if (f === null) drawSoPage(c, t); // the flap, lying on the page
        else { // the white sheet under it, and the flap's shadow as it folds
          drawFoot(c, 0, t);
          drawCutShadow(c, { ...cutout, peel: f, fly: 0 }, (a) => rgba('ink', a), { amt: 0.4, fadeH: 0.5, pts: 48 });
        }
        return;
      }
      if (side === 'R') { drawExtremeSlot(c, 0, t); if (t >= OPEN_DONE) { drawGrid(c, 0, t); drawFoot(c, 1, t); } return; }
      if (side === 'C') { drawSoPage(c, t); return; } // the flap, folding
      if (side === 'AO') {
        black(c);
        cut(c, ghostAlpha(inkAt(extreme, t)), (k) => {
          k.textAlign = 'center';
          k.font = font(stretchFamily(0, 900), AO_EXTREME.size);
          k.fillText('EXTREME', AO_EXTREME.cx, AO_EXTREME.y);
        });
        cut(c, 1, (k) => {
          k.save();
          k.translate(UNFOLD.x, UNFOLD.y);
          k.rotate(-Math.PI / 2);
          k.textAlign = 'left';
          k.font = font(MONO, UNFOLD.size);
          k.letterSpacing = `${UNFOLD.track}px`;
          k.fillText('UNFOLD ▸', 0, 0);
          k.letterSpacing = '0px';
          k.restore();
        });
        return;
      }
      if (side === 'BO' || side === 'AI') { drawExtremeSlot(c, 1, t); if (t >= OPEN_DONE) { drawGrid(c, 2, t); drawFoot(c, 2, t); } return; }
      // 'BI'
      drawExtremeSlot(c, 2, t);
      if (t >= OPEN_DONE) { drawGrid(c, 4, t); drawFoot(c, 3, t); }
    },
    drawMarks(side, c, t) {
      if (side === 'L') { if (flapAt(t) !== null) drawUnderline(c, 0, t); } // (on the white sheet: hidden by the flap)
      else if (side === 'R') drawUnderline(c, 1, t);
      else if (side === 'AI') drawUnderline(c, 2, t);
      else if (side === 'BI') drawUnderline(c, 3, t);
    },
    key(side, layer, t) {
      if (layer === 'marks') {
        if (side === 'L') return flapAt(t) === null ? '' : `${ulProg(t)}`;
        return side === 'R' || side === 'AI' || side === 'BI' ? `${ulProg(t)}` : '';
      }
      const inked = (w: Word) => Math.round(inkAt(w, t) * INK_STEPS);
      // the grid and the foot line appear together, all at once, once B has finished opening (OPEN_DONE) — before
      // that neither is drawn, so the key is just the fixed string 'before' (footKey(slot) would itself be constant
      // then too: so2/effortlessly haven't started, but the grid's own appearance isn't otherwise in the key).
      const drops = Array.from({ length: ARCHIVO_WEIGHTS.length + 1 }, (_, i) => Math.round(dropAt(t, i) * DROP.steps)).join('.');
      const footKey = (slot: number) => (t < OPEN_DONE ? 'before' : `${drops},${inked(so2)},${SYL.map((_, i) => Math.round(sylInk(i, t) * INK_STEPS)).join(',')}`);
      const exKey = () => { const e = extremeAt(t); return `${e.step},${e.width}`; };
      const f = flapStep(t);
      if (side === 'L') return f === null ? `so:${inked(so1)}` : `foot0:${footKey(0)},${Math.round(f * 48)}`;
      if (side === 'R') return `ex0:${exKey()},${inked(extreme)}|foot1:${footKey(1)}`;
      if (side === 'C') return `so:${inked(so1)}`;
      if (side === 'AO') return `ao:${inked(extreme)}`;
      if (side === 'BO' || side === 'AI') return `ex1:${exKey()},${inked(extreme)}|foot2:${footKey(2)}`;
      return `ex2:${exKey()},${inked(extreme)}|foot3:${footKey(3)}`; // 'BI'
    },
    camera,
    focus,
    cutout,
  };
};
