import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData } from '../src/engine/audio';
import { Lyrics } from '../src/engine/lyrics';
import {
  CAM_BLEND_S, RIP_S, TURN_S, bookLeaves, camBlend, landedAt, landsAt, magState, sinceLanding, spreadAt, visibleFaces,
} from '../src/scenes/magazine/schedule';
import { MAX_FACES, foldFaces, restPanels } from '../src/scenes/magazine/schedule';
import { resolveFlatplan } from '../src/spreads/flatplan';
import { makeSpreads } from '../src/spreads/registry';
import type { FaceSide, Panels, Spread } from '../src/spreads/spread';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json')), lyrics = new Lyrics(data('lyrics.json'));
const plan = resolveFlatplan(audio, lyrics);
const starts = plan.map((e) => e.start);
const ix = (id: string) => plan.findIndex((e) => e.id === id);
const at = (id: string) => plan[ix(id)]!.start;
const R = (spread: number) => ({ spread, side: 'R' as const }), L = (spread: number) => ({ spread, side: 'L' as const });

test('the cover is up before the first turn', () => {
  expect(magState(plan, 5)).toEqual({ open: 0, turnP: null, how: null });
});
test('the cover turns on the verse downbeat', () => {
  const s = magState(plan, 8.291);
  expect(s.open).toBe(0);
  expect(s.how).toBe('turn');
  expect(s.turnP).not.toBeNull();
  expect(s.turnP!).toBeCloseTo(0, 9);
});
test('turn progress is eased out', () => {
  // halfway through the turn's time, outQuart is 15/16 of the way
  expect(magState(plan, 8.291 + TURN_S / 2).turnP!).toBeCloseTo(0.9375, 6);
});
test('after the turn the next spread is open', () => {
  expect(magState(plan, 8.291 + TURN_S + 0.01)).toEqual({ open: 1, turnP: null, how: null });
  expect(magState(plan, 30)).toEqual({ open: 2, turnP: null, how: null });
});
test('verse 2 turns twice: into the perfume ad on its downbeat, into the accessories on the downbeat at "you\'re"', () => {
  expect(magState(plan, 53.069 + 0.1)).toMatchObject({ open: ix('perfume') - 1, how: 'turn' });
  expect(magState(plan, 60.233 - 0.01)).toEqual({ open: ix('perfume'), turnP: null, how: null });
  expect(magState(plan, 60.233 + 0.1)).toMatchObject({ open: ix('perfume'), how: 'turn' });
  expect(magState(plan, 60.233 + TURN_S)).toEqual({ open: ix('accessories'), turnP: null, how: null });
});
test('the bridge comes up on the drop, a bar before its section', () => {
  expect(magState(plan, 110.385 + 0.1)).toMatchObject({ open: ix('specimen'), how: 'turn' });
  expect(magState(plan, 111)).toEqual({ open: ix('whoworeit'), turnP: null, how: null });
});
test('the rip into the ransom note is a transition of its own kind: RIP_S long, its progress linear in time', () => {
  expect(RIP_S).toBe(0.6);
  const r0 = at('ransom');
  expect(r0).toBeCloseTo(133.669, 3);
  expect(magState(plan, r0)).toEqual({ open: ix('whoworeit'), turnP: 0, how: 'rip' }); // under way from its downbeat
  for (const r of [0.1, 0.35, 0.5, 0.9]) {
    const s = magState(plan, r0 + r * RIP_S);
    expect(s).toMatchObject({ open: ix('whoworeit'), how: 'rip' });
    expect(s.turnP!).toBeCloseTo(r, 9); // (not eased: page.ts ripPose eases its parts)
  }
  expect(magState(plan, r0 + RIP_S)).toEqual({ open: ix('ransom'), turnP: null, how: null });
});

test('visible faces by role: the cover\'s right face alone, then two pages, four during a turn', () => {
  expect(visibleFaces({ open: 0, turnP: null, how: null }, plan)).toEqual({ right: R(0) });
  expect(visibleFaces({ open: 0, turnP: 0.5, how: 'turn' }, plan)).toEqual({ turnFront: R(0), turnBack: L(1), right: R(1) });
  expect(visibleFaces({ open: 1, turnP: null, how: null }, plan)).toEqual({ left: L(1), right: R(1) });
  expect(visibleFaces({ open: 1, turnP: 0.5, how: 'turn' }, plan)).toEqual({ left: L(1), turnFront: R(1), turnBack: L(2), right: R(2) });
});
test('a rip: the left page stays, the torn leaf\'s back is blank paper, the next right page lies under it', () => {
  const w = ix('whoworeit'), r = ix('ransom');
  expect(visibleFaces(magState(plan, 133.669 + 0.2), plan)).toEqual({ left: L(w), turnFront: R(w), right: R(r) });
  expect(visibleFaces(magState(plan, 140), plan)).toEqual({ left: L(r), right: R(r) });
});
test('the close: the last leaf turns onto the left with nothing under it; then only the back cover shows', () => {
  const i = ix('insideback'), b = ix('backcover');
  expect(b).toBe(plan.length - 1);
  expect(visibleFaces(magState(plan, at('backcover') + 0.2), plan)).toEqual({ left: L(i), turnFront: R(i), turnBack: L(b) });
  expect(visibleFaces(magState(plan, 168), plan)).toEqual({ left: L(b) });
});
test('a turn is under way from its downbeat, p = 0', () => {
  expect(visibleFaces({ open: 1, turnP: 0, how: 'turn' }, plan)).toEqual(visibleFaces({ open: 1, turnP: 0.5, how: 'turn' }, plan));
});
test('never more than four faces from the pages and the turn alone (the fold-out\'s panels add up to two: foldFaces), at any time', () => {
  for (let t = 0; t < 171.317; t += 1 / 60) expect(Object.keys(visibleFaces(magState(plan, t), plan)).length).toBeLessThanOrEqual(4);
});

