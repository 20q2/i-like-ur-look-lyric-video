import { expect, test } from 'bun:test';
import { rgba } from '../src/engine/palette';
import { SPROCKET, filmStrip, knockout } from '../src/engine/print';

/** A Canvas2D stand-in (there's no DOM under bun): the state that save/restore keep, and each rect filled, with the
 *  composite mode and fill it was filled in. */
function mockCtx() {
  type State = { op: string; fill: string; stroke: string };
  let s: State = { op: 'source-over', fill: '#111111', stroke: '#222222' };
  const stack: State[] = [], fills: (Omit<State, 'stroke'> & { x: number; y: number; w: number; h: number })[] = [];
  const c = {
    get globalCompositeOperation() { return s.op; }, set globalCompositeOperation(v: string) { s.op = v; },
    get fillStyle() { return s.fill; }, set fillStyle(v: string) { s.fill = v; },
    get strokeStyle() { return s.stroke; }, set strokeStyle(v: string) { s.stroke = v; },
    save() { stack.push({ ...s }); },
    restore() { s = stack.pop() ?? s; },
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ op: s.op, fill: s.fill, x, y, w, h }); },
  };
  return { c: c as unknown as CanvasRenderingContext2D, fills, state: () => ({ ...s }), depth: () => stack.length };
}

test('knockout cuts what it draws out of the print, opaque to start with, and hands the context back as it was', () => {
  const m = mockCtx(), before = m.state();
  let inside: object = {};
  knockout(m.c, (k) => {
    inside = { op: k.globalCompositeOperation, fill: k.fillStyle, stroke: k.strokeStyle };
    k.fillStyle = 'rgba(0,0,0,0.5)'; // (a half-strength cut)
    k.fillRect(1, 2, 3, 4);
  });
  expect(inside).toEqual({ op: 'destination-out', fill: '#000', stroke: '#000' });
  expect(m.fills).toEqual([{ op: 'destination-out', fill: 'rgba(0,0,0,0.5)', x: 1, y: 2, w: 3, h: 4 }]);
  expect(m.state()).toEqual(before);
  expect(m.depth()).toBe(0);
  expect(() => knockout(m.c, () => { throw new Error('mid-cut'); })).toThrow('mid-cut');
  expect(m.state()).toEqual(before); // (restored even so)
  expect(m.depth()).toBe(0);
});
test('a film strip: the band in ink, two rows of sprocket holes cut, the run centred, and the windows cut', () => {
  const m = mockCtx(), y = 744, h = 176, w = 770;
  const frames = [{ x: 48, y: 766, w: 228, h: 107 }, { x: 290, y: 766, w: 228, h: 107 }];
  filmStrip(m.c, 0, y, w, h, frames);
  const [band, ...cuts] = m.fills;
  expect(band).toEqual({ op: 'source-over', fill: rgba('ink'), x: 0, y, w, h });
  for (const f of cuts) expect([f.op, f.fill]).toEqual(['destination-out', '#000']);
  const holes = cuts.slice(0, -frames.length);
  const top = holes.filter((f) => f.y === y + SPROCKET.inset), bottom = holes.filter((f) => f.y === y + h - SPROCKET.inset - SPROCKET.h);
  expect([top.length, bottom.length, holes.length]).toEqual([32, 32, 64]);
  for (const f of holes) expect([f.w, f.h]).toEqual([SPROCKET.w, SPROCKET.h]);
  expect(bottom.map((f) => f.x)).toEqual(top.map((f) => f.x));
  const xs = top.map((f) => f.x);
  for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(SPROCKET.pitch, 9);
  const left = xs[0]!, right = w - (xs[xs.length - 1]! + SPROCKET.w);
  expect(left).toBeCloseTo(right, 9); // the same margin at each end
  expect(left).toBeGreaterThanOrEqual((SPROCKET.pitch - SPROCKET.w) / 2); // and at least half a gap: butted strips keep the rhythm
  expect(cuts.slice(-frames.length).map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(frames);
  expect(m.state().op).toBe('source-over');
  expect(m.depth()).toBe(0);
});
test('a frame across a row of sprocket holes is an error, before anything prints', () => {
  const m = mockCtx();
  expect(() => filmStrip(m.c, 0, 744, 770, 176, [{ x: 48, y: 752, w: 228, h: 107 }])).toThrow(/sprocket/); // the top row
  expect(() => filmStrip(m.c, 0, 744, 770, 176, [{ x: 48, y: 800, w: 228, h: 110 }])).toThrow(/sprocket/); // the bottom row
  expect(m.fills).toEqual([]);
});
