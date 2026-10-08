// Which spread is up at song time t, and the page turn in progress: the flatplan's spreads (spreads/flatplan.ts,
// resolveFlatplan), the cover first, each later one coming up at its start as the leaf on the right turns (or is ripped
// out), over TURN_S (a rip over RIP_S).
import type { Side } from '../../engine/layout';
import type { BookPose } from '../../engine/page';
import { ease } from '../../engine/util';
import type { How, Resolved, Timed } from '../../spreads/flatplan';
import type { FaceSide, Panels } from '../../spreads/spread';

/** Length of a page turn (s). */
export const TURN_S = 0.55;
/** Length of a rip (s): the leaf's lift and tear, and its fling out of frame (page.ts ripPose). */
export const RIP_S = 0.6;
/** Length of the camera's move to the next spread (s); starts with the turn, ends after it. */
export const CAM_BLEND_S = 0.72;

export interface MagState {
  /** The spread fully open — or, during a turn, the one being turned away from (its right page's leaf is turning). */
  open: number;
  /** The turn's eased progress (0..1), or null when no turn is in progress (as BookPose.turnP); in a rip, the rip's
   *  progress r, linear in time (BookPose.rip: page.ts ripPose eases its parts itself). */
  turnP: number | null;
  /** How the turn in progress brings the next spread up — a turn, or a rip (the leaf torn out) — or null if none is. */
  how: How | null;
}
export interface Face { spread: number; side: FaceSide }
export type Role = 'left' | 'turnFront' | 'turnBack' | 'right';

/** How long the transition into a spread lasts (s): a turn's TURN_S, a rip's RIP_S; the first spread's start is none. */
export const transitionS = (how: How | null) => (how === null ? 0 : how === 'rip' ? RIP_S : TURN_S);
/** When the transition into spread `e` has landed (the first spread: its start). */
export const landsAt = (e: Timed) => e.start + transitionS(e.how);
/** A moment after the transition into spread `e` has landed (the first spread: its start): where the preview's PageDown
 *  lands (review.ts), and how long the keys check follows a spread past the start of its turn out (main.ts
 *  __lv.keycheck). */
export const landedAt = (e: Timed) => (e.how === null ? e.start : landsAt(e) + 0.05);

/** The spread that is up at t: the last whose start is <= t (during a turn, the one being turned to). */
export function spreadAt(starts: readonly number[], t: number) {
  let k = 0;
  while (k + 1 < starts.length && t >= starts[k + 1]!) k++;
  return k;
}

/** The state of the magazine at t, for the spreads `plan` (resolveFlatplan): which is open, and the turn in progress. */
export function magState(plan: readonly Timed[], t: number): MagState {
  let k = 0;
  while (k + 1 < plan.length && t >= plan[k + 1]!.start) k++;
  const e = plan[k]!;
  if (k >= 1 && t < landsAt(e)) {
    const r = (t - e.start) / transitionS(e.how);
    return { open: k - 1, turnP: e.how === 'rip' ? r : ease.outQuart(r), how: e.how };
  }
  return { open: k, turnP: null, how: null };
}

/** The faces that can be seen, by role, from the spreads' leaves (resolveFlatplan): at rest, the open spread's pages
 *  that it has (the cover has no left page, the back cover no right one); during a turn into spread k, the left page
 *  stays k - 1's, the turning leaf shows k - 1's right face and, on its back, k's left, and k's right page lies under
 *  it. A ripped leaf's back is blank paper (no face), and the left page stays k - 1's through the rip. */
export function visibleFaces(s: MagState, plan: readonly Resolved[]): Partial<Record<Role, Face>> {
  const r: Partial<Record<Role, Face>> = {}, a = s.open, from = plan[a]!;
  if (from.left !== null) r.left = { spread: a, side: 'L' };
  if (s.turnP === null) { // (not truthiness: a turn is under way from p = 0, the downbeat itself)
    if (from.right !== null) r.right = { spread: a, side: 'R' };
    return r;
  }
  const b = a + 1;
  r.turnFront = { spread: a, side: 'R' };
  if (s.how !== 'rip') r.turnBack = { spread: b, side: 'L' };
  if (plan[b]!.right !== null) r.right = { spread: b, side: 'R' };
  return r;
}

/** The book's leaves at state s (BookPose): the piles as the open spread has them (during a turn, the spread turned away
 *  from, its right page still counted on the right pile as it lifts off), its pages' leaves, the turning leaf, and in a
 *  rip the rip's progress (BookPose.rip). */
export function bookLeaves(s: MagState, plan: readonly Resolved[]): Pick<BookPose, 'leaves' | 'onLeft' | 'leftLeaf' | 'rightLeaf' | 'turnLeaf' | 'rip'> {
  const a = plan[s.open]!, turning = s.turnP !== null;
  return { leaves: a.n, onLeft: a.onLeft, leftLeaf: a.left, turnLeaf: turning ? a.right : null, rightLeaf: turning ? plan[s.open + 1]!.right : a.right,
    ...(s.how === 'rip' ? { rip: s.turnP! } : {}) };
}

