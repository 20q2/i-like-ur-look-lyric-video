import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { AudioData } from '../src/engine/audio';
import { BOW, PAGE_W, bowZ, curlPoint } from '../src/engine/curl';
import { Lyrics } from '../src/engine/lyrics';
import {
  Book, type BookPose, COVER_STOCK, LEAF_EPS, LEAVES, type Leaf, type LeafZ, type PageShadow, RIP, TURN_SHADOW, bowAllowed, leafBow, leafZ,
  panelReach, panelShadow, panelZ, ripPose, turnShadow,
} from '../src/engine/page';
import { LAMP as LAMP_CFG } from '../src/engine/lamp';
import { GUTTER, GUTTER_GLSL } from '../src/engine/paper';
import { RIP_S, TURN_S, bookLeaves, landsAt, magState } from '../src/scenes/magazine/schedule';
import { resolveFlatplan } from '../src/spreads/flatplan';

const LAMP = { x: LAMP_CFG.pos[0], z: LAMP_CFG.pos[2] }; // the magazine's lamp (lamp.ts), upper left
const N = LEAVES; // the magazine's leaves
const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json'));
const plan = resolveFlatplan(audio, new Lyrics(data('lyrics.json')));
const ix = (id: string) => plan.findIndex((e) => e.id === id);
// piles early in the song (the right one taller), in the middle, late (the left taller), the cover's turn, and the last
// leaf's, closing the magazine (12 leaves after the rip: the right page's plane is the bed)
const BOOKS: [string, LeafZ][] = [
  ...[0, 1, 6, 10].map((onLeft): [string, LeafZ] => [`${onLeft} on the left`, leafZ(N, onLeft, true)]), ['the last turn', leafZ(N - 1, N - 2, true)],
];

/** The book's pose at song time t, as Magazine.render poses it (no faces: those are blank paper). */
function poseAt(t: number): BookPose {
  const s = magState(plan, t);
  return { ...bookLeaves(s, plan), turnP: s.turnP, lift: 0, settle: 0 };
}
/** Times through the whole flatplan: every spread at rest, and every transition at its start, early, late and at its end. */
const TIMES = plan.flatMap((e, k) => {
  const next = plan[k + 1]?.start ?? audio.duration, rest = (landsAt(e) + next) / 2;
  return k === 0 ? [rest] : [e.start, e.start + 0.1 * TURN_S, e.start + 0.5 * TURN_S, landsAt(e) - 1e-6, rest];
});

/** What paper.ts's turn shadow leaves of the lamp's key at x, its `shade` (side +1: the right page, -1: the left). The
 *  ambient is never shaded. */
function lightAt(s: PageShadow, side: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - (s.x - s.soft)) / (2 * s.soft)));
  const c = t * t * (3 - 2 * t);
  return 1 - s.amt * (side > 0 ? 1 - c : c);
}
/** Both pages' shade at x in [-PAGE_W, PAGE_W]: the left page left of the spine, the right page right of it. */
function spreadLight(p: number, z: LeafZ, lamp = LAMP) {
  const s = turnShadow(lamp, p, z, 0);
  return (x: number) => (x < 0 ? lightAt(s.left, -1, x) : lightAt(s.right, 1, x));
}

