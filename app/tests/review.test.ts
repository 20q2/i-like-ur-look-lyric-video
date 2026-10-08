import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData } from '../src/engine/audio';
import { Lyrics } from '../src/engine/lyrics';
import { spreadJump, spreadJumpTargets, spreadLoop } from '../src/review';
import { resolveFlatplan, timeFlatplan } from '../src/spreads/flatplan';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json')), lyrics = new Lyrics(data('lyrics.json'));
// the preview's: the flatplan as timed, without the magazine's checks (main.ts)
const plan = timeFlatplan(audio, lyrics), starts = plan.map((e) => e.start), at = spreadJumpTargets(plan);
const id = (x: string) => plan.findIndex((e) => e.id === x);

test("the preview's spreads come up when the magazine's do", () => {
  expect(starts).toEqual(resolveFlatplan(audio, lyrics).map((e) => e.start));
});
test('PageDown from the cover lands just after each turn: 8.891, 23.22, 35.758 s; PageUp from 36 goes back to 23.22', () => {
  const seen: number[] = [];
  for (let t = 0, i = 0; i < 3; i++) seen.push((t = spreadJump(at, t, 1)!));
  expect(seen.map((x) => x.toFixed(3))).toEqual(['8.891', '23.220', '35.758']);
  expect(spreadJump(at, 36, -1)).toBeCloseTo(23.22, 9);
});
test('PageDown lands on every spread of the flatplan: verse 2\'s second, the bridge on the drop, and the back cover', () => {
  const seen: number[] = [];
  for (let t: number | undefined = 0; (t = spreadJump(at, t, 1)) !== undefined;) seen.push(t);
  expect(seen.length).toBe(plan.length - 1);
  expect(seen[id('accessories') - 1]).toBeCloseTo(60.233 + 0.6, 9); // its turn (0.55 s) and a moment
  expect(seen[id('whoworeit') - 1]).toBeCloseTo(110.385 + 0.6, 9);
  expect(seen[seen.length - 1]).toBeCloseTo(starts[id('backcover')]! + 0.6, 9);
});
test('a PageUp just after landing goes on to the spread before; at either end there is nowhere to go', () => {
  expect(spreadJump(at, 23.22 + 0.1, -1)).toBeCloseTo(8.891, 9); // not back to 23.22, 0.1 s ago
  expect(spreadJump(at, 8.891, 1)).toBeCloseTo(23.22, 9); // from a target, the next
  expect(spreadJump(at, 0, -1)).toBeUndefined();
  expect(spreadJump(at, at[at.length - 1]!, 1)).toBeUndefined();
  expect(spreadJump(at, 5, -1)).toBe(0); // inside the cover: back to its start
});
test('l loops the spread up: from its start (its turn in) to the next one\'s, the last one to the end of the song', () => {
  const end = audio.duration;
  expect(spreadLoop(starts, 5, end)).toEqual([0, 8.291]); // the cover
  expect(spreadLoop(starts, 10, end)).toEqual([8.291, 22.62]); // verse 1
  expect(spreadLoop(starts, 8.291, end)).toEqual([8.291, 22.62]); // on a turn's downbeat: the spread turned to
  expect(spreadLoop(starts, 8.5, end)).toEqual([8.291, 22.62]); // mid-turn, likewise
  expect(spreadLoop(starts, 22.62 - 1e-6, end)).toEqual([8.291, 22.62]); // just before the next turn: still verse 1
  expect(spreadLoop(starts, 36, end)).toEqual([35.158, 53.069]); // chorus 1
  expect(spreadLoop(starts, 55, end)).toEqual([53.069, starts[id('accessories')]!]); // verse 2's first spread, to its second
  expect(spreadLoop(starts, 164.5, end)).toEqual([164.118, starts[id('backcover')]!]); // the inside back cover, a second
  expect(spreadLoop(starts, 170, end)).toEqual([starts[id('backcover')]!, end]); // the back cover, to the end
  // from where PageDown lands (23.22), the loop starts at the turn in (22.62), not at the landing
  expect(spreadLoop(starts, at[2]!, end)).toEqual([22.62, 35.158]);
});
