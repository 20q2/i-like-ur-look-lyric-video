// The guards: every box a spread says must read is in frame,
// and sharp enough (type for its size, a drawing to FADE), while it's sung — through the pose the magazine renders
// (view.ts: the spread's camera or a turn's blend, the groove, the hand) — and every turn starts with the right page in
// frame.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { AudioData } from '../src/engine/audio';
import { BOW } from '../src/engine/curl';
import { H, W } from '../src/engine/gl';
import { PAGE } from '../src/engine/layout';
import { Lyrics } from '../src/engine/lyrics';
import { leafZ } from '../src/engine/page';
import { FADE, SHARP, coc, focusDistance } from '../src/scenes/magazine/focus';
import { landsAt } from '../src/scenes/magazine/schedule';
import { bookView } from '../src/scenes/magazine/view';
import { type Resolved, resolveFlatplan } from '../src/spreads/flatplan';
import { makeSpreads } from '../src/spreads/registry';
import { ANGLES, FIT_MARGIN, TURN_DIST, fit, inFrame, turnReady } from '../src/spreads/shots';
import { type CameraPose, FRAME_SPREAD, type FocusBox, LENS, type Spread, pageToWorld, placeCamera } from '../src/spreads/spread';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json')), lyrics = new Lyrics(data('lyrics.json'));
/** The book as the magazine builds it: the flatplan (spread k comes up at plan[k].start, on its leaves) and its spreads. */
const plan = resolveFlatplan(audio, lyrics), spreads = makeSpreads(audio, lyrics, plan), starts = plan.map((e) => e.start);
const view = bookView(spreads, starts, audio, lyrics.lines);
/** Where spread k's pages lie, open: on its own piles (a rip leaves the book a leaf thinner). */
const pagesZ = (k: number, pl: readonly Resolved[] = plan) => leafZ(pl[k]!.n, pl[k]!.onLeft, false);
const cam = new THREE.PerspectiveCamera(LENS.fov, W / H, LENS.near, LENS.far);
/** How soft a box of type (one with a FocusBox.size) may be: 1.2% of the type's size on screen, or SHARP, whichever is
 *  larger: a 0.9 px blur on a 300 px headline is nothing; on 40 px of italic it would be. A box without a size is a
 *  drawing, and may be as soft as FADE, where the focus pass's blur only starts to show: a big drawing at the closest
 *  framings reaches 0.37–0.48 px on the groove's punch, which SHARP would fail. */
const FOCUS_TOL = 0.012;
/** A page lies from flat on its pile to the rest bow's height above it (curl.ts BOW, as tests/focus.test.ts raises it).
 *  (Not the settle: for 0.3 s after landing, a left page's free edge floats up to ~0.0045 higher, ~0.04 px of circle
 *  at the closest framing, curl.ts SETTLE.) */
const RAISES = [0, BOW.h] as const;
/** Samples per song second. */
const RATE = 30;
type View = (t: number) => CameraPose;
const name = (b: FocusBox) => `${b.side} [${b.box.join(', ')}]${b.size ? ` (${b.size} pu type)` : ''}`;
const posed = (p: CameraPose) => `pose dist ${p.dist.toFixed(2)} tilt ${p.tilt.toFixed(2)}`;

/** When spread k's boxes are checked, its pages lying open: from when its turn has landed (schedule.ts landsAt: until
 *  then its left page is the back of the leaf in the air, and that leaf sweeps over its right page; the cover is up from
 *  the start) until its own turn starts and its right page lifts. The camera may still be blending in from the last
 *  spread's pose (CAM_BLEND_S): that's the rendered pose, so it's checked. */
const flatWindow = (k: number, pl: readonly Resolved[]): [number, number] => [k === 0 ? 0 : landsAt(pl[k]!), pl[k + 1]?.start ?? audio.duration];

