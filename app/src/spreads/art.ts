// Ink line art for the magazine: fashion technical flats in the cover's manner — outlines, seams and stitches dashed,
// shade hatched — as path data in each piece's own units. The jacket, hanger and her cut line are the cover's
// (spreads/cover.ts draws them exactly; changing them changes the approved cover). Draw a piece with artDrawings /
// drawArt under a transform that places and scales it (line widths are in the piece's units: they scale with it,
// unless drawArt's widthK undoes that). Everything here is frozen, down to the points: the cover and the spreads share
// it, and a drawing made without wobble holds its raw polylines by reference (engine/drawing.ts makeDrawing), so a
// write would move the cover's art too. It throws instead, where it's made.
import { type Drawing, circle, drawProgress, hatchLines, makeDrawing, parsePath } from '../engine/drawing';
import { type V2, pointAtLength, polylineLengths } from '../engine/util';
import type { Box } from './shots';

/** One stroke group: paths that ink together (a drawing's groups ink in turn, each on its cue), in one line style. */
export interface ArtGroup {
  readonly paths: readonly (string | readonly V2[])[];
  readonly width: number;
  readonly dash?: readonly number[];
  readonly wobble?: number;
}
/** A piece: its stroke groups in drawing order, and the box (in its own units) that holds them. */
export interface Art { readonly box: Box; readonly groups: readonly ArtGroup[] }

