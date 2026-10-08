// The camera's view at song time t, as the magazine renders it: the spread's own camera (or, after a turn starts, the
// blend from the old spread's to the new one's), then the groove, then the hand. Pure: Magazine and the guards
// (tests/sung.test.ts) both build it with bookView, so the poses the guards check are the poses rendered.
import type { AudioData } from '../../engine/audio';
import { type CameraPose, type Spread, lerpPose } from '../../spreads/spread';
import { GrooveTrack, type Sung } from './groove';
import { handheld } from './handheld';
import { camBlend, spreadAt } from './schedule';

/** During the camera's move after a turn starts: the two spreads' poses blended, with a slight pull back on the eased
 *  progress, so it eases out with the move (on the linear progress the zoom stopped dead at the end of every blend). */
export function blendPose(spreads: readonly Spread[], cb: NonNullable<ReturnType<typeof camBlend>>, t: number): CameraPose {
  const p = lerpPose(spreads[cb.from]!.camera(t), spreads[cb.to]!.camera(t), cb.u);
  return { ...p, dist: p.dist * (1 + 0.06 * Math.sin(Math.PI * cb.u)) };
}

/** The magazine's view of its book (`spreads`, coming up at `starts`: the flatplan's, spreads/flatplan.ts
 *  resolveFlatplan), with the groove from the first inside spread on (the cover's flip; a book that is only a cover never
 *  grooves), calmed while the `sung` lines are sung (groove.ts). */
export function bookView(spreads: readonly Spread[], starts: readonly number[], audio: AudioData, sung: readonly Sung[] = []): (t: number) => CameraPose {
  const groove = new GrooveTrack(audio, starts[1] ?? Infinity, undefined, sung);
  return (t) => {
    const cb = camBlend(starts, t);
    // blending between two spreads' poses after a turn starts, then the pose of the spread that is up (not magState's
    // `open`: were the blend ever shorter than the turn, that would snap back to the spread being turned away)
    const p = cb ? blendPose(spreads, cb, t) : spreads[spreadAt(starts, t)]!.camera(t);
    return handheld(groove.apply(p, t), t);
  };
}