/** A box's corners (in page terms: v runs down the page, so its top is v0) and its centre. */
function boxPoints(b: FocusBox) {
  const u0 = Math.min(b.box[0], b.box[2]), u1 = Math.max(b.box[0], b.box[2]), v0 = Math.min(b.box[1], b.box[3]), v1 = Math.max(b.box[1], b.box[3]);
  const at = (name: string, u: number, v: number) => ({ name, ...pageToWorld(b.side, u, v) });
  return { u: (u0 + u1) / 2, v: (v0 + v1) / 2, pts: [at('corner TL', u0, v0), at('corner TR', u1, v0), at('corner BL', u0, v1), at('corner BR', u1, v1), at('centre', (u0 + u1) / 2, (v0 + v1) / 2)] };
}

/** One sample a box fails at: its index, time and value (the reach, or the circle against its tolerance), where on the
 *  box, and the pose. */
interface Miss { i: number; t: number; value: number; tol: number; at: string; pose: CameraPose }
/** Failing samples as time spans: runs of consecutive samples. */
function spans(ms: readonly Miss[]) {
  const out: string[] = [];
  for (let j = 0; j < ms.length;) {
    let e = j;
    while (e + 1 < ms.length && ms[e + 1]!.i === ms[e]!.i + 1) e++;
    out.push(e === j ? ms[j]!.t.toFixed(2) : `${ms[j]!.t.toFixed(2)}–${ms[e]!.t.toFixed(2)}`);
    j = e + 1;
  }
  return `${out.join(', ')} s`;
}

/** The guard on one box over [from, to] (song s), RATE times a second, through the rendered pose `v(t)`, its page at
 *  `z(t)` above the bed and raised by each of `raises`: its corners in frame, FIT_MARGIN in from the edges (the margin
 *  a fitted box keeps: fit's), and its corners' and centre's circles of confusion (focus.ts, as tests/focus.test.ts
 *  measures them) within tolerance: for type, from its size on screen, the projected length of a vertical segment
 *  `size` pu tall at the box's centre, at the worse of the page's heights; for a drawing, FADE (FOCUS_TOL). One line per
 *  kind of failure, over all the times it fails, with its worst sample. */
function checkBox(v: View, b: FocusBox, z: (t: number) => number, from: number, to: number, raises: readonly number[] = RAISES): string[] {
  const { u, v: cv, pts } = boxPoints(b), seg = b.size ? [pageToWorld(b.side, u, cv - b.size / 2), pageToWorld(b.side, u, cv + b.size / 2)] : null;
  const P = new THREE.Vector3(), s = new THREE.Vector3(), out: Miss[] = [], soft: Miss[] = [];
  for (let i = 0, n = Math.ceil((to - from) * RATE - 1e-9); i <= n; i++) {
    const t = Math.min(to, from + i / RATE), p = v(t), focus = focusDistance(p), zt = z(t);
    placeCamera(cam, p);
    let reach = 0, reachAt = '', circle = 0, circleAt = '', sizePx = Infinity;
    for (const raise of raises) {
      const raised = raise > 0 ? ', page raised' : '';
      for (const q of pts) {
        P.set(q.x, q.y, zt + raise);
        s.copy(P).project(cam);
        // (|z| >= 1: behind the camera, or past its near or far plane)
        const r = Math.abs(s.z) >= 1 ? Infinity : Math.max(Math.abs(s.x), Math.abs(s.y));
        if (r > reach) {
          reach = r;
          const edge = r === Infinity ? 'behind the lens' : Math.abs(s.x) >= Math.abs(s.y) ? (s.x > 0 ? 'right edge' : 'left edge') : (s.y > 0 ? 'top edge' : 'bottom edge');
          reachAt = `${edge}, ${q.name}${raised}`;
        }
        const c = coc(-P.applyMatrix4(cam.matrixWorldInverse).z, focus);
        if (c > circle) { circle = c; circleAt = `${q.name}${raised}`; }
      }
      if (seg) {
        const a = new THREE.Vector3(seg[0]!.x, seg[0]!.y, zt + raise).project(cam), e = new THREE.Vector3(seg[1]!.x, seg[1]!.y, zt + raise).project(cam);
        sizePx = Math.min(sizePx, Math.hypot(((a.x - e.x) * W) / 2, ((a.y - e.y) * H) / 2)); // (NDC spans 2 for W or H px)
      }
    }
    const tol = seg ? Math.max(SHARP, FOCUS_TOL * sizePx) : FADE;
    if (reach > 1 - FIT_MARGIN) out.push({ i, t, value: reach, tol: 1 - FIT_MARGIN, at: reachAt, pose: p });
    else if (circle > tol) soft.push({ i, t, value: circle, tol, at: circleAt, pose: p });
  }
  const lines: string[] = [];
  if (out.length) {
    const w = out.reduce((a, m) => (m.value > a.value ? m : a));
    lines.push(`${name(b)}: out of frame ${spans(out)}, worst ${w.value === Infinity ? '' : `${w.value.toFixed(3)} of the half-frame (> ${(1 - FIT_MARGIN).toFixed(2)}) `}at ${w.t.toFixed(2)}, ${w.at}, ${posed(w.pose)}`);
  }
  if (soft.length) {
    const w = soft.reduce((a, m) => (m.value / m.tol > a.value / a.tol ? m : a));
    lines.push(`${name(b)}: circle ${w.value.toFixed(2)} px > ${w.tol.toFixed(2)} over ${spans(soft)}, worst at ${w.t.toFixed(2)}, ${w.at}, ${posed(w.pose)}`);
  }
  return lines;
}