/** T read-only all the way down (properties, arrays, tuples): what deepFreeze makes of it. */
export type Frozen<T> = T extends string | number | boolean | bigint | symbol | null | undefined ? T : { readonly [K in keyof T]: Frozen<T[K]> };
/** Freeze `o` and everything in it, all the way down, in place (a write then throws: ES modules are strict). */
function deepFreeze<T>(o: T): Frozen<T> {
  if (typeof o === 'object' && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o as Frozen<T>;
}

// ---- the cover's (unchanged; page units on the cover) ----
// Him: a single-breasted blazer as a technical flat (x 264..528), symmetric about x 396, leaving the left column to
// the cover lines: neck to hem ~1.5x its shoulder width (a real blazer's is ~1.6x), nipped at the waist, sleeves
// ending just above the hem, notch lapels breaking at the top of two buttons, the fronts cut away below them, flap
// pockets, a welt on the left breast.
export const HANGER = deepFreeze([
  'M396 286 L396 272 C396 258 410 254 414 244 C418 234 408 224 398 228',
  'M396 286 L266 346 Q260 350 266 352 L526 352 Q532 350 526 346 Z',
]);
export const OUTLINE = deepFreeze(['M298 350 C282 356 274 372 272 392 L264 690 L304 696 L312 468 C318 500 324 528 323 556 C322 600 316 660 313 712 L366 716 C380 690 392 650 396 612 C400 650 412 690 426 716 L479 712 C476 660 470 600 469 556 C468 528 474 500 480 468 L488 696 L528 690 L520 392 C518 372 510 356 494 350 L440 340 C428 348 364 348 352 340 Z']);
export const LAPELS = deepFreeze([
  'M352 340 L338 386 L346 395 L328 402 C332 452 360 514 396 556', // collar, notch, lapel down to the break
  'M440 340 L454 386 L446 395 L464 402 C460 452 432 514 396 556',
  'M364 346 L396 556', 'M428 346 L396 556', // the neckline's V
  'M396 556 L396 612', // the front edge, down the buttons
]);
export const POCKETS = deepFreeze([
  'M326 648 L376 648 L376 662 L326 662 Z', 'M416 648 L466 648 L466 662 L416 662 Z', // flaps
  'M438 503 L467 497 L468 505 L439 511 Z', // breast welt
  circle(396, 566, 5, 20), circle(396, 604, 5, 20),
]);
export const STITCHES = deepFreeze([
  'M318 706 L364 710', 'M428 710 L474 706', // hem
  'M266 682 L305 688', 'M487 688 L526 682', // cuffs
  'M355 350 L343 384', 'M437 350 L449 384', // collar
  'M334 408 C338 454 364 512 393 548', 'M458 408 C454 454 428 512 399 548', // lapel edges
  'M329 655 L373 655', 'M419 655 L463 655', // flaps
]);
export const SHADE = deepFreeze<V2[][]>([
  // inside the left side seam (its curve sampled), 12 pu wide
  [{ x: 312, y: 468 }, { x: 316, y: 491 }, { x: 320, y: 513 }, { x: 323, y: 535 }, { x: 323, y: 556 }, { x: 321, y: 592 }, { x: 319, y: 631 },
    { x: 316, y: 672 }, { x: 313, y: 712 }, { x: 325, y: 712 }, { x: 328, y: 672 }, { x: 331, y: 631 }, { x: 333, y: 592 }, { x: 335, y: 556 },
    { x: 335, y: 535 }, { x: 332, y: 513 }, { x: 328, y: 491 }, { x: 324, y: 472 }],
  [{ x: 272, y: 392 }, { x: 284, y: 396 }, { x: 276, y: 690 }, { x: 264, y: 690 }], // the left sleeve's outer side
  [{ x: 440, y: 340 }, { x: 454, y: 386 }, { x: 446, y: 395 }, { x: 420, y: 398 }, { x: 428, y: 346 }], // the right collar
]);
// Her: a woman's outline as one cut line (symmetric about x 608), traced from the crown down her left side — the
// viewer's right, beside the scissors — and back up her right: a shoulder-length bob, bare arms, a sheath dress to
// the knee, legs in pointed heels. Her feet end 20 pu above the price line. One subpath, in pieces:
export const HER = deepFreeze([[
  'M608 274 C623 274 636 284 638 300 L641 344 C641 350 636 353 630 353 L618 353', // crown; the bob, its ends turned under
  'L617 362 C630 364 648 366 657 374', // neck, left shoulder
  'C662 378 664 386 664 398 L671 566 C673 580 672 596 667 600 C663 602 660 596 660 586 L659 568 L651 412', // left arm, hand
  'C650 432 634 454 632 478 C630 500 652 516 653 544 C653 590 647 660 642 706', // bodice, waist, hip, sheath to the knee
  'L634 706 C637 736 634 790 628 828 C630 838 629 848 624 854 C620 849 618 838 619 828 C617 790 615 740 614 706', // left leg
  'L602 706', // the hem between her knees
  'C601 740 599 790 597 828 C598 838 596 849 592 854 C587 848 586 838 588 828 C582 790 579 736 582 706', // right leg
  'L574 706 C569 660 563 590 563 544 C564 516 586 500 584 478 C582 454 566 432 565 412', // the dress, up her right side
  'L557 568 L556 586 C556 596 553 602 549 600 C544 596 543 580 545 566 L552 398', // right arm, hand
  'C552 386 554 378 559 374 C568 366 586 364 599 362 L598 353 L586 353 C580 353 575 350 575 344 L578 300 C580 284 593 274 608 274 Z', // right shoulder, neck, bob
].join(' ')]);
export const SCISSORS = deepFreeze([circle(654, 266, 5, 16), circle(668, 272, 5, 16), 'M658 270 L684 254', 'M664 268 L686 264']);
/** The scissors' root, where the blades open from: midway between the finger rings' centres, (654, 266) and (668, 272). */
export const SCISSORS_ROOT = deepFreeze({ x: (654 + 668) / 2, y: (266 + 272) / 2 });
/** The scissors' axis (radians): from the root to midway between the tips, (684, 254) and (686, 264). A spread riding
 *  them on a cut line turns them by it and places them by the root. */
export const SCISSORS_AXIS = Math.atan2((254 + 264) / 2 - SCISSORS_ROOT.y, (684 + 686) / 2 - SCISSORS_ROOT.x);
/** The jacket's neck point (where it hangs: the anchor to place it by), in its units. */
export const JACKET_NECK = deepFreeze({ x: 396, y: 340 } as const);
/** The hanger's hook, its tip (where a leash's clasp would clip on), in its units: HANGER's last curve's end. */
export const HANGER_HOOK = deepFreeze({ x: 398, y: 228 } as const);

/** Her head and shoulders: HER's line from her left shoulder (the viewer's right) up over the bob and down to her
 *  right, cut off below the shoulders (open). */
export const HER_BUST = 'M664 430 L664 398 C664 386 662 378 657 374 C648 366 630 364 617 362 L618 353 L630 353 C636 353 641 350 641 344 L638 300 C636 284 623 274 608 274 C593 274 580 284 578 300 L575 344 C575 350 580 353 586 353 L598 353 L599 362 C586 364 568 366 559 374 C554 378 552 386 552 398 L552 430';

// ---- the new flats (each in its own units, origin top-left) ----
/** A closed polyline: an ellipse at (cx, cy) with radii rx, ry. */
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 64): V2[] => circle(0, 0, 1, n).map((p) => ({ x: cx + p.x * rx, y: cy + p.y * ry }));
/** An open polyline along the ellipse at (cx, cy), radii rx, ry, from angle a0 to a1 (radians: 0 is its right end and,
 *  y being down, angles grow clockwise). */
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 40): V2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
/** The first subpath of `d` as a polyline, each point moved off it along its normal by `by(s)` (s 0..1 along it;
 *  positive: to the left of its direction of travel, as drawn on a y-down page). */
