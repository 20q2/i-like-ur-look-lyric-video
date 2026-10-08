import { expect, test } from 'bun:test';
import { type Face, KeyTrack, type LayerSource, RASTER_TOL, checkLayer, faceDelta, faceDiff, keyPair } from '../src/keycheck';

/** A face of n pixels, `width` a row, all [r, g, b, a]. */
const face = (px: readonly number[], n = 4, width = 2): Face => ({ data: Uint8ClampedArray.from({ length: 4 * n }, (_, i) => px[i % 4]!), width });
const ink = (v: number) => face([v, v, v, 255]);

test('faces are compared premultiplied: noise in a nearly transparent pixel is nothing, a level of ink is a level', () => {
  expect(faceDiff(face([20, 20, 20, 255]), face([20, 20, 20, 255]))).toBe(0);
  expect(faceDiff(face([20, 20, 20, 255]), face([23, 20, 20, 255]))).toBe(3);
  expect(faceDiff(face([20, 20, 20, 40]), face([20, 20, 20, 53]))).toBe(13); // a ghost's alpha up an ink step
  // alpha 1: unpremultiplied red and blue, stored as all but nothing
  expect(faceDiff(face([255, 0, 0, 1]), face([0, 0, 255, 1]))).toBeLessThanOrEqual(1);
  expect(() => faceDiff(face([0, 0, 0, 0], 2), face([0, 0, 0, 0], 3))).toThrow();
});
test('faceDelta boxes the pixels that differ by more than the tolerance, wherever they are', () => {
  const a = face([20, 20, 20, 255], 12, 4), b = { ...a, data: a.data.slice() };
  b.data[4 * 9 + 1] = 90; // pixel 9 of a 4-wide face: x 1, y 2
  b.data[4 * 2 + 0] = 21; // a level of noise at x 2, y 0: under the tolerance, outside the box
  expect(faceDelta(a, b)).toEqual({ d: 70, box: [1, 2, 1, 2] });
  expect(faceDelta(a, a)).toEqual({ d: 0, box: null });
});
test('two keys are shown from where they part', () => {
  const a = `${'g'.repeat(40)}3${'0'.repeat(60)}`, b = `${'g'.repeat(40)}4${'0'.repeat(60)}`;
  expect(keyPair(a, b)).toBe(`"…${'g'.repeat(12)}3${'0'.repeat(27)}…", then "…${'g'.repeat(12)}4${'0'.repeat(27)}…" (they part at character 40)`);
  expect(keyPair('a', 'b')).toBe('"a", then "b"');
});

/** Feeds a track samples at 1/15 s: [key, ink level] pairs; a key that comes up again is repainted from its samples. */
function track(samples: readonly (readonly [string, number])[], pxPerPu = 1) {
  const k = new KeyTrack('test R print', pxPerPu), at = new Map<number, Face>();
  samples.forEach(([key, v], i) => { const f = ink(v); at.set(i / 15, f); k.sample(i / 15, key, f, (t) => at.get(t)!); });
  return k.finish();
}

test('a key that changes with its face passes, and so does noise under one key', () => {
  const k = track([['a', 10], ['a', 10], ['b', 23], ['b', 23 + RASTER_TOL], ['c', 36], ['c', 36]]);
  expect(k.fails).toEqual([]);
  expect(k.warns).toEqual([]);
});
test('a stale key fails once per run, naming its span; a new key over the same pixels warns', () => {
  const k = track([['a', 10], ['a', 10], ['a', 23], ['a', 36], ['b', 49], ['c', 49]]);
  expect(k.fails).toEqual([expect.stringMatching(/key "a" from t=0\.000 to 0\.200, but the face changed under it — up to 26 levels .*at pu x 0–2, y 0–2 \(first at t=0\.133, 2 samples\)/)]);
  expect(k.warns).toEqual([expect.stringMatching(/new key at t=0\.333, same pixels: "b", then "c"/)]);
});
test("each face is measured against its key's drawing: a face creeping a level a sample fails", () => {
  // consecutive samples never differ by more than a level, but the scene would still be showing the first
  expect(track([['a', 10], ['a', 11], ['a', 12], ['a', 13], ['a', 14]]).fails).toEqual([expect.stringMatching(/up to 4 levels .*first at t=0\.200/)]);
});
test('a key that comes back must bring back its face: A, A, B, A, A with the second A another face fails', () => {
  const k = track([['A', 10], ['A', 10], ['B', 23], ['A', 36], ['A', 36]]);
  expect(k.fails).toEqual([expect.stringMatching(/key "A" came up again at t=0\.200 with another face than at t=0\.000, when it first came up: up to 26 levels/)]);
  // and one that does bring it back passes
  expect(track([['A', 10], ['A', 10], ['B', 23], ['A', 10], ['A', 10]]).fails).toEqual([]);
});
test('a key or a face that is not a pure function of t fails', () => {
  const k = new KeyTrack('test L marks');
  k.twice(1, 'a', 'a', ink(1), ink(1)); // pure
  expect(k.finish().fails).toEqual([]);
  k.twice(1, 'a', 'b', ink(1), ink(1));
  k.twice(2, 'a', 'a', ink(1), ink(9));
  expect(k.finish().fails).toEqual([expect.stringMatching(/not a pure function of t — at t=1\.000: the key is "a", then "b" \(2 samples\)/)]);
});

