// Spread 5, Accessories (verse 2b, pp. 10-11): the magazine shops him. A calfskin leash, drawn huge as a technical
// flat, snakes from its handle loop on the left page (low, by the lyric) across the gutter to a brass clasp clipped
// onto the hanger's hook on the right page — the jacket on its hanger (ART.jacket, the cover's), on a leash. Lyric 1
// ("But you're already on a leash") climbs in rising sizes toward the lamp, its last row running on across the gutter
// toward him. A luggage tag swings off the clasp, stamped SOLD as the word "leash" lands; the listing and lyric 2 sit
// under him. The narrator crosses SOLD out in lipstick on "unfortunate" and loops him on "baby" — hers, leashed too.
import { F, font, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { PAGE, drawFolio, karaokeKey, setLine, subLine, type Side } from '../engine/layout';
import { drawStretch, knockout } from '../engine/print';
import { lipstickStroke } from '../engine/lipstick';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { ease, prog } from '../engine/util';
import { ART, HANGER_HOOK, OUTLINE, artDrawings, drawArt } from './art';
import { sectionLine } from './cues';
import { loopAround } from './marks';
import { type Box, type Shot, director, plan, resolveAt } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';

// ---- the layout (page units; "spread x" runs on across the gutter, the right face at x - 770) ----
const ITALIC = F.bodoni(400, { italic: true });
/** Bodoni Moda's display cap height, per pu of size (FocusBox.size). */
const CAP = 0.75;
/** Lyric 1's three rows, rising toward the lamp (left page, upper half): "But you're" small, "already" bigger, "on a
 *  leash" biggest — and running on across the gutter, toward him. */
const ROW1 = { x: 48, y: 190, size: 56 } as const;
const ROW2 = { x: 44, y: 360, size: 150 } as const;
const ROW3 = { x: 48, y: 520, size: 130 } as const;
/** "leash", alone and biggest, filling the left page's foot: the strap runs out of the handle just under it (its top
 *  edge ~760 at the word's right end, below its baseline). */
const ROW4 = { x: 36, y: 740, size: 250 } as const;
/** The spread's title: a solid black band across the top of the right page (house style B), ACCESSORIES cut out of
 *  it in Archivo 900 at its widest step, stretched to the band's width, and a mono kicker cut above it. Above the
 *  hanger's hook (from y ~168). */
const BAND = { h: 132, title: 'ACCESSORIES', x: 34, y: 112, size: 96, step: 5, w: 702, kicker: 'THE FALL EDIT · LEATHER GOODS · P. 11', ky: 30 } as const;
/** Small mono meant to be read: Plex Mono 600 at >= 10.5 pu (TREATMENT §6). */
const SMALL = { family: F.mono(600), size: 10.5 } as const;
/** Below the leash's lowest reach on this page (it rises from here, so nothing printed at y >= 710 crosses it). */
const LISTING = { x: 58, y: 726, lead: 22 } as const;
const LISTING_LINES = ['THE LEASH. Calfskin, brass clasp.', '1.2 m. One only. Price on request.'];
/** Lyric 2, under the listing, in two rows. */
const L2_SIZE = 30;
const L2_ROWS = [{ x: 58, y: 822, words: [0, 3] as const }, { x: 58, y: 864, words: [3, 6] as const }];

/** The jacket on its hanger (ART.jacket, ART.hanger), at 0.95, the right page's hero: placed so HANGER_HOOK lands
 *  exactly where the leash's clasp (art.ts's LEASH_CLASP, (1150, 176)) grips it — he's on a leash. Opaque: the hanger
 *  hides inside it. */
const JACKET_PLACE = { x: 1150, y: 176, scale: 0.95 } as const;
/** Its placed box (for the loop and the guard): ART.jacket's and ART.hanger's combined box, times JACKET_PLACE. */
const JACKET_BOX: Box = [235, 160, 520, 655];
/** The tag: tied by a string to his right cuff (`cuff`, spread x: ART.jacket's sleeve end, (528, 690), placed), its
 *  grommet at (x, y), rotated and scaled — a luggage tag hanging off him into the page's empty corner. */
const TAG_PLACE = { x: 1390, y: 700, rot: (-8 * Math.PI) / 180, scale: 1.3, cuff: { x: 1272, y: 620 } } as const;
/** Its placed box, rotation included (for the camera, the cross-out and the guard). */
const TAG_BOX: Box = [520, 680, 745, 960];
/** SOLD's stamp, in the tag's own (unrotated) units: Archivo 900, boxed, centred below the grommet (it lands: SLAM). */
const STAMP = { x: 0, y: 150, size: 44, pad: [14, 10] as const } as const;
/** SOLD drops onto the tag, landing on "leash": over `fallS` before the word it falls from `high` times its size,
 *  accelerating, its shadow (`shadow` of ink) closing in under it from `shadowOff` pu; on impact it squashes by `squash`
 *  and springs back over `squashS`, and knocks the tag into a swing, `swing` rad at `hz`, dying away over `swingS`. */
const SLAM = { fallS: 0.2, high: 1.7, shadow: 0.3, shadowOff: 26, squash: 0.08, squashS: 0.12, swing: 0.07, hz: 4.5, swingS: 0.7, steps: 16 } as const;
/** The leash's own ink, shared by every one of ART.leash's groups: it inks along its length, following the glide. */
const LEASH_STEPS = 64;
/** The cross-out's zigzag and the loop round him: the brush and their quantisation steps. */
const LIP_W = 7;
const STEPS = { cross: 32, loop: 32 } as const;

/** A zigzag polyline across `box`, `n` traverses, for a hard cross-out. */
function zigzag(box: Box, n: number): { x: number; y: number }[] {
  const [u0, v0, u1, v1] = box, pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) pts.push({ x: i % 2 === 0 ? u0 : u1, y: v0 + ((v1 - v0) * i) / n });
  return pts;
}
const CROSS_PTS = zigzag(TAG_BOX, 4);

