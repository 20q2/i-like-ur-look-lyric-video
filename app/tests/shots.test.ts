import { expect, test } from 'bun:test';
import { AudioData, type AudioJSON } from '../src/engine/audio';
import { PAGE } from '../src/engine/layout';
import {
  ANGLES, DIST, FIT_MARGIN, LAND_MIN, LEAD, SNAP_S, TURN_DIST, type Shot, beatAtOrAfter, beatAtOrBefore, director,
  downbeatAtOrAfter, downbeatAtOrBefore, eighthAtOrAfter, evaluate, fit, imageMotion, inFrame, plan, turnReady,
} from '../src/spreads/shots';
import { type CameraPose, FRAME_SPREAD } from '../src/spreads/spread';

/** 120 bpm from 0 s: a beat every 0.5 s, a downbeat every 2 s, a minute long, silent. */
function synth(): AudioData {
  const n = 60 * 60, z = new Array(n).fill(0);
  const j = {
    duration: 60, bpm: 120, beat_period: 0.5, time_signature: 4, fps: 60,
    beats: Array.from({ length: 121 }, (_, i) => i * 0.5), downbeats: Array.from({ length: 31 }, (_, i) => i * 2),
    sections: [{ name: 'a', start: 0, end: 60 }], onsets: {}, notes: '',
    rms: z, low: z, mid: z, high: z, vocal: z, drums: z, bass: z, other: z,
  } as AudioJSON;
  return new AudioData(j);
}
const A = synth();
const BOX = { side: 'L' as const, box: [200, 200, 500, 500] as const };

test('the beat grid: beats, eighths and downbeats at or after (or before) a time', () => {
  expect(beatAtOrAfter(A, 1.1)).toBeCloseTo(1.5, 9);
  expect(beatAtOrAfter(A, 1.5)).toBeCloseTo(1.5, 9); // on a beat: that beat
  expect(eighthAtOrAfter(A, 1.1)).toBeCloseTo(1.25, 9);
  expect(downbeatAtOrAfter(A, 2.1)).toBeCloseTo(4, 9);
  expect(downbeatAtOrBefore(A, 5.9)).toBeCloseTo(4, 9);
  expect(downbeatAtOrAfter(A, 61)).toBeCloseTo(62, 9); // past the last downbeat: extrapolated by the bar
});

test('fit frames a box: centred on it, in frame, within the distance range', () => {
  for (const tilt of [0.12, 0.8, 0.95]) {
    const p = fit(BOX, tilt);
    expect(p.dist).toBeGreaterThanOrEqual(DIST.min);
    expect(p.dist).toBeLessThanOrEqual(DIST.max);
    expect(p.x).toBeCloseTo((350 - 770) / 1000, 9);
    expect(p.y).toBeCloseTo(1 - 350 / 1000, 9);
    expect(p.tilt).toBe(tilt);
    expect(inFrame(p, BOX.side, BOX.box)).toBe(true);
  }
  // a speck fits from as close as the textures allow, a whole spread from no further than DIST.max
  expect(fit({ side: 'R', box: [300, 300, 310, 305] }, 0.8).dist).toBe(DIST.min);
  expect(fit({ side: 'R', box: [0, 0, 770, 1000] }, 0.12).dist).toBeLessThanOrEqual(DIST.max);
  expect(fit('spread', 0.8)).toEqual({ ...FRAME_SPREAD, roll: 0 });
  // zoom < 1 comes closer than the fit, but never past DIST.min. BOX itself (300x300 pu) sits at the floor at every
  // tilt (even tilt 0 needs only dist ~0.64 to fit it with the default pad), so zoom can't move it: a bigger box
  // whose unzoomed fit clears the floor shows zoom's effect, and an extreme zoom still stops at the floor.
  const BIG = { side: 'R' as const, box: [50, 50, 700, 900] as const };
  expect(fit(BIG, 0.8).dist).toBeGreaterThan(DIST.min);
  expect(fit(BIG, 0.8, 0, 0.15, 0.8).dist).toBeLessThan(fit(BIG, 0.8).dist);
  expect(fit(BIG, 0.8, 0, 0.15, 0.1).dist).toBe(DIST.min);
});

