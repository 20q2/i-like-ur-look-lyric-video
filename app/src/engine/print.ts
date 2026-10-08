// Printing tricks the inside pages use: cutting shapes out of the print (reversed type, holes — paper-coloured detail
// painted on would vanish when the page is minified: TREATMENT.md §6), Archivo stepped through its widths, and a strip
// of film printed in solid ink.
import { rgba } from './palette';
import { ARCHIVO_WIDTHS, F, font, measure } from './type';

/** Draw with destination-out: whatever `draw` paints is cut out of what is printed (alpha 1 cuts to bare paper;
 *  a fill's alpha cuts that much). The fill and stroke start opaque. Restores the context, even if `draw` throws. */
export function knockout(c: CanvasRenderingContext2D, draw: (c: CanvasRenderingContext2D) => void) {
  c.save();
  try {
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = c.strokeStyle = '#000';
    draw(c);
  } finally {
    c.restore();
  }
}

/** The last Archivo width step: steps run 0..STRETCH_STEPS over ARCHIVO_WIDTHS (62% … 125%). */
export const STRETCH_STEPS = ARCHIVO_WIDTHS.length - 1;
const stepOf = (step: number) => Math.max(0, Math.min(STRETCH_STEPS, Math.round(step)));

/** Archivo at width step `step` (0..STRETCH_STEPS = ARCHIVO_WIDTHS: 62% … 125%). */
export const stretchFamily = (step: number, weight = 900) => F.archivo(ARCHIVO_WIDTHS[stepOf(step)]! / 10, weight);

/** `text` at (x, baseline y) in Archivo at width step `step` (stretchFamily), in the context's fill. With `width`, it is
 *  also scaled horizontally to natural + (width − natural) · step / STRETCH_STEPS, where natural is its width in that
 *  step's own family: unscaled at step 0, exactly `width` at the last step. With `cut`, it is cut out of the print
 *  instead, at the fill's alpha. Restores the context. */
export function drawStretch(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, step: number,
  o: { weight?: number; width?: number; cut?: boolean } = {}) {
  const fam = stretchFamily(step, o.weight), w = measure(text, fam, size);
  if (w === 0) return;
  const target = o.width === undefined ? w : w + (o.width - w) * (stepOf(step) / STRETCH_STEPS);
  c.save();
  if (o.cut) c.globalCompositeOperation = 'destination-out';
  c.translate(x, y);
  c.scale(target / w, 1);
  c.font = font(fam, size);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(text, 0, 0);
  c.restore();
}

export interface Rect { x: number; y: number; w: number; h: number }
/** The film strip's sprocket holes: `w` x `h`, one every `pitch`, `inset` in from the strip's long edges. */
export const SPROCKET = Object.freeze({ w: 10, h: 8, pitch: 24, inset: 6 });
/** A strip of 35 mm film printed in solid ink at (x, y, w, h): sprocket holes cut along both edges (SPROCKET), as many
 *  as fit with at least half the gap between holes at each end, the run centred, so the ends match (two strips butted
 *  end to end, as across the gutter, keep the rhythm); and the frames' windows cut out — paper shows through them;
 *  draw each frame's picture into its window. A frame that crosses a row of holes is an error (checked before any
 *  printing). */
export function filmStrip(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frames: readonly Rect[]) {
  const S = SPROCKET, top = y + S.inset, bottom = y + h - S.inset - S.h;
  for (const f of frames) {
    for (const row of [top, bottom]) {
      if (f.y < row + S.h && f.y + f.h > row) throw new Error(`filmStrip: frame (${f.x}, ${f.y}, ${f.w} x ${f.h}) crosses the sprocket holes at y ${row}..${row + S.h}`);
    }
  }
  // (n holes, with half a gap at each end, take n pitches: a hole and a gap each)
  const n = Math.max(0, Math.floor(w / S.pitch)), x0 = x + (w - ((n - 1) * S.pitch + S.w)) / 2;
  c.save();
  c.fillStyle = rgba('ink');
  c.fillRect(x, y, w, h);
  c.restore();
  knockout(c, (k) => {
    for (let i = 0; i < n; i++) { const hx = x0 + i * S.pitch; k.fillRect(hx, top, S.w, S.h); k.fillRect(hx, bottom, S.w, S.h); }
    for (const f of frames) k.fillRect(f.x, f.y, f.w, f.h);
  });
}