test('the shadow starts at the free edge of a leaf lying on the right page', () => {
  for (const [, z] of BOOKS) {
    const s = turnShadow(LAMP, 1e-4, z, 0);
    expect(s.right.x).toBeCloseTo(PAGE_W, 2);
    expect(s.right.amt).toBeCloseTo(0, 3);
  }
});
test('and ends at the free edge of the leaf landing on the left page', () => {
  for (const [, z] of BOOKS) {
    const s = turnShadow(LAMP, 1 - 1e-4, z, 0);
    expect(s.left.x).toBeCloseTo(-PAGE_W, 2);
    expect(s.left.amt).toBeCloseTo(0, 3);
  }
});
test('it takes nothing at the very start and end of a turn (no pop)', () => {
  for (const [, z] of BOOKS) for (const p of [0, 1]) {
    const s = turnShadow(LAMP, p, z, 0);
    expect(s.right.amt).toBeCloseTo(0, 12);
    expect(s.left.amt).toBeCloseTo(0, 12);
  }
});
test('the pages hand it over at the spine continuously, whichever pile is taller', () => {
  const xs = Array.from({ length: 155 }, (_, i) => -PAGE_W + (2 * PAGE_W * i) / 154);
  for (const lamp of [LAMP, { x: 0.6, z: 1.8 }]) for (const [name, z] of BOOKS) {
    // the right page has it until its projected edge crosses the spine, then the left page
    let crossed = -1;
    let prev = xs.map(spreadLight(0, z, lamp));
    for (let i = 1; i <= 10000; i++) {
      const p = i / 10000, s = turnShadow(lamp, p, z, 0);
      if (crossed < 0 && s.right.x < 0) crossed = p;
      const cur = xs.map(spreadLight(p, z, lamp));
      const jump = Math.max(...cur.map((v, k) => Math.abs(v - prev[k]!)));
      if (jump > 0.005) throw new Error(`${name}, lamp x ${lamp.x}: the shade jumps by ${jump.toFixed(4)} at p = ${p}`);
      prev = cur;
    }
    expect(crossed).toBeGreaterThan(0.5);
    expect(crossed).toBeLessThan(1);
  }
});
test('the shadow falls on the right page while the leaf lifts and on the left as it lands', () => {
  for (const [, z] of BOOKS) {
    const lifting = turnShadow(LAMP, 0.3, z, 0), landing = turnShadow(LAMP, 0.9, z, 0);
    expect(lifting.right.x).toBeGreaterThan(PAGE_W); // the whole right page is in it
    expect(landing.right.x).toBeLessThan(0); // none of the right page
    expect(landing.left.x).toBeLessThan(-PAGE_W / 2);
  }
});
test("raising the book and the lamp together changes nothing: the shadow is cast in the book's own frame", () => {
  for (const [, z] of BOOKS) for (const lift of [0.004, 0.5, 3]) for (const p of [0.05, 0.3, 0.6, 0.76, 0.9]) {
    const flat = turnShadow(LAMP, p, z, 0), raised = turnShadow({ x: LAMP.x, z: LAMP.z + lift }, p, z, lift);
    for (const side of ['right', 'left'] as const) for (const k of ['x', 'soft', 'amt'] as const) {
      expect(raised[side][k]).toBeCloseTo(flat[side][k], 10);
    }
  }
});
test("no leaf or pile jumps as any of the flatplan's turns, or its rip, starts or lands", () => {
  for (let k = 1; k < plan.length; k++) {
    const e = plan[k]!, z = (t: number, turning: boolean) => { const b = poseAt(t); return leafZ(b.leaves, b.onLeft, turning); };
    const open = z(e.start - 1e-6, false), turn = z(e.start, true), next = z(landsAt(e), false);
    // the start: the leaf lifts off where the right page lay, uncovering the next page on top of the stack below
    expect(turn.turn0).toBeCloseTo(open.right, 12);
    expect(turn.right).toBeCloseTo(open.stackR, 12);
    expect(turn.left).toBeCloseTo(open.left, 12);
    expect(turn.stackL).toBeCloseTo(open.stackL, 12);
    // the end: the next right page and its stack stay as they are
    expect(turn.right).toBeCloseTo(next.right, 12);
    expect(turn.stackR).toBeCloseTo(next.stackR, 12);
    if (e.how === 'turn') { // a turned leaf lands as the next left page, on the old one, which joins the left stack
      expect(turn.turn1).toBeCloseTo(next.left, 12);
      expect(next.stackL).toBeCloseTo(turn.left, 12);
    } else { // a torn-out leaf lands nowhere: the left page and its stack stay
      expect(next.left).toBeCloseTo(turn.left, 12);
      expect(next.stackL).toBeCloseTo(turn.stackL, 12);
    }
  }
});
test('every stack lies a leaf below its page', () => {
  for (let a = 0; a <= N; a++) for (const turning of [false, true]) {
    if (turning && a === N) continue; // (nothing on the right to turn)
    const z = leafZ(N, a, turning);
    expect(z.stackR).toBeCloseTo(z.right - LEAF_EPS, 12);
    expect(z.stackL).toBeCloseTo(z.left - LEAF_EPS, 12);
  }
});
test('a page bows as much as the pile under it allows: flat on nothing, fully on a thick pile', () => {
  // the first spread: the inside cover lies alone on the left, nothing under it; the rest of the magazine on the right
  expect(leafBow(leafZ(N, 1, false))).toMatchObject({ left: 0, right: 1 });
  // the last spread: the reverse; and the closed magazine's empty side, at the front and at the back
  expect(leafBow(leafZ(N, N - 1, false))).toMatchObject({ left: 1, right: 0 });
  expect(leafBow(leafZ(N, 0, false)).left).toBe(0);
  expect(leafBow(leafZ(N, N, false)).right).toBe(0);
  // in between, by the pile: never higher than the stack under the page, and growing with it
  expect(bowAllowed(BOW.h / 2)).toBeCloseTo(0.5, 12);
  let prevL = -1, prevR = 2;
  for (let a = 0; a <= N; a++) {
    const z = leafZ(N, a, false), w = leafBow(z);
    expect(w.left * BOW.h).toBeLessThanOrEqual(Math.max(0, z.stackL) + 1e-12);
    expect(w.right * BOW.h).toBeLessThanOrEqual(Math.max(0, z.stackR) + 1e-12);
    expect(w.left).toBeGreaterThanOrEqual(prevL);
    expect(w.right).toBeLessThanOrEqual(prevR);
    prevL = w.left; prevR = w.right;
  }
});
test('each page and the stack under it carry the same bow, so the page keeps lying a leaf above it', () => {
  const book = new Book();
  const [left, , right, stackL, stackR] = book.group.children as THREE.Mesh[];
  const bow = (m: THREE.Mesh) => (m.material as THREE.RawShaderMaterial).uniforms.uBow!.value as number;
  let checked = 0;
  for (const t of TIMES) {
    book.pose(poseAt(t)); // (the cover's turn and the close too: the book partly open)
    if (stackR!.visible) { expect(bow(stackR!)).toBe(bow(right!)); checked++; }
    if (stackL!.visible) { expect(bow(stackL!)).toBe(bow(left!)); checked++; }
  }
  expect(checked).toBeGreaterThan(80);
  book.dispose();
});
const bowOf = (l: Leaf) => l.mat.uniforms.uBow!.value as number;
test("the turning leaf lifts off with the right page's bow, and lands with the next left page's", () => {
  const book = new Book();
  for (let k = 1; k < plan.length; k++) {
    const e = plan[k]!;
    book.pose(poseAt(e.start - 1e-6)); const right = bowOf(book.right), left = bowOf(book.left);
    book.pose(poseAt(e.start)); expect(bowOf(book.turning)).toBeCloseTo(right, 12); expect(bowOf(book.left)).toBeCloseTo(left, 12);
    book.pose(poseAt(landsAt(e) - 1e-9)); const landing = bowOf(book.turning), nextRight = bowOf(book.right), stays = bowOf(book.left);
    book.pose(poseAt(landsAt(e)));
    // (a torn-out leaf doesn't land, it is flung away (ripPose): the left page keeps its bow)
    expect(e.how === 'turn' ? landing : stays).toBeCloseTo(bowOf(book.left), 6);
    expect(nextRight).toBeCloseTo(bowOf(book.right), 6);
  }
  book.dispose();
});
test("the gutter's occlusion is the book's opening on every leaf and stack, and its shaders are built from GUTTER", () => {
  const book = new Book();
  const meshes = book.group.children as THREE.Mesh[];
  const mat = (m: THREE.Mesh) => m.material as THREE.RawShaderMaterial, isPanel = (m: THREE.Mesh) => m === book.panelA.mesh || m === book.panelB.mesh;
  const p = (id: string, raw: number) => plan[ix(id)]!.start + raw * TURN_S, eased = (raw: number) => 1 - (1 - raw) ** 4;
  // closed, the cover turning (the book opening with it), open, whatever the piles hold; the last leaf turning (the book
  // closing with it), and closed at the back
  for (const [t, k] of [[5, 0], [p('getthelook', 0.3), eased(0.3)], [20, 1], [p('accessories', 0.4), 1], [140, 1],
    [p('backcover', 0.3), 1 - eased(0.3)], [168, 0]] as const) {
    const b = poseAt(t);
    book.pose(b);
    // (the fold-out's panels, posed only while they lift or lie open, have their own: see the fold-out's tests; a
    // cut-out piece has none, lying out in the page, far from the spine: engine/cutout.ts)
    for (const m of meshes) if ((m !== book.turning.mesh || b.turnP !== null) && !isPanel(m) && m !== book.cut.mesh) expect(mat(m).uniforms.uGutter!.value).toBeCloseTo(k, 12);
  }
  for (const m of meshes) expect(mat(m).fragmentShader).toContain(GUTTER_GLSL);
  for (const v of Object.values(GUTTER)) expect(GUTTER_GLSL).toContain(v.toFixed(6));
  book.dispose();
});