function offset(d: string, by: (s: number) => number): V2[] {
  const p = parsePath(d)[0]!, L = polylineLengths(p), total = L[L.length - 1]!;
  return p.map((q, i) => {
    const a = p[Math.max(0, i - 1)]!, b = p[Math.min(p.length - 1, i + 1)]!, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const k = by(L[i]! / total);
    return { x: q.x + ((b.y - a.y) / len) * k, y: q.y - ((b.x - a.x) / len) * k };
  });
}
/** A highlight on a glossy surface: a thin lens along `d`, `w` wide at its middle, drawn to a point at either end. */
function lens(d: string, w: number): V2[] {
  const side = (k: number) => offset(d, (s) => k * (w / 2) * Math.sin(Math.PI * s));
  const out = [...side(1), ...side(-1).reverse()];
  return [...out, { ...out[0]! }];
}
/** A strip `w` wide inside a path (to its right), from its own line: a band to hatch along an edge. */
const strip = (d: string, w: number): V2[] => [...offset(d, () => 0), ...offset(d, () => -w).reverse()];
/** Short ticks across a path every `every` units, reaching `half` either side of it (a zip's teeth). */
function ticks(d: string, every: number, half: number): V2[][] {
  const out: V2[][] = [];
  for (const pts of parsePath(d)) {
    const L = polylineLengths(pts);
    for (let s = every / 2; s < L[L.length - 1]!; s += every) {
      const p = pointAtLength(pts, L, s), nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
      out.push([{ x: p.x - nx * half, y: p.y - ny * half }, { x: p.x + nx * half, y: p.y + ny * half }]);
    }
  }
  return out;
}

/** The boot's zip: down the back of the shaft, in from its edge, from the topline to above the Achilles. */
const BOOT_ZIP = 'M55 15 C50 36 44 66 44 98 C44 136 55 170 62 196';
/** The shin, just inside the shaft's front edge, and on down the instep: where the shade lies (the lamp is upper left). */
const BOOT_SHIN = 'M121 10 C122 58 120 118 115.5 178 C113 206 119 230 134 249';
/** The sole's edge, a few units above the ground, from the shank to the toe. */
const BOOT_SOLE = 'M109 326 C125 335 140 336 153 336 L204 336';
/** Patent leather knee boots on a stiletto, toe to the right, as a technical flat: a slim shaft that swells at the calf
 *  and narrows to the ankle, a back zip with its pull, the topline stitched, a pointed toe, a slender heel with a curved
 *  back. The patent is in its highlights, thin lenses where the lamp (upper left) catches it — down the shaft left of
 *  centre, over the instep and the toe box, down the heel's back — against the shade hatched along the shin and the
 *  heel's breast and on the sole's edge. */
