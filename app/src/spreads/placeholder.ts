// Placeholder spreads for the flatplan's spreads whose module isn't built yet (the section's title on the left, the
// spread's lyrics set with karaoke on the right). They let the whole song play as a magazine while the real spreads
// are made.
import { F, font, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { HAIRLINE_PU, MARGIN, PAGE, drawFolio, karaokeKey, setLine, textCutDashes, textLeft, textWidth } from '../engine/layout';
import type { Line } from '../engine/lyrics';
import { FRAME_SPREAD, type Spread, type SpreadCtx } from './spread';

const TITLES: Record<string, string> = {
  verse1: 'Verse I', prechorus1: 'Pre-Chorus I', chorus1: 'Chorus I', verse2: 'Verse II', prechorus2: 'Pre-Chorus II',
  chorus2: 'Chorus II', postchorus1: 'Post-Chorus I', bridge1: 'The Bridge', chorus3: 'Chorus III',
  postchorus2: 'Post-Chorus II', outro1: 'Outro',
};

/** The placeholder for the spread `ctx` is for, printing `lines` (its share of its section: registry.ts
 *  placeholderLines). */
export function placeholder(ctx: SpreadCtx, lines: Line[]): Spread {
  const { section, pages } = ctx;
  return {
    id: `placeholder-${ctx.id}`, section, pages,
    drawPrint(side, c, t) {
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      if (side === 'L') {
        c.fillStyle = rgba('ink');
        c.font = font(F.mono(500), 11);
        c.letterSpacing = '3px';
        c.fillText('FEATURE', MARGIN.outer, MARGIN.top + 40);
        c.letterSpacing = '0px';
        // the title in the display cut, outlined by HAIRLINE_PU, its hyphen from the text cut ("Pre-Chorus" printed as
        // "Pre Chorus": the display cut's is 4/2000 em thick), shrunk to fit the text width if it must be
        const title = Object.hasOwn(TITLES, section) ? TITLES[section]! : section, fam = F.bodoni(700, { italic: true });
        c.save();
        c.translate(MARGIN.outer, MARGIN.top + 150);
        c.scale(Math.min(1, textWidth / measure(title, fam, 76)), 1);
        c.font = font(fam, 76);
        c.fillText(title, 0, 0);
        c.strokeStyle = rgba('ink');
        c.lineWidth = HAIRLINE_PU;
        c.lineJoin = 'round';
        c.strokeText(title, 0, 0);
        textCutDashes(c, title, 0, 0, fam, F.bodoni(400, { italic: true, text: true }), 76, true);
        c.restore();
        c.fillRect(MARGIN.outer, MARGIN.top + 180, 120, 1.5);
        c.fillStyle = rgba('graphite');
        c.font = font(F.mono(400), 10);
        c.fillText('SPREAD IN PRODUCTION', MARGIN.outer, PAGE.h - MARGIN.bottom - 20);
      } else {
        let y = MARGIN.top + 110;
        for (const l of lines) {
          // the text optical size: the display cut's hairlines (hyphens, comma tails) vanish at this size on screen
          setLine(c, l, t, textLeft('R'), y, { family: F.bodoni(400, { text: true }), size: 40, maxWidth: textWidth });
          y += 70;
        }
      }
      drawFolio(c, side, pages[side === 'L' ? 0 : 1]);
    },
    drawMarks() {},
    key(side, layer, t) { return layer === 'print' && side === 'R' ? karaokeKey(lines, t) : ''; },
    camera(t) {
      return { ...FRAME_SPREAD, x: FRAME_SPREAD.x + 0.015 * Math.sin(t * 0.21), y: FRAME_SPREAD.y + 0.01 * Math.sin(t * 0.17 + 1) };
    },
  };
}