/** During the camera's move after a turn starts (within dur of the start of spread k >= 1, the one up): from/to spreads
 *  and eased progress u (0..1); null outside it. */
export function camBlend(starts: readonly number[], t: number, dur = CAM_BLEND_S): { from: number; to: number; u: number } | null {
  const k = spreadAt(starts, t);
  return k >= 1 && t < starts[k]! + dur ? { from: k - 1, to: k, u: ease.inOutCubic((t - starts[k]!) / dur) } : null;
}

/** Time since the most recent turn landed (landsAt), or null before the first landing. The landed leaf settles for
 *  SETTLE.dur (curl.ts) from then. A rip lands no leaf — the page torn out leaves, and the left page hasn't moved — so it
 *  doesn't count. */
export function sinceLanding(plan: readonly Timed[], t: number): number | null {
  for (let k = plan.length - 1; k >= 1; k--) {
    const e = plan[k]!;
    if (e.how === 'turn' && landsAt(e) <= t) return t - landsAt(e);
  }
  return null;
}

/** The gatefold panels' faces (BookPose's aFront, aBack, bFront and bBack): panel A's front and back, panel B's. */
export type PanelRole = 'aFront' | 'aBack' | 'bFront' | 'bBack';
/** The most faces in view at once (faces.ts's pool): a gatefold with both panels lifting — its left and right pages and
 *  both faces of both panels. */
export const MAX_FACES = 6;
/** The most faces bound at once (faces.ts's pool): MAX_FACES, and a loose cut-out's front ('C': spread.ts Cutout),
 *  which the fold-out's left flap is while the gatefold lies open. */
export const MAX_BOUND = MAX_FACES + 1;

/** Throws unless `p` keeps Spread.panels' rules at rest: both in [0, 1], b > 0 only while a is 1. */
export function checkPanels(p: Panels, what: string) {
  if (!(p.a >= 0 && p.a <= 1 && p.b >= 0 && p.b <= 1)) throw new Error(`${what}: panels a ${p.a}, b ${p.b}: each is in [0, 1]`);
  if (p.b > 0 && p.a !== 1) throw new Error(`${what}: panel B is unfolding (b ${p.b}) while A isn't open (a ${p.a}): B unfolds from A lying open`);
}

/**
 * The fold-out's faces (Task B3), mapped onto visibleFaces's (`r`, at state s): the panels of each spread whose right
 * page is in view, `panelsOf(spread)` (null: not a gatefold), decide what shows, so the spread draws each printed
 * surface as printed (spread.ts PanelSide) and never which is where:
 * - folded (a = 0): no panel shows; the right page's face is A's outside, 'AO' — the page you see is panel A, folded
 *   over it. So too on a turning leaf: a turn carries the folded panels with it, and throws on any that aren't;
 * - A lifting (0 < a, b = 0): the right page is 'R' again, under it; A's front is its outside, 'AO', and its back is B's
 *   outside, 'BO' — B lies folded on A's back, and isn't posed (page.ts Book);
 * - B lifting (b > 0, A open): A's back is its own inside, 'AI'; B's front is its outside, 'BO', its back its inside,
 *   'BI'. All six faces are bound then, the two facing down included: MAX_FACES.
 */
export function foldFaces(r: Partial<Record<Role, Face>>, s: MagState, panelsOf: (spread: number) => Panels | null): Partial<Record<Role | PanelRole, Face>> {
  const out: Partial<Record<Role | PanelRole, Face>> = { ...r };
  for (const role of ['turnFront', 'right'] as const) {
    const f = r[role];
    if (f?.side !== 'R') continue;
    const p = panelsOf(f.spread);
    if (p === null) continue;
    checkPanels(p, `spread ${f.spread}`);
    const face = (side: FaceSide): Face => ({ spread: f.spread, side });
    if (p.a === 0) { out[role] = face('AO'); continue; }
    if (s.turnP !== null) throw new Error(`spread ${f.spread}: its panels are open (a ${p.a}) during a turn: they must be folded (0) from its start until its turn in lands, and from its turn out on`);
    out.aFront = face('AO'); out.aBack = face(p.b > 0 ? 'AI' : 'BO');
    if (p.b > 0) { out.bFront = face('BO'); out.bBack = face('BI'); }
  }
  return out;
}

/** The panels as the book poses them (BookPose.panels) at state s: the open spread's while no turn is in progress (a
 *  turn carries them folded, foldFaces), none otherwise. */
export function restPanels(s: MagState, panelsOf: (spread: number) => Panels | null): Panels | undefined {
  return s.turnP === null ? panelsOf(s.open) ?? undefined : undefined;
}
