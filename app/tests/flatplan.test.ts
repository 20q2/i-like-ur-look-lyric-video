import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData } from '../src/engine/audio';
import { Lyrics } from '../src/engine/lyrics';
import { LEAVES } from '../src/engine/page';
import { CAM_BLEND_S } from '../src/scenes/magazine/schedule';
import { type Entry, FLATPLAN, resolveFlatplan, spreadCtx, timeFlatplan } from '../src/spreads/flatplan';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json')), lyrics = new Lyrics(data('lyrics.json'));
const plan = resolveFlatplan(audio, lyrics);
const ix = (id: string) => plan.findIndex((e) => e.id === id);
/** FLATPLAN with entry `id` changed (or removed: null). */
const edit = (id: string, f: (e: Entry) => Entry | null): Entry[] => FLATPLAN.flatMap((e) => (e.id !== id ? [e] : f(e) ?? []));

test('the spreads come up by rule (spec §2): sections, the downbeat on "you\'re", a bar before the bridge, two beats into the outro', () => {
  // (the back cover is the beat 2 beats after 164.118: 165.013 in the data; the spec's 164.118 + 2 × 0.448 is 165.014)
  const want = [0, 8.291, 22.62, 35.158, 53.069, 60.233, 67.398, 79.936, 96.056, 110.385, 133.669, 149.789, 164.118, 165.013];
  expect(plan.map((e) => e.id)).toEqual(FLATPLAN.map((e) => e.id));
  expect(plan.length).toBe(want.length);
  plan.forEach((e, i) => expect(Math.abs(e.start - want[i]!)).toBeLessThan(1e-3));
  // the rules, not the numbers: the accessories' turn is a downbeat, at or after "you're", within a bar of it
  const youre = lyrics.get('already on a leash').words[1]!, acc = plan[ix('accessories')]!.start;
  expect(audio.downbeats).toContain(acc);
  expect(acc).toBeGreaterThanOrEqual(youre.start);
  expect(acc - youre.start).toBeLessThan(60 / audio.bpm * 4);
  // the bridge's comes up on the drop, the downbeat a bar before its section; the back cover two beats after the outro's
  const bridge = audio.sections.find((s) => s.name === 'bridge1')!.start, d = audio.downbeats.indexOf(bridge);
  expect(plan[ix('whoworeit')]!.start).toBe(audio.downbeats[d - 1]!);
  expect(audio.beatAt(plan[ix('backcover')]!.start) - audio.beatAt(plan[ix('insideback')]!.start)).toBeCloseTo(2, 9);
});
test('the rules follow the data: "you\'re" sung later moves the accessories\' turn to the downbeat after it', () => {
  const l = data('lyrics.json'), line = l.lines.find((x: { text: string }) => x.text.includes('already on a leash'));
  line.words[1].start = 61.0;
  const moved = resolveFlatplan(audio, new Lyrics(l))[ix('accessories')]!.start;
  expect(moved).toBe(audio.downbeats.find((x) => x >= 61)!);
  expect(moved).toBeGreaterThan(61);
});
test('each spread after the cover turns, but the ransom note rips', () => {
  expect(plan.map((e) => e.how)).toEqual(plan.map((e, i) => (i === 0 ? null : e.id === 'ransom' ? 'rip' : 'turn')));
});
test('the leaves: a turn moves the right page over, the rip tears it out, the last turn closes the magazine', () => {
  const leaves = plan.map((e) => `${e.left}/${e.right}`);
  expect(leaves).toEqual(['null/0', '0/1', '1/2', '2/3', '3/4', '4/5', '5/6', '6/7', '7/8', '8/9', '8/10', '10/11', '11/12', '12/null']);
  // 13 leaves until the rip, 12 from it on; the left pile grows a leaf a turn
  expect(LEAVES).toBe(13);
  expect(plan.map((e) => e.n)).toEqual(plan.map((_, i) => (i < ix('ransom') ? 13 : 12)));
  expect(plan.map((e) => e.onLeft)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12]);
  // closed at the back: every leaf left on the left pile, no right page (the plan's "onLeft 13" can't be: the rip took
  // one of the 13 out)
  const last = plan[plan.length - 1]!;
  expect(last.right).toBeNull();
  expect(last.onLeft).toBe(last.n);
  expect(last.left).toBe(LEAVES - 1); // the back cover: the last leaf's back
  for (const e of plan) expect(e.onLeft).toBeLessThanOrEqual(e.n);
});
test("the spreads' ctx: pages from the leaves (the rip skips 19-20), the next spread's start as the turn out, none for the last", () => {
  const pages = plan.map((_, i) => spreadCtx(audio, lyrics, plan, i).pages.join('-'));
  expect(pages).toEqual(['0-1', '2-3', '4-5', '6-7', '8-9', '10-11', '12-13', '14-15', '16-17', '18-19', '18-21', '22-23', '24-25', '26-0']);
  // the cover's lines stay true: "HOW TO BE SEEN, P. 2" is Get the Look's left page, "HIM, WORN WELL — P. 6" the Cover Story's
  expect(spreadCtx(audio, lyrics, plan, ix('getthelook')).pages[0]).toBe(2);
  expect(spreadCtx(audio, lyrics, plan, ix('coverstory')).pages[0]).toBe(6);
  plan.forEach((e, i) => {
    const c = spreadCtx(audio, lyrics, plan, i);
    expect(c).toMatchObject({ id: e.id, section: e.section, start: e.start, leaves: { left: e.left, right: e.right } });
    expect(c.turnAt).toBe(plan[i + 1]?.start);
  });
  expect(spreadCtx(audio, lyrics, plan, plan.length - 1).turnAt).toBeUndefined();
});
test('timeFlatplan times the plan as resolveFlatplan does, without its checks', () => {
  expect(timeFlatplan(audio, lyrics)).toEqual(plan.map(({ id, section, start, how }) => ({ id, section, start, how })));
  const swapped = [...FLATPLAN.slice(0, 4), FLATPLAN[5]!, FLATPLAN[4]!, ...FLATPLAN.slice(6)]; // out of order
  expect(() => timeFlatplan(audio, lyrics, swapped)).not.toThrow();
  expect(() => resolveFlatplan(audio, lyrics, swapped)).toThrow(/flatplan: perfume \(entry 5\): starts at 53\.069, not after accessories \(60\.233\)/);
});