test('a rolled fit still frames the box', () => {
  const p = fit(BOX, 0.5, 0.3);
  expect(p.roll).toBe(0.3);
  expect(inFrame(p, BOX.side, BOX.box)).toBe(true);
});

test('a rolled fit backs off until the rolled box is in frame', () => {
  const wide = { side: 'R' as const, box: [40, 320, 700, 720] as const };
  const flat = fit(wide, ANGLES.top), rolled = fit(wide, ANGLES.top, 0.2);
  expect(rolled.dist).toBeGreaterThan(flat.dist);
  expect(inFrame(rolled, wide.side, wide.box, 0, FIT_MARGIN)).toBe(true);
});

test("fit's refinement backs a tilted box off until perspective agrees", () => {
  const big = { side: 'R' as const, box: [50, 50, 700, 900] as const };
  for (const tilt of [ANGLES.low, ANGLES.ground]) {
    const p = fit(big, tilt);
    expect(p.dist).toBeGreaterThan(DIST.min);
    expect(inFrame(p, big.side, big.box, 0, FIT_MARGIN)).toBe(true);
  }
});

test('a pose frame is held as given, its distance clamped into DIST', () => {
  const p: CameraPose = { x: 0.3, y: 0.2, dist: 5, tilt: 0.5, roll: 0.1 };
  // the tilt argument (999) is nonsense but ignored: pose (and 'spread') frames don't use it
  expect(fit({ pose: p }, 999)).toEqual({ ...p, dist: DIST.max });
  expect(fit({ pose: { ...p, dist: 0.2 } }, 999).dist).toBe(DIST.min);
  expect(fit({ pose: { ...p, dist: 1.5 } }, 999)).toEqual({ ...p, dist: 1.5 }); // within range: held as given
});

test("a spread may take its own resting range (DirectorOpts.dist): poses held and boxes fitted within it, DIST by default", () => {
  const far: CameraPose = { x: 0.77, y: 0.5, dist: 3.4, tilt: 0.1, roll: 0 }, WIDE = { min: 0.9, max: 3.6 };
  expect(plan(A, [{ at: 1, frame: { pose: far } }])[0]!.to.dist).toBe(DIST.max); // clamped, as before
  expect(plan(A, [{ at: 1, frame: { pose: far } }], { dist: WIDE })[0]!.to.dist).toBe(3.4); // held
  // four pages wide (the fold-out's centrefold, from the left page's outer edge to panel B's): out of reach within DIST,
  // in frame within the wider range
  const centrefold = { side: 'R' as const, box: [-770, 0, 2310, 1000] as const };
  const near = plan(A, [{ at: 1, frame: centrefold }])[0]!.to, wide = plan(A, [{ at: 1, frame: centrefold }], { dist: WIDE })[0]!.to;
  expect(near.dist).toBe(DIST.max);
  expect(inFrame(near, centrefold.side, centrefold.box)).toBe(false);
  expect(wide.dist).toBeGreaterThan(DIST.max);
  expect(wide.dist).toBeLessThanOrEqual(WIDE.max);
  expect(inFrame(wide, centrefold.side, centrefold.box, 0, FIT_MARGIN)).toBe(true);
  // the default is DIST itself
  expect(plan(A, [{ at: 1, frame: BOX }], { dist: DIST })).toEqual(plan(A, [{ at: 1, frame: BOX }]));
  expect(() => plan(A, [{ at: 1, frame: BOX }], { dist: { min: 2, max: 1 } })).toThrow(/a range of distances/);
});
test('without a turnAt (the last spread) there is no turn rule: a spread may end close in', () => {
  const m = plan(A, [{ at: 1, frame: BOX }]);
  expect(m.length).toBe(1);
  expect(turnReady(evaluate(m, 30, FRAME_SPREAD))).toBe(false);
});

test('an out-of-range tilt throws (catches degrees passed as radians); spread and pose frames ignore tilt entirely', () => {
  expect(() => fit(BOX, 80)).toThrow(); // 80 degrees, clearly not radians
  expect(() => fit(BOX, -0.1)).toThrow();
  expect(() => fit(BOX, Math.PI / 2)).toThrow(); // exclusive upper bound
  expect(() => fit(BOX, Math.PI / 2 - 1e-6)).not.toThrow();
  expect(() => fit('spread', 80)).not.toThrow();
  expect(() => fit({ pose: { x: 0, y: 0, dist: 1, tilt: 0, roll: 0 } }, 80)).not.toThrow();
});