/** Why a box of spread k is never checked: all its times fall outside the spread's flat window [w0, w1]. */
function neverChecked(b: FocusBox, k: number, pl: readonly Resolved[], w0: number, w1: number) {
  const s = (x: number) => x.toFixed(3), up = pl[k]!.start;
  if (b.from > b.to) return 'it ends before it starts';
  if (b.to < up) return `it ends before the spread comes up at ${s(up)} s (song seconds, not the spread's?)`;
  if (b.to < w0) return `it's all in the turn in, ${s(up)}–${s(w0)} s, before the pages are down`;
  return k + 1 < pl.length ? `it starts after the turn out at ${s(w1)} s` : `it starts after the song ends at ${s(w1)} s`;
}

/** The guard on the boxes of spread k of `book` (laid out by the flatplan `pl`), seen through `v`. A box is checked
 *  while it's sung and its spread lies open (flatWindow); one that never is fails, saying why: the guard would otherwise
 *  pass it unseen. */
function checkSpread(book: readonly Spread[], pl: readonly Resolved[], v: View, k: number): string[] {
  const sp = book[k]!, z = pagesZ(k, pl), [w0, w1] = flatWindow(k, pl), fails: string[] = [];
  for (const b of sp.focus ?? []) {
    // (a page it doesn't have: the cover has no left page, the back cover no right one)
    if ((b.side === 'L' ? pl[k]!.left : pl[k]!.right) === null) { fails.push(`${name(b)}: never seen: spread ${k} (${pl[k]!.id}) has no ${b.side === 'L' ? 'left' : 'right'} page`); continue; }
    const from = Math.max(b.from, w0), to = Math.min(b.to, w1);
    if (!(from <= to)) { fails.push(`${name(b)} ${b.from.toFixed(3)}–${b.to.toFixed(3)} s: never checked: ${neverChecked(b, k, pl, w0, w1)}`); continue; }
    const pz = b.side === 'L' ? z.left : z.right;
    fails.push(...checkBox(v, b, (t) => pz + (sp.lift?.(t) ?? 0), from, to)); // (lift: the cover's drop, Magazine.render)
  }
  return fails;
}