const BOOT: Art = {
  box: [0, 0, 220, 350],
  groups: [
    // the silhouette: the topline, the shin, the instep and vamp to the toe, the sole, the shank up to the heel, the
    // heel and its top-lift, the counter, the Achilles, the calf
    { paths: ['M48 12 C72 8 98 4 123 2 C124 50 122 118 117 178 C114 208 121 234 138 254 C152 270 176 292 198 308 C208 316 215 324 214 331 C213 337 207 340 199 340 L153 340 C133 340 117 334 105 322 C97 314 91 302 87 288 C83 306 80 324 79 340 L72 340 C70 318 65 298 56 282 C48 271 45 256 47 241 C49 227 58 214 59 200 C60 168 35 140 34 98 C33 62 43 30 48 12 Z'], width: 2.2, wobble: 0.5 },
    { paths: [ // the zip's tape and its pull; the sole's edge; the highlights
      offset(BOOT_ZIP, () => 1.5), offset(BOOT_ZIP, () => -1.5),
      'M51 15 L58 15 L58 33 C58 37 56 38 54.5 38 C53 38 51 37 51 33 Z', 'M53.5 28 L55.5 28 L55.5 34 L53.5 34 Z',
      BOOT_SOLE,
      lens('M74 24 C70 64 68 120 72 178', 5), 'M84 34 C82 70 81 110 83 146', // down the shaft
      lens('M127 222 C131 239 141 253 156 266', 2.6), lens('M166 290 C181 299 195 309 205 318', 3), // instep, toe box
      'M60 289 C65 303 69 318 71.5 333', 'M51 247 C50 257 52 266 57 273', // the heel's back, the counter
    ], width: 1.3, wobble: 0.3 },
    { paths: ['M50 19 C74 15 99 11 121 9', 'M121 230 C104 252 82 268 60 279'], width: 1, dash: [3, 3] }, // stitching: the topline, the ankle seam
    { paths: [ // fine lines: the zip's teeth; shade along the shin and the instep, on the sole's edge, down the heel's breast
      ...ticks(BOOT_ZIP, 2.6, 1.5),
      ...hatchLines(strip(BOOT_SHIN, 7), 1.1, 2.8),
      ...hatchLines([...offset(BOOT_SOLE, () => 0), { x: 204, y: 340 }, { x: 153, y: 340 }, { x: 132, y: 339 }, { x: 116, y: 333 }], 0.6, 1.6),
      ...hatchLines(strip('M87 290 C83 306 80 324 79 339', 3.5), 1.1, 2.2),
    ], width: 0.8 },
  ],
};
// The compact, three-quarter view from the front: its base an ellipse 118 x 44 at (150, 216) with a wall 16 deep, its lid
// stood open behind on the hinge, facing us (118 x 84 at (150, 86)).
const C_LID = { cx: 150, cy: 86, rx: 118, ry: 84 }, C_RIM = { cx: 150, cy: 216, rx: 118, ry: 44 }, C_WALL = 16;
const C_PAN = { cx: 150, cy: 220, rx: 90, ry: 31 }; // the pan of blush, sunk a little in the base
/** The base's wall: down at the left, along the bottom (the rim's lower arc, C_WALL lower), up at the right. */
const COMPACT_SIDE: V2[] = [{ x: C_RIM.cx - C_RIM.rx, y: C_RIM.cy }, ...arc(C_RIM.cx, C_RIM.cy + C_WALL, C_RIM.rx, C_RIM.ry, Math.PI, 0, 48), { x: C_RIM.cx + C_RIM.rx, y: C_RIM.cy }];
/** The wall's shaded right end: between the rim's lower arc and the bottom's, from ~40° short of its end round to it. */
const COMPACT_WALL: V2[] = [...arc(C_RIM.cx, C_RIM.cy, C_RIM.rx, C_RIM.ry, 0, 0.75, 12), ...arc(C_RIM.cx, C_RIM.cy + C_WALL, C_RIM.rx, C_RIM.ry, 0.75, 0, 12)];
/** Inside the base, the back of its wall above the pan: in the rim's shadow (between the lip's far arc and the pan's). */
const COMPACT_INNER: V2[] = [...arc(150, 216, 109, 39, Math.PI * 1.12, Math.PI * 1.88, 24), ...arc(C_PAN.cx, C_PAN.cy, C_PAN.rx + 2, C_PAN.ry + 1, Math.PI * 1.8, Math.PI * 1.2, 24)];
/** The rose pressed into the blush (it is the shade "Rose"): a bud's spiral and five petals round it, seen at the pan's
 *  slant (squashed by its ry/rx), then a ring. */
