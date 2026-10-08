// Entry: preview player (default) or export mode (?export=1, driven by scripts/render.ts).
import { Engine, type AdaptiveSampling } from './engine/engine';
import { PW, PH, SCALE } from './engine/gl';
import type { FaceSide, Spread } from './spreads/spread';
import { spreadJump, spreadJumpTargets, spreadLoop } from './review';
import { spreadAt } from './scenes/magazine/schedule';
import type { Timed } from './spreads/flatplan';
import { makeTimeline } from './timeline';

const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const ONLY = params.get('only'); // comma-separated scene ids to load (faster stills)
const FROM = params.get('t') ? parseFloat(params.get('t')!) : null;

const canvas = document.getElementById('c') as HTMLCanvasElement;
// physical size: 1920x1080 times ?scale= (the page CSS keeps showing it at 1920x1080)
canvas.width = PW;
canvas.height = PH;

const engine = new Engine(canvas, makeTimeline);

declare global {
  interface Window { __lv: any }
}

let TIMELINE: typeof engine.timeline = [];

async function boot() {
  const onlySet = ONLY ? new Set(ONLY.split(',')) : null;
  await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
  TIMELINE = engine.timeline;
  // an id matching no entry would load nothing and render every frame as an unloaded scene
  const unknown = onlySet ? [...onlySet].filter((id) => !TIMELINE.some((e) => e.id === id)) : [];
  if (unknown.length) throw new Error(`?only=${ONLY}: no timeline entry ${unknown.join(', ')} (the timeline has ${TIMELINE.map((e) => e.id).join(', ')})`);
  if (EXPORT) setupExport();
  else setupPlayer();
}

