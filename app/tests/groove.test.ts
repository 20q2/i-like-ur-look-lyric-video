import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AudioData, type AudioJSON } from '../src/engine/audio';
import { GROOVE, GrooveTrack, hitEnv } from '../src/scenes/magazine/groove';
import { FRAME_SPREAD } from '../src/spreads/spread';

/** 120 bpm from 0: beats every 0.5 s, downbeats every 2 s, the drums at `drums` throughout. */
function synth(drums = 1): AudioData {
  const n = 60 * 60, z = new Array(n).fill(0), d = new Array(n).fill(drums);
  return new AudioData({
    duration: 60, bpm: 120, beat_period: 0.5, time_signature: 4, fps: 60,
    beats: Array.from({ length: 121 }, (_, i) => i * 0.5), downbeats: Array.from({ length: 31 }, (_, i) => i * 2),
    sections: [{ name: 'a', start: 0, end: 60 }], onsets: {}, notes: '',
    rms: z, low: z, mid: z, high: z, vocal: z, drums: d, bass: z, other: z,
  } as AudioJSON);
}
/** Like `synth`, but with two pickup beats (0, 0.5) before the first downbeat at 1.0 — the real song's shape
 *  (data/audio.json's beats[0..1] precede its first downbeat too). */
function pickupSynth(): AudioData {
  const n = 60 * 60, z = new Array(n).fill(0), d = new Array(n).fill(1);
  return new AudioData({
    duration: 60, bpm: 120, beat_period: 0.5, time_signature: 4, fps: 60,
    beats: Array.from({ length: 121 }, (_, i) => i * 0.5), downbeats: Array.from({ length: 30 }, (_, i) => 1 + i * 2),
    sections: [{ name: 'a', start: 0, end: 60 }], onsets: {}, notes: '',
    rms: z, low: z, mid: z, high: z, vocal: z, drums: d, bass: z, other: z,
  } as AudioJSON);
}
/** Like `synth`, but the drums step from 0 to 1 at 20 s (a clean edge to measure the energy gate's rise against). */
function stepSynth(): AudioData {
  const n = 60 * 60, z = new Array(n).fill(0);
  const d = Array.from({ length: n }, (_, i) => (i / 60 < 20 ? 0 : 1));
  return new AudioData({
    duration: 60, bpm: 120, beat_period: 0.5, time_signature: 4, fps: 60,
    beats: Array.from({ length: 121 }, (_, i) => i * 0.5), downbeats: Array.from({ length: 31 }, (_, i) => i * 2),
    sections: [{ name: 'a', start: 0, end: 60 }], onsets: {}, notes: '',
    rms: z, low: z, mid: z, high: z, vocal: z, drums: d, bass: z, other: z,
  } as AudioJSON);
}
const P = FRAME_SPREAD;