test('closed at the back: the back cover alone, face up on the left pile, varnished; no right page, no right stack', () => {
  const book = new Book(), b = poseAt(168);
  const [left, turning, right, stackL, stackR] = book.group.children as THREE.Mesh[];
  book.pose(b);
  expect([left!.visible, turning!.visible, right!.visible, stackL!.visible, stackR!.visible]).toEqual([true, false, false, true, false]);
  expect((book.left.mat.uniforms.uStockB!.value as THREE.Vector3).toArray()).toEqual([...COVER_STOCK]); // the back cover's outside
  const z = leafZ(b.leaves, b.onLeft, false);
  expect(book.left.mat.uniforms.uZ1!.value).toBeCloseTo(b.leaves * LEAF_EPS, 12); // on the whole book
  expect(stackL!.scale.z).toBeCloseTo(z.stackL, 12);
  expect(bowOf(book.left)).toBe(0); // closed: flat, no gutter
  expect(book.footprint(b)).toEqual([-PAGE_W, 0, 0, 1]);
  book.dispose();
});
test('the footprint follows the piles: the cover joins the left as it lands, the last leaf leaves the right as it lifts', () => {
  const book = new Book(), fp = (t: number) => book.footprint(poseAt(t));
  const g = plan[ix('getthelook')]!, c = plan[ix('backcover')]!;
  expect(fp(5)).toEqual([0, 0, PAGE_W, 1]); // closed at the front
  expect(fp(g.start)[0]).toBeCloseTo(0, 12); // the cover lifting: no left side yet
  expect(fp(landsAt(g) - 1e-6)[0]).toBeCloseTo(-PAGE_W, 4); // landed
  expect(fp(20)).toEqual([-PAGE_W, 0, PAGE_W, 1]);
  expect(fp(c.start)).toEqual([-PAGE_W, 0, PAGE_W, 1]); // the last leaf still lying on the right as it starts to turn
  expect(fp(c.start + 0.05)[2]).toBeCloseTo(0, 12); // lifted: gone from the right
  expect(fp(landsAt(c))).toEqual([-PAGE_W, 0, 0, 1]);
  book.dispose();
});
test('every pose through the song is finite, with each page and stack placed where its pile says', () => {
  const book = new Book();
  const meshes = book.group.children as THREE.Mesh[];
  for (let t = 0; t < audio.duration; t += 1 / 30) {
    const b = poseAt(t);
    book.pose(b);
    for (const m of meshes) {
      for (const [name, u] of Object.entries((m.material as THREE.RawShaderMaterial).uniforms)) {
        const v = u.value;
        const nums = typeof v === 'number' ? [v] : v instanceof THREE.Vector3 ? v.toArray() : [];
        if (nums.some((x) => !Number.isFinite(x))) throw new Error(`t=${t.toFixed(3)}: ${name} is ${nums}`);
      }
      if (m.visible && ![m.position.x, m.position.z, m.scale.z].every(Number.isFinite)) throw new Error(`t=${t.toFixed(3)}: a stack misplaced`);
    }
    if (!book.footprint(b).every(Number.isFinite)) throw new Error(`t=${t.toFixed(3)}: the footprint is ${book.footprint(b)}`);
  }
  book.dispose();
});
test('a pose whose turn has no leaf, or whose leaf has no turn, is an error', () => {
  const book = new Book(), rest = poseAt(20);
  expect(() => book.pose({ ...rest, turnP: 0.5 })).toThrow(/turns at p 0\.5, but its turning leaf is null/);
  expect(() => book.pose({ ...rest, turnLeaf: 1 })).toThrow(/turns nothing, but its turning leaf is 1/);
  book.dispose();
});