const COMPACT_ROSE: V2[][] = (() => {
  const k = C_PAN.ry / C_PAN.rx, cx = C_PAN.cx, cy = C_PAN.cy + 1;
  const spiral = Array.from({ length: 73 }, (_, i) => { const a = (i / 72) * Math.PI * 5, r = 3 + (i / 72) * 15; return { x: cx + r * Math.cos(a), y: cy + k * r * Math.sin(a) }; });
  const petals = Array.from({ length: 5 }, (_, j) => {
    const a0 = (j / 5) * 2 * Math.PI + 0.3, pts: V2[] = [];
    for (let i = 0; i <= 14; i++) { const a = a0 + (i / 14) * 1.5, r = 21 + 9 * Math.sin((i / 14) * Math.PI); pts.push({ x: cx + r * Math.cos(a), y: cy + k * r * Math.sin(a) }); }
    return pts;
  });
  return [spiral, ...petals, ellipse(cx, cy, 52, 52 * k, 48)];
})();
/** An open powder compact, three-quarter view: the lid stood open behind on its hinge, its mirror with a bevel and
 *  the lamp's glints; the base with its rim and lip, and the pressed blush in its pan, a rose embossed in it; shade
 *  hatched on the wall's far end and inside, under the rim. */
const COMPACT: Art = {
  box: [0, -1, 300, 289], // (from a unit above 0: the lid's thickness reaches y −1)
  groups: [
    // the lid, and its thickness showing along its top as it leans back (out from its edge, and back into it)
    { paths: [ellipse(C_LID.cx, C_LID.cy, C_LID.rx, C_LID.ry), Array.from({ length: 41 }, (_, i) => {
      const a = Math.PI * (1.05 + (0.9 * i) / 40), t = 3 * Math.sin((Math.PI * i) / 40) ** 2;
      return { x: C_LID.cx + (C_LID.rx + 0.3 * t) * Math.cos(a), y: C_LID.cy + (C_LID.ry + t) * Math.sin(a) };
    })], width: 2, wobble: 0.5 },
    // the mirror, its bevel, and the glints across it (two long, two short, all at the lamp's angle)
    { paths: [ellipse(150, 88, 102, 70), ellipse(150, 88, 97, 66), 'M86 94 L150 49', 'M102 100 L152 65', 'M163 129 L202 102', 'M178 134 L205 115'], width: 1, wobble: 0.3 },
    // the hinge's knuckles, the base's rim and wall
    { paths: ['M131 165 L169 165 C172 165 173 167 173 171 C173 175 172 177 169 177 L131 177 C128 177 127 175 127 171 C127 167 128 165 131 165 Z', 'M143 165 V177', 'M157 165 V177', ellipse(C_RIM.cx, C_RIM.cy, C_RIM.rx, C_RIM.ry), COMPACT_SIDE], width: 2, wobble: 0.5 },
    // the lip inside the rim, the pan; the shade on the wall's end and inside the base
    { paths: [ellipse(150, 216, 109, 39), ellipse(C_PAN.cx, C_PAN.cy, C_PAN.rx, C_PAN.ry), ...hatchLines(COMPACT_WALL, 1.1, 3.2), ...hatchLines(COMPACT_INNER, 1.1, 3.4)], width: 1 },
    { paths: COMPACT_ROSE, width: 0.8 }, // the pressed rose
  ],
};
/** A rat-tail teasing comb, its teeth down: a slim spine rounded at its end, drawn out into a long tail to a point, a
 *  ridge along it; the teeth long and short in turn, as a teasing comb's are. */
