// Magazine grid and typesetting, in page units (pu): each page is PAGE.w x PAGE.h pu, origin top-left,
// y down. Left pages have the gutter (inner margin) on their right, right pages on their left.
import { F, font, glyphX, measure } from './type';
import { Lyrics, type Line, type Word } from './lyrics';
import { rgba } from './palette';
import { PAGE } from './pagesize';

export type Side = 'L' | 'R';
export { PAGE }; // (pagesize.ts: the page geometry needs it without the typesetting)
export const MARGIN = { top: 64, bottom: 72, inner: 58, outer: 48 } as const;
export const COLUMNS = 12;
export const GUTTER = 12;
export const BASELINE = 12;

/** Left edge of the text area on a page. */
export const textLeft = (side: Side) => (side === 'L' ? MARGIN.outer : MARGIN.inner);
export const textWidth = PAGE.w - MARGIN.inner - MARGIN.outer;
export const colWidth = (textWidth - GUTTER * (COLUMNS - 1)) / COLUMNS;

/** x and width of `span` columns starting at column `col` (0-based). */
export function columns(side: Side, col: number, span: number): { x: number; w: number } {
  if (col < 0 || span < 1 || col + span > COLUMNS) throw new Error(`bad column span ${col}+${span}`);
  return { x: textLeft(side) + col * (colWidth + GUTTER), w: span * colWidth + (span - 1) * GUTTER };
}
/** y of baseline n, counted from the top margin. */
export const baseline = (n: number) => MARGIN.top + n * BASELINE;

/** Opacity of unsung words: a faint ghost of the print to come. */
export const GHOST = 0.16;
/** Ink (0 = ghost, 1 = full) of a word at sung-progress p: it prints in over the first 35% of the word. */
export const inkOf = (p: number) => (p <= 0 ? 0 : p >= 0.35 ? 1 : p / 0.35);
/** Levels of printed ink (at most 35: karaokeKey writes each word's level as one base-36 digit). */
export const INK_STEPS = 16;
if (INK_STEPS > 35) throw new Error('INK_STEPS > 35: karaokeKey would stop changing exactly when the ink does');
/**
 * The ink a word prints with at t: inkOf quantised to INK_STEPS levels. Draw lyric ink with this, never the
 * exact inkOf: faces are redrawn only when karaokeKey changes, so a face must look the same at every t that
 * shares its key, or a frame would depend on which earlier frame drew it.
 */
export const inkAt = (w: Word, t: number) => Math.round(inkOf(Lyrics.wordProgress(w, t)) * INK_STEPS) / INK_STEPS;
/** A word's ink level at t (inkAt) as one base-36 digit: karaokeKey's encoding, for a key made of words from several
 *  lines or parts of them. */
export const wordInkKey = (w: Word, t: number) => Math.round(inkAt(w, t) * INK_STEPS).toString(36);
/** Changes exactly when some word in `lines` prints at a different ink level (inkAt). */
export function karaokeKey(lines: Line[], t: number): string {
  let s = '';
  for (const l of lines) for (const w of l.words) s += wordInkKey(w, t);
  return s;
}
/** The opacity type prints at for an ink level (0, a ghost: GHOST; 1, full ink): setLine's, for type set any other way. */
export const ghostAlpha = (ink: number) => GHOST + (1 - GHOST) * ink;

/**
 * An ink outline (pu) for display-cut type whose finest hairlines vanish on screen. Bodoni Moda's display cuts draw
 * their hyphen and dashes, and the italic t's crossbar, 4 units of 2000 thick (0.1 pu at 50 pu: under a fifth of a
 * pixel even at 4K), so no size or output scale we use brings them back: "Pre-Chorus" printed as "Pre Chorus" and
 * "Better" as "Beller". Fill and stroke the same text, both in opaque ink (a translucent fill and stroke would double
 * up where they overlap); setLine's `hairline` does it for a lyric's fully inked words. That brings the crossbars
 * back; dashes stay faint under it (~0.65 px at the open-spread framing), so reprint them with textCutDashes.
 */
export const HAIRLINE_PU = 0.5;

export interface SetLineOpts {
  family: string; size: number; align?: 'left' | 'center' | 'right'; maxWidth?: number;
  /** Outline each word with HAIRLINE_PU of opaque ink once it's fully inked (inkAt 1: quantised, so karaokeKey still
   *  covers it). Ghost and part-inked words are translucent and stay unstroked. */
  hairline?: boolean;
  /** Cut the words out of the print (reversed type on solid ink: TREATMENT.md §6): a ghost cuts at GHOST strength (dark
   *  grey on the black), a sung word through to bare paper, its hairline outline too. Restores globalCompositeOperation
   *  afterward; the fill and stroke are left black. */
  cut?: boolean;
}
/**
 * Print a lyric line at (x, baseline y) with karaoke: unsung words as a ghost, sung words in ink. Words are
 * placed at their positions in the kerned run of the whole line. Shrinks to maxWidth. Returns the width.
 * Leaves `c.font`, `textAlign` and `textBaseline` set to this line's values afterward (no save/restore) —
 * a caller may rely on that to draw more text (e.g. the cover's trailing "." after "Better") in the same font right after.
 * With `hairline`, the stroke style, width and join may be left set too.
 */