test("moves land on their grid: 'land' on a beat, 'glide' on a downbeat or until; 'snap' is a fixed quarter second from its cue", () => {
  const shots: Shot[] = [
    { at: 1.1, frame: BOX, move: 'land' },
    { at: 3.3, frame: BOX, move: 'snap' },
    { at: 5.1, frame: 'spread', move: 'glide' },
    { at: 9.2, frame: BOX, until: 9.75, move: 'land' },
  ];
  const m = plan(A, shots);
  expect(m.map((x) => x.land)).toEqual([beatAtOrAfter(A, 1.1 + LAND_MIN), 3.3 + SNAP_S, downbeatAtOrAfter(A, 5.1 + 2), 9.75]);
  expect(m[0]!.land).toBeCloseTo(1.5, 9);
  expect(m[1]!.land).toBeCloseTo(3.55, 9);
  expect(m[2]!.land).toBeCloseTo(8, 9);
});

test('an until must fall on the beat grid, unless the move is snap', () => {
  expect(() => plan(A, [{ at: 1, frame: BOX, move: 'land', until: 1.37 }])).toThrow();
  expect(plan(A, [{ at: 1, frame: BOX, move: 'land', until: 1.5 }])[0]!.land).toBeCloseTo(1.5, 9); // on a beat
  expect(plan(A, [{ at: 1, frame: BOX, move: 'glide', until: 1.25 }])[0]!.land).toBeCloseTo(1.25, 9); // on an eighth
  expect(plan(A, [{ at: 1, frame: BOX, move: 'snap', until: 1.37 }])[0]!.land).toBeCloseTo(1.37, 9); // snap: anything goes
});

test('until <= at throws', () => {
  expect(() => plan(A, [{ at: 5, frame: BOX, until: 5 }])).toThrow();
  expect(() => plan(A, [{ at: 5, frame: BOX, until: 4 }])).toThrow();
});

test('a word cue leads by LEAD; a plain number is used as is', () => {
  expect(plan(A, [{ at: { start: 2 }, frame: BOX }])[0]!.at).toBeCloseTo(2 - LEAD, 9);
  expect(plan(A, [{ at: 2, frame: BOX }])[0]!.at).toBeCloseTo(2, 9);
});

test('two shots that resolve to the same start throw, naming both', () => {
  expect(() => plan(A, [{ at: 2, frame: BOX }, { at: 2, frame: 'spread' }])).toThrow(/2\.000/);
  // a word cue colliding with a plain number
  expect(() => plan(A, [{ at: { start: 2 + LEAD }, frame: BOX }, { at: 2, frame: 'spread' }])).toThrow(/2\.000/);
});

test('a word cue with .w names the word in a collision error', () => {
  expect(() => plan(A, [{ at: { start: 2 + LEAD, w: 'baby' }, frame: BOX }, { at: 2, frame: 'spread' }])).toThrow(/word "baby" at 2\.000/);
});

test('before the first shot the camera holds its start; once a move lands it holds its pose', () => {
  const cam = director(A, [{ at: 2, frame: BOX, angle: 'low' }]);
  expect(cam(0)).toEqual(FRAME_SPREAD);
  expect(cam(1.999)).toEqual(FRAME_SPREAD);
  expect(cam(2.5)).toEqual(fit(BOX, 0.8));
  expect(cam(30)).toEqual(fit(BOX, 0.8));
});

test('opts.start is the pose before the first shot', () => {
  const start: CameraPose = { x: 0.1, y: 0.2, dist: 1.5, tilt: 0.3, roll: 0 };
  const cam = director(A, [{ at: 5, frame: BOX }], { start });
  expect(cam(0)).toEqual(start);
  expect(cam(4.999)).toEqual(start);
});

test("'land' overshoots its pose and settles back onto it", () => {
  const to = fit(BOX, 0.8), cam = director(A, [{ at: 2, frame: BOX, move: 'land', angle: 'low' }]); // closing in from FRAME_SPREAD
  let minDist = Infinity;
  for (let t = 2; t <= 2.5; t += 0.005) minDist = Math.min(minDist, cam(t).dist);
  expect(minDist).toBeLessThan(to.dist); // past it (closer)
  expect(cam(2.5).dist).toBeCloseTo(to.dist, 9);
});