test("the book's leaves: the open spread's piles, its pages' leaves, the turning leaf counted on the right pile", () => {
  const leaves = (t: number) => bookLeaves(magState(plan, t), plan);
  expect(leaves(5)).toEqual({ leaves: 13, onLeft: 0, leftLeaf: null, rightLeaf: 0, turnLeaf: null }); // closed: the cover
  expect(leaves(8.4)).toEqual({ leaves: 13, onLeft: 0, leftLeaf: null, rightLeaf: 1, turnLeaf: 0 }); // the cover turning
  expect(leaves(20)).toEqual({ leaves: 13, onLeft: 1, leftLeaf: 0, rightLeaf: 1, turnLeaf: null });
  expect(leaves(at('ransom') + 0.3 * RIP_S)).toStrictEqual({ leaves: 13, onLeft: 9, leftLeaf: 8, rightLeaf: 10, turnLeaf: 9, rip: expect.closeTo(0.3, 9) }); // the rip: leaf 9 torn out
  for (const t of [8.4, 20, at('ransom') - 1e-6, at('ransom') + RIP_S]) expect('rip' in leaves(t)).toBe(false); // (only in a rip)
  expect(leaves(140)).toEqual({ leaves: 12, onLeft: 9, leftLeaf: 8, rightLeaf: 10, turnLeaf: null }); // a leaf fewer
  expect(leaves(165.2)).toEqual({ leaves: 12, onLeft: 11, leftLeaf: 11, rightLeaf: null, turnLeaf: 12 }); // the last turn
  expect(leaves(168)).toEqual({ leaves: 12, onLeft: 12, leftLeaf: 12, rightLeaf: null, turnLeaf: null }); // closed: the back cover
});

test('transitions land after their length: a turn TURN_S on, a rip RIP_S; the cover\'s start is no transition', () => {
  expect(landsAt(plan[0]!)).toBe(0);
  expect(landsAt(plan[1]!)).toBeCloseTo(8.291 + TURN_S, 9);
  expect(landsAt(plan[ix('ransom')]!)).toBeCloseTo(133.669 + RIP_S, 9);
  expect(landedAt(plan[0]!)).toBe(0);
  expect(landedAt(plan[1]!)).toBeCloseTo(8.291 + TURN_S + 0.05, 9);
});
test('the camera blend outlasts the turn and the rip', () => {
  expect(CAM_BLEND_S).toBeGreaterThan(TURN_S);
  expect(CAM_BLEND_S).toBeGreaterThan(RIP_S);
  expect(camBlend(starts, 5)).toBeNull();
  const after = 8.291 + (TURN_S + CAM_BLEND_S) / 2; // the leaf is down, the camera still moving
  expect(magState(plan, after).turnP).toBeNull();
  const b = camBlend(starts, after)!;
  expect(b.from).toBe(0);
  expect(b.to).toBe(1);
  expect(camBlend(starts, 8.291 + CAM_BLEND_S + 0.01)).toBeNull();
  // and into the back cover, the last
  expect(camBlend(starts, at('backcover') + 0.3)).toMatchObject({ from: ix('insideback'), to: ix('backcover') });
});
test('the spread that is up: the last started, the one being turned to during its turn', () => {
  expect(spreadAt(starts, 5)).toBe(0);
  expect(spreadAt(starts, 8.291)).toBe(1);
  expect(spreadAt(starts, 8.291 + TURN_S / 2)).toBe(1);
  expect(magState(plan, 8.291 + TURN_S / 2).open).toBe(0); // (while the turn's open spread is still the cover)
  expect(spreadAt(starts, 30)).toBe(2);
  expect(spreadAt(starts, 171)).toBe(plan.length - 1);
});
test('sinceLanding counts from the last turn to have landed; a rip lands no leaf', () => {
  expect(sinceLanding(plan, 5)).toBeNull();
  expect(sinceLanding(plan, 8.291 + TURN_S / 2)).toBeNull();
  expect(sinceLanding(plan, 8.291 + TURN_S)).toBeCloseTo(0, 9);
  expect(sinceLanding(plan, 20)).toBeCloseTo(20 - 8.291 - TURN_S, 9);
  expect(sinceLanding(plan, 22.62 + 0.1)).toBeCloseTo(22.62 + 0.1 - 8.291 - TURN_S, 9); // still the last one landed
  expect(sinceLanding(plan, 30)).toBeCloseTo(30 - 22.62 - TURN_S, 9);
  // after the rip: still from the bridge's turn, which landed long before (its settle long over)
  expect(sinceLanding(plan, 133.669 + RIP_S + 0.05)).toBeCloseTo(133.669 + RIP_S + 0.05 - 110.385 - TURN_S, 9);
  expect(sinceLanding(plan, 168)).toBeCloseTo(168 - at('backcover') - TURN_S, 9); // the close lands the back cover
});

