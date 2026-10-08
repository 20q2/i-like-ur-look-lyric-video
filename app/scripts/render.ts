#!/usr/bin/env bun
// Offline renderer. Drives the app in headless Edge (or Chrome) (?export=1) and either
//   stills:  bun scripts/render.ts stills --t 1.5,23,40.2 [--only id1,id2] [--out dir]
//   sheet:   bun scripts/render.ts sheet --from 20 --to 35 [--n 12] [--cols 4] [--only ids] [--out file.png]   (or --times a,b,c | --cuts [--offsets a,b,c])
//   perf:    bun scripts/render.ts perf --from 20 --to 25 [--only ids] [--samples 1] [--shutter 0.5]   (avg ms per frame incl. GPU sync and the export's pixel readback)
//   video:   bun scripts/render.ts video [--from 0] [--to <duration>] [--fps 60] [--crf 16] [--x264 aq-mode=3] [--samples 1] [--shutter 0.5] [--out ../out/lyricvideo.mp4] [--noaudio]
//            --samples N averages N sub-frames per frame over shutter×(1/fps): motion blur + temporal AA;
//            --samples auto picks the count per frame (4, 12, 36, 108 or 324, see Engine.render)
//   keys:    bun scripts/render.ts keys [--spreads 0,1,2,3] [--step 0.0667]   (the keys check, main.ts __lv.keycheck: every
//            spread's keys change exactly when its faces do; all spreads by default; exits 1 on a failure)
//   --scale N (all modes): render at N× the 1920x1080 layout (--scale 2 = true 3840x2160); stills are then saved
//            full-res from the pixel buffer, videos are encoded at the physical size.
//   --card NAME (all modes): render a diagnostic scene (testcard, lipsticktest) instead of the video
// Starts a private Vite dev server (no live reload) unless --url names one, which must serve this app.
import { chromium, type Browser, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'stills';
const MODES = ['stills', 'sheet', 'perf', 'video', 'keys', 'gpu'];
if (!MODES.includes(mode)) {
  console.error(`unknown mode: ${mode}

usage: bun scripts/render.ts <mode> [options]   (options: see the comment at the top of scripts/render.ts)
  stills --t 1.5,23,40.2 [--only ids] [--out dir]
  sheet  --from 20 --to 35 [--n 12] [--cols 4] [--only ids] [--out file.png]   (or --times a,b,c | --cuts [--offsets a,b,c])
  perf   --from 20 --to 25 [--only ids] [--samples 1] [--shutter 0.5]
  video  [--from 0] [--to <duration>] [--fps 60] [--samples N|auto] [--shutter 0.5] [--preset slow] [--out ../out/lyricvideo.mp4] [--noaudio]
  keys   [--spreads 0,1,2,3] [--step 0.0667]   (the keys check: keys change exactly when faces do)
  gpu    (print the WebGL renderer string)
  all modes: [--scale N] [--url URL]`);
  process.exit(1);
}
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const SCALE = Math.max(1, Math.round(+opt('scale', '1')!));
const OW = 1920 * SCALE, OH = 1080 * SCALE; // output size
// --samples N (fixed) or --samples auto [--min-samples 4] [--max-samples 324] [--tol 3] (adaptive, see Engine.render)
const SAMPLES = opt('samples', '1') === 'auto'
  ? { min: +opt('min-samples', '4')!, max: +opt('max-samples', '324')!, tol: +opt('tol', '3')! }
  : +opt('samples', '1')!;
const CARD = opt('card');
// keys: --spreads, each item a spread index (Number('') is 0, so a stray comma would quietly add the cover), and --step,
// read before anything starts so a bad one fails at once
const KEYS = mode !== 'keys' ? null : (() => {
  const list = opt('spreads'), step = +opt('step', String(1 / 15))!;
  const spreads = list === undefined ? undefined : list.split(',').map((x) => {
    if (!/^\d+$/.test(x.trim())) throw new Error(`--spreads ${list}: "${x}" isn't a spread index (0 is the cover)`);
    return +x;
  });
  if (!(step > 0)) throw new Error(`--step ${opt('step')}: a step in song seconds`);
  return { spreads, step };
})();
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
const ROOT = path.resolve(APP, '..');
// (absolute: Bun on Windows throws EEXIST from mkdirSync(recursive) on an existing dir given as '../x')
const mkdirp = (dir: string) => mkdirSync(path.resolve(dir), { recursive: true });

// Another project's dev server may hold a port (5173/5174 are taken on this machine): a server named with --url must
// be serving this app.
async function isOurApp(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok && (await r.text()).includes('<title>I Like Ur Look</title>'); } catch { return false; }
}