test('a plan out of order throws, naming the entry', () => {
  // a section's spread twice: the same start
  const twice = [...FLATPLAN.slice(0, 5), { id: 'perfume2', section: 'verse2', at: { section: 'verse2' } }, ...FLATPLAN.slice(5)];
  expect(() => resolveFlatplan(audio, lyrics, twice)).toThrow(/flatplan: perfume2 \(entry 5\): starts at 53\.069, not after perfume \(53\.069\)/);
});
test('page turns closer than the camera\'s move throw; CAM_BLEND_S apart is fine; the cover\'s start is no turn', () => {
  // the back cover a beat after the inside back cover (0.448 s): too close; two beats (0.896 s) is the plan
  expect(60 / audio.bpm).toBeLessThan(CAM_BLEND_S);
  expect(() => resolveFlatplan(audio, lyrics, edit('backcover', (e) => ({ ...e, at: { beatsAfterPrev: 1 } })))).toThrow(/flatplan: backcover \(entry 13\): its turn at 164\.56\d+ is closer to insideback's at 164\.118 than CAM_BLEND_S/);
  // the first spread may come up at once: the cover's start is none
  const early = edit('getthelook', (e) => ({ ...e, at: { beatsAfterPrev: 0.1 } }));
  expect(resolveFlatplan(audio, lyrics, early)[1]!.start).toBeLessThan(0.1);
});
test('an unknown section, line or word throws, naming the entry', () => {
  expect(() => resolveFlatplan(audio, lyrics, edit('perfume', (e) => ({ ...e, section: 'verse9' })))).toThrow(/flatplan: perfume \(entry 4\): no section "verse9"/);
  expect(() => resolveFlatplan(audio, lyrics, edit('perfume', (e) => ({ ...e, at: { section: 'verse9' } })))).toThrow(/flatplan: perfume \(entry 4\): no section "verse9"/);
  expect(() => resolveFlatplan(audio, lyrics, edit('whoworeit', (e) => ({ ...e, at: { barBefore: 'bridge9' } })))).toThrow(/flatplan: whoworeit \(entry 9\): no section "bridge9"/);
  const leash = (line: string, word: number, section = 'verse2') => edit('accessories', (e) => ({ ...e, at: { downbeatAtOrAfter: { section, line, word } } }));
  expect(() => resolveFlatplan(audio, lyrics, leash('already on a lead', 1))).toThrow(/flatplan: accessories \(entry 5\): no line of verse2 contains "already on a lead"/);
  expect(() => resolveFlatplan(audio, lyrics, leash('already on a leash', 6))).toThrow(/flatplan: accessories \(entry 5\): "But you’re already on a leash" has no word 6 \(its words are 0–5\)/);
  expect(() => resolveFlatplan(audio, lyrics, leash('already on a leash', 1, 'chorus1'))).toThrow(/flatplan: accessories \(entry 5\): no line of chorus1 contains/);
});
test('a turn past the back cover throws: the magazine is closed', () => {
  const after = [...FLATPLAN, { id: 'more', section: 'outro1', at: { beatsAfterPrev: 4 } }];
  expect(() => resolveFlatplan(audio, lyrics, after)).toThrow(/flatplan: more \(entry 14\): there is no right page to turn: backcover closed the magazine/);
});
test('the first entry is the closed magazine: it has no how, and no rule after nothing', () => {
  expect(() => resolveFlatplan(audio, lyrics, edit('cover', (e) => ({ ...e, how: 'turn' })))).toThrow(/flatplan: cover \(entry 0\): the first entry is the closed magazine, up from the start, which takes no `how` \(this one has 'turn'\)/);
  expect(() => resolveFlatplan(audio, lyrics, edit('cover', (e) => ({ ...e, at: { beatsAfterPrev: 2 } })))).toThrow(/flatplan: cover \(entry 0\): beatsAfterPrev: there is no previous entry/);
});
test('an id used twice throws: the registry keys the modules by it', () => {
  const twice = edit('corrections', (e) => ({ ...e, id: 'perfume' }));
  expect(() => resolveFlatplan(audio, lyrics, twice)).toThrow(/flatplan: perfume \(entry 6\): entry 4 has this id too/);
});
test('the flatplan is frozen', () => {
  expect(Object.isFrozen(FLATPLAN)).toBe(true);
  for (const e of FLATPLAN) expect(Object.isFrozen(e)).toBe(true);
});
