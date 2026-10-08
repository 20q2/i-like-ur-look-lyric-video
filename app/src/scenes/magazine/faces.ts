// Page-face canvases and textures. A face is one side of one spread, with a print layer and a marks
// (lipstick) layer, each redrawn only when the spread's key for it changes — static pages cost nothing per
// frame. At most MAX_BOUND are visible at once (a gatefold's six and a loose cut-out: schedule.ts), so that many slots
// are recycled.
import * as THREE from 'three';
import { SCALE } from '../../engine/gl';
import { PAGE } from '../../engine/layout';
import type { FaceTex } from '../../engine/page';
import { prewarm } from '../../engine/lipstick';
import { type FaceSide, type Layer, type Spread, drawLayer } from '../../spreads/spread';
import { type Face, MAX_BOUND } from './schedule';

/** Texture px per page unit: 2.2x a full-spread framing at the output scale, capped at 4096 px tall. */
export const PX_PER_PU = Math.min(2.2 * SCALE, 4096 / PAGE.h);
/** A face canvas's size in px: the scene's, and the keys check's. */
export const FACE_PX = Object.freeze({ w: Math.round(PAGE.w * PX_PER_PU), h: Math.round(PAGE.h * PX_PER_PU) });
export const faceId = (f: Face) => `${f.spread}${f.side}`;

/** Paint a face layer on `c`: clear it, set the page-unit transform (PX_PER_PU), and run `draw` with the context's
 *  default state, which it hands back, restored even when `draw` throws (a broken spread would otherwise leak a save
 *  level, and its font and styles, into every later draw on this canvas): its own save()s must balance. The keys check
 *  (main.ts __lv.keycheck) paints through it too, the same drawing, but on CPU-backed canvases (willReadFrequently,
 *  read back every sample), where the scene's are GPU-rasterised. */
export function paintFace(c: CanvasRenderingContext2D, draw: (c: CanvasRenderingContext2D) => void) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(PX_PER_PU, 0, 0, PX_PER_PU, 0, 0);
  c.save();
  try { draw(c); } finally { c.restore(); }
}

class LayerCanvas {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string | null = null;
  constructor() {
    this.canvas.width = FACE_PX.w;
    this.canvas.height = FACE_PX.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    // Plain RGBA8 holding the canvas's sRGB values, decoded by faceTex in the paper shader: with an sRGB texture
    // format the browser copies every upload through the CPU (measured ~38 ms a layer at 1694 x 2200, ~1 ms so).
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.premultiplyAlpha = true; // the paper shader composites premultiplied: no dark fringes when minified
    // the mip chain is load-bearing, not just for minified pages: the paper shader reads a marks layer's coverage
    // at a fixed page-space footprint through it (textureLod) for the lipstick's wax relief, so it must be generated
    // and sampled trilinear
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.anisotropy = 8;
  }
  redraw(draw: (c: CanvasRenderingContext2D) => void, key: string) {
    paintFace(this.ctx, draw);
    this.tex.needsUpdate = true;
    this.key = key;
  }
  dispose() {
    this.tex.dispose();
    this.canvas.width = this.canvas.height = 0; // free the ~15 MB backing store now, not whenever it is collected
  }
}
class Slot { print = new LayerCanvas(); marks = new LayerCanvas(); face: string | null = null }

export class FaceCache {
  private slots = Array.from({ length: MAX_BOUND }, () => new Slot());
  private bound = new Map<string, Slot>();
  /** Layer redraws since construction (for perf checks). */
  redraws = 0;
  constructor(private spreads: readonly Spread<FaceSide>[]) {
    // lipstick on the marks layers inks through scratch canvases of the face's size: have them ready before the first
    // mark (the slot's canvas is left clear, and its null key has it redrawn before its texture is first used)
    prewarm(this.slots[0]!.marks.ctx);
  }
  /** Textures for these faces at time t, redrawing only layers whose key changed. */
  update(faces: Face[], t: number): Map<string, FaceTex> {
    const want = new Set(faces.map(faceId));
    for (const [id, s] of this.bound) if (!want.has(id)) { this.bound.delete(id); s.face = null; }
    const out = new Map<string, FaceTex>();
    for (const f of faces) {
      const id = faceId(f);
      let s = this.bound.get(id);
      if (!s) {
        s = this.slots.find((x) => x.face === null);
        if (!s) throw new Error(`more than ${MAX_BOUND} visible faces`);
        s.face = id; s.print.key = null; s.marks.key = null;
        this.bound.set(id, s);
      }
      const sp = this.spreads[f.spread]!;
      for (const layer of ['print', 'marks'] as Layer[]) {
        const k = sp.key(f.side, layer, t);
        const lc = s[layer];
        if (k !== lc.key) {
          lc.redraw((c) => drawLayer(sp, f.side, layer, c, t), k);
          this.redraws++;
        }
      }
      out.set(id, { print: s.print.tex, marks: s.marks.tex });
    }
    return out;
  }
  dispose() {
    for (const s of this.slots) { s.print.dispose(); s.marks.dispose(); }
    this.bound.clear();
  }
}
