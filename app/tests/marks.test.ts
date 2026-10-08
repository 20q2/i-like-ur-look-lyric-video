import { expect, test } from 'bun:test';
import { charTimes, loopAround } from '../src/spreads/marks';

test("a lipstick loop goes round its box, outside the box's inscribed ellipse, and past where it started", () => {
  const box = [100, 200, 300, 260] as const;
  const pts = loopAround(box, 3);
  const cx = 200, cy = 230;
  let turned = 0;
  for (let i = 1; i < pts.length; i++) {
    const a0 = Math.atan2(pts[i - 1]!.y - cy, pts[i - 1]!.x - cx), a1 = Math.atan2(pts[i]!.y - cy, pts[i]!.x - cx);
    let d = a1 - a0; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
  }
  expect(Math.abs(turned) / (2 * Math.PI)).toBeGreaterThan(1.05); // past its start: the overlap
  for (const p of pts) expect(((p.x - cx) / 100) ** 2 + ((p.y - cy) / 30) ** 2).toBeGreaterThan(1); // outside the box's ellipse
  expect(loopAround(box, 3)).toEqual(pts); // deterministic
  expect(loopAround(box, 4)).not.toEqual(pts); // seeded
});
test("a loop stays outside its box's inscribed ellipse at any aspect, wide or tall, for any seed", () => {
  // (the tilt is held back on flat boxes: at ±0.125 rad a 40:1 box's loop cut deep inside its ellipse)
  const aspects = [...Array.from({ length: 20 }, (_, i) => i + 1), 1.5, 4.25];
  let worst = Infinity, at = '';
  for (const rho of aspects) for (const tall of [false, true]) for (let seed = 0; seed < 200; seed++) {
    const a = tall ? 40 : 40 * rho, b = tall ? 40 * rho : 40, cx = 300, cy = 500;
    for (const p of loopAround([cx - a, cy - b, cx + a, cy + b], seed)) {
      const r2 = ((p.x - cx) / a) ** 2 + ((p.y - cy) / b) ** 2;
      if (r2 < worst) { worst = r2; at = `${rho}:1 ${tall ? 'tall' : 'wide'}, seed ${seed}`; }
    }
  }
  expect(worst, at).toBeGreaterThan(1);
});
test('a loop is never drawn tighter than the guarantee allows', () => {
  expect(() => loopAround([0, 0, 100, 50], 1, { grow: 1.1 })).toThrow(/grow/);
  expect(loopAround([0, 0, 100, 50], 1, { grow: 1.5 }).length).toBe(121);
});
test('charTimes spreads each word over its characters and the spaces between', () => {
  const words = [{ w: 'better', start: 1, end: 1.6 }, { w: 'on', start: 2, end: 2.2 }, { w: 'me', start: 2.2, end: 2.5 }];
  const ct = charTimes('better on me', words);
  expect(ct.length).toBe(12);
  expect(ct[0]).toEqual([1, 1.1]);
  expect(ct[5]![1]).toBeCloseTo(1.6, 9);
  expect(ct[6]).toEqual([1.6, 2]); // the space waits for the next word
  expect(ct[11]![1]).toBeCloseTo(2.5, 9);
});
test("charTimes writes a word without the punctuation it's sung with, and refuses text that isn't the words", () => {
  // (chorus 1 sings "me," and the lipstick writes "better on me")
  const words = [{ w: 'better', start: 1, end: 1.6 }, { w: 'on', start: 2, end: 2.2 }, { w: 'me,', start: 2.2, end: 2.5 }];
  const ct = charTimes('better on me', words);
  expect(ct.length).toBe(12);
  expect(ct[10]![0]).toBeCloseTo(2.2, 9);
  expect(ct[10]![1]).toBeCloseTo(2.35, 9); // "me" takes the whole of "me,"'s span
  expect(ct[11]![1]).toBeCloseTo(2.5, 9);
  expect(() => charTimes('better in me', words)).toThrow(/charTimes/);
  expect(() => charTimes('better on', words)).toThrow(/charTimes/);
  expect(() => charTimes('better  on me', words)).toThrow(/charTimes/);
});
test('charTimes takes curly and typed quotes alike, in the text or the words', () => {
  const sung = [{ w: '’cause', start: 0, end: 0.6 }, { w: 'I’m', start: 0.7, end: 1 }]; // (the data's, made curly by Lyrics)
  const typed = charTimes("'cause I'm", sung);
  expect(typed.length).toBe(10);
  expect(typed[0]![0]).toBe(0);
  expect(typed[0]![1]).toBeCloseTo(0.1, 9);
  expect(typed[6]).toEqual([0.6, 0.7]); // the space
  expect(charTimes('’cause I’m', sung)).toEqual(typed);
  expect(charTimes('’cause I’m', [{ w: "'cause", start: 0, end: 0.6 }, { w: "I'm", start: 0.7, end: 1 }])).toEqual(typed);
});
