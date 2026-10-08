import { expect, test } from 'bun:test';
import { INK_STEPS, MARGIN, PAGE, baseline, columns, inkAt, inkOf, karaokeKey, setRows, subLine, textWidth } from '../src/engine/layout';
import type { Line, Word } from '../src/engine/lyrics';

test('columns fill the text area between the margins', () => {
  const all = columns('R', 0, 12);
  expect(all.x).toBe(MARGIN.inner);
  expect(all.w).toBeCloseTo(textWidth, 9);
  expect(columns('L', 0, 12).x).toBe(MARGIN.outer);
  const r = columns('R', 6, 6);
  expect(r.x + r.w).toBeCloseTo(PAGE.w - MARGIN.outer, 9);
  expect(() => columns('R', 10, 3)).toThrow();
});
test('baselines step from the top margin', () => {
  expect(baseline(0)).toBe(MARGIN.top);
  expect(baseline(2) - baseline(1)).toBe(12);
});
test('ink prints in over the first part of a word', () => {
  expect(inkOf(0)).toBe(0);
  expect(inkOf(0.175)).toBeCloseTo(0.5, 9);
  expect(inkOf(0.35)).toBe(1);
  expect(inkOf(1)).toBe(1);
});
const word = (w: string, start: number, end: number, index: number): Word => ({ w, start, end, conf: 1, line: 0, index, gi: index });
const line: Line = { i: 0, text: 'a b', section: 'x', start: 1, end: 3, words: [word('a', 1, 2, 0), word('b', 2, 3, 1)] };
test('the karaoke key changes only while words print', () => {
  expect(karaokeKey([line], 0)).toBe(karaokeKey([line], 0.9));
  expect(karaokeKey([line], 1.1)).not.toBe(karaokeKey([line], 0.9));
  expect(karaokeKey([line], 3.5)).toBe(karaokeKey([line], 9));
});
const times = Array.from({ length: 3001 }, (_, i) => 0.5 + i * 0.001); // through both words' printing, and past it
test('printed ink comes in INK_STEPS levels within [0, 1]', () => {
  for (const t of times) for (const w of line.words) {
    const k = inkAt(w, t);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThanOrEqual(1);
    expect(k * INK_STEPS).toBe(Math.round(k * INK_STEPS));
  }
  expect(inkAt(line.words[0]!, 1)).toBe(0);
  expect(inkAt(line.words[0]!, 1 + 0.175)).toBe(0.5);
  expect(inkAt(line.words[0]!, 2.5)).toBe(1);
});
test('times with equal karaoke keys print every word with equal ink', () => {
  const byKey = new Map<string, number[]>();
  for (const t of times) {
    const inks = line.words.map((w) => inkAt(w, t));
    const k = karaokeKey([line], t), seen = byKey.get(k);
    if (seen) expect(inks).toEqual(seen);
    else byKey.set(k, inks);
  }
  expect(byKey.size).toBeGreaterThan(INK_STEPS); // the samples do cross many keys
});
test('a sub-line is some of the words, as a line of their own', () => {
  const three: Line = { ...line, text: 'a b, c', words: [word('a', 1, 2, 0), word('b,', 2, 3, 1), word('c', 3, 4, 2)] };
  const s = subLine(three, 1, 3);
  expect(s.text).toBe('b, c');
  expect(s.words).toEqual(three.words.slice(1, 3));
  expect(s.words[0]).toBe(three.words[1]!); // the parent's own words, keeping their indexes in it
  expect(s.section).toBe(three.section);
  expect([s.start, s.end]).toEqual([2, 4]); // sung from its first word's start to its last's end
  expect([subLine(three, 0, 1).start, subLine(three, 0, 1).end]).toEqual([1, 2]);
  expect(karaokeKey([s], 3.1)).toBe(karaokeKey([three], 3.1).slice(1)); // the same words, inking the same ("c" part-way)
  expect(karaokeKey([s], 3.1)).not.toBe(karaokeKey([s], 3.5));
  expect(() => subLine(three, 2, 2)).toThrow(/subLine/);
});
test("setRows checks every row before it prints any: in order, each word once, all of them", () => {
  // (the context is never touched: under bun, printing a row would fail on measuring its text, with no DOM)
  const c = {} as CanvasRenderingContext2D;
  const o = { family: 'x', size: 10 };
  expect(() => setRows(c, line, 0, [{ x: 0, y: 0, words: [1, 2] }], o)).toThrow(/in order/);
  expect(() => setRows(c, line, 0, [{ x: 0, y: 0, words: [0, 0] }], o)).toThrow(/in order/);
  expect(() => setRows(c, line, 0, [{ x: 0, y: 0, words: [0, 1] }, { x: 0, y: 9, words: [0, 2] }], o)).toThrow(/in order/); // the second row
  expect(() => setRows(c, line, 0, [{ x: 0, y: 0, words: [0, 1] }], o)).toThrow(/end at word 1 of 2/); // one short
});
