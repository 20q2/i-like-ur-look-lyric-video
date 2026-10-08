// Spread 13, the back cover (outro1; batch-2 spec §4.10): leaf 12's back, the outside, varnished (engine/page.ts's
// leafStock already gives it COVER_STOCK: TREATMENT §7). The book closes onto it at 165.014 and nothing ever turns
// away from it (spread.ts's turnOut throws here: there is no `turnAt`), so its camera is built without one, and it
// holds its last pose, slowly rising, to the song's end. It has no right page (flatplan.ts: leaf 12 is the last),
// so only 'L' ever draws; drawPrint/drawMarks/key are no-ops on 'R', the key held constant (never seen, but typed).
//
// ---- the ad, and the mark ----
// A full-bleed ad for the jacket (huge and centred, bigger than the front cover's), "WORN WELL." under it in Bodoni
// italic, a mono credit line. Once the close lands (~165.6), on the first downbeat after, she writes "better on me"
// across it in lipstick over a bar, landing the kiss on the downbeat a bar later (167.70, exactly as spec'd) — the
// spec's "two bars" would run past that fixed downbeat, so the write is a bar, not two (reported as a deviation).
// Then it stays, as written, while the song fades out (the spec's thumb smudge, the mark copied rightward and fading,
// was cut on the user's note: "just leave it and let it stick").
import { HAIRLINE_PU, PAGE } from '../engine/layout';
import { PAGE_W } from '../engine/curl';
import { kiss, lipstickWrite } from '../engine/lipstick';
import { rgba } from '../engine/palette';
import { type StrokeText, strokeText } from '../engine/stroke';
import { F, font } from '../engine/type';
import { ease, prog } from '../engine/util';
import type { V2 } from '../engine/util';
import { TURN_S } from '../scenes/magazine/schedule';
import { ART, type ArtDrawing, OUTLINE, artDrawings, drawArt } from './art';
import { type Box, type Shot, beatAtOrBefore, director, downbeatAtOrAfter } from './shots';
import { type CameraPose, type FocusBox, type SpreadFactory } from './spread';

// (the back cover, like the front, carries no folio)

// ---- layout (page units; this face draws alone, so plain page coordinates, as cover.ts's 'R' does) ----
/** ART.hanger ∪ ART.jacket's native box (art.ts) and its centre: the group is already assembled in one frame. */
const GROUP = { x0: 256, y0: 220, x1: 536, y1: 722 } as const;
const GROUP_C = { x: (GROUP.x0 + GROUP.x1) / 2, y: (GROUP.y0 + GROUP.y1) / 2 };
/** The ad's placement: bigger than the front cover's native size (scale 1.3), centred a little above mid-page. */
const AD = { cx: PAGE.w / 2, cy: 420, scale: 1.3 } as const;
const WORN_WELL = { text: 'WORN WELL.', y: 850, size: 110 } as const;
const CREDIT = { text: 'THE FALL COLLECTION', y: 900, size: 12, tracking: 2 } as const;
const WORN_FAMILY = F.bodoni(700, { italic: true });

// ---- the lipstick ----
/** "better on me" in the narrator's one hand (hscript), bigger than the cover story's (~140 pu, spec's number),
 *  the same slant (-16deg: TREATMENT §2 — one hand across the video), across the jacket's lower torso. */
const WRITE = { x: 101, y: 679, rot: (-16 * Math.PI) / 180, size: 140, font: 'hscript' as const };
const LIP_TEXT = 'better on me';
/** Where LIP_TEXT's stroke text (hscript) lies turned by WRITE.rot, from WRITE's point, per pu of WRITE.size —
 *  measured once for coverstory.ts's own "better on me" (same text, same font: the ratio is the font's, not the
 *  spread's) and reproduced here; lazy() below re-measures it and throws if the font's metrics ever drift. */
