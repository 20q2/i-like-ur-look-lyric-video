// Spread 12, the inside back cover (outro1, pp. 24-25; batch-2 spec §4.9): seen for about a second, between the
// close's two flops (leaf 11 turns it up at 164.118, leaf 12 closes the book onto backcover at 165.014). No lyric of
// the outro prints here ("Yeah" belongs to no page: registry.ts's placeholder test expects this id to claim none) and
// there are no shots: the camera rides the close, held on the open spread (director with no shots: see shots.ts plan,
// which leaves camera(t) at its `start`, FRAME_SPREAD, once that's already turn-ready). Everything here is printed at
// once (no karaoke, no cues to ink progressively), so both faces' keys are constants.
//
// ---- the layout (page units) ----
// Left page, the inside back cover: a small in-book ad for the jacket, on its hanger — the cover's own art, shrunk
// and centred (smaller than the cover's or the back cover's full-bleed placements: this is a modest house-ad page),
// framed by a hairline rule, unbranded.
// Right page, the issue's last page: the next-issue tease, a kicker, the giant masthead-to-come and a dateline.
import { HAIRLINE_PU, PAGE, drawFolio } from '../engine/layout';
import { rgba } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { ART, type ArtDrawing, artDrawings, drawArt } from './art';
import { director } from './shots';
import { type FocusBox, type SpreadFactory, turnOut } from './spread';

/** ART.hanger ∪ ART.jacket's native box (art.ts), and its centre — the group they already share one coordinate frame
 *  in (as the cover draws them, with no relative repositioning needed between the two). */
const GROUP = { x0: 256, y0: 220, x1: 536, y1: 722 } as const;
const GROUP_C = { x: (GROUP.x0 + GROUP.x1) / 2, y: (GROUP.y0 + GROUP.y1) / 2 };
/** Where the shrunk ad sits on the left page, and its scale (native size x this). */
const AD = { cx: PAGE.w / 2, cy: 420, scale: 0.5 } as const;
/** A hairline rule round the ad, and the wordmark under it. */
const FRAME: readonly [number, number, number, number] = [150, 170, 620, 660];

const NEXT_ISSUE = { text: 'NEXT ISSUE', y: 330, size: 28, family: F.bodoni(400, { italic: true }) } as const;
/** THE WINTER / ISSUE, each fitted to WIDTH (measure() at draw time: font metrics need the DOM, so the factory can't
 *  precompute this — the fit is exact regardless, as drawStretch's width-matching is). */
const WINTER = { l1: 'THE WINTER', l2: 'ISSUE', y1: 470, y2: 605, size: 120, width: 640 } as const;
const ON_SALE = { text: 'ON SALE NOVEMBER 1', y: 680, size: 13, tracking: 2 } as const;
/** Bodoni's display-cut cap height, in em (coverstory.ts's CAP.bodoni): FocusBox.size for the giant headline. */
const CAP_BODONI = 0.75;

export const insideback: SpreadFactory = (ctx) => {
  const { pages } = ctx, turnAt = turnOut(ctx);
  const hanger: readonly ArtDrawing[] = artDrawings(ART.hanger, 701), jacket: readonly ArtDrawing[] = artDrawings(ART.jacket, 702);
  const full = (ds: readonly ArtDrawing[]) => ds.map(() => 1);
  const hangerFull = full(hanger), jacketFull = full(jacket);
  // no shots: a single held framing (shots.ts's plan, given no shots and a turn-ready `start`, never adds a move)
  const camera = director(ctx.audio, [], { turnAt });

  const focus: FocusBox[] = [
    { from: ctx.start, to: turnAt, side: 'L', box: FRAME }, // the framed ad (a drawing: the jacket inside it)
    { from: ctx.start, to: turnAt, side: 'R', box: [60, NEXT_ISSUE.y - NEXT_ISSUE.size, 710, NEXT_ISSUE.y + 8], size: NEXT_ISSUE.size },
    { from: ctx.start, to: turnAt, side: 'R', box: [40, WINTER.y1 - WINTER.size, 730, WINTER.y2 + 20], size: WINTER.size * CAP_BODONI },
    { from: ctx.start, to: turnAt, side: 'R', box: [60, ON_SALE.y - ON_SALE.size, 710, ON_SALE.y + 6], size: ON_SALE.size },
  ];

  return {
    id: 'insideback', section: ctx.section, pages,
    drawPrint(side, c, _t) {
      c.textBaseline = 'alphabetic';
      c.textAlign = 'center';
      if (side === 'L') {
        c.strokeStyle = rgba('ink');
        c.lineWidth = 1;
        c.strokeRect(FRAME[0], FRAME[1], FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]);
        c.save();
        c.translate(AD.cx, AD.cy);
        c.scale(AD.scale, AD.scale);
        c.translate(-GROUP_C.x, -GROUP_C.y);
        c.strokeStyle = rgba('ink');
        drawArt(c, hanger, hangerFull, 1 / AD.scale);
        drawArt(c, jacket, jacketFull, 1 / AD.scale);
        c.restore();
        drawFolio(c, 'L', pages[0]);
      } else {
        c.fillStyle = rgba('ink');
        c.font = font(NEXT_ISSUE.family, NEXT_ISSUE.size);
        c.fillText(NEXT_ISSUE.text, PAGE.w / 2, NEXT_ISSUE.y);
        const giant = F.bodoni(900);
        for (const [text, y] of [[WINTER.l1, WINTER.y1], [WINTER.l2, WINTER.y2]] as const) {
          const w = measure(text, giant, WINTER.size), k = Math.min(1, WINTER.width / w);
          c.save();
          c.translate(PAGE.w / 2, y);
          c.scale(k, 1);
          c.font = font(giant, WINTER.size);
          c.fillText(text, 0, 0);
          c.strokeStyle = c.fillStyle; c.lineWidth = Math.max(HAIRLINE_PU, WINTER.size * 0.012); c.lineJoin = 'round';
          c.strokeText(text, 0, 0); // (the Didone's hairlines, outlined so they hold: as setLine's `hairline`)
          c.restore();
        }
        c.font = font(F.mono(600), ON_SALE.size);
        c.letterSpacing = `${ON_SALE.tracking}px`;
        c.fillText(ON_SALE.text, PAGE.w / 2, ON_SALE.y);
        c.letterSpacing = '0px';
        drawFolio(c, 'R', pages[1]);
      }
    },
    drawMarks() {}, // no lipstick here: the narrator's marks start on the back cover
    key(side, layer) {
      if (layer === 'marks') return '';
      return side === 'L' ? 'ad' : 'next';
    },
    camera, focus,
  };
};