const COMB: Art = {
  box: [0, 0, 370, 70],
  groups: [
    { paths: ['M10 9 C70 8 140 8 190 10 C252 12 310 15 364 18 C310 19.4 252 21.5 190 25 L10 26 C6 26 4 24 4 21 L4 14 C4 11 6 9 10 9 Z'], width: 1.8, wobble: 0.4 },
    { paths: ['M12 14 C72 13.2 140 13.4 190 15.5 C250 17 300 17.6 340 18', ...Array.from({ length: 30 }, (_, i) => `M${12 + i * 6} 26.5 V${i % 2 ? 51 : 59}`)], width: 1.1 },
  ],
};
/** A street frame's picture (320 x 150, the frame itself not drawn): shopfronts, the kerb, a crossing, a lamp post.
 *  `variant` (0..5) moves the buildings and windows so six frames of one walk differ. */
function street(variant: number): Art {
  const s = [0, 18, -12, 30, -22, 8][variant % 6]!;
  const b1 = 96 + s, b2 = 200 - s / 2;
  const win = (x: number, y: number, w: number, h: number) => `M${x} ${y} h${w} v${h} h${-w} Z`;
  const windows: string[] = [];
  for (let x = 14; x + 14 < b1 - 6; x += 28) for (const y of [44, 74]) windows.push(win(x, y, 14, 18));
  for (let x = b1 + 16; x + 20 < b2 - 6; x += 34) windows.push(win(x, 62, 20, 14));
  // the low building's shopfront, under its windows: an awning's edge, the shop window, the door
  windows.push(`M${b1 + 4} 82 H${b2 - 4}`, win(b1 + 8, 87, b2 - b1 - 34, 14), `M${b2 - 20} 106 V87 h12 V106`);
  for (let x = b2 + 14; x + 16 < 292; x += 32) for (const y of [32, 66]) windows.push(win(x, y, 16, 22));
  return {
    box: [0, 0, 320, 150],
    groups: [
      // three buildings, low between two taller: each wall drawn once, the taller one's, up from the pavement
      { paths: [`M0 30 H${b1} V106 M${b1} 48 H${b2} M${b2} 106 V18 H320`], width: 0.9, wobble: 0.3 },
      { paths: windows, width: 0.6 },
      { paths: ['M0 106 H320 M0 112 H320', ...Array.from({ length: 6 }, (_, i) => win(24 + i * 46, 124, 26, 16))], width: 0.8 },
      { paths: ['M300 24 V106 M300 24 Q310 22 313 30'], width: 1 },
    ],
  };
}

/** LUI, the spread 4 perfume ad's invented flacon: a faceted bottle as a technical flat, symmetric about x 120 —
 *  a chamfered stopper, a collar, a shoulder flaring out to a chamfered-octagon body — its facet edges (the collar
 *  ring, the stopper's divide, the body's bevels and waist) a second group, and two hatched glints (the left bevel,
 *  the stopper) a third, lightest group: spread 4 cuts it, and the hatch, out of the black at a lighter alpha, for a
 *  reflection rather than a line. */