// ---- the fold-out (Task B3): which printed surface shows where
const G = ix('specimen'); // a gatefold's index, for the mapping's own tests (any spread would do)
const F_ = (side: FaceSide) => ({ spread: G, side });
const rest = { open: G, turnP: null, how: null } as const;
const only = (p: Panels | null) => (k: number) => (k === G ? p : null);
const folded = (r: ReturnType<typeof visibleFaces>, s: Parameters<typeof foldFaces>[1], p: Panels | null) => foldFaces(r, s, only(p));
test('the fold-out: folded, the right page shows panel A\'s outside, and no panel face is bound', () => {
  expect(folded(visibleFaces(rest, plan), rest, { a: 0, b: 0 })).toEqual({ left: L(G), right: F_('AO') });
  // not a gatefold: as visibleFaces has it
  expect(folded(visibleFaces(rest, plan), rest, null)).toEqual({ left: L(G), right: R(G) });
});
test('A lifting or open: the right page under it, A\'s outside on its front and B\'s outside on its back (B lies folded on it)', () => {
  for (const a of [0.001, 0.5, 1]) {
    expect(folded(visibleFaces(rest, plan), rest, { a, b: 0 })).toEqual({ left: L(G), right: R(G), aFront: F_('AO'), aBack: F_('BO') });
  }
});
test('B lifting or open: A\'s back is its own inside, B\'s faces its outside and inside; six faces, the pool\'s', () => {
  for (const b of [0.001, 0.5, 1]) {
    const f = folded(visibleFaces(rest, plan), rest, { a: 1, b });
    expect(f).toEqual({ left: L(G), right: R(G), aFront: F_('AO'), aBack: F_('AI'), bFront: F_('BO'), bBack: F_('BI') });
    expect(Object.keys(f).length).toBe(MAX_FACES);
  }
});
test('a turn carries the folded panels: A\'s outside on the leaf turning away, and on the page coming up under it', () => {
  const out = { open: G, turnP: 0.5, how: 'turn' } as const, into = { open: G - 1, turnP: 0.5, how: 'turn' } as const;
  expect(foldFaces(visibleFaces(out, plan), out, only({ a: 0, b: 0 }))).toEqual({ left: L(G), turnFront: F_('AO'), turnBack: L(G + 1), right: R(G + 1) });
  expect(foldFaces(visibleFaces(into, plan), into, only({ a: 0, b: 0 }))).toEqual({ left: L(G - 1), turnFront: R(G - 1), turnBack: L(G), right: F_('AO') });
  expect(() => foldFaces(visibleFaces(out, plan), out, only({ a: 0.2, b: 0 }))).toThrow(/during a turn/);
  expect(() => foldFaces(visibleFaces(into, plan), into, only({ a: 1, b: 0 }))).toThrow(/during a turn/);
  expect(restPanels(out, only({ a: 0, b: 0 }))).toBeUndefined();
  expect(restPanels(rest, only({ a: 0.3, b: 0 }))).toEqual({ a: 0.3, b: 0 });
});
test('the panels\' rules: each in [0, 1], and B unfolds only from A lying open', () => {
  expect(() => folded(visibleFaces(rest, plan), rest, { a: 0.9, b: 0.1 })).toThrow(/B unfolds from A lying open/);
  expect(() => folded(visibleFaces(rest, plan), rest, { a: 1.2, b: 0 })).toThrow(/in \[0, 1\]/);
  expect(() => folded(visibleFaces(rest, plan), rest, { a: Number.NaN, b: 0 })).toThrow(/in \[0, 1\]/);
});

/** Every frame of the song through foldFaces, with `spreads`' panels: none throws, and none binds more faces than the
 *  pool has. Returns the most faces bound at once. */
function foldThroughSong(spreads: readonly Spread<FaceSide>[]) {
  let most = 0;
  for (let t = 0; t < 171.317; t += 1 / 60) {
    const s = magState(plan, t), panelsOf = (k: number) => spreads[k]!.panels?.(t) ?? null;
    const n = Object.keys(foldFaces(visibleFaces(s, plan), s, panelsOf)).length;
    expect(n).toBeLessThanOrEqual(MAX_FACES);
    most = Math.max(most, n);
  }
  return most;
}
test('every built spread\'s panels keep the rules through the song: folded through its turns, never more faces than the pool', () => {
  foldThroughSong(makeSpreads(audio, lyrics, plan));
});