export function setLine(c: CanvasRenderingContext2D, line: Line, t: number, x: number, y: number, o: SetLineOpts): number {
  let size = o.size;
  let width = measure(line.text, o.family, size);
  if (width === 0) return 0; // empty text: nothing to shrink to fit or draw
  if (o.maxWidth !== undefined && width > o.maxWidth) { size *= o.maxWidth / width; width = measure(line.text, o.family, size); }
  const left = o.align === 'center' ? x - width / 2 : o.align === 'right' ? x - width : x;
  c.font = font(o.family, size);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  const op = c.globalCompositeOperation;
  if (o.cut) c.globalCompositeOperation = 'destination-out';
  let from = 0;
  for (const w of line.words) {
    const at = line.text.indexOf(w.w, from);
    if (at < 0) throw new Error(`word "${w.w}" not found in line "${line.text}"`);
    from = at + w.w.length;
    // `at` is a UTF-16 offset (String#indexOf); glyphX indexes code points, hence Array.from(...).length.
    const gx = glyphX(line.text, Array.from(line.text.slice(0, at)).length, o.family, size);
    const ink = inkAt(w, t), a = ghostAlpha(ink);
    c.fillStyle = o.cut ? `rgba(0,0,0,${a})` : rgba('ink', a);
    c.fillText(w.w, left + gx, y);
    if (o.hairline && ink >= 1) {
      c.strokeStyle = o.cut ? '#000' : rgba('ink');
      c.lineWidth = HAIRLINE_PU;
      c.lineJoin = 'round'; // (a miter would spike at the serifs)
      c.strokeText(w.w, left + gx, y);
    }
  }
  c.globalCompositeOperation = op;
  return width;
}

/** Words i0..i1-1 of a line (at least one) as a line of their own, for setting a lyric over rows: their texts joined by
 *  spaces, sung from the first's start to the last's end. The words are the parent's own, so they keep its indexes
 *  (`line`, `index` in it, `gi`), as the line keeps its `i` and `section`. */
export function subLine(line: Line, i0: number, i1: number): Line {
  const words = line.words.slice(i0, i1);
  if (!words.length) throw new Error(`subLine: words ${i0}..${i1} of "${line.text}" are none of its ${line.words.length}`);
  return { ...line, text: words.map((w) => w.w).join(' '), start: words[0]!.start, end: words[words.length - 1]!.end, words };
}
export interface Row { x: number; y: number; /** word indexes [from, to) */ words: readonly [number, number] }
/** Print a lyric line over rows (karaoke as setLine, each row a kerned run of its own), each row its words at its own
 *  (x, baseline y), aligned there by `o.align`. The rows must cover the line's words in order, each once: checked for
 *  all of them before any prints. */
export function setRows(c: CanvasRenderingContext2D, line: Line, t: number, rows: readonly Row[], o: SetLineOpts) {
  let next = 0;
  for (const r of rows) {
    if (r.words[0] !== next || r.words[1] <= r.words[0]) throw new Error(`setRows: rows of "${line.text}" don't cover its words in order (row ${r.words})`);
    next = r.words[1];
  }
  if (next !== line.words.length) throw new Error(`setRows: rows of "${line.text}" end at word ${next} of ${line.words.length}`);
  for (const r of rows) setLine(c, subLine(line, r.words[0], r.words[1]), t, r.x, r.y, o);
}

/**
 * Print `text`'s hyphens and dashes again in `dashFamily`, the text cut of the display `family` it was just printed in
 * at (x, baseline y), left-aligned. The display cuts' dashes are 4/2000 em thick, still faint under HAIRLINE_PU;
 * the text cut's are 38/2000, with the same advance, length and height, so they land exactly over them. Uses (and
 * restores) the context's font; with `stroke`, strokes them too, as a HAIRLINE_PU-outlined run needs.
 */
export function textCutDashes(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, dashFamily: string, size: number, stroke = false) {
  const was = c.font, align = c.textAlign;
  c.font = font(dashFamily, size);
  c.textAlign = 'left'; // glyphX offsets are from the run's left end
  Array.from(text).forEach((ch, i) => {
    if (!'-–—'.includes(ch)) return;
    const gx = glyphX(text, i, family, size);
    c.fillText(ch, x + gx, y);
    if (stroke) c.strokeText(ch, x + gx, y);
  });
  c.font = was;
  c.textAlign = align;
}

/** Folio: page number and running head in the bottom outer corner. */
export function drawFolio(c: CanvasRenderingContext2D, side: Side, page: number, head = 'EFFORTLESS · THE FALL ISSUE') {
  c.font = font(F.mono(500), 9);
  c.fillStyle = rgba('ink', 0.85);
  c.textBaseline = 'alphabetic';
  const y = PAGE.h - MARGIN.bottom / 2;
  if (side === 'L') { c.textAlign = 'left'; c.fillText(`${page}    ${head}`, MARGIN.outer, y); }
  else { c.textAlign = 'right'; c.fillText(`${head}    ${page}`, PAGE.w - MARGIN.outer, y); }
}