test("'land' overshoots ~5.7% of its move", () => {
  const to = fit(BOX, 0.8), cam = director(A, [{ at: 2, frame: BOX, move: 'land', angle: 'low' }]);
  let minDist = Infinity;
  for (let t = 2; t <= 2.5; t += 0.0005) minDist = Math.min(minDist, cam(t).dist);
  expect(Math.log(to.dist / minDist) / Math.log(FRAME_SPREAD.dist / to.dist)).toBeCloseTo(0.057, 2);
});

test('a snap lands continuously: no pop at the landing instant', () => {
  const cam = director(A, [{ at: 1, frame: BOX, move: 'snap' }]);
  const land = 1 + SNAP_S;
  const before = cam(land - 1e-6), atLand = cam(land), after = cam(land + 1e-6);
  expect(Math.abs(before.dist - atLand.dist)).toBeLessThan(1e-4);
  expect(Math.abs(before.x - atLand.x) + Math.abs(before.y - atLand.y)).toBeLessThan(1e-4);
  expect(atLand).toEqual(after);
});

test('a move starts from wherever the camera is, even mid-move: nothing jumps', () => {
  const cam = director(A, [
    { at: 1.0, frame: BOX, move: 'land' },
    { at: 1.2, frame: { side: 'R', box: [400, 600, 700, 900] }, move: 'snap' }, // starts before the first lands (1.5)
  ]);
  for (const t of [1.0, 1.2]) {
    const a = cam(t - 1e-6), b = cam(t + 1e-6);
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.dist - b.dist) + Math.abs(a.tilt - b.tilt)).toBeLessThan(1e-4);
  }
});

test('the smooth contract: lands and glides stay under 6% of the frame width per frame; a snap is a cut (exempt)', () => {
  // big, page-filling boxes: this measures the smoothness contract itself, not 'fit' — a box sitting at DIST.min
  // would make the short 'land' moves here (into and back out of it) swing through more zoom than half a second can
  // cover smoothly. A 'glide' has a full bar to spread the same swing over (0.5-0.9% per frame): it isn't at risk.
  const shots: Shot[] = [
    { at: 1, frame: { side: 'L', box: [60, 80, 710, 920] }, move: 'land' },
    { at: 3, frame: { side: 'R', box: [60, 80, 710, 920] }, move: 'glide' },
    { at: 6, frame: { side: 'L', box: [60, 80, 710, 920] }, move: 'snap' },
    { at: 9, frame: 'spread', move: 'land' },
  ];
  const cam = director(A, shots);
  const snapStart = 6, snapEnd = snapStart + SNAP_S;
  let worstBounded = 0, worstSnap = 0;
  for (let t = 0; t < 12; t += 1 / 60) {
    const m = imageMotion(cam(t), cam(t + 1 / 60));
    if (t >= snapStart - 1e-9 && t < snapEnd - 1e-9) worstSnap = Math.max(worstSnap, m);
    else worstBounded = Math.max(worstBounded, m);
  }
  expect(worstBounded).toBeLessThan(0.06);
  expect(worstSnap).toBeGreaterThan(0.06); // the snap really is a jump — exempt because it IS one, not secretly smooth
});

test("a 'glide' eases in and out", () => {
  const cam = director(A, [{ at: 1, frame: { side: 'L', box: [60, 80, 710, 920] }, move: 'glide' }]); // lands on 4
  const step = (t: number) => Math.abs(Math.log(cam(t + 1 / 60).dist / cam(t).dist)) + Math.abs(cam(t + 1 / 60).x - cam(t).x);
  const mid = step(2.5);
  expect(step(1)).toBeLessThan(mid / 20);
  expect(step(4 - 1 / 60)).toBeLessThan(mid / 20);
});