// ------------------------------------------------------------------ export API
function setupExport() {
  document.body.classList.add('export');
  window.__lv = {
    engine,
    duration: engine.duration,
    errors: engine.errors,
    /** Output size in px (1920x1080 times scale); stream() sends frames of width*height*4 bytes. */
    scale: SCALE,
    width: PW,
    height: PH,
    timeline: TIMELINE.map(({ id, start, end }) => ({ id, start, end })),
    /** Render a single frame at t (seeks as needed). */
    still(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5) { return engine.render(t, 1 / 60, true, samples, shutter); },
    /** The last rendered frame as a full-resolution (PW x PH) PNG, base64 (for stills at scale > 1). */
    async png() {
      const px = await engine.readPixelsAsync(), row = PW * 4;
      const img = new ImageData(PW, PH);
      for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * row, (PH - y) * row), y * row); // bottom-up -> top-down
      const oc = new OffscreenCanvas(PW, PH);
      oc.getContext('2d')!.putImageData(img, 0, 0);
      const b = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    },
    /**
     * Render [from, to) at fps and stream raw RGBA frames (bottom-up) over a WebSocket.
     * Returns when all frames were sent, with a histogram of sub-frames per frame. With `inflight`, the
     * receiver acknowledges each frame it has handed on (a text message with its running count) and at
     * most `inflight` frames are unacknowledged:
     * backpressure from the encoder, so a slow encode (4K) cannot pile frames up in the receiver's memory.
     */
    async stream(opts: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number }) {
      const ws = new WebSocket(opts.ws);
      ws.binaryType = 'arraybuffer';
      let acked = 0;
      ws.onmessage = (e) => { if (typeof e.data === 'string') acked = Math.max(acked, +e.data || 0); };
      await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); });
      const dt = 1 / opts.fps;
      const n0 = Math.round(opts.from * opts.fps), n1 = Math.round(opts.to * opts.fps);
      const buf = new Uint8Array(PW * PH * 4);
      // warm-up: render one frame before the range so the first frame is sequential for stateful scenes
      const S = opts.samples ?? 1, SH = opts.shutter ?? 0.5;
      // (adaptive sampling only runs stateless scenes: one sample is enough for the warm-up)
      if (n0 > 0) engine.render((n0 - 1) * dt, dt, false, typeof S === 'number' ? S : 1, SH);
      const used: Record<number, number> = {}; // sub-frames per frame -> frames
      for (let n = n0; n < n1; n++) {
        const k = engine.render(n * dt, dt, false, S, SH);
        used[k] = (used[k] ?? 0) + 1;
        await engine.readPixelsAsync(buf);
        if (opts.inflight) while (n - n0 - acked >= opts.inflight) await new Promise((r) => setTimeout(r, 2));
        while (ws.bufferedAmount > 64 * 1024 * 1024) await new Promise((r) => setTimeout(r, 2));
        ws.send(buf);
        if (n % 30 === 0) await new Promise((r) => setTimeout(r, 0)); // let the socket flush
      }
      while (ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 5));
      ws.close();
      return used;
    },
    /** The magazine's page turns (song s): when each spread after the cover comes up, as the flatplan times them
     *  (spreads/flatplan.ts timeFlatplan; render.ts sheet --cuts frames them). */
    async turns(): Promise<number[]> {
      const { timeFlatplan } = await import('./spreads/flatplan'); // (loaded apart, as keycheck's modules are)
      return timeFlatplan(engine.audio, engine.lyrics).slice(1).map((e) => e.start);
    },
    /**
     * The keys check (render.ts keys; keycheck.ts): for each spread, side and layer, every `step` s from a second before
     * the spread comes up until its turn out has landed, its key, and its face painted at that time as the scene paints
     * it (paintFace), judged by keycheck.ts's checkLayer. Logs a line per spread, side and layer as it goes (render.ts
     * shows them).
     */
    async keycheck(o: { spreads?: number[]; step?: number } = {}) {
      // imported here, not at the top: a spread that throws while it loads must stay a scene error (Engine.loadEntry),
      // not take the preview and the export page down with it
      const [{ makeSpreads }, { resolveFlatplan }, { landedAt }, { FACE_PX, PX_PER_PU, paintFace }, { drawLayer, PANEL_SIDES }, { checkLayer }] = await Promise.all([
        import('./spreads/registry'), import('./spreads/flatplan'), import('./scenes/magazine/schedule'), import('./scenes/magazine/faces'), import('./spreads/spread'), import('./keycheck'),
      ]);
      const plan = resolveFlatplan(engine.audio, engine.lyrics), book = makeSpreads(engine.audio, engine.lyrics, plan), step = o.step ?? 1 / 15;
      // read back on the CPU from the start (willReadFrequently): a canvas read back as often as this would be moved off
      // the GPU by Chrome part-way through, its raster changing under the check. Two fresh ones for each layer: canvases
      // that had painted the cover read spread 1's faces ~15% slower (measured, cause unknown)
      const faceCanvas = () => { const cv = document.createElement('canvas'); cv.width = FACE_PX.w; cv.height = FACE_PX.h; return cv.getContext('2d', { willReadFrequently: true })!; };
      const fails: string[] = [], warns: string[] = [];
      for (const k of o.spreads ?? book.map((_, i) => i)) {
        const sp: Spread<FaceSide> | undefined = book[k];
        if (!sp) { fails.push(`no spread ${k}: the book has ${book.length} (0-${book.length - 1})`); continue; }
        const e = plan[k]!, t0 = Math.max(0, e.start - 1), t1 = k + 1 < plan.length ? landedAt(plan[k + 1]!) : engine.duration;
        // the faces it has (the cover has no left page, the back cover no right one)
        // (and a gatefold's panels' sides, spread.ts PANEL_SIDES; and a cut-out's piece, spread.ts Cutout)
        for (const side of [...(e.left !== null ? ['L'] : []), ...(e.right !== null ? ['R'] : []), ...(sp.panels ? PANEL_SIDES : []), ...(sp.cutout ? ['C'] : [])] as FaceSide[]) {
          for (const layer of ['print', 'marks'] as const) {
            const name = `${sp.id} ${side} ${layer}`, began = performance.now(), on = { A: faceCanvas(), B: faceCanvas() };
            const r = checkLayer(name, {
              key: (t) => sp.key(side, layer, t),
              paint: (t, c) => { paintFace(on[c], (g) => drawLayer(sp, side, layer, g, t)); return on[c].getImageData(0, 0, FACE_PX.w, FACE_PX.h); },
              t0, t1, step, pxPerPu: PX_PER_PU,
            });
            fails.push(...r.fails); warns.push(...r.warns);
            console.log(`keycheck: ${name}: ${r.samples} samples (+${r.probes} probes) in ${((performance.now() - began) / 1000).toFixed(1)} s, ${r.fails.length} failures, ${r.warns.length} warnings`);
            await new Promise((res) => setTimeout(res, 0)); // (let the log out)
          }
        }
      }
      return { fails, warns };
    },
  };
  window.__lv.ready = true;
}