// ---- the rip (Task B2): the right page's leaf torn out and flung off ----
const rip0 = plan[ix('ransom')]!.start, ripAt = (r: number) => poseAt(rip0 + r * RIP_S);
test('the rip: the leaf curls up to RIP.curl of a turn by the tear and holds there; the fling waits for the tear', () => {
  expect(ripPose(0)).toEqual({ curl: 0, fling: 0, shadow: 1, shown: true });
  for (const r of [0.1, 0.2, 0.3]) {
    expect(ripPose(r).curl).toBeGreaterThan(ripPose(r - 0.05).curl);
    expect(ripPose(r).fling).toBe(0);
  }
  for (const r of [RIP.tear, 0.5, 0.9, 0.999]) expect(ripPose(r).curl).toBeCloseTo(RIP.curl, 12);
  for (const r of [RIP.gone, 0.9, 0.999]) expect(ripPose(r).fling).toBe(1); // out of frame from RIP.gone on
  expect(ripPose(RIP.tear + 0.25).fling).toBeGreaterThan(0);
});
test('the ripped leaf is there until the rip ends, and gone from r = 1', () => {
  for (const r of [0, 0.5, 0.999999]) expect(ripPose(r).shown).toBe(true);
  for (const r of [1, 1.5]) expect(ripPose(r).shown).toBe(false);
  const book = new Book(), b = ripAt(0.5);
  book.pose(b); expect(book.turning.mesh.visible).toBe(true);
  book.pose({ ...b, rip: 1 }); expect(book.turning.mesh.visible).toBe(false);
  book.dispose();
});
test("the turn shadow fades out as the ripped leaf flies: whole until the tear, gone by RIP.fade", () => {
  expect(ripPose(RIP.tear).shadow).toBe(1);
  expect(ripPose(RIP.fade).shadow).toBe(0);
  let prev = 1;
  for (let r = RIP.tear; r <= RIP.fade; r += 0.01) { const v = ripPose(r).shadow; expect(v).toBeLessThanOrEqual(prev); prev = v; }
  // the book's pages take it so: the curled leaf's shadow, scaled
  const book = new Book();
  for (const r of [0.2, 0.45, 0.55, 0.7]) {
    const b = ripAt(r), rp = ripPose(r), z = leafZ(b.leaves, b.onLeft, true);
    book.pose(b);
    const want = turnShadow(LAMP, rp.curl, { ...z, turn1: z.turn0 }, 0).right.amt * rp.shadow;
    expect(book.right.mat.uniforms.uShadowAmt!.value).toBeCloseTo(want, 12);
    expect(want).toBeLessThanOrEqual(TURN_SHADOW);
  }
  book.dispose();
});
test('the rip is continuous through the tear, at r = RIP.tear: the curl eases out to rest as the fling eases in from it', () => {
  const e = 1e-6, a = ripPose(RIP.tear - e), b = ripPose(RIP.tear + e), slope = (f: (r: number) => number, r: number) => (f(r + e) - f(r - e)) / (2 * e);
  expect(b.curl - a.curl).toBeLessThan(1e-9);
  expect(b.fling).toBeLessThan(1e-9);
  expect(Math.abs(slope((r) => ripPose(r).curl, RIP.tear - 2 * e))).toBeLessThan(1e-3);
  expect(Math.abs(slope((r) => ripPose(r).fling, RIP.tear + 2 * e))).toBeLessThan(1e-3);
  // and the book with it: the leaf's curl and its mesh's transform
  const book = new Book(), m = () => { const x = book.turning.mesh; x.updateMatrix(); return { u: book.turning.mat.uniforms.uTurn!.value as number, el: [...x.matrix.elements] }; };
  book.pose(ripAt(RIP.tear - e)); const before = m();
  book.pose(ripAt(RIP.tear + e)); const after = m();
  expect(Math.abs(after.u - before.u)).toBeLessThan(1e-6);
  after.el.forEach((v, i) => expect(v).toBeCloseTo(before.el[i]!, 6));
  book.dispose();
});
test('the ripped leaf stays hinged on the right pile while it curls, then flies about its spine edge; turns are never moved', () => {
  const book = new Book(), mesh = book.turning.mesh, ID = new THREE.Matrix4().elements;
  const placed = () => { mesh.updateMatrix(); return [...mesh.matrix.elements]; };
  for (const r of [0, 0.2, RIP.tear]) {
    book.pose(ripAt(r));
    placed().forEach((v, i) => expect(v).toBeCloseTo(ID[i]!, 12));
    expect(book.turning.mat.uniforms.uZ1!.value).toBe(book.turning.mat.uniforms.uZ0!.value);
  }
  // flung: its spine edge's midpoint moved by the fling's share of RIP.move, the group untouched (Book.pose would throw)
  for (const r of [0.6, RIP.gone, 0.95]) {
    book.pose(ripAt(r));
    mesh.updateMatrix();
    const f = ripPose(r).fling, hinge = book.turning.mat.uniforms.uZ0!.value as number;
    const mid = new THREE.Vector3(0, 0.5, hinge).applyMatrix4(mesh.matrix);
    expect(mid.x).toBeCloseTo(RIP.move[0] * f, 9);
    expect(mid.y).toBeCloseTo(0.5 + RIP.move[1] * f, 9);
    expect(mid.z).toBeCloseTo(hinge + RIP.move[2] * f, 9);
    expect(book.group.position.x).toBe(0);
  }
  // a turn after the rip (and every turn) is posed on an untransformed mesh again
  book.pose(poseAt(plan[ix('ransom') + 1]!.start + 0.1 * TURN_S));
  placed().forEach((v, i) => expect(v).toBeCloseTo(ID[i]!, 12));
  book.dispose();
});
// ---- the fold-out (Task B3): two panels hinged outward from the right page's outer edge
/** A pose at rest in the middle of the song, the panels `panels`. */
const panelPose = (panels: { a: number; b: number }): BookPose => ({ ...poseAt(20), panels });
test('the panels lie a leaf above what they fold onto: A above the right page\'s outer edge, B above A', () => {
  for (const [onLeft, bow] of [[1, 0], [6, 1], [10, 0.4]] as const) {
    const z = leafZ(N, onLeft, false), p = panelZ(z, bow);
    expect(p.a).toBeCloseTo(z.right + bow * BOW.h + LEAF_EPS, 12); // the page's outer edge: its hinge plus the bow, flat there
    expect(p.b - p.a).toBeCloseTo(LEAF_EPS, 12);
  }
});
test('folded, panel A follows the right page\'s bow from its free edge: a leaf above the page all across it (LEAF_VERT)', () => {
  const z = leafZ(N, 6, false), bowR = 0.8, zA = panelZ(z, bowR).a;
  for (let i = 0; i <= 20; i++) {
    const s = (PAGE_W * i) / 20, x = PAGE_W - s; // (s from A's hinge, at the page's outer edge; x from the spine)
    const page = z.right + bowR * bowZ(x), panel = zA + bowR * (bowZ(PAGE_W - s) - BOW.h); // (LEAF_VERT, uBowFlip 1)
    expect(panel - page).toBeCloseTo(LEAF_EPS, 12);
  }
  const book = new Book();
  expect(book.panelA.mat.vertexShader).toContain('mix(s, PAGE_W - s, uBowFlip)');
  expect([book.panelA.mat.uniforms.uBowFlip!.value, book.panelB.mat.uniforms.uBowFlip!.value, book.right.mat.uniforms.uBowFlip!.value]).toEqual([1, 0, 0]);
  book.dispose();
});
test('the panels are leaves mirrored about their hinges, posed only while they lift or lie open, flat at their hinges', () => {
  const book = new Book();
  expect([book.panelA.mesh.position.x, book.panelA.mesh.scale.x, book.panelB.mesh.position.x, book.panelB.mesh.scale.x]).toEqual([PAGE_W, -1, 2 * PAGE_W, -1]);
  const vis = () => [book.panelA.mesh.visible, book.panelB.mesh.visible];
  book.pose(poseAt(20)); expect(vis()).toEqual([false, false]);
  book.pose(panelPose({ a: 0, b: 0 })); expect(vis()).toEqual([false, false]);
  const b = panelPose({ a: 0.4, b: 0 });
  book.pose(b); expect(vis()).toEqual([true, false]);
  const u = book.panelA.mat.uniforms, zp = panelZ(leafZ(b.leaves, b.onLeft, false), book.right.mat.uniforms.uBow!.value);
  expect([u.uTurn!.value, u.uZ0!.value, u.uZ1!.value]).toEqual([0.4, zp.a, zp.a]);
  book.pose(panelPose({ a: 1, b: 0.5 })); expect(vis()).toEqual([true, true]);
  expect(book.panelB.mat.uniforms.uTurn!.value).toBe(0.5);
  expect(book.panelB.mat.uniforms.uZ0!.value).toBeCloseTo(zp.b, 12);
  // open, A lies flat beyond the page: no bow, no gutter
  expect([u.uBow!.value, u.uGutter!.value]).toEqual([0, 0]);
  book.dispose();
});
test('the panels open only at rest, with a right page, and B only from A lying open', () => {
  const book = new Book(), turning = poseAt(plan[ix('accessories')]!.start + 0.1);
  expect(() => book.pose({ ...turning, panels: { a: 0.5, b: 0 } })).toThrow(/during a turn/);
  expect(() => book.pose({ ...turning, panels: { a: 0, b: 0 } })).not.toThrow();
  expect(() => book.pose({ ...poseAt(168), panels: { a: 0.5, b: 0 } })).toThrow(/no right page/);
  expect(() => book.pose(panelPose({ a: 0.9, b: 0.1 }))).toThrow(/while A isn't open/);
  book.dispose();
});
test('the footprint grows a page with each panel lying open, joining it as it lands; the contact shadow follows', () => {
  const book = new Book(), x1 = (a: number, b: number) => book.footprint(panelPose({ a, b }))[2];
  expect(x1(0, 0)).toBe(PAGE_W);
  expect(x1(0.5, 0)).toBe(PAGE_W); // (airborne: no contact shadow under it)
  expect(x1(0.995, 0)).toBeGreaterThan(PAGE_W);
  expect(x1(0.995, 0)).toBeLessThan(2 * PAGE_W);
  expect(x1(1, 0)).toBeCloseTo(2 * PAGE_W, 12);
  expect(x1(1, 0.5)).toBeCloseTo(2 * PAGE_W, 12);
  expect(x1(1, 1)).toBeCloseTo(3 * PAGE_W, 12);
  expect(panelReach(undefined)).toBe(0);
  expect(book.footprint(panelPose({ a: 1, b: 1 })).slice(0, 2)).toEqual([-PAGE_W, 0]);
  book.dispose();
});
test('a lifting panel\'s shadow edge is its free edge projected from the lamp onto what it lifts off, covering toward its hinge', () => {
  const zh = 0.012, zp = 0.0104;
  for (const hinge of [PAGE_W, 2 * PAGE_W]) {
    for (const p of [0.05, 0.2, 0.35]) {
      const s = panelShadow(LAMP, p, hinge, zh, zp, 0), e = curlPoint(PAGE_W, p);
      const ex = hinge - e.x, ez = zh + e.z; // the free edge, in the world (the panel is mirrored about its hinge)
      expect(s.x).toBeCloseTo(LAMP.x + ((ex - LAMP.x) * (LAMP.z - zp)) / (LAMP.z - ez), 9);
      expect(s.amt).toBeCloseTo(0.515 * Math.sin(Math.PI * p), 12);
    }
    expect(panelShadow(LAMP, 0, hinge, zh, zp, 0).amt).toBe(0);
  }
  // A just lifting off the right page shades it from the spine (its free edge) toward its hinge, the page's outer edge
  const book = new Book(), b = panelPose({ a: 0.02, b: 0 });
  book.pose(b);
  const u = book.right.mat.uniforms;
  expect(u.uShadowSide!.value).toBe(-1);
  expect(u.uShadowX!.value).toBeGreaterThan(0);
  expect(u.uShadowX!.value).toBeLessThan(0.1);
  expect(u.uShadowAmt!.value).toBeGreaterThan(0);
  book.pose(poseAt(20));
  expect(u.uShadowAmt!.value).toBe(0); // (and gone at rest)
  book.dispose();
});