/** The guard on the turn out of spread k (k >= 1, not the last): just before it starts, the director's rule on the
 *  spread's own pose (the whole right page in frame, from at least TURN_DIST), and the rendered pose — moved by the
 *  beats before it and the hand — still showing all of the right page, the leaf that turns, as high as it lies.
 *  The groove's punch for the turn's downbeat comes after this instant (a hit's envelope starts at 0). In the turn's
 *  first 0.1 s it crops the right page's edge by up to ~12 px (2.15% of the half-frame) on 5 of batch 1's 10 turns at
 *  FRAME_SPREAD: accepted, as the approved bounce, and the turn reads fine. (The rip, Task B2, grabs the right page
 *  too: the same rule holds before it.) */
function checkTurn(book: readonly Spread[], pl: readonly Resolved[], v: View, k: number): string[] {
  const t = pl[k + 1]!.start - 1e-6, own = book[k]!.camera(t), seen = v(t), z = pagesZ(k, pl).right, fails: string[] = [];
  if (!turnReady(own)) fails.push(`t=${t.toFixed(3)}: the spread's pose isn't ready for the turn (the right page in frame, from >= ${TURN_DIST}): ${JSON.stringify(own)}`);
  for (const raise of RAISES) {
    if (!inFrame(seen, 'R', [0, 0, PAGE.w, PAGE.h], z + raise)) fails.push(`t=${t.toFixed(3)}: the rendered pose cuts the right page (raised ${raise}): ${JSON.stringify(seen)}`);
  }
  return fails;
}

// ---- the guards can fail: synthetic spreads, mostly held still (a constant view) so a case sits where it's put ----
const K = 2, [W0, W1] = flatWindow(K, plan), FROM = W0 + 2, TO = FROM + 1;
/** The book with spread k replaced by a synthetic one holding `camera`, declaring `focus`. */
const synth = (camera: CameraPose, focus?: FocusBox[], k = K, base: readonly Spread[] = spreads) => base.map((s, i): Spread => (i !== k ? s : {
  id: 'synthetic', section: s.section, pages: s.pages, drawPrint() {}, drawMarks() {}, key: () => '', camera: () => camera, focus,
}));
const still = (p: CameraPose): View => () => p;
const box = (side: FocusBox['side'], b: FocusBox['box'], size?: number): FocusBox => ({ from: FROM, to: TO, side, box: b, size });
const at = (side: FocusBox['side'], u: number, v: number, dist: number, tilt: number): CameraPose => ({ ...pageToWorld(side, u, v), dist, tilt, roll: 0 });
/** Spread K's boxes through a view: by default the one the magazine renders (groove and hand), else held still. */
const judge = (camera: CameraPose, b: FocusBox, v?: View) => { const book = synth(camera, [b]); return checkSpread(book, plan, v ?? bookView(book, starts, audio), K); };
const zK = pagesZ(K);

