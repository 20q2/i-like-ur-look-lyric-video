import { expect, test } from 'bun:test';
import { hatchLines, makeDrawing } from '../src/engine/drawing';
import { ART, HANGER, HER, JACKET_NECK, LAPELS, OUTLINE, POCKETS, SCISSORS, SHADE, STITCHES, artDrawings, drawArt } from '../src/spreads/art';

test('every piece of art parses into drawable strokes that stay inside its box', () => {
  for (const [name, a] of Object.entries(ART)) {
    const ds = artDrawings(a, 7);
    expect(ds.length).toBe(a.groups.length);
    for (const d of ds) expect(d.d.total).toBeGreaterThan(0);
    const [x0, y0, x1, y1] = a.box;
    for (const d of ds) for (const s of d.d.strokes) for (const p of s) {
      // (a little wobble may cross the box by a unit or two)
      expect(p.x, name).toBeGreaterThan(x0 - 4); expect(p.x, name).toBeLessThan(x1 + 4);
      expect(p.y, name).toBeGreaterThan(y0 - 4); expect(p.y, name).toBeLessThan(y1 + 4);
    }
  }
});
test("the cover's art is the approved cover's: its strokes, lengths, vertex sums and extents, pinned", () => {
  // (measured from cover.ts's own constants before they moved here, M4 batch 1, unwobbled, as makeDrawing parses them:
  // the cover draws exactly these, so a change here is a change to the approved cover. The sums move with any vertex.)
  type Pin = [name: string, paths: Parameters<typeof makeDrawing>[0], strokes: number, vertices: number, length: number, sumX: number, sumY: number, box: number[]];
  const pinned: Pin[] = [
    ['HANGER', HANGER, 2, 70, 641.03, 28064.844, 20816.906, [263, 227.13, 529, 352]],
    ['OUTLINE', OUTLINE, 1, 155, 2251.454, 61282, 81347.938, [264, 340, 528, 716]],
    ['LAPELS', LAPELS, 5, 46, 981.259, 18216, 21563.75, [328, 340, 464, 612]],
    ['POCKETS', POCKETS, 5, 57, 393.927, 22802, 33625, [326, 497, 468, 662]],
    ['STITCHES', STITCHES, 10, 50, 638.947, 19800, 25991.688, [266, 350, 526, 710]],
    ['SHADE', SHADE.flatMap((p) => hatchLines(p, 1.1, 6)), 52, 104, 1289.449, 32744.943, 56346.458, [264.32, 341.75, 452.92, 712]],
    ['HER', HER, 1, 433, 2404.952, 263264, 243309.469, [544.03, 274, 671.97, 854]],
    ['SCISSORS', SCISSORS, 4, 38, 115.318, 25176, 10202, [649, 254, 686, 277]],
  ];
  for (const [name, paths, strokes, vertices, length, sumX, sumY, box] of pinned) {
    const d = makeDrawing(paths), pts = d.strokes.flat();
    expect(d.strokes.length, name).toBe(strokes);
    expect(pts.length, name).toBe(vertices);
    expect(Math.abs(d.total - length), name).toBeLessThan(0.001);
    expect(Math.abs(pts.reduce((s, p) => s + p.x, 0) - sumX), name).toBeLessThan(0.001);
    expect(Math.abs(pts.reduce((s, p) => s + p.y, 0) - sumY), name).toBeLessThan(0.001);
    const ext = [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
    ext.forEach((v, i) => expect(Math.abs(v - box[i]!), name).toBeLessThan(0.01));
  }
  expect(HER[0]).toMatch(/^M608 274 C623 274 636 284 638 300/); // her crown, where the scissors start
});
test("the spreads' jacket, hanger and her are the cover's own paths", () => {
  expect(ART.jacket.groups.slice(0, 4).map((g) => g.paths)).toEqual([OUTLINE, LAPELS, POCKETS, STITCHES]);
  for (const [i, p] of [OUTLINE, LAPELS, POCKETS, STITCHES].entries()) expect(ART.jacket.groups[i]!.paths).toBe(p);
  expect(ART.hanger.groups[0]!.paths).toBe(HANGER);
  expect(ART.her.groups[0]!.paths).toBe(HER);
  expect(ART.scissors.groups[0]!.paths).toBe(SCISSORS);
});
test('the shared art is frozen all the way down: a write throws where it is made', () => {
  const unfrozen: string[] = [];
  const walk = (o: unknown, at: string) => {
    if (typeof o !== 'object' || o === null) return;
    if (!Object.isFrozen(o)) unfrozen.push(at);
    for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`);
  };
  const all = { ART, HANGER, OUTLINE, LAPELS, POCKETS, STITCHES, SHADE, HER, SCISSORS, JACKET_NECK };
  for (const [name, v] of Object.entries(all)) walk(v, name);
  expect(unfrozen).toEqual([]);
  expect(() => { (HANGER as string[]).push('M0 0 L1 1'); }).toThrow(TypeError);
  expect(() => { (SHADE[0]![0] as { x: number }).x = 0; }).toThrow(TypeError);
  expect(() => { (ART.jacket.groups[0] as { width: number }).width = 3; }).toThrow(TypeError);
  // a drawing made without wobble holds the art's own polylines (makeDrawing doesn't copy them): moving its points
  // would move the cover's scissors
  const d = makeDrawing(SCISSORS);
  expect(d.strokes[0]).toBe(SCISSORS[0] as never);
  expect(() => { (d.strokes[0]![0] as { x: number }).x += 5; }).toThrow(TypeError);
});
test('drawArt strokes each group that has begun, its line width and dashes times widthK, and leaves no dash set', () => {
  const calls: string[] = [];
  const c = {
    lineJoin: '', lineCap: '', set lineWidth(w: number) { calls.push(`width ${w}`); },
    setLineDash(d: number[]) { calls.push(`dash [${d}]`); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push('stroke'); },
  } as unknown as CanvasRenderingContext2D;
  // the boot: the outline (2.2), the zip and highlights (1.3), the stitching (1, dashed 3 3), the fine lines (0.8)
  drawArt(c, artDrawings(ART.boot, 1), [1, 0, 0.5], 0.5);
  expect(calls).toEqual(['width 1.1', 'dash []', 'stroke', 'width 0.5', 'dash [1.5,1.5]', 'stroke', 'dash []']);
});