// ---- the driver, on layers whose key and ink are functions of t, sampled every 1/15 s ----
const layer = (key: (t: number) => string, level: (t: number) => number, t1 = 0.6): LayerSource => ({ key, paint: (t) => ink(level(t)), t0: 0, t1, step: 1 / 15 });

test('the driver passes a layer drawn exactly as its key says', () => {
  const q = (t: number) => Math.floor(t / 0.01); // a key quantised every 10 ms, the face drawn from the same quantum
  const r = checkLayer('ok', layer((t) => String(q(t)), (t) => 10 + q(t)));
  expect(r).toEqual({ fails: [], warns: [], samples: 9, probes: expect.any(Number) });
  expect(r.probes).toBeGreaterThan(0);
});
test('the driver fails a key that comes back with another face (A, B, A)', () => {
  const r = checkLayer('aba', layer((t) => (t < 0.1 || t >= 0.17 ? 'A' : 'B'), (t) => (t < 0.1 ? 10 : t < 0.17 ? 23 : 36), 0.3));
  expect(r.fails).toEqual([expect.stringMatching(/key "A" came up again at t=0\.200 with another face than at t=0\.000/)]);
});
test('the driver fails a face creeping under one key', () => {
  const r = checkLayer('creep', layer(() => 'A', (t) => 10 + Math.round(t * 15)));
  expect(r.fails).toEqual([expect.stringMatching(/key "A" from t=0\.000 to 0\.533, .*up to 8 levels .*first at t=0\.200, 6 samples/)]);
});
test('a probe after a key change catches a face drawn from the exact value under a quantised key', () => {
  // the key steps every 10 ms, the face moves continuously: under every key a step apart, two faces
  const src = layer((t) => String(Math.floor(t / 0.01)), (t) => 10 + Math.round(t * 1000), 0.2);
  expect(checkLayer('exact', src, { probes: [], back: false }).fails).toEqual([]); // the samples alone: every key new
  const r = checkLayer('exact', src, { back: false });
  expect(r.fails.length).toBe(2);
  expect(r.fails[0]).toMatch(/key "0" from t=0\.000 to 0\.004, .*up to 4 levels .*first at t=0\.004/);
});
test('the backward probe catches a face that changes ahead of its key', () => {
  // the face changes at 0.515, its key at 0.52: the samples either side (0.467, 0.533) agree with their keys
  const src = layer((t) => (t < 0.52 ? 'A' : 'B'), (t) => (t < 0.515 ? 10 : 40));
  expect(checkLayer('ahead', src, { back: false }).fails).toEqual([]);
  expect(checkLayer('ahead', src).fails).toEqual([expect.stringMatching(/key "A" from t=0\.000 to 0\.520, but the face changed under it — up to 30 levels .*first at t=0\.520, 1 sample\)/)]);
});
test('a key or a paint that throws ends the layer as a failure, saying when', () => {
  const r = checkLayer('throws', { ...layer(() => 'A', () => 10), paint: (t) => { if (t > 0.3) throw new Error('boom'); return ink(10); } });
  expect(r.fails).toEqual([expect.stringMatching(/^throws: threw at t=0\.3333: Error: boom/)]);
});