test('a hit is up in `attack` and mostly gone in 0.3 s', () => {
  expect(hitEnv(-0.01)).toBe(0);
  expect(hitEnv(GROOVE.attack)).toBeCloseTo(1, 9);
  expect(hitEnv(0.3)).toBeLessThan(0.2);
});
test('order-independent: a forward sweep, a reverse sweep and a fresh instance agree (sub-frames render out of time order, engine.ts)', () => {
  const times = [4.1, 7.77, 10, 20.25, 33.3];
  const g = new GrooveTrack(synth(), 4);
  const forward = times.map((t) => g.apply(P, t));
  const backward = [...times].reverse().map((t) => g.apply(P, t));
  backward.reverse(); // back to `times`' order, for a direct comparison with `forward`
  const fresh = times.map((t) => new GrooveTrack(synth(), 4).apply(P, t));
  expect(backward).toEqual(forward);
  expect(fresh).toEqual(forward);
});
test('still before `from`, and with amount 0', () => {
  const g = new GrooveTrack(synth(), 10);
  for (const t of [0, 5, 9.99]) expect(g.apply(P, t)).toEqual(P);
  expect(new GrooveTrack(synth(), 0, { ...GROOVE, amount: 0 }).apply(P, 12.3)).toEqual(P);
});
test('still when the drums are silent', () => {
  const g = new GrooveTrack(synth(0), 0);
  for (const t of [3, 12.05, 40.5]) expect(g.apply(P, t)).toEqual(P);
});
test('it fades in over a beat after `from`', () => {
  const g = new GrooveTrack(synth(), 10);
  expect(g.energy(10)).toBe(0);
  expect(g.energy(10.25)).toBeGreaterThan(0.4);
  expect(g.energy(10.25)).toBeLessThan(0.6);
  expect(g.energy(11)).toBeCloseTo(1, 6);
});
test('the energy gate rises across a beat-wide window centred on a change in the drums, not a trailing one', () => {
  const g = new GrooveTrack(stepSynth(), 0);
  expect(g.energy(19.6)).toBe(0); // well before the step at 20 s, outside the centred window
  const mid = g.energy(19.8); // inside the window, partway through the rise
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(0.5);
  expect(g.energy(20.25)).toBeCloseTo(1, 6); // half a beat after: the window is past the step, fully gated open
});
test('a punch on every beat: closest just after each beat, the downbeats closest of all', () => {
  const g = new GrooveTrack(synth(), 0);
  const after = (b: number) => g.apply(P, b + GROOVE.attack).dist;
  const between = (b: number) => g.apply(P, b + 0.45).dist;
  for (const b of [20.5, 21, 21.5]) expect(after(b)).toBeLessThan(between(b)); // off-beats: in after the hit
  expect(after(22)).toBeLessThan(after(21)); // the downbeat (22) punches harder than beat 3 of the bar
});
test('a pickup before the first downbeat counts backward from it, not forward from the beat grid', () => {
  // the beat at 0.5 is the beat just before the downbeat at 1.0: beat 4 of the bar before it (k = 3, rocks negative).
  // The old numbering gave it k = 2 (beat 3, which doesn't rock).
  const g = new GrooveTrack(pickupSynth(), 0, { ...GROOVE, swayRoll: 0 });
  const roll = g.apply(P, 0.5 + GROOVE.attack).roll;
  expect(roll).toBeLessThan(0);
  expect(roll).toBeCloseTo(-GROOVE.rock * hitEnv(GROOVE.attack), 6);
});
test('the backbeat rocks: one way on beat 2, the other on beat 4', () => {
  const g = new GrooveTrack(synth(), 0, { ...GROOVE, swayRoll: 0 }); // isolate the rock from the sway's own roll
  expect(g.apply(P, 20.5 + GROOVE.attack).roll).toBeGreaterThan(0); // beat 2 (k = 1)
  expect(g.apply(P, 21.5 + GROOVE.attack).roll).toBeLessThan(0); // beat 4 (k = 3)
  // beats 1 and 3 (k = 0, 2) don't themselves rock; what's left over is the decayed tail of the neighbouring backbeat
  expect(Math.abs(g.apply(P, 21 + GROOVE.attack).roll)).toBeLessThan(0.002);
  expect(Math.abs(g.apply(P, 22 + GROOVE.attack).roll)).toBeLessThan(0.002);
});
test('bounded: within 7% closer, 0.012 of y, 0.07 rad of tilt, 0.03 rad of roll and 0.005 sideways, over a minute', () => {
  const g = new GrooveTrack(synth(), 0);
  for (let t = 0; t < 60; t += 1 / 60) {
    const q = g.apply(P, t);
    expect(q.dist / P.dist).toBeGreaterThan(0.93);
    expect(q.dist / P.dist).toBeLessThanOrEqual(1);
    expect(Math.abs(q.y - P.y)).toBeLessThan(0.012);
    expect(Math.abs(q.tilt - P.tilt)).toBeLessThan(0.07);
    expect(Math.abs(q.roll - P.roll)).toBeLessThan(0.03);
    expect(Math.abs(q.x - P.x)).toBeLessThan(0.005);
  }
});
test('on the song: still through the cover, moving with the beat from verse 1', () => {
  const audio = new AudioData(JSON.parse(readFileSync(path.join(import.meta.dir, '../../data/audio.json'), 'utf8')));
  const from = audio.sections[1]!.start, g = new GrooveTrack(audio, from);
  for (let t = 0; t < from; t += 0.05) expect(g.apply(P, t)).toEqual(P);
  let moved = 0;
  for (let t = 40; t < 50; t += 1 / 60) if (Math.abs(g.apply(P, t).dist - P.dist) > 1e-4) moved++;
  expect(moved).toBeGreaterThan(300); // most of chorus 1's frames
});
test('on the song: the gate holds at (near) full strength through most of chorus 1', () => {
  const audio = new AudioData(JSON.parse(readFileSync(path.join(import.meta.dir, '../../data/audio.json'), 'utf8')));
  const from = audio.sections[1]!.start, g = new GrooveTrack(audio, from);
  let full = 0, total = 0;
  for (let t = 40; t < 50; t += 1 / 60) { total++; if (g.energy(t) >= 0.9) full++; }
  expect(full / total).toBeGreaterThanOrEqual(0.9);
});

test('calm while a line is sung: the groove drops to `reading`, full again in the gaps', () => {
  // 120 bpm: a beat is 0.5 s. Lines 20–24 and 24.5–26 (a half-beat gap: merged), then 40–42 (a long gap before it).
  const sung = [{ start: 20, end: 24 }, { start: 24.5, end: 26 }, { start: 40, end: 42 }];
  const g = new GrooveTrack(synth(), 4, GROOVE, sung);
  expect(g.energy(15)).toBeCloseTo(1, 6); // nobody singing
  expect(g.energy(22)).toBeCloseTo(GROOVE.reading, 6); // mid-line
  expect(g.energy(24.25)).toBeCloseTo(GROOVE.reading, 6); // the short gap between two lines stays calm
  expect(g.energy(33)).toBeCloseTo(1, 6); // a long gap: full bounce
  expect(g.energy(19.75)).toBeGreaterThan(GROOVE.reading); // easing in over the beat before the line…
  expect(g.energy(19.75)).toBeLessThan(1);
  expect(g.energy(20)).toBeCloseTo(GROOVE.reading, 6); // …calm by its first word
  expect(g.energy(26.25)).toBeGreaterThan(GROOVE.reading); // easing out after it ends
  expect(g.energy(26.5)).toBeCloseTo(1, 6);
  // the punch itself is scaled: a hit mid-line moves the camera `reading` times as far as one in a gap
  const hit = (b: number) => P.dist - g.apply(P, b + GROOVE.attack).dist;
  expect(hit(22) / hit(32)).toBeCloseTo(GROOVE.reading, 2); // both downbeats
});
test('calming is continuous in t (a motion-blurred frame never averages a jump)', () => {
  const g = new GrooveTrack(synth(), 4, GROOVE, [{ start: 20, end: 24 }]);
  let worst = 0;
  for (let t = 18; t < 26; t += 1 / 600) worst = Math.max(worst, Math.abs(g.energy(t + 1 / 600) - g.energy(t)));
  expect(worst).toBeLessThan(0.01);
});
