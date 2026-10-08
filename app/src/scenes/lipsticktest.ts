// Lipstick test page (?card=lipsticktest): brush strokes, handwriting and kiss prints on flat paper, to judge
// the lipstick before it goes onto the magazine. As on a magazine page, the lipstick is its own transparent layer
// composited over the print. Right of the kisses, a kiss pressed over a stroke: the stroke must show through the
// kiss's creases and flecks, not paper. Loops every 4 s so the writing animates.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { strokeText } from '../engine/stroke';
import { circle } from '../engine/drawing';
import { kiss, lipstickStroke, lipstickWrite } from '../engine/lipstick';
import { clamp, fract } from '../engine/util';

export default class LipstickTest extends Scene {
  print = new Layer2D();
  marks = new Layer2D();
  words = strokeText('better on me', 'script', 150);
  ring = circle(0, 0, 1, 64).map((p) => ({ x: 390 + p.x * 200, y: 182 + p.y * 72 }));

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    const u = fract(f.t / 4);
    const p = this.print.ctx;
    this.print.clear(rgba('paper'));
    p.fillStyle = rgba('ink');
    p.font = font(F.bodoni(700), 64);
    p.textAlign = 'left';
    p.textBaseline = 'alphabetic';
    p.fillText('The Look of the Season', 120, 205);
    p.fillText('her', 1500, 520);
    const c = this.marks.ctx;
    this.marks.clear();
    lipstickStroke(c, this.ring, u * 1400, { width: 14, seed: 1 });                          // circling a word
    lipstickStroke(c, [{ x: 120, y: 262 }, { x: 1000, y: 258 }], u * 1800, { width: 10, seed: 2 }); // underline
    c.save();
    c.translate(1080, 360);
    lipstickWrite(c, this.words, u * this.words.total * 1.3, { width: 5, seed: 7 });           // handwriting
    c.restore();
    lipstickStroke(c, [{ x: 1480, y: 500 }, { x: 1650, y: 468 }], Infinity, { width: 18, seed: 9 }); // crossing out
    kiss(c, 300, 760, 260, -0.12, 0.3, 0, 1);
    kiss(c, 800, 760, 260, 0.08, 1, 0, 2);
    kiss(c, 1300, 760, 260, -0.05, clamp(u * 3), clamp(u * 3 - 1), 3);
    lipstickStroke(c, [{ x: 1545, y: 818 }, { x: 1845, y: 792 }], Infinity, { width: 34, seed: 11 }); // a stroke...
    kiss(c, 1695, 765, 230, 0.06, 1, 0, 4);                                                    // ...kissed over
    clearRT(renderer, out, LIN.paper);
    comp.draw(renderer, this.print.upload(), out, { mode: 'normal' });
    comp.draw(renderer, this.marks.upload(), out, { mode: 'normal' });
  }
}
