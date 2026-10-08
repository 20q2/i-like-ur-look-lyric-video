import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData, type AudioJSON } from '../src/engine/audio';
import { inkAt } from '../src/engine/layout';
import { Lyrics } from '../src/engine/lyrics';
import { inkedAt, kicksAcross, onKicks, sectionLine } from '../src/spreads/cues';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const audio = new AudioData(data('audio.json')), lyrics = new Lyrics(data('lyrics.json'));

test('sectionLine finds a line in its own section (the chorus repeats), however its quotes and commas are typed', () => {
  const a = sectionLine(lyrics, 'chorus1', 'I like your look'), b = sectionLine(lyrics, 'chorus2', 'I like your look');
  expect(a.section).toBe('chorus1');
  expect(b.section).toBe('chorus2');
  expect(a.i).not.toBe(b.i);
  expect(sectionLine(lyrics, 'verse1', "'cause I'm a doll").words.length).toBe(8); // typed quotes; the data's are curly
  expect(sectionLine(lyrics, 'verse1', 'hair all tall baby').text).toContain('tall,');
  expect(() => sectionLine(lyrics, 'verse1', 'so extreme')).toThrow(/verse1/);
  expect(() => sectionLine(lyrics, 'verse1', '...')).toThrow();
});
test('sectionLine refuses text that more than one line of the section has, and names them', () => {
  // ("I wear my" begins verse 1's first and third lines)
  expect(() => sectionLine(lyrics, 'verse1', 'I wear my')).toThrow(/2 lines of verse1 .*patent leather boots.*blush/);
  expect(sectionLine(lyrics, 'verse1', 'I wear my blush').words[3]!.w).toBe('blush');
});
test('onKicks: n cues in [from, to), in order, the kicks there first, the rest spread out after them', () => {
  const from = 9, to = 12, kicks = audio.events('kick', from, to).map(([t]) => t);
  expect(kicks.length).toBeGreaterThan(2);
  expect(onKicks(audio, 2, from, to)).toEqual(kicks.slice(0, 2));
  const at = onKicks(audio, kicks.length + 3, from, to);
  expect(at.length).toBe(kicks.length + 3);
  expect(at.slice(0, kicks.length)).toEqual(kicks);
  for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!);
  expect(at[at.length - 1]!).toBeLessThan(to);
  expect(onKicks(audio, 3, 300, 301)).toEqual([300.25, 300.5, 300.75]); // no kicks (past the song): evenly from `from`
});
/** A song with only these kicks (strength 1): enough AudioData for cue-finding. */
const withKicks = (kicks: number[]) => new AudioData({
  duration: 10, bpm: 120, beat_period: 0.5, time_signature: 4, fps: 60, beats: [], downbeats: [], sections: [], notes: '',
  onsets: { kick: kicks.map((t) => [t, 1] as [number, number]) }, rms: [], low: [], mid: [], high: [], vocal: [], drums: [], bass: [], other: [],
} as AudioJSON);
test('kicksAcross: the k-th cue is the first kick in the k-th of n even slots, else the slot itself, in order', () => {
  // slots [0, .25) [.25, .5) [.5, .75) [.75, 1): the first kick in each (0.15 is passed over: a cue a slot), the even
  // time where a slot has none (0.9 lies past the second and third slots' ends), and nothing taken twice
  expect(kicksAcross(withKicks([0.1, 0.15, 0.9]), 4, 0, 1)).toEqual([0.1, 0.25, 0.5, 0.9]);
  // a kick on a slot's start is that slot's (at or after); one at the window's end is past it ([from, to))
  expect(kicksAcross(withKicks([0.5, 1]), 2, 0, 1)).toEqual([0, 0.5]);
  expect(kicksAcross(withKicks([]), 3, 300, 301)).toEqual([300, 300 + 1 / 3, 300 + 2 / 3]); // no kicks: the even times
  expect(kicksAcross(withKicks([0.2]), 0, 0, 1)).toEqual([]);
  expect(() => kicksAcross(withKicks([]), 2, 1, 1)).toThrow(/empty window/);
  expect(() => kicksAcross(withKicks([]), 1.5, 0, 1)).toThrow(/whole number/);
});
test('kicksAcross spreads a drawing across its words where onKicks bunches it at the start (verse 1: the boot)', () => {
  const l = sectionLine(lyrics, 'verse1', 'patent leather boots'), from = l.words[3]!.start, to = l.end, n = 4;
  const across = kicksAcross(audio, n, from, to), first = onKicks(audio, n, from, to);
  const kicks = new Set(audio.events('kick', from, to).map(([t]) => t));
  for (let k = 0; k < n; k++) {
    const slot = from + (k * (to - from)) / n, next = from + ((k + 1) * (to - from)) / n;
    expect(kicks.has(across[k]!)).toBe(true); // a kick in each slot, here
    expect(across[k]!).toBeGreaterThanOrEqual(slot);
    expect(across[k]!).toBeLessThan(next);
  }
  // the last group starts in "boots", the line's last word; onKicks has all four in "patent", inside 0.7 s
  expect(across[n - 1]!).toBeGreaterThanOrEqual(l.words[5]!.start);
  expect(first[n - 1]! - first[0]!).toBeLessThan(0.8);
  expect(first[n - 1]!).toBeLessThan(l.words[3]!.end);
});
test('inkedAt is the first moment a word prints at full ink', () => {
  for (const w of sectionLine(lyrics, 'verse1', 'patent leather boots').words) {
    const t = inkedAt(w);
    expect(inkAt(w, t)).toBe(1);
    expect(inkAt(w, t - 1e-6)).toBeLessThan(1);
    expect(t).toBeGreaterThan(w.start);
    expect(t).toBeLessThanOrEqual(w.end);
  }
  // a word with no length never inks within its span (inkAt is 0 at its end): an error, not a cue that never prints
  const w = sectionLine(lyrics, 'verse1', 'patent leather boots').words[5]!;
  expect(() => inkedAt({ ...w, end: w.start })).toThrow(/never reaches full ink/);
});