async function ensureServer(): Promise<{ url: string; stop: () => void }> {
  // a server named with --url is used as it is (it must serve this app); otherwise always a private one: a dev server
  // already running may be another worktree's (same app, different code) or live-reloading (a file saved mid-render
  // would reload the page)
  const given = opt('url');
  if (given) {
    if (!(await isOurApp(given))) throw new Error(`--url ${given} is not serving this app`);
    return { url: given, stop: () => {} };
  }
  const failures: string[] = [];
  // --strictPort makes vite exit at once if the random port is taken: try a few
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 5300 + Math.floor(Math.random() * 500);
    // no live reload: a file saved mid-render must not reload the page
    const proc = Bun.spawn([process.execPath, 'x', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'pipe', env: { ...process.env, LV_NO_HMR: '1' } });
    const stop = stopOnSignal(() => killTree(proc));
    // drain stderr in the background (an unread pipe can fill and stall vite), keeping the tail for the error message
    let errTail = '';
    const drained = (async () => {
      const dec = new TextDecoder();
      for await (const chunk of proc.stderr) errTail = (errTail + dec.decode(chunk, { stream: true })).slice(-4000);
    })().catch(() => {});
    let exited = false;
    proc.exited.then(() => { exited = true; });
    const u = `http://localhost:${port}`;
    for (let i = 0; i < 100 && !exited && !(await isOurApp(u)); i++) await Bun.sleep(100);
    if (!exited && (await isOurApp(u))) return { url: u, stop };
    stop();
    await Promise.race([drained, Bun.sleep(1000)]);
    failures.push(`port ${port}: ${exited ? `vite exited with code ${proc.exitCode}` : 'not serving this app within 10 s'}\n${errTail.replace(/\x1b\[[0-9;]*m/g, '').trim()}`);
  }
  throw new Error(`vite did not start (3 attempts):\n${failures.join('\n')}`);
}

// Ctrl-C skips the finally blocks, and on Windows vite would keep serving: stop it from the signal too.
// Returns an idempotent stop (the finally path and the signal path must not both kill).
let stopCurrent = () => {};
let signalsHooked = false;
function stopOnSignal(kill: () => void) {
  let done = false;
  const stop = () => { if (!done) { done = true; kill(); } };
  stopCurrent = stop;
  if (!signalsHooked) {
    signalsHooked = true;
    // the browser is left to playwright's own signal handling / the closed pipe (best effort, not awaited)
    const onSignal = () => { stopCurrent(); process.exit(130); };
    for (const sig of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) {
      try { process.on(sig as NodeJS.Signals, onSignal); } catch { /* signal not supported by this runtime */ }
    }
  }
  return stop;
}

// `bun x vite` runs vite in a child process, and on Windows killing the parent leaves that child serving: kill the tree
function killTree(proc: { pid: number; kill: () => void }) {
  if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
  else proc.kill();
}

