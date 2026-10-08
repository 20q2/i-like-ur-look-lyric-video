// The preview's review aids, pure, tested under bun: where
// PageDown / PageUp land, and what `l` loops (main.ts). The keys check is keycheck.ts.
import { landedAt, spreadAt } from './scenes/magazine/schedule';
import type { Timed } from './spreads/flatplan';

/** Where PageDown and PageUp land, for the flatplan's spreads as timed (spreads/flatplan.ts timeFlatplan, without
 *  resolveFlatplan's checks: the preview keeps working on a running order the magazine rejects): the cover at its start,
 *  then each later spread just after its turn in has landed (schedule.ts landedAt). */
export function spreadJumpTargets(plan: readonly Timed[]): number[] {
  return plan.map(landedAt);
}

/** What `l` loops from t, for spreads coming up at `starts`: the spread up then (during a turn, the one turned to:
 *  spreadAt), from its start, its turn in, to the next spread's start, the turn out not played; the last spread to
 *  `end`, the song's. */
export function spreadLoop(starts: readonly number[], t: number, end: number): [number, number] {
  const k = spreadAt(starts, t);
  return [starts[k]!, starts[k + 1] ?? end];
}

/** The target to jump to from t: the next one more than 0.05 s ahead (dir 1), or the last one more than 0.3 s back
 *  (dir -1, so a PageUp just after a jump goes on to the spread before, not back to where it is). Undefined at
 *  either end. */
export function spreadJump(at: readonly number[], t: number, dir: 1 | -1): number | undefined {
  if (dir === 1) return at.find((x) => x > t + 0.05);
  const back = at.filter((x) => x < t - 0.3);
  return back[back.length - 1];
}