/** A line of `section`, its word count checked (a re-alignment that split or merged words would move every cue). */
function lineOf(lyrics: Lyrics, section: string, text: string, words: number): Line {
  const l = sectionLine(lyrics, section, text);
  if (l.words.length !== words) throw new Error(`accessories: "${l.text}" has ${l.words.length} words, expected ${words}`);
  return l;
}

export const accessories: SpreadFactory = (ctx) => {
  const { audio, lyrics, section, pages } = ctx, turnAt = turnOut(ctx);
  const L1 = lineOf(lyrics, section, "But you're already on a leash", 6);
  const L2 = lineOf(lyrics, section, "So that's unfortunate for me, baby", 6);
  const [but, youre, already, on, a, leash] = L1.words as [Word, Word, Word, Word, Word, Word];
  const [so, thats, unfortunate, forWord, me, baby] = L2.words as [Word, Word, Word, Word, Word, Word];

  // ---- drawings (pure geometry: built here) ----
  const leashArt = artDrawings(ART.leash, 51);
  const hangerArt = artDrawings(ART.hanger, 61), jacketArt = artDrawings(ART.jacket, 62);
  /** The jacket's outline, filled with paper under its lines (a Path2D: built on first draw, the factory mustn't touch
   *  the DOM). */
  let jacketFill: Path2D | null = null;
  const jacketPath = () => (jacketFill ??= new Path2D(OUTLINE[0]));
  const tagArt = artDrawings(ART.tag, 71);
  const offOf = (side: Side) => (side === 'R' ? 770 : 0);

  // ---- the camera: Snap, following the leash toward him, a snap to the tag as it's stamped SOLD, the listing and
  // lyric 2, a snap to the cross-out, out for the turn ----
  const shots: Shot[] = [
    // a glide from the handle, along the leash, toward him: wide enough to keep the lyric (rows 2-3) in view too
    { at: already, frame: { pose: { x: -0.1, y: 0.56, dist: 1.78, tilt: 0.1, roll: 0 } }, move: 'glide', until: 62.472 },
    { at: leash, frame: { pose: { x: 0, y: 0.47, dist: 2.0, tilt: 0.1, roll: 0.02 } } }, // "leash": the whole spread, the word and the tag as SOLD lands
    { at: so, frame: { side: 'R', box: [40, 680, 740, 910] } }, // "So that's": the listing and lyric 2
    { at: unfortunate, frame: { side: 'R', box: [40, 260, 750, 965] } }, // "unfortunate": the cross-out (lyric 2 stays in view)
    { at: baby, frame: 'spread' }, // "baby": out to the spread for the turn
  ];
  const camera = director(audio, shots, { turnAt });
  const moves = plan(audio, shots, { turnAt });
  /** A line (or a single word, as a one-word array) reads from its start, or, if the camera is still moving onto it
   *  then, from where that move lands — from its second word at the latest (its own end, for one word). */
  const settled = (ws: readonly Word[]) => {
    const w0 = ws[0]!, m = moves.findLast((x) => x.at <= w0.start), latest = ws[1]?.start ?? w0.end;
    return m && w0.start < m.land ? Math.min(m.land, latest) : w0.start;
  };
  /** The move a cue starts (as planned). */
  const moveOn = (cue: Shot['at']) => {
    const at = resolveAt(cue), m = moves.find((x) => Math.abs(x.at - at) < 1e-9);
    if (!m) throw new Error(`accessories: no shot starts at ${at.toFixed(3)}`);
    return m;
  };
  const shot1Land = moveOn(already).land;
  // "on a leash" runs on across the gutter, toward the tag the "So that's" shot (so.start, minus LEAD) cuts to: give
  // its reading up to there, not to "leash"'s own end (the camera is already on the tag by then).
  const row3To = Math.min(leash.end, resolveAt(so));

  // what must read when: each row over its sung span (settled); the leash, gliding, and the tag, stamping, each "the
  // drawing a line is about" while its shot frames it; and the marks, drawn.
  const focus: FocusBox[] = [
    { from: settled([but, youre]), to: youre.end, side: 'L', box: [40, 140, 420, 205], size: CAP * ROW1.size },
    { from: settled([already]), to: already.end, side: 'L', box: [36, 240, 660, 400], size: CAP * ROW2.size },
    { from: settled([on, a]), to: a.end, side: 'L', box: [40, 410, 360, 530], size: CAP * ROW3.size },
    { from: settled([leash]), to: row3To, side: 'L', box: [30, 545, 640, 752], size: CAP * ROW4.size },
    { from: resolveAt(already), to: shot1Land, side: 'L', box: [60, 740, 740, 860] }, // the leash, gliding (a drawing)
    { from: resolveAt(already), to: shot1Land, side: 'R', box: [0, 140, 420, 720] }, // (its far side, and the clasp)
    { from: moveOn(leash).land, to: resolveAt(so), side: 'R', box: TAG_BOX }, // the tag, stamped (a drawing: from where the move onto it lands, down in the page's corner)
    { from: settled([so, thats, unfortunate]), to: unfortunate.end, side: 'R', box: [40, 796, 730, 898], size: CAP * L2_SIZE },
    { from: settled([forWord, me, baby]), to: Math.min(baby.end, turnAt), side: 'R', box: [40, 838, 560, 898], size: CAP * L2_SIZE },
    { from: moveOn(unfortunate).land, to: moveOn(unfortunate).land + 0.4, side: 'R', box: TAG_BOX }, // the cross-out (a drawing)
    { from: baby.start, to: Math.min(baby.start + 30 / audio.bpm, turnAt), side: 'R', box: JACKET_BOX }, // the loop (a drawing)
  ];

  // Every animated value, quantised once: the keys encode exactly these, and the faces draw exactly these.
  const q = (x: number, n: number) => Math.round(x * n) / n;
  const state = (t: number) => ({
    leash: q(prog(t, resolveAt(already), shot1Land, ease.outCubic), LEASH_STEPS),
    /** SOLD's fall (0 not yet, 1 landed), and the time since it landed, a frame at a time (-1 before), for the squash and
     *  the tag's swing (0 once they've died away). */
    fall: q(prog(t, leash.start - SLAM.fallS, leash.start, ease.inQuad), SLAM.steps),
    since: t < leash.start ? -1 : t >= leash.start + SLAM.swingS ? 0 : q(t - leash.start, 60) || 1 / 60,
  });
  const marksAt = (t: number) => ({
    cross: q(prog(t, unfortunate.start, unfortunate.start + 0.35, ease.outCubic), STEPS.cross),
    loop: q(prog(t, baby.start, Math.min(baby.start + 30 / audio.bpm, turnAt), ease.inOutQuad), STEPS.loop),
  });

  // ---- drawing ----
  /** The leash: its handle loop, the strap and the clasp, on both faces (the strap crosses the gutter), inking
   *  together along its length. */
  const drawLeash = (c: CanvasRenderingContext2D, side: Side, leashProg: number) => {
    if (leashProg <= 0) return;
    c.save();
    c.translate(-offOf(side), 0);
    c.strokeStyle = rgba('ink');
    drawArt(c, leashArt, leashArt.map(() => leashProg));
    c.restore();
  };
  /** The jacket on its hanger, right page only: printed whole (established art, not new — it doesn't ink itself). */
  const drawJacket = (c: CanvasRenderingContext2D) => {
    c.save();
    c.translate(JACKET_PLACE.x - 770, JACKET_PLACE.y);
    c.scale(JACKET_PLACE.scale, JACKET_PLACE.scale);
    c.translate(-HANGER_HOOK.x, -HANGER_HOOK.y);
    c.strokeStyle = rgba('ink');
    drawArt(c, hangerArt, hangerArt.map(() => 1), 1 / JACKET_PLACE.scale);
    c.fillStyle = rgba('paper');
    c.fill(jacketPath());
    drawArt(c, jacketArt, jacketArt.map(() => 1), 1 / JACKET_PLACE.scale);
    c.restore();
  };
  /** The tag, swinging off the clasp on its string, SOLD stamped on it. */
  const drawTag = (c: CanvasRenderingContext2D, s: ReturnType<typeof state>) => {
    const { x: gx, y: gy } = TAG_PLACE;
    c.strokeStyle = rgba('ink');
    c.beginPath();
    const { cuff } = TAG_PLACE;
    c.moveTo(cuff.x - 770, cuff.y);
    c.quadraticCurveTo((cuff.x + gx) / 2 - 770, Math.max(cuff.y, gy) + 24, gx - 770, gy); // (sagging between them)
    c.lineWidth = 1;
    c.stroke();
    // the tag's swing from SOLD's impact
    const swing = s.since > 0 ? SLAM.swing * Math.sin(2 * Math.PI * SLAM.hz * s.since) * Math.exp((-3 * s.since) / SLAM.swingS) : 0;
    c.save();
    c.translate(gx - 770, gy);
    c.rotate(TAG_PLACE.rot + swing);
    c.scale(TAG_PLACE.scale, TAG_PLACE.scale);
    drawArt(c, tagArt, tagArt.map(() => 1), 1 / TAG_PLACE.scale);
    if (s.fall > 0) {
      const w = measure('SOLD', F.archivo(100, 900), STAMP.size);
      const block = (c2: CanvasRenderingContext2D) => {
        c2.fillText('SOLD', 0, 0);
        c2.strokeRect(-w / 2 - STAMP.pad[0], -STAMP.size * 0.72 - STAMP.pad[1], w + STAMP.pad[0] * 2, STAMP.size * 0.92 + STAMP.pad[1] * 2);
      };
      const h = 1 - s.fall, k = 1 + (SLAM.high - 1) * h; // (its height: 1 at the top of the fall, 0 landed)
      const squash = s.since > 0 ? 1 - SLAM.squash * Math.exp(-s.since / (SLAM.squashS / 3)) : 1;
      c.save();
      c.translate(STAMP.x, STAMP.y);
      c.font = font(F.archivo(100, 900), STAMP.size);
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.lineWidth = 2;
      if (h > 0) { // its shadow on the tag, closing in as it falls
        c.save();
        c.translate(SLAM.shadowOff * h, SLAM.shadowOff * h);
        c.fillStyle = c.strokeStyle = rgba('ink', SLAM.shadow * (1 - 0.6 * h));
        block(c);
        c.restore();
      }
      c.scale(k / squash, k * squash);
      c.fillStyle = c.strokeStyle = rgba('ink');
      block(c);
      c.restore();
    }
    c.restore();
  };

  const drawLeft = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink');
    setLine(c, subLine(L1, 0, 2), t, ROW1.x, ROW1.y, { family: ITALIC, size: ROW1.size, hairline: true });
    setLine(c, subLine(L1, 2, 3), t, ROW2.x, ROW2.y, { family: ITALIC, size: ROW2.size, hairline: true });
    setLine(c, subLine(L1, 3, 5), t, ROW3.x, ROW3.y, { family: ITALIC, size: ROW3.size, hairline: true });
    setLine(c, subLine(L1, 5, 6), t, ROW4.x, ROW4.y, { family: ITALIC, size: ROW4.size, hairline: true });
    drawLeash(c, 'L', s.leash);
    drawFolio(c, 'L', pages[0]);
  };
  const drawRight = (c: CanvasRenderingContext2D, t: number, s: ReturnType<typeof state>) => {
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink');
    c.fillStyle = rgba('ink'); // the title band (the row before it leaves its ghost's ink set)
    c.fillRect(0, 0, PAGE.w, BAND.h);
    knockout(c, (k) => {
      drawStretch(k, BAND.title, BAND.x, BAND.y, BAND.size, BAND.step, { weight: 900, width: BAND.w });
      k.textAlign = 'left';
      k.font = font(SMALL.family, SMALL.size);
      k.letterSpacing = '2px';
      k.fillText(BAND.kicker, BAND.x + 2, BAND.ky);
      k.letterSpacing = '0px';
    });
    c.textAlign = 'left';
    drawJacket(c);
    drawLeash(c, 'R', s.leash);
    drawTag(c, s);
    c.font = font(SMALL.family, SMALL.size);
    c.textAlign = 'left';
    c.fillStyle = rgba('ink');
    LISTING_LINES.forEach((line, i) => c.fillText(line, LISTING.x, LISTING.y + i * LISTING.lead));
    for (const r of L2_ROWS) setLine(c, subLine(L2, r.words[0], r.words[1]), t, r.x, r.y, { family: ITALIC, size: L2_SIZE, hairline: true });
    drawFolio(c, 'R', pages[1]);
  };

  const step = (x: number, n: number) => Math.round(x * n);
  return {
    id: 'accessories', section, pages,
    drawPrint(side, c, t) {
      const s = state(t);
      if (side === 'L') drawLeft(c, t, s); else drawRight(c, t, s);
    },
    drawMarks(side, c, t) {
      if (side !== 'R') return;
      const m = marksAt(t);
      if (m.cross > 0) {
        const L = CROSS_PTS.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - CROSS_PTS[i - 1]!.x, p.y - CROSS_PTS[i - 1]!.y)), 0);
        lipstickStroke(c, CROSS_PTS, m.cross * L, { width: LIP_W, seed: 91 });
      }
      if (m.loop > 0) {
        const pts = loopAround(JACKET_BOX, 92);
        const L = pts.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y)), 0);
        lipstickStroke(c, pts, m.loop * L, { width: LIP_W, seed: 92 });
      }
    },
    key(side, layer, t) {
      const s = state(t);
      if (layer === 'marks') { if (side !== 'R') return ''; const m = marksAt(t); return `${step(m.cross, STEPS.cross)},${step(m.loop, STEPS.loop)}`; }
      const leashStep = step(s.leash, LEASH_STEPS);
      if (side === 'L') return `${karaokeKey([subLine(L1, 0, 2), subLine(L1, 2, 3), subLine(L1, 3, 5), subLine(L1, 5, 6)], t)}|${leashStep}`;
      return [karaokeKey([L2], t), leashStep, step(s.fall, SLAM.steps), step(s.since, 60)].join('|');
    },
    camera, focus,
  };
};
