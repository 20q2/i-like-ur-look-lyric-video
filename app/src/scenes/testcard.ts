// Karaoke test card: checks data/lyrics.json + data/audio.json against the song, start to finish.
// Paper page. Centre: the current line in Bodoni, karaoke word by word (unsung = graphite, sung = ink,
// the word being sung underlined in lipstick as it progresses); low-confidence words (conf < 0.5)
// carry a dotted underline. Previous and next lines small above/below. Top: section, time, bar.beat,
// tempo; four beat cells (downbeat cell wider) and a lipstick kick dot. Bottom: the section strip
// with downbeat ticks and a playhead.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { Lyrics, type Line } from '../engine/lyrics';
import { LIN, rgba } from '../engine/palette';

const M = 96; // page margin (logical px)

export default class TestCard extends Scene {
  layer = new Layer2D();

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, lyrics, audio, comp } = this.ctx;
    const c = this.layer.ctx;
    const t = f.t;
    this.layer.clear();
    c.textBaseline = 'alphabetic';

    // header
    const beatInBar = Math.min(3, Math.floor(f.barPhase * 4));
    c.fillStyle = rgba('ink');
    c.font = font(F.mono(600), 22);
    c.textAlign = 'left';
    c.fillText((audio.section(t)?.name ?? '-').toUpperCase(), M, M);
    c.textAlign = 'right';
    c.fillText(`${t.toFixed(2)} s    bar ${Math.floor(f.bar) + 1}.${beatInBar + 1}    ${audio.bpm.toFixed(2)} bpm`, W - M, M);

    // beat cells + kick dot
    const y0 = M + 28;
    let x = M;
    for (let i = 0; i < 4; i++) {
      const w = i === 0 ? 88 : 56;
      c.strokeStyle = rgba('ink');
      c.lineWidth = 2;
      if (i === beatInBar) {
        c.fillStyle = rgba('ink', 1 - 0.7 * (f.barPhase * 4 - beatInBar));
        c.fillRect(x, y0, w, 20);
      }
      c.strokeRect(x, y0, w, 20);
      x += w + 12;
    }
    c.fillStyle = rgba('lipstick', f.a.kick);
    c.beginPath();
    c.arc(x + 16, y0 + 10, 9, 0, Math.PI * 2);
    c.fill();

    // lyrics
    const cur = lyrics.lineAt(t) ?? lyrics.lastLine(t);
    const prev = cur ? lyrics.lines[cur.i - 1] : undefined;
    const next = cur ? lyrics.lines[cur.i + 1] : lyrics.nextLine(t);
    if (prev) this.small(c, prev, H * 0.37);
    if (cur) this.karaoke(c, cur, t, H * 0.56);
    if (next) this.small(c, next, H * 0.7);

    // section strip
    const sy = H - M, sw = W - 2 * M;
    const X = (s: number) => M + (s / audio.duration) * sw;
    c.font = font(F.mono(500), 13);
    c.textAlign = 'left';
    for (const s of audio.sections) {
      const on = t >= s.start && t < s.end;
      c.fillStyle = on ? rgba('ink') : rgba('paper2');
      c.fillRect(X(s.start), sy - 28, X(s.end) - X(s.start) - 2, 28);
      c.fillStyle = on ? rgba('paper') : rgba('ink', 0.7);
      c.fillText(s.name, X(s.start) + 6, sy - 9);
    }
    c.fillStyle = rgba('graphite');
    for (const d of audio.downbeats) c.fillRect(X(d), sy - 36, 1, 5);
    c.fillStyle = rgba('lipstick');
    c.fillRect(X(t) - 1.5, sy - 44, 3, 56);

    clearRT(renderer, out, LIN.paper);
    comp.draw(renderer, this.layer.upload(), out, { mode: 'normal' });
  }

  private karaoke(c: CanvasRenderingContext2D, l: Line, t: number, y: number) {
    const fam = F.bodoni(500);
    let size = 104;
    c.font = font(fam, size);
    let w = c.measureText(l.text).width;
    if (w > W - 2 * M) {
      size *= (W - 2 * M) / w;
      c.font = font(fam, size);
      w = c.measureText(l.text).width;
    }
    const space = c.measureText(' ').width;
    let x = (W - w) / 2;
    c.textAlign = 'left';
    for (const wd of l.words) {
      const ww = c.measureText(wd.w).width;
      const p = Lyrics.wordProgress(wd, t);
      c.fillStyle = p > 0 ? rgba('ink') : rgba('graphite', 0.45);
      c.fillText(wd.w, x, y);
      if (p > 0 && p < 1) {
        c.fillStyle = rgba('lipstick');
        c.fillRect(x, y + size * 0.14, ww * p, Math.max(3, size * 0.05));
      }
      if (wd.conf < 0.5) {
        c.fillStyle = rgba('graphite');
        for (let dx = 0; dx < ww; dx += 10) c.fillRect(x + dx, y + size * 0.28, 4, 3);
      }
      x += ww + space;
    }
  }

  private small(c: CanvasRenderingContext2D, l: Line, y: number) {
    c.font = font(F.bodoni(400, { italic: true }), 40);
    c.textAlign = 'center';
    c.fillStyle = rgba('graphite', 0.8);
    c.fillText(l.text, W / 2, y, W - 2 * M);
  }
}