async function openPage(url: string) {
  const browser = await chromium.launch({
    channel: process.env.LV_BROWSER ?? 'msedge', // Chromium-based; Edge ships with Windows (LV_BROWSER=chrome to override)
    headless: !flag('headed'),
    args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  // if booting fails the caller never gets the browser to close
  try { return { browser, ...(await bootApp(browser, url)) }; } catch (e) { await browser.close(); throw e; }
}

async function bootApp(browser: Browser, url: string) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const only = opt('only');
  await page.goto(`${url}/?export=1${only ? `&only=${only}` : ''}${SCALE !== 1 ? `&scale=${SCALE}` : ''}${CARD ? `&card=${encodeURIComponent(CARD)}` : ''}`);
  // (a module that throws while it loads leaves no __lv at all: say what the page said, not just that it timed out)
  try { await page.waitForFunction(() => (window as any).__lv?.ready || (window as any).__lv?.error, null, { timeout: 120000 }); }
  catch (e) { throw new Error(`the app didn't boot within 120 s; ${logs.length ? `the page logged:\n${logs.join('\n')}` : 'the page logged no errors'}`, { cause: e }); }
  const err = await page.evaluate(() => (window as any).__lv.error);
  if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
  const size: [number, number] = await page.evaluate(() => [(window as any).__lv.width ?? 1920, (window as any).__lv.height ?? 1080]);
  if (size[0] !== OW || size[1] !== OH) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${OW}x${OH} (--scale ${SCALE})`);
  const sceneErrors: string[] = await page.evaluate(() => (window as any).__lv.errors);
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
  return { page, logs };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirp(outDir);
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__lv.still(t, s, sh), [t, SAMPLES, +opt('shutter', '0.5')!] as const);
    const f = path.join(outDir, `f_${t.toFixed(2).padStart(7, '0')}.png`);
    if (typeof SAMPLES !== 'number') console.log(`t=${t}: ${k} sub-frames`);
    // at scale > 1 the canvas is shown downscaled on the page: save the full-res pixel buffer instead
    if (SCALE !== 1) await Bun.write(f, Buffer.from(await page.evaluate(() => (window as any).__lv.png()), 'base64'));
    else await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(async ({ times, cols }) => {
    const P = (window as any).__lv;
    const cw = 480, ch = 270, pad = 4, lab = 18;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    times.forEach((t: number, i: number) => {
      P.still(t);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
    });
    return cv.toDataURL('image/png');
  }, { times, cols });
  mkdirp(path.dirname(out));
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

async function video(page: Page, from: number, to: number, fps: number, out: string) {
  mkdirp(path.dirname(out));
  const crf = opt('crf', '16')!;
  const audio = path.join(ROOT, 'audio/song.wav');
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (!flag('noaudio')) args.push('-ss', String(from), '-t', String(to - from), '-i', audio);
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream,
  // otherwise ffmpeg converts with BT.601 while players and YouTube decode untagged HD as BT.709.
  // scale tags the matrix and range; primaries and transfer need setparams (the -color_* output flags don't reach the stream).
  args.push('-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', '-c:v', 'libx264', '-preset', opt('preset', 'slow')!, '-crf', crf, '-pix_fmt', 'yuv420p', '-tune', 'grain', '-x264-params', opt('x264', 'aq-mode=3')!);
  if (!flag('noaudio')) args.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
  args.push('-movflags', '+faststart', out);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
  let frames = 0;
  const total = Math.round(to * fps) - Math.round(from * fps);
  const t0 = performance.now();
  // ffmpeg exiting before we close its input means the video is broken: fail, rather than wait for acks forever
  let closing = false, exited = false;
  const died = ff.exited.then((code): Promise<never> => {
    exited = true;
    if (!closing) throw new Error(`ffmpeg exited (code ${code}) after ${frames} of ${total} frames${code === 0 ? ' (with audio, -shortest ends the video with song.wav: is --to past the end of the song?)' : ''}`);
    return new Promise<never>(() => {}); // the normal end, once its input is closed: never settles a race below
  });
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 4 + 1024),
      async message(ws, msg) {
        if (exited) return;
        // a failed write: ffmpeg is gone or broken — make sure it is gone, and `died` reports it (not once its input is closed:
        // then it is finalising the file)
        try { ff.stdin.write(msg as Uint8Array); await ff.stdin.flush(); } catch { if (!closing) ff.kill(); return; }
        frames++;
        ws.send(String(frames)); // ack: the page keeps at most a few frames ahead of ffmpeg (bounded memory at 4K)
        if (frames % 60 === 0 || frames === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${frames}/${total} frames  ${(frames / el).toFixed(1)} fps  eta ${((total - frames) / (frames / el)).toFixed(0)}s   `);
        }
      },
    },
  });
  try {
    const used: Record<string, number> = await Promise.race([
      page.evaluate((o) => (window as any).__lv.stream(o), { from, to, fps, ws: `ws://localhost:${server.port}`, samples: SAMPLES, shutter: +opt('shutter', '0.5')!, inflight: 4 }),
      died,
    ]);
    // wait for all frames to arrive
    while (frames < total) await Promise.race([Bun.sleep(20), died]);
    closing = true;
    ff.stdin.end();
    const code = await ff.exited;
    if (code !== 0) throw new Error(`ffmpeg failed (exit code ${code}): ${out} is not a finished video`);
    console.log(`\nwrote ${out} (${frames} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
  } finally {
    if (!closing) ff.kill(); // the render failed: don't let ffmpeg finalise a partial file
    server.stop();
  }
}

const { url, stop } = await ensureServer();
try {
  const { browser, page, logs } = await openPage(url);
  try {
    if (mode === 'gpu') {
      console.log(await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2')!;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      }));
    } else if (mode === 'stills') {
      const times = (opt('t') ?? '0').split(',').map(Number);
      const files = await stills(page, times, opt('out', path.join(ROOT, 'out/stills'))!);
      console.log(files.join('\n'));
    } else if (mode === 'sheet') {
      const from = +opt('from', '0')!, to = +opt('to', '10')!, n = +opt('n', '12')!;
      let times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
      if (opt('times')) times = opt('times')!.split(',').map(Number);
      if (flag('cuts')) {
        // frames around every cut: each boundary between timeline entries and each page turn of the magazine (the
        // flatplan's: __lv.turns), by default just before, then 1/60, 0.1 and 0.3 s after (a turn lands in TURN_S on a
        // strong ease-out, so most of it happens early); --offsets for others (s from each cut)
        const tl: { id: string; start: number }[] = await page.evaluate(() => (window as any).__lv.timeline);
        const turns: number[] = await page.evaluate(() => (window as any).__lv.turns());
        const cuts = [...new Set([...tl.slice(1).map((e) => e.start), ...turns])].sort((a, b) => a - b);
        if (!cuts.length) throw new Error('--cuts: no timeline boundaries or page turns');
        const offsets = opt('offsets')?.split(',').map(Number) ?? [-1 / 60, 1 / 60, 0.1, 0.3];
        if (!offsets.length || offsets.some((x) => !Number.isFinite(x))) throw new Error(`--offsets ${opt('offsets')}: seconds from each cut, a,b,c`);
        times = cuts.flatMap((c) => offsets.map((d) => c + d));
      }
      const out = opt('out', path.join(ROOT, `out/sheets/sheet_${from}-${to}.png`))!;
      await sheet(page, times, +opt('cols', '4')!, out);
      console.log(out);
    } else if (mode === 'perf') {
      const from = +opt('from', '0')!, to = +opt('to', '5')!;
      const r = await page.evaluate(async ({ from, to, samples, shutter }) => {
        const P = (window as any).__lv;
        const ms: number[] = [];
        const buf = new Uint8Array(P.width * P.height * 4);
        P.still(from);
        const used: Record<number, number> = {};
        for (let t = from; t < to; t += 1 / 60) {
          const a = performance.now();
          const k = P.engine.render(t, 1 / 60, false, samples, shutter);
          used[k] = (used[k] ?? 0) + 1;
          await P.engine.readPixelsAsync(buf);
          ms.push(performance.now() - a);
        }
        ms.sort((a, b) => a - b);
        return { n: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1], used };
      }, { from, to, samples: SAMPLES, shutter: +opt('shutter', '0.5')! });
      console.log(`frames ${r.n}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.used)}`);
    } else if (mode === 'video') {
      const dur: number = await page.evaluate(() => (window as any).__lv.duration);
      await video(page, +opt('from', '0')!, +opt('to', String(dur))!, +opt('fps', '60')!, path.resolve(opt('out', path.join(ROOT, 'out/lyricvideo.mp4'))!));
    } else if (mode === 'keys') {
      page.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('keycheck: ')) console.log(m.text().slice(10)); });
      const t0 = performance.now();
      // (a spread that throws while it loads fails the check's own import of the spreads: say so, not Playwright's stack)
      const r: { fails: string[]; warns: string[] } = await page.evaluate((o) => (window as any).__lv.keycheck(o), KEYS!)
        .catch((e: Error) => ({ fails: [`the check didn't run: ${e.message.replace(/^page\.evaluate: |^evaluate: /, '')}`], warns: [] }));
      for (const w of r.warns.slice(0, 20)) console.log(`warn: ${w}`);
      if (r.warns.length > 20) console.log(`warn: … ${r.warns.length - 20} more`);
      for (const f of r.fails) console.error(`FAIL: ${f}`);
      console.log(`keys: ${r.fails.length} failures, ${r.warns.length} warnings (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
      if (r.fails.length) process.exitCode = 1;
    }
    if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
