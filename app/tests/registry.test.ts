import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData } from '../src/engine/audio';
import { Lyrics } from '../src/engine/lyrics';
import { FLATPLAN, resolveFlatplan, spreadCtx } from '../src/spreads/flatplan';
import { SPREADS, makeSpreads, placeholderLines } from '../src/spreads/registry';
import { turnOut } from '../src/spreads/spread';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json')), lyrics = new Lyrics(data('lyrics.json'));
const plan = resolveFlatplan(audio, lyrics);
const ix = (id: string) => plan.findIndex((e) => e.id === id);

test("one spread per entry of the flatplan, in its order, the cover first, each its entry's module or placeholder, built without a DOM", () => {
  const s = makeSpreads(audio, lyrics);
  expect(s.length).toBe(plan.length);
  expect(s[0]!.id).toBe('cover');
  expect(s[0]!.lamp).toBeDefined(); // (the cover itself, its lamp coming on and all)
  s.forEach((sp, i) => expect(sp.section).toBe(plan[i]!.section));
  s.forEach((sp, i) => expect([plan[i]!.id, `placeholder-${plan[i]!.id}`]).toContain(sp.id));
  expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
  // the folios follow the leaves (flatplan.ts spreadCtx): after the rip, pp. 18 and 21; the back cover has no right page
  expect(s.map((sp) => sp.pages.join('-'))).toEqual(['0-1', '2-3', '4-5', '6-7', '8-9', '10-11', '12-13', '14-15', '16-17', '18-19', '18-21', '22-23', '24-25', '26-0']);
});
test('the registry is keyed by the flatplan\'s ids', () => {
  const ids = new Set(FLATPLAN.map((e) => e.id));
  for (const k of Object.keys(SPREADS)) expect(ids.has(k)).toBe(true);
});
test('the last spread has no turn out of it; every other one does', () => {
  plan.forEach((e, i) => {
    const c = spreadCtx(audio, lyrics, plan, i);
    if (i + 1 < plan.length) expect(turnOut(c)).toBe(plan[i + 1]!.start);
    else expect(() => turnOut(c)).toThrow(/backcover: nothing turns away from it/);
  });
});
test("placeholders split a section's lines between its spreads (verse 2's at \"But you're\"), every line on one spread", () => {
  const lines = (id: string) => placeholderLines(lyrics, plan, ix(id)).map((l) => l.text);
  expect(lines('perfume')).toEqual(['I want you to dress just for me', 'Your Acqua Di Gio on my sheets']);
  expect(lines('accessories')).toEqual(['But you’re already on a leash', 'So that’s unfortunate for me, baby']);
  expect(lines('insideback')).toEqual([]); // seen for a second, between the close's two flops
  expect(lines('backcover')).toEqual(['Yeah']);
  expect(lines('whoworeit')).toHaveLength(5); // (the bridge's, though it comes up during the post-chorus)
  const all = plan.flatMap((_, i) => placeholderLines(lyrics, plan, i).map((l) => l.i));
  expect(all.sort((a, b) => a - b)).toEqual(lyrics.lines.map((l) => l.i));
});
test("a lyric line tagged with a section the song doesn't have is an error, not an emptied placeholder", () => {
  const l = data('lyrics.json');
  l.lines[5].section = 'verse9';
  expect(() => makeSpreads(audio, new Lyrics(l))).toThrow(/tagged "verse9", which is not an audio section/);
});
test('a lyric line in a section no spread prints is an error', () => {
  const without = resolveFlatplan(audio, lyrics, FLATPLAN.filter((e) => e.section !== 'chorus2'));
  expect(() => makeSpreads(audio, lyrics, without)).toThrow(/"’Cause I like your look, it’s so extreme"\) is in chorus2, which no spread of the flatplan prints/);
});
test("an entry named like one of Object's own methods still gets a placeholder (the registry's own entries only)", () => {
  const renamed = resolveFlatplan(audio, lyrics, FLATPLAN.map((e) => (e.id === 'perfume' ? { ...e, id: 'toString' } : e)));
  const s = makeSpreads(audio, lyrics, renamed);
  expect(s[4]!.id).toBe('placeholder-toString');
  expect(s[4]!.pages).toEqual([8, 9]);
});