const FLACON_OUTLINE = 'M108 0 L132 0 L140 8 L140 32 L140 70 L200 140 L200 340 L170 380 L70 380 L40 340 L40 140 L100 70 L100 32 L100 8 Z';
const FLACON_FACETS = ['M100 70 L140 70', 'M106 16 L134 16', 'M80 140 L80 340', 'M160 140 L160 340', 'M40 245 L200 245', 'M40 340 L200 340'];
const FLACON: Art = {
  box: [36, -4, 204, 384],
  groups: [
    { paths: [FLACON_OUTLINE], width: 2.6, wobble: 0.4 },
    { paths: FLACON_FACETS, width: 1.4, wobble: 0.2 },
    // (lens needs interior points to bulge a straight run: a plain 2-point M-L line has none, sin(pi*s) vanishing at
    // both its ends alike, so each is split into a few short L segments)
    { paths: [...hatchLines(lens('M60 150 L60 210 L60 270 L60 330', 16), 0.3, 4), ...hatchLines(lens('M118 2 L118 11 L118 20 L118 30', 10), 0.3, 3)], width: 0.8 },
  ],
};

/** Spread 5's leash: a calfskin lead as a technical flat, in "spread x" units (continuous across the gutter at the
 *  layout's own scale, 0..1540, the right page at x - 770, as spreads/accessories.ts draws it on both faces) — its
 *  handle loop, the strap snaking up to a brass clasp, the clasp's gate and spring. One group (the loop, both of the
 *  strap's edges, the clasp's ring) inks as the technical flat's silhouette; stitching just inside the edges, a few
 *  rivets along the strap, and the clasp's gate and coiled spring ink alongside it, each its own group, so a spread can
 *  still ink them in sequence if it wants to, though accessories.ts inks them all together, along the strap's length. */
const LEASH_LOOP = { x: 170, y: 860, rx: 78, ry: 58 } as const;
/** The strap's centreline, from the loop's rightmost point (its attachment) up to the clasp. */
const LEASH_CENTER = 'M248 860 C430 845 640 770 760 690 C880 610 980 430 1080 290 C1112 246 1130 206 1148 172';
const LEASH_HW = 15; // the strap's half-width
/** The clasp's ring, at the strap's end — placed so its tip lands on ART.jacket's HANGER_HOOK at accessories.ts's scale. */
const LEASH_CLASP = { x: 1150, y: 176, rx: 27, ry: 20 } as const;
const leashCenterPts = parsePath(LEASH_CENTER)[0]!, leashCenterLens = polylineLengths(leashCenterPts);
const leashCenterLen = leashCenterLens[leashCenterLens.length - 1]!;
/** A handful of rivets along the strap, evenly spread (fractions of its centreline's length). */
const leashRivets: V2[][] = [0.12, 0.3, 0.48, 0.66, 0.84].map((s) => {
  const p = pointAtLength(leashCenterPts, leashCenterLens, s * leashCenterLen);
  return circle(p.x, p.y, 6, 14);
});
const LEASH: Art = {
  box: [60, 90, 1210, 940],
  groups: [
    { paths: [ellipse(LEASH_LOOP.x, LEASH_LOOP.y, LEASH_LOOP.rx, LEASH_LOOP.ry), offset(LEASH_CENTER, () => LEASH_HW),
      offset(LEASH_CENTER, () => -LEASH_HW), ellipse(LEASH_CLASP.x, LEASH_CLASP.y, LEASH_CLASP.rx, LEASH_CLASP.ry)], width: 2.4, wobble: 0.5 },
    { paths: [offset(LEASH_CENTER, () => LEASH_HW * 0.6), offset(LEASH_CENTER, () => -LEASH_HW * 0.6)], width: 1, dash: [3, 3] },
    { paths: leashRivets, width: 1 },
    // the gate (a bar across the ring's opening) and its coiled spring, beside it
    { paths: [`M${LEASH_CLASP.x} ${LEASH_CLASP.y - 18} L${LEASH_CLASP.x} ${LEASH_CLASP.y + 18}`,
      `M${LEASH_CLASP.x - 7} ${LEASH_CLASP.y - 14} L${LEASH_CLASP.x + 7} ${LEASH_CLASP.y - 8} L${LEASH_CLASP.x - 7} ${LEASH_CLASP.y - 2} L${LEASH_CLASP.x + 7} ${LEASH_CLASP.y + 4} L${LEASH_CLASP.x - 7} ${LEASH_CLASP.y + 10}`],
      width: 1.2, wobble: 0.2 },
  ],
};
/** Spread 5's luggage tag: its own units, origin at the grommet (where the string from the clasp ties on), the body
 *  hanging below it, tapered at the top. SOLD is stamped on it in print (accessories.ts), not drawn here. */