const WRITE_INK = Object.freeze({ x0: -0.0352, y0: -1.5848, x1: 4.7118, y1: -0.0261 });
/** The kiss, beside the writing (to its right, past the jacket's edge). */
const KISS = { x: 600, y: 560, size: 140, rot: -0.12, seed: 52 } as const;
/** The brush, and the kiss's timing (as the cover's: cover.ts's KISS_PRESS_S / KISS_LIFT_S). */
const LIP = { width: 6, seed: 51 } as const;
const KISS_PRESS_S = 0.12, KISS_LIFT_S = 0.18;
/** Quantisation steps (the keys and the drawing share them). */
const STEPS = { write: 64, kiss: 32 } as const;
type V2s = readonly (readonly V2[])[];
/** The extent of `strokes` turned by `rot` about their origin (coverstory.ts's turnedExtent). */
function turnedExtent(strokes: V2s, rot: number) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) {
    for (const p of st) {
      const x = p.x * cs - p.y * sn, y = p.x * sn + p.y * cs;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

// ---- the camera: the closed book, home (as the cover's, mirrored to the left half), a push-in on the writing, the
// kiss, then a slow pull back that keeps rising past home through the last bars (the song ends on a rising shot) ----
export const BACKCOVER_HOME: CameraPose = { x: -PAGE_W / 2, y: 0.5, dist: 2.25, tilt: 0.08, roll: 0.015 };
const RISE_DIST = 2.5;

export const backcover: SpreadFactory = (ctx) => {
  const { audio, pages } = ctx;
  const hanger: readonly ArtDrawing[] = artDrawings(ART.hanger, 801), jacket: readonly ArtDrawing[] = artDrawings(ART.jacket, 802);
  const full = (ds: readonly ArtDrawing[]) => ds.map(() => 1);
  const hangerFull = full(hanger), jacketFull = full(jacket);
  /** The coat's silhouette (a Path2D: on first draw, the factory mustn't touch the DOM). */
  let coat: Path2D | null = null;
  const coatFill = () => (coat ??= new Path2D(OUTLINE[0]));

  // ---- timing: every cue a rule on the data, not a hardcoded second ----
  const closeLands = ctx.start + TURN_S; // the book lies flat, back cover up (~165.6, spec's number)
  const writeFrom = downbeatAtOrAfter(audio, closeLands);
  const kissAt = audio.timeOfBeat(audio.beatAt(writeFrom) + 4); // a bar later (167.70, the spec's downbeat, exactly)
  const kissDoneAt = kissAt + KISS_PRESS_S + KISS_LIFT_S;
  const kissBeat = audio.beatAt(kissAt);
  const riseFrom = audio.timeOfBeat(kissBeat + 2); // two beats after the kiss lifts: the slow rise to the end
  const beatBeforeKiss = audio.timeOfBeat(kissBeat - 1);
  const lastBeat = beatAtOrBefore(audio, audio.duration);

  // ---- lazily built (font-dependent; the factory itself must not touch the DOM) ----
  let cache: { write: StrokeText } | null = null;
  const lazy = () => {
    if (cache) return cache;
    const write = strokeText(LIP_TEXT, WRITE.font, WRITE.size);
    const ink = turnedExtent(write.strokes, WRITE.rot), K = WRITE.size, sides = ['x0', 'y0', 'x1', 'y1'] as const;
    if (sides.some((k) => Math.abs(ink[k] - WRITE_INK[k] * K) > 0.5)) {
      throw new Error(`backcover: the lipstick's "${LIP_TEXT}" now lies at [${sides.map((k) => (ink[k] / K).toFixed(4)).join(', ')}] per pu of WRITE.size, not WRITE_INK's [${sides.map((k) => WRITE_INK[k]).join(', ')}]: measure it again`);
    }
    return (cache = { write });
  };
  // ---- the box the writing fills (WRITE_INK placed and turned by WRITE), for the camera and the guard ----
  const writeBox: Box = (() => {
    const r = LIP.width / 2, K = WRITE.size;
    const ext = turnedExtent([[{ x: WRITE_INK.x0 * K, y: WRITE_INK.y0 * K }, { x: WRITE_INK.x1 * K, y: WRITE_INK.y1 * K },
      { x: WRITE_INK.x0 * K, y: WRITE_INK.y1 * K }, { x: WRITE_INK.x1 * K, y: WRITE_INK.y0 * K }]], WRITE.rot);
    return [Math.floor(WRITE.x + ext.x0 - r), Math.floor(WRITE.y + ext.y0 - r), Math.ceil(WRITE.x + ext.x1 + r), Math.ceil(WRITE.y + ext.y1 + r)];
  })();
  const kissBox: Box = [KISS.x - 85, KISS.y - 50, KISS.x + 85, KISS.y + 60];

  // ---- every animated value, quantised once: the key and the drawing share it ----
  const q = (x: number, n: number) => Math.round(x * n);
  const marksAt = (t: number) => ({
    write: q(prog(t, writeFrom, kissAt, ease.outCubic), STEPS.write),
    press: q(prog(t, kissAt, kissAt + KISS_PRESS_S, ease.outCubic), STEPS.kiss),
    lift: q(prog(t, kissAt + KISS_PRESS_S, kissDoneAt, ease.outQuad), STEPS.kiss),
  });

  // ---- the camera: push in on the writing, the kiss, then back to HOME, and on from there a slow continued rise to the
  // song's end, the mark whole in frame ----
  const P = (x: number, y: number, dist: number, tilt: number, roll: number) => ({ pose: { x, y, dist, tilt, roll } });
  const shots: Shot[] = [
    { at: closeLands, frame: { side: 'L', box: writeBox }, move: 'glide', until: writeFrom }, // the push-in, as she starts
    { at: beatBeforeKiss, frame: { side: 'L', box: kissBox }, move: 'land', until: kissAt }, // the kiss lands
    { at: kissDoneAt, frame: P(BACKCOVER_HOME.x, BACKCOVER_HOME.y, BACKCOVER_HOME.dist, BACKCOVER_HOME.tilt, BACKCOVER_HOME.roll), move: 'glide', until: riseFrom }, // the pull back
    { at: riseFrom, frame: P(BACKCOVER_HOME.x, BACKCOVER_HOME.y, RISE_DIST, BACKCOVER_HOME.tilt, BACKCOVER_HOME.roll), move: 'glide', until: lastBeat }, // and a slow further rise to the end
  ];
  const camera = director(audio, shots, { start: BACKCOVER_HOME });

  const focus: FocusBox[] = [
    { from: writeFrom, to: beatBeforeKiss, side: 'L', box: writeBox }, // the writing (a drawing): until the camera leaves for the kiss
    { from: kissAt, to: riseFrom, side: 'L', box: kissBox }, // the kiss (a drawing)
    { from: riseFrom, to: audio.duration, side: 'L', box: [writeBox[0], Math.min(writeBox[1], kissBox[1]), Math.max(writeBox[2], kissBox[2]), Math.max(writeBox[3], kissBox[3])] }, // the mark, left as it is (a drawing): the camera is home by here
  ];

  return {
    id: 'backcover', section: ctx.section, pages,
    drawPrint(side, c) {
      if (side !== 'L') return;
      c.textBaseline = 'alphabetic';
      c.textAlign = 'center';
      c.save();
      c.translate(AD.cx, AD.cy);
      c.scale(AD.scale, AD.scale);
      c.translate(-GROUP_C.x, -GROUP_C.y);
      c.strokeStyle = rgba('ink');
      drawArt(c, hanger, hangerFull, 1 / AD.scale);
      c.fillStyle = rgba('paper'); // the coat is opaque, as the front cover's: the hanger hides inside it
      c.fill(coatFill());
      drawArt(c, jacket, jacketFull, 1 / AD.scale);
      c.restore();
      c.fillStyle = rgba('ink');
      c.font = font(WORN_FAMILY, WORN_WELL.size);
      c.fillText(WORN_WELL.text, PAGE.w / 2, WORN_WELL.y);
      // Bodoni's hairlines vanish at this size (it read "W ORV WELL."): outline it too, as setLine's `hairline` does
      c.strokeStyle = rgba('ink'); c.lineWidth = Math.max(HAIRLINE_PU, WORN_WELL.size * 0.012); c.lineJoin = 'round';
      c.strokeText(WORN_WELL.text, PAGE.w / 2, WORN_WELL.y);
      c.font = font(F.mono(600), CREDIT.size);
      c.letterSpacing = `${CREDIT.tracking}px`;
      c.fillText(CREDIT.text, PAGE.w / 2, CREDIT.y);
      c.letterSpacing = '0px';
    },
    drawMarks(side, c, t) {
      if (side !== 'L') return;
      const s = marksAt(t);
      if (s.write > 0) {
        c.save();
        c.translate(WRITE.x, WRITE.y);
        c.rotate(WRITE.rot);
        lipstickWrite(c, lazy().write, (s.write / STEPS.write) * lazy().write.total, { width: LIP.width, seed: LIP.seed });
        c.restore();
      }
      if (s.press > 0) kiss(c, KISS.x, KISS.y, KISS.size, KISS.rot, s.press / STEPS.kiss, s.lift / STEPS.kiss, KISS.seed);
    },
    key(side, layer, t) {
      if (side !== 'L') return 'r'; // the R face is never seen: nothing is drawn there, so its key never changes
      if (layer === 'print') return 'print';
      const s = marksAt(t);
      return `${s.write},${s.press},${s.lift}`;
    },
    camera, focus,
  };
};