test('the guard, through the rendered view, passes a box that reads and fails one off the page: one line, its span', () => {
  expect(TO).toBeLessThan(W1);
  expect(judge(FRAME_SPREAD, box('R', [100, 200, 670, 800]))).toEqual([]);
  // a box at page x 2000 (a page is 770 wide)
  expect(judge(FRAME_SPREAD, box('R', [2000, 400, 2200, 600]))).toEqual([
    expect.stringMatching(new RegExp(`^R \\[2000, 400, 2200, 600\\]: out of frame ${FROM.toFixed(2)}–${TO.toFixed(2)} s, worst 2\\.\\d+ of the half-frame \\(> 0\\.97\\) at \\d+\\.\\d+, right edge, corner (TR|BR)`)),
  ]);
});
test('a box on screen but inside the 3% margin fails; one clear of it passes', () => {
  const p = at('R', 385, 500, 0.9, 0.12);
  const band = judge(p, box('R', [300, 262, 470, 600]), still(p)); // its top edge 0.974–0.993 of the half-frame up
  expect(band).toEqual([expect.stringMatching(/out of frame .* worst 0\.99\d of the half-frame \(> 0\.97\) at .*, top edge, corner T[LR], page raised/)]);
  expect(judge(p, box('R', [300, 280, 470, 600]), still(p))).toEqual([]);
});
test('a box behind the lens fails', () => {
  const p = at('R', 385, 0, 0.9, 1.2); // looking along the page from low over its foot: its bottom strip is behind the camera
  expect(judge(p, box('R', [300, 960, 470, 1000]), still(p))).toEqual([expect.stringMatching(/out of frame .* worst at \d+\.\d+, behind the lens, corner/)]);
});
// (the next two judge geometry, so their boxes are 10 pu captions: small type, whose tolerance is SHARP)
test('a box is judged at both the page\'s heights: the raise alone can fail it', () => {
  // below a tilted target on the right page: its near corners come closer than the focus as the bow raises them
  const p = at('R', 385, 400, 0.9, 0.3), b = box('R', [285, 400, 485, 520], 10);
  expect(checkBox(still(p), b, () => zK.right, FROM, TO, [0])).toEqual([]); // flat: circle 0.30 px
  expect(checkBox(still(p), b, () => zK.right, FROM, TO)).toEqual([expect.stringMatching(/circle 0\.4\d px > 0\.35 .*, page raised/)]); // raised: 0.41
});
test('each page is judged at its own height: a left-page box that passes at the right page\'s height fails at its own', () => {
  const p = at('L', 385, 600, 0.9, 0.3), b = box('L', [285, 500, 485, 600], 10);
  expect(judge(p, b, still(p))).toEqual([expect.stringMatching(/^L \[285, 500, 485, 600\] \(10 pu type\): circle 0\.39 px > 0\.35/)]); // z.left: 0.0032
  expect(checkBox(still(p), b, () => zK.right, FROM, TO)).toEqual([]); // z.right: 0.016, circle 0.29 px
});
test('a drawing (no size) may be as soft as FADE; type, 1.2% of its size on screen but never more than SHARP allows', () => {
  // the boots, the whole left-page drawing of spread 1, tilting further: at 0.4 a 0.63 px circle (over SHARP, under
  // FADE) reads, at 0.46 a 0.75 px one doesn't, nor at a ground view 2.67 px (which the box's height once let pass)
  const BOOTS = [330, 236, 750, 904] as const, boots = (tilt: number) => fit({ side: 'L', box: BOOTS }, tilt, 0, 0.5);
  for (const [tilt, fails] of [[0.4, []], [0.46, [/circle 0\.7\d px > 0\.70/]], [ANGLES.ground, [/circle 2\.\d+ px > 0\.70/]]] as const) {
    expect(judge(boots(tilt), box('L', BOOTS), still(boots(tilt)))).toEqual(fails.map((f) => expect.stringMatching(f)));
  }
  expect(judge(boots(0.4), box('L', BOOTS, 10), still(boots(0.4)))).toEqual([expect.stringMatching(/circle 0\.6\d px > 0\.35/)]); // (as small type)
  // SPLIT, 250 pu Archivo, its cap height ~180 pu, from a low tilt: 0.62 px at its far corners, well under 1.2% of its
  // 342 px on screen (4.1 px)
  const SPLIT = [40, 330, 730, 580] as const, low = fit({ side: 'R', box: SPLIT }, 0.5, 0, 0.3);
  expect(judge(low, box('R', SPLIT, 180), still(low))).toEqual([]);
  // a 30 pu caption from a wide framing is 26 px on screen, so its tolerance is SHARP: 0.41 px fails it, where the same
  // box as a drawing would pass
  const wide = at('R', 385, 600, 2, 0.35), CAPTION = [150, 300, 620, 340] as const;
  expect(judge(wide, box('R', CAPTION, 30), still(wide))).toEqual([expect.stringMatching(/^R \[150, 300, 620, 340\] \(30 pu type\): circle 0\.4\d px > 0\.35/)]);
  expect(judge(wide, box('R', CAPTION), still(wide))).toEqual([]);
});
test('a box that is never checked fails, saying why', () => {
  const never = (from: number, to: number) => judge(FRAME_SPREAD, { from, to, side: 'R', box: [100, 200, 670, 800] }, still(FRAME_SPREAD));
  expect(never(2, 3)).toEqual([expect.stringMatching(/never checked: it ends before the spread comes up at 22\.620 s \(song seconds, not the spread's\?\)/)]);
  expect(never(starts[K]!, starts[K]! + 0.3)).toEqual([expect.stringMatching(/never checked: it's all in the turn in, 22\.620–23\.170 s, before the pages are down/)]);
  expect(never(W1 + 0.5, W1 + 1)).toEqual([expect.stringMatching(/never checked: it starts after the turn out at 35\.158 s/)]);
  expect(never(TO, FROM)).toEqual([expect.stringMatching(/never checked: it ends before it starts/)]);
});
test('a box on a page the spread doesn\'t have fails: the back cover has no right page, the cover no left one', () => {
  const last = plan.length - 1, box = (side: FocusBox['side'], from: number): FocusBox => ({ from, to: from + 1, side, box: [100, 200, 670, 800] });
  const back = synth(FRAME_SPREAD, [box('R', 168), box('L', 168)], last);
  expect(checkSpread(back, plan, still(FRAME_SPREAD), last)).toEqual([expect.stringMatching(/^R \[100, 200, 670, 800\]: never seen: spread 13 \(backcover\) has no right page/)]);
  const front = synth(FRAME_SPREAD, [box('L', 4)], 0);
  expect(checkSpread(front, plan, still(FRAME_SPREAD), 0)).toEqual([expect.stringMatching(/never seen: spread 0 \(cover\) has no left page/)]);
});
test('a box sung past its spread\'s turn out is checked until the turn starts, not into the next spread\'s camera', () => {
  // spread K+1 looks far off the page: once the turn starts the view blends there, and the box would leave the frame
  const book = synth({ ...FRAME_SPREAD, x: 5 }, undefined, K + 1, synth(FRAME_SPREAD, [{ from: W1 - 0.5, to: W1 + 1, side: 'R', box: [100, 200, 670, 800] }]));
  const v = bookView(book, starts, audio);
  expect(checkSpread(book, plan, v, K)).toEqual([]);
  expect(checkBox(v, book[K]!.focus![0]!, () => zK.right, W1 - 0.5, W1 + 1)).toEqual([expect.stringMatching(/out of frame 35\.\d\d–36\.16 s/)]); // unclipped
});
test('the turn guard fails a spread still close in at its turn, and passes one at the spread framing', () => {
  const close = synth(at('R', 385, 500, 1, 0.12));
  expect(checkTurn(close, plan, bookView(close, starts, audio), K).length).toBe(3);
  const open = synth(FRAME_SPREAD);
  expect(checkTurn(open, plan, bookView(open, starts, audio), K)).toEqual([]);
});

test('every inside spread that is built says what must read (spec §4: each declares its focus boxes)', () => {
  expect(spreads.filter((s, k) => k > 0 && !s.id.startsWith('placeholder-') && !s.focus?.length).map((s) => s.id)).toEqual([]);
});

for (const [k, sp] of spreads.entries()) {
  if (sp.focus?.length) {
    test(`${sp.id}: every focus box is in frame and in focus while it's sung`, () => {
      expect(checkSpread(spreads, plan, view, k)).toEqual([]);
    });
  }
  if (k >= 1 && k + 1 < spreads.length) { // (the last, the back cover, isn't turned away from)
    test(`${sp.id}: the turn out of it starts with the right page in frame, from >= ${TURN_DIST}`, () => {
      expect(checkTurn(spreads, plan, view, k)).toEqual([]);
    });
  }
}
