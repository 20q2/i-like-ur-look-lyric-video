// A subtle handheld camera: someone holding a phone over the bed. A slow sway (breathing), a faint tremor and a hint of
// roll, added to the camera pose last: after the spread's pose, any blend between spreads, and the groove (view.ts).
// Deterministic — noise of t — so every render of a frame agrees, and motion blur sees it on every sub-frame. Amplitudes
// are world units at `ref` (the open-spread distance, where a world unit is ~1000 px at 1080p): the sway ~1.4 px, the
// tremor ~0.4 px. At these knobs, over the song at FRAME_SPREAD, the image moves at most 1.14 px (0.5 typically) and at
// most 0.086 px from one frame to the next, and the roll moves the frame's edge at most 0.51 px. Closer in, the same
// hand moves the image a little more: (ref/dist)^0.3 times as much, 1.23x at the cover's close-up (dist 1), and never
// more than `maxGrow` times (reached at dist 0.51), so the lyrics stay legible however close a spread frames them.
import { fbm1 } from '../../engine/util';
import { type CameraPose, FRAME_SPREAD } from '../../spreads/spread';

/** The hand: `sway` and `tremor` in world units at `ref`; `swayHz` and `tremorHz` their noise's lattice rates (per
 *  second), not the motion's frequencies: its velocity's power spectrum has its median at ~0.27 Hz for the sway and
 *  ~2.2 Hz for the tremor; `roll` in radians; `maxGrow` the most the image moves closer in, as a multiple of its motion
 *  at `ref`; `amount` scales it all (0: locked off). */
export interface Handheld {
  amount: number; sway: number; swayHz: number; tremor: number; tremorHz: number; roll: number; ref: number; maxGrow: number;
}
/** Frozen, as the other look constants are (typed Handheld, not literal types, so a test can pass a variant). */
export const HANDHELD = Object.freeze<Handheld>({
  amount: 1, sway: 0.0014, swayHz: 0.3, tremor: 0.0004, tremorHz: 3.5, roll: 0.0009, ref: FRAME_SPREAD.dist, maxGrow: 1.5,
});

export function handheld(p: CameraPose, t: number, h: Readonly<Handheld> = HANDHELD): CameraPose {
  if (h.amount === 0) return p;
  // the image moves (ref/dist)^0.3 times as much as at ref, up to maxGrow; in the world, that times dist/ref
  const grow = Math.min(h.maxGrow, Math.pow(h.ref / p.dist, 0.3)), k = (h.amount * grow * p.dist) / h.ref;
  const dx = h.sway * fbm1(t * h.swayHz, 3, 11) + h.tremor * fbm1(t * h.tremorHz, 2, 37);
  const dy = h.sway * fbm1(t * h.swayHz, 3, 23) + h.tremor * fbm1(t * h.tremorHz, 2, 41);
  return { ...p, x: p.x + k * dx, y: p.y + k * dy, roll: p.roll + h.amount * h.roll * fbm1(t * h.swayHz * 0.8, 2, 53) };
}