// ------------------------------------------------------------------ preview player
function setupPlayer() {
  const audio = new Audio('audio/song.wav');
  audio.preload = 'auto';
  const ui = document.getElementById('ui')!;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const info = document.getElementById('info')!;
  const marks = document.getElementById('marks')!;
  const errs = document.getElementById('errs')!;
  scrub.max = String(engine.duration);
  scrub.step = '0.001';
  // the volume, remembered in this browser (storage can be missing or blocked: then it starts at full each time); it
  // hands the keyboard back once set, so the arrows seek again rather than nudging it
  const volume = document.getElementById('volume') as HTMLInputElement;
  try { const v = parseFloat(localStorage.getItem('lv.volume') ?? ''); if (v >= 0 && v <= 1) volume.value = String(v); } catch { /* no storage */ }
  audio.volume = parseFloat(volume.value);
  volume.oninput = () => {
    audio.volume = parseFloat(volume.value);
    try { localStorage.setItem('lv.volume', volume.value); } catch { /* no storage */ }
  };
  volume.onchange = () => volume.blur();
  if (engine.errors.length) { errs.textContent = engine.errors.join('\n\n'); errs.style.display = 'block'; }

  for (const e of TIMELINE) {
    const m = document.createElement('div');
    m.className = 'mark';
    m.style.left = `${(e.start / engine.duration) * 100}%`;
    m.style.width = `${((e.end - e.start) / engine.duration) * 100}%`;
    m.title = `${e.id} ${e.start.toFixed(2)}–${e.end.toFixed(2)}`;
    m.textContent = e.id;
    m.onclick = () => seek(e.start);
    marks.appendChild(m);
  }

  let t = FROM ?? 0;
  let playing = false;
  let loop: [number, number] | null = null;
  let lastAudioT = 0, lastPerf = 0;
  const seek = (x: number) => { t = Math.max(0, Math.min(engine.duration - 0.001, x)); audio.currentTime = t; };
  seek(t);

  const toggle = () => { playing = !playing; if (playing) { audio.currentTime = t; audio.play(); } else audio.pause(); };
  canvas.onclick = toggle;
  scrub.oninput = () => seek(parseFloat(scrub.value));
  // the flatplan's spreads as timed, unchecked (review.ts), loaded apart: a module that throws as it loads stays the
  // magazine's scene error, and the preview runs on without its spread jumps
  let plan: Timed[] = [], starts: number[] = [], jumps: number[] = [];
  import('./spreads/flatplan').then(({ timeFlatplan }) => {
    plan = timeFlatplan(engine.audio, engine.lyrics);
    starts = plan.map((e) => e.start);
    jumps = spreadJumpTargets(plan);
  }).catch((e) => console.error('the preview has no spread jumps (PageDown, PageUp, l):', e));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === ' ') { ev.preventDefault(); toggle(); }
    // spread to spread (review.ts): the cover, then each spread just after its turn has landed
    if (ev.key === 'PageDown' || ev.key === 'PageUp') {
      ev.preventDefault();
      const to = spreadJump(jumps, t, ev.key === 'PageDown' ? 1 : -1);
      if (to !== undefined) seek(to);
    }
    if (ev.key === 'ArrowRight') seek(t + (ev.shiftKey ? 5 : 1));
    if (ev.key === 'ArrowLeft') seek(t - (ev.shiftKey ? 5 : 1));
    if (ev.key === '.') seek(t + 1 / 60);
    if (ev.key === ',') seek(t - 1 / 60);
    if (ev.key === 'l' && starts.length) loop = loop ? null : spreadLoop(starts, t, engine.duration); // the spread up, turn in to turn out (review.ts)
    if (ev.key === 'h') ui.classList.toggle('hidden');
  });

  let frames = 0, fpsT = performance.now(), fps = 0;
  const tick = () => {
    if (playing) {
      // smooth the coarse audio clock with performance.now()
      const now = performance.now();
      if (audio.currentTime !== lastAudioT) { lastAudioT = audio.currentTime; lastPerf = now; }
      t = lastAudioT + (audio.paused ? 0 : (now - lastPerf) / 1000);
      // (the last spread's loop runs to the song's end, which the wav reaches first: 171.316825 s, data/audio.json's
      // duration 171.317, and there the audio stops by itself; wrap then too, and play on)
      if (loop && (t >= loop[1] || audio.ended)) { seek(loop[0]); if (audio.paused) audio.play(); }
      if (audio.ended) playing = false;
    }
    engine.render(t, 1 / 60);
    scrub.value = String(t);
    frames++;
    const now = performance.now();
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const l = engine.lyrics.lineAt(t), up = plan.length ? ` ▸${plan[spreadAt(starts, t)]!.id}` : ''; // (the spread up: a section can have two)
    info.textContent = `${t.toFixed(2)}s  beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}  §${engine.audio.section(t)?.name ?? '—'}${up}  ${fps.toFixed(0)}fps   ${l ? '“' + l.text + '”' : ''}${loop ? '  LOOP' : ''}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;position:fixed;top:0;left:0">${String(e?.stack ?? e)}</pre>`);
  window.__lv = { error: String(e?.stack ?? e) };
});