const TAG_W = 130, TAG_TOP = 10, TAG_NECK = 32, TAG_H = 190;
const TAG_BODY = `M-18 0 L18 0 L${TAG_W / 2} ${TAG_NECK} L${TAG_W / 2} ${TAG_H} L${-TAG_W / 2} ${TAG_H} L${-TAG_W / 2} ${TAG_NECK} Z`;
const TAG: Art = {
  box: [-TAG_W / 2 - 4, -16, TAG_W / 2 + 4, TAG_H + 4],
  groups: [
    { paths: [TAG_BODY, circle(0, 0, 12, 20)], width: 1.8, wobble: 0.4 },
    { paths: [circle(0, 0, 7, 16)], width: 1.2 },
    { paths: [`M${-TAG_W / 2 + 10} ${TAG_NECK + 13} L${TAG_W / 2 - 10} ${TAG_NECK + 13} L${TAG_W / 2 - 10} ${TAG_H - 10} L${-TAG_W / 2 + 10} ${TAG_H - 10} Z`], width: 0.9, dash: [3, 3] },
  ],
};

/** Everything, by name. */
export const ART = deepFreeze({
  jacket: { box: [256, 330, 536, 722], groups: [
    { paths: OUTLINE, width: 2.0, wobble: 0.7 }, { paths: LAPELS, width: 1.5, wobble: 0.6 }, { paths: POCKETS, width: 1.3, wobble: 0.4 },
    { paths: STITCHES, width: 0.9, dash: [3, 3] }, { paths: SHADE.flatMap((p) => hatchLines(p, 1.1, 6)), width: 0.7 },
  ] },
  hanger: { box: [256, 220, 536, 356], groups: [{ paths: HANGER, width: 1.6, wobble: 0.5 }] },
  her: { box: [536, 266, 680, 862], groups: [{ paths: HER, width: 1.2, wobble: 0.3, dash: [5, 5] }] },
  herBust: { box: [548, 270, 668, 434], groups: [{ paths: [HER_BUST], width: 1.2, wobble: 0.3, dash: [5, 5] }] },
  scissors: { box: [645, 250, 690, 280], groups: [{ paths: SCISSORS, width: 1 }] },
  boot: BOOT, compact: COMPACT, comb: COMB, flacon: FLACON, leash: LEASH, tag: TAG,
  street0: street(0), street1: street(1), street2: street(2), street3: street(3), street4: street(4), street5: street(5),
} satisfies Record<string, Art>);

export interface ArtDrawing { readonly d: Drawing; readonly width: number; readonly dash: readonly number[] }
/** A piece's groups as drawings (wobble seeded per group from `seed`). Pure: build once, in the factory. */
export function artDrawings(a: Art, seed: number): ArtDrawing[] {
  return a.groups.map((g, i) => ({ d: makeDrawing(g.paths, { wobble: g.wobble ?? 0, seed: seed + i * 31 }), width: g.width, dash: g.dash ?? [] }));
}
/** Stroke a piece's groups, each to its own progress (0..1), in the context's stroke colour, line widths and dash
 *  patterns times `widthK` (pass 1/scale to keep the piece's own line style in page units when the context is scaled:
 *  a stitch line keeps its width and its stitch length together). */
export function drawArt(c: CanvasRenderingContext2D, ds: readonly ArtDrawing[], progress: readonly number[], widthK = 1) {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  ds.forEach((g, i) => {
    const p = progress[i] ?? 0;
    if (p <= 0) return;
    c.lineWidth = g.width * widthK;
    c.setLineDash(g.dash.map((x) => x * widthK));
    drawProgress(c, g.d, p * g.d.total);
  });
  c.setLineDash([]);
}