test('the turn rule: a spread that ends close in gets a two-beat pull-back to the spread before its turn', () => {
  const shots: Shot[] = [{ at: 1, frame: BOX }];
  const beat = 60 / A.bpm;
  const m = plan(A, shots, { turnAt: 10 });
  expect(m.length).toBe(2);
  expect(m[1]!.land).toBeCloseTo(beatAtOrBefore(A, 10 - beat), 9); // the beat a beat or more before the turn: 9.5
  expect(m[1]!.at).toBeCloseTo(beatAtOrBefore(A, 10 - beat) - 2 * beat, 9); // two beats of glide: 8.5
  const cam = director(A, shots, { turnAt: 10 });
  expect(turnReady(cam(10))).toBe(true);
  expect(cam(10).dist).toBeGreaterThanOrEqual(TURN_DIST);
});
test('a box shot that already frames the turn page needs no pull-back', () => {
  const fullPage = { side: 'R' as const, box: [0, 0, PAGE.w, PAGE.h] as const };
  const p = fit(fullPage, ANGLES.top);
  expect(p.dist).toBeCloseTo(DIST.max, 1); // from 'top' the whole right page is about as far as DIST allows
  expect(plan(A, [{ at: 1, frame: fullPage }], { turnAt: 10 }).length).toBe(1);
});
test('the turn page in frame but from closer than TURN_DIST still gets the pull-back', () => {
  const fullPage = { side: 'R' as const, box: [0, 0, PAGE.w, PAGE.h] as const };
  const p = fit(fullPage, ANGLES.ground);
  expect(inFrame(p, 'R', fullPage.box)).toBe(true);
  expect(p.dist).toBeLessThan(TURN_DIST);
  expect(plan(A, [{ at: 1, frame: fullPage, angle: 'ground' }], { turnAt: 10 }).length).toBe(2);
});
test('a spread that already ends on the spread gets no extra move', () => {
  expect(plan(A, [{ at: 1, frame: BOX }, { at: 6, frame: 'spread' }], { turnAt: 10 }).length).toBe(2);
});
test('an in-progress move at turnAt is not accepted, even if its pose alone would look turnReady', () => {
  const shots: Shot[] = [{ at: 1, frame: BOX }, { at: 1.3, frame: 'spread', move: 'glide' }];
  const midPose = evaluate(plan(A, shots), 3.8, FRAME_SPREAD);
  expect(turnReady(midPose)).toBe(true); // the interpolated pose alone would already pass (the glide lands at 4)
  expect(() => plan(A, shots, { turnAt: 3.8 })).toThrow(/land the last by|turn-ready/); // but it hasn't landed yet
});
test('a shot starting at or after the turn throws', () => {
  expect(() => plan(A, [{ at: 10, frame: BOX }], { turnAt: 10 })).toThrow();
  expect(() => plan(A, [{ at: 10.5, frame: BOX }], { turnAt: 10 })).toThrow();
});
test('a shot at or after the turn is named as such', () => {
  expect(() => plan(A, [{ at: 10, frame: BOX }], { turnAt: 10 })).toThrow(/at or after the turn/);
});
test('a last shot too close to its turn to pull back from is an error, not a silent cut', () => {
  expect(() => plan(A, [{ at: 9.8, frame: BOX }], { turnAt: 10 })).toThrow(/land the last by|turn-ready/);
});

test('returned poses are frozen', () => {
  const m = plan(A, [{ at: 1, frame: BOX }]);
  expect(Object.isFrozen(m[0]!.to)).toBe(true);
  expect(Object.isFrozen(m[0]!.from)).toBe(true);
  expect(Object.isFrozen(director(A, [])(0))).toBe(true); // the start pose
});

test('evaluate is the director: the same moves give the same pose', () => {
  const shots: Shot[] = [{ at: 1, frame: BOX }, { at: 4, frame: 'spread', move: 'glide' }];
  const m = plan(A, shots), cam = director(A, shots);
  for (const t of [0.5, 1.2, 3, 4.7, 9]) expect(evaluate(m, t, FRAME_SPREAD)).toEqual(cam(t));
});

test('the defaults are the Snap camera: looking down, jumping a fixed quarter second after its cue', () => {
  const m = plan(A, [{ at: 1.1, frame: BOX }]);
  expect(m[0]!.to.tilt).toBe(ANGLES.top);
  expect(m[0]!.land).toBeCloseTo(1.1 + SNAP_S, 9);
});
