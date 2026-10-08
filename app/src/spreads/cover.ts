// Spread 0: the cover of EFFORTLESS, printing itself over the intro's four bars and kissed on "Better". Right face
// only; every cue comes from the data (downbeats, kicks, the word "Better").
// It opens in the dark: the magazine already lying on
// the bed, the camera swinging round onto it from low and to the side over the intro's drum fill, and the lamp coming
// on as the fill lands on bar 1.
import { F, font, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { HAIRLINE_PU, inkAt, karaokeKey, setLine } from '../engine/layout';
import { PAGE_W } from '../engine/curl';
import { drawProgress, hatchLines, makeDrawing } from '../engine/drawing';
import { kiss } from '../engine/lipstick';
import type { Lyrics } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import { ease, hash, prog } from '../engine/util';
import { HANGER, HER, LAPELS, OUTLINE, POCKETS, SCISSORS, SHADE, STITCHES } from './art';
import { inkedAt, onKicks } from './cues';
import { type CameraPose, type Spread, lerpPose, pageToWorld } from './spread';

// ---- artwork, in page units (770 x 1000, origin top-left); him, the hanger and her are in art.ts ----
const MAST = { x: 48, y: 150, w: 674 };
const BARCODE = { x: 604, y: 892, w: 112, h: 52 };
// (a pu is ~0.28 mm of an 8.4-inch page: a 140 pu mouth is ~4 cm, a kiss print wider than the barcode)
const KISS = { x: 660, y: 918, size: 140, rot: -0.14 };
/** The kiss presses in over KISS_PRESS_S as soon as "Better." has printed in full, then lifts off over KISS_LIFT_S
 *  (~0.3 s in all), and stays on the barcode. */
const KISS_PRESS_S = 0.12, KISS_LIFT_S = 0.18;
/** The camera eases back out of the close-up to `home` over PULL_BACK_S, arriving on the flip (see camera()). */
const PULL_BACK_S = 0.3;
/** The cover's home framing, the whole cover in frame (camera()): a standard framing (tests/focus.test.ts). */
export const COVER_HOME: CameraPose = { x: PAGE_W / 2, y: 0.5, dist: 2.25, tilt: 0.08, roll: -0.015 };
const COVER_ITALIC = F.bodoni(700, { italic: true });
/** The opening: the camera starts low and off to the side, in perspective (a pose relative to COVER_HOME's), and
 *  swings round onto the cover, landing on bar 1's downbeat as the lamp comes on, over LAMP_ON_S. Until then the lamp
 *  is at `dark` (a little of its light: the room is dark, not black). */
const OPENING = Object.freeze({ dx: 0.55, dy: -0.15, dist: 3.1, tilt: 1.05, roll: 0.06, yaw: 0.95 });
const LAMP_ON_S = 0.06, DARK = 0.07;

export function cover(audio: AudioData, lyrics: Lyrics, flipAt: number): Spread {
  const bars = audio.downbeats.filter((d) => d < flipAt - 0.01);
  if (bars.length < 4) throw new Error(`the cover needs 4 intro bars before ${flipAt}, found ${bars.length}`);
  const [b1, b2, b3, b4] = bars.slice(-4) as [number, number, number, number];
  const beat = 60 / audio.bpm;
  const better = lyrics.get('Better');
  const lastWord = better.words[better.words.length - 1]!;
  /** When "Better." has printed in full: the first t with its last word at full ink (inkAt, quantised — the full stop
   *  prints with it). (inkedAt throws if it never does, within the word's span.) */
  const inked = inkedAt(lastWord);
  const leaveAt = flipAt - PULL_BACK_S; // the camera starts back out of the close-up
  // bar 4's push-in runs from its downbeat until "Better." is printed; the kiss then presses in and lifts, all of it in
  // the close-up, before the camera leaves, which is PULL_BACK_S before the flip
  if (!(better.start >= b4)) throw new Error(`the cover needs "Better" sung after bar 4's downbeat (${b4}); it starts at ${better.start}`);
  if (!(inked > b4)) throw new Error(`the cover needs "Better" printed after bar 4's downbeat (${b4}); it's printed at ${inked}`);
  if (inked + KISS_PRESS_S + KISS_LIFT_S > leaveAt) {
    throw new Error(`the cover needs "Better" printed by ${leaveAt - KISS_PRESS_S - KISS_LIFT_S}, for the kiss to play out in the close-up before the camera pulls back for the flip at ${flipAt}; it's printed at ${inked}`);
  }
  // the cover's fixed print, there as the magazine falls in (the user's note: the eye goes to the ink drawing, not to
  // the masthead and small print arriving): three lines of small print, the price and barcode
  const mono = (text: string, x: number, y: number, align: CanvasTextAlign, size: number) => (c: CanvasRenderingContext2D) => {
    c.font = font(F.mono(600), size);
    c.textAlign = align;
    c.fillText(text, x, y);
  };
  const barcode = (c: CanvasRenderingContext2D) => {
    c.textAlign = 'left';
    c.font = font(F.mono(500), 9);
    c.fillText('$9.99 US · $12.99 CAN', BARCODE.x, BARCODE.y - 10);
    for (let x = BARCODE.x, i = 0; x < BARCODE.x + BARCODE.w; i++) { // bars
      const w = 1 + Math.floor(hash(i, 4) * 3);
      if (i % 2 === 0) c.fillRect(x, BARCODE.y, w, BARCODE.h);
      x += w;
    }
    c.font = font(F.mono(400), 8);
    c.fillText('0 74470 47000 9', BARCODE.x, BARCODE.y + BARCODE.h + 12);
  };
  const small = [
    mono('THE FALL ISSUE · NO. 47', 48, 182, 'left', 11),
    mono('OCTOBER 11, 2026', 722, 182, 'right', 11), // (the date in her music video)
    mono('+ HOW TO BE SEEN, P. 2', 722, 212, 'right', 10),
    barcode,
  ];

  // bar 2: the hanger on the downbeat, then the jacket's stroke groups on the kicks after it
  const groupAt = [b2, ...onKicks(audio, 5, b2 + 0.05, b3 - 0.05)];
  const groups = [
    { d: makeDrawing(HANGER, { wobble: 0.5, seed: 11 }), width: 1.6, dash: [] as number[] },
    { d: makeDrawing(OUTLINE, { wobble: 0.7, seed: 12 }), width: 2.0, dash: [] },
    { d: makeDrawing(LAPELS, { wobble: 0.6, seed: 13 }), width: 1.5, dash: [] },
    { d: makeDrawing(POCKETS, { wobble: 0.4, seed: 14 }), width: 1.3, dash: [] },
    { d: makeDrawing(STITCHES, { seed: 15 }), width: 0.9, dash: [3, 3] },
    { d: makeDrawing(SHADE.flatMap((p) => hatchLines(p, 1.1, 6))), width: 0.7, dash: [] },
  ].map((g, i) => ({ ...g, at: groupAt[i]! }));

  // 50 pu in the display cut, outlined by HAIRLINE_PU (its t's crossbars: TREATMENT.md §2). "of the" is indented so its
  // f's tail (x 64..79 flush left) hangs over the e of "Season", not 3 pu above the S, where it read as "Šeason".
  const coverLines = [
    { text: 'The Look', x: 48, y: 470, family: COVER_ITALIC, size: 50 },
    { text: 'of the', x: 68, y: 524, family: COVER_ITALIC, size: 50 },
    { text: 'Season', x: 48, y: 578, family: COVER_ITALIC, size: 50 },
    { text: 'HIM, WORN WELL — P. 6', x: 48, y: 610, family: F.mono(600), size: 9 },
  ].map((l, i) => ({ ...l, at: b1 + i * beat })); // (the words first, a line a beat from the lamp coming on: the ink draws from bar 2)
  const her = makeDrawing(HER, { wobble: 0.3, seed: 21 });
  /** The coat's silhouette, filled with paper under its lines (a Path2D: on first draw, the factory mustn't touch the
   *  DOM). */
  let fill: Path2D | null = null;
  const jacketFill = () => (fill ??= new Path2D(OUTLINE[0]));
  const scissors = makeDrawing(SCISSORS, { seed: 22 });
  const herFrom = b3, herTo = b4 - 0.1;

  // Every animated value is quantised once, here; the key encodes exactly these values and the draw
  // functions draw exactly these values — so a frame never depends on when its face was last redrawn.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  const state = (t: number) => ({
    jacket: groups.map((g) => q(prog(t, g.at, g.at + 0.5, ease.outCubic), 96)),
    lines: coverLines.filter((l) => t >= l.at).length,
    her: q(prog(t, herFrom, herTo, ease.inOutQuad), 96),
    last: t >= b4,
  });
  const kissAt = (t: number) => ({
    press: q(prog(t, inked, inked + KISS_PRESS_S, ease.outCubic), 32),
    lift: q(prog(t, inked + KISS_PRESS_S, inked + KISS_PRESS_S + KISS_LIFT_S, ease.outQuad), 32),
  });

  return {
    id: 'cover', section: audio.sections[0]!.name, pages: [0, 1],
    drawPrint(side, c, t) {
      if (side !== 'R') return;
      const s = state(t);
      c.textBaseline = 'alphabetic';
      c.fillStyle = rgba('ink'); // the masthead and the small print: printed
      const fam = F.bodoni(900);
      c.font = font(fam, 100 * (MAST.w / measure('EFFORTLESS', fam, 100)));
      c.textAlign = 'left';
      c.fillText('EFFORTLESS', MAST.x, MAST.y);
      for (const draw of small) draw(c);
      c.strokeStyle = rgba('ink');
      c.lineJoin = 'round';
      c.lineCap = 'round';
      groups.forEach((g, i) => {
        const p = s.jacket[i]!;
        if (p <= 0) return;
        // the coat is opaque: as its outline draws, it fills, hiding the hanger inside it
        if (i === 1) { c.save(); c.globalAlpha = p; c.fillStyle = rgba('paper'); c.fill(jacketFill()); c.restore(); }
        c.lineWidth = g.width;
        c.setLineDash(g.dash);
        drawProgress(c, g.d, p * g.d.total);
      });
      c.setLineDash([]);
      c.textAlign = 'left';
      c.strokeStyle = rgba('ink');
      c.lineWidth = HAIRLINE_PU;
      for (const l of coverLines.slice(0, s.lines)) {
        c.font = font(l.family, l.size);
        c.fillText(l.text, l.x, l.y);
        if (l.family === COVER_ITALIC) c.strokeText(l.text, l.x, l.y);
      }
      if (s.her > 0) { // her: a dotted cut line around an empty space, and the scissors
        c.strokeStyle = rgba('graphite');
        c.lineWidth = 1.2;
        c.setLineDash([5, 5]);
        drawProgress(c, her, s.her * her.total);
        c.setLineDash([]);
        c.lineWidth = 1;
        drawProgress(c, scissors, scissors.total);
      }
      if (s.last) {
        const w = setLine(c, better, t, 48, 905, { family: COVER_ITALIC, size: 64, hairline: true });
        if (inkAt(lastWord, t) >= 1) { // the quantised ink the key encodes
          c.fillStyle = rgba('ink');
          c.fillText('.', 48 + w, 905);
          c.strokeStyle = rgba('ink'); // outlined like the word it ends
          c.lineWidth = HAIRLINE_PU;
          c.lineJoin = 'round';
          c.strokeText('.', 48 + w, 905);
        }
      }
    },
    drawMarks(side, c, t) {
      if (side !== 'R') return;
      const k = kissAt(t);
      kiss(c, KISS.x, KISS.y, KISS.size, KISS.rot, k.press, k.lift, 5);
    },
    key(side, layer, t) {
      if (side !== 'R') return '';
      if (layer === 'marks') { const k = kissAt(t); return `${k.press},${k.lift}`; }
      const s = state(t);
      return [...s.jacket, s.lines, s.her, s.last ? karaokeKey([better], t) : '-'].join(',');
    },
    camera(t) {
      const home = COVER_HOME;
      if (t < b1) { // the opening's swing round onto the cover
        const o = OPENING, from: CameraPose = { x: home.x + o.dx, y: home.y + o.dy, dist: o.dist, tilt: o.tilt, roll: o.roll, yaw: o.yaw };
        return lerpPose(from, home, prog(t, 0, b1, ease.inOutQuad));
      }
      const k = pageToWorld('R', KISS.x, KISS.y);
      // near: the bottom of the cover, "Better." (bottom left) and the kiss (bottom right) in one frame
      const near: CameraPose = { x: k.x - 0.27, y: k.y + 0.11, dist: 1.0, tilt: 0.05, roll: -0.03 };
      // Bar 4: push in while "Better." prints, hold on the kiss, then ease back out to the whole cover, arriving on the
      // flip. The page turns (and the verse starts) with the whole kissed cover in frame and the camera no longer moving
      // up the page: from `home` the scene's blend to spread 1 is only a move across.
      const push = prog(t, b4, inked, ease.inOutCubic) * (1 - prog(t, leaveAt, flipAt, ease.inOutCubic));
      return lerpPose(home, near, push);
    },
    lamp(t) { // on as the fill lands on bar 1
      return DARK + (1 - DARK) * prog(t, b1, b1 + LAMP_ON_S);
    },
  };
}
