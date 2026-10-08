// The contract between the magazine scene and a spread (design spec §4.2), plus camera poses.
import type * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { PAGE, type Side } from '../engine/layout';
import type { Lyrics } from '../engine/lyrics';
import { lerp } from '../engine/util';
import type { CutShape } from '../engine/cutout';
import type { Box } from './shots';

/** Camera: a target in spread space (world units: spine at x = 0, page bottom y = 0, top y = 1), its
 * distance, tilt (0 = looking straight down; positive = camera moves toward -y and looks up the page) and
 * roll (positive turns the image clockwise), in radians. */
/** Where the camera looks (x, y on the bed), from how far, tilted off straight down by `tilt` (looking up the page,
 *  from below it) and rolled by `roll`; `yaw` (default 0) swings that tilted view round the target, about the vertical:
 *  positive from the right of the page. */
export interface CameraPose { x: number; y: number; dist: number; tilt: number; roll: number; yaw?: number }
export type Layer = 'print' | 'marks';

/** The fold-out's printed sides (Task B3), one per printed surface: panel A's outside and inside, panel B's outside and
 *  inside. Each is drawn upright, as the page is read, like 'L' and 'R'. Which of them shows where is the engine's
 *  (schedule.ts foldFaces): a spread draws each surface as printed and never asks how far its panels are open. */
export type PanelSide = 'AO' | 'AI' | 'BO' | 'BI';
export const PANEL_SIDES: readonly PanelSide[] = Object.freeze(['AO', 'AI', 'BO', 'BI']);
/** A loose piece's printed side (Spread.cutout): its front, drawn as it lay in its page (in that page's units). */
export type CutSide = 'C';
/** Every side a face can be: a page, a gatefold panel's surface, or a cut-out piece's. */
export type FaceSide = Side | PanelSide | CutSide;
/** A gatefold's panels' unfold progress (Spread.panels), each 0 (folded) to 1 (open), eased by the spread. */
export interface Panels { a: number; b: number }

/** A spread. `S` is the sides it draws: a plain spread's pages ('L', 'R'), or a gatefold's (FaceSide: Spread<FaceSide>,
 *  which defines `panels`). */
export interface Spread<S extends FaceSide = Side> {
  id: string;
  /** The audio section this spread belongs to (data/audio.json). */
  section: string;
  /** Page numbers of its left and right pages, for its folios: SpreadCtx.pages (the cover: 0 and 1). */
  pages: [number, number];
  /** Draw a face's print, in page units, onto a cleared transparent canvas. */
  drawPrint(side: S, c: CanvasRenderingContext2D, t: number): void;
  /** Draw a face's lipstick marks, in page units, onto a cleared transparent canvas. */
  drawMarks(side: S, c: CanvasRenderingContext2D, t: number): void;
  /** Must change whenever that layer would draw differently at t, and be a pure function of t. */
  key(side: S, layer: Layer, t: number): string;
  camera(t: number): CameraPose;
  /** Height of the whole magazine above the sheets (world units). */
  lift?(t: number): number;
  /** The lamp, 0 (off) to 1 (on: the default) — only the cover uses it (it comes on with the song). */
  lamp?(t: number): number;
  /**
   * The fold-out (Task B3; only a Spread<FaceSide> defines it): two panels hinged outward from the right page's outer
   * edge, A on the page's edge and B on A's, each 0 (folded) to 1 (open). Rules, which the scene throws on: both in
   * [0, 1]; b > 0 only while a is 1 (B unfolds from A lying open); both 0 from the spread's start until its turn in has
   * landed and from its turn out on (a turn carries the folded panels with its leaf). What shows (foldFaces): folded,
   * the right page shows 'AO'; A lifting, its outside is 'AO' and its back B's outside, 'BO', B lying folded on it; B
   * lifting, A's back is 'AI', B's outside 'BO', its back 'BI', and 'R' shows under them from A's first lift on.
   */
  panels?(t: number): Panels;
  /** A piece of a page that comes loose and flies off (memoriam's portrait, the perfume ad's strip; engine/cutout.ts). */
  cutout?: Cutout;
  /** What must read when (the guards check it); the cover and placeholders have none. */
  focus?: FocusBox[];
}

/**
 * A piece of a page that comes loose and flies off (Spread.cutout): its page, its outline there (an ellipse or a
 * rectangle about (x, y), rx and ry its half-extents, pu), and its tab (engine/cutout.ts CutShape: the angle to the
 * point of its outline it's hinged at and tears free from last). `loose(t)` is null while it lies in its page, and once
 * it's gone — the page's face draws it, or what it left, and its shadow (engine/cutout.ts drawCutShadow); else its peel
 * (0..1: lifting about its tab) and its fly (0..1: torn free and flung out of frame, gone by 1), each eased. Never loose
 * during a turn. Loose, it's its own mesh, its front the spread's 'C' face (drawn where it lay in the page: only what
 * lies inside the outline shows) and its back blank paper.
 */
export interface Cutout extends CutShape {
  loose(t: number): { peel: number; fly: number } | null;
}

/** A box a spread prints something in that must read while it's sung (tests/sung.test.ts): in frame, and sharp enough,
 *  from `from` to `to` (song s). */
export interface FocusBox {
  from: number; to: number; side: Side; box: Box;
  /** The type size in pu of the box's text (for display type, its cap height): text and lyric boxes must give it. Type
   *  may be as soft as 1.2% of that size on screen, or SHARP, whichever is larger. A box without a size is a drawing,
   *  and may be as soft as FADE (0.7 px, where the focus pass's blur only starts to show: focus.ts). */
  size?: number;
}

/** Draw a spread's print or marks for one face at t: the one dispatch, for the scene's faces (faces.ts) and the keys
 *  check (main.ts __lv.keycheck). */
export function drawLayer(sp: Spread<FaceSide>, side: FaceSide, layer: Layer, c: CanvasRenderingContext2D, t: number) {
  if (layer === 'print') sp.drawPrint(side, c, t);
  else sp.drawMarks(side, c, t);
}

/** What a spread is built from (spreads/flatplan.ts spreadCtx): the data, and its entry in the flatplan. */
export interface SpreadCtx {
  audio: AudioData; lyrics: Lyrics;
  /** Its flatplan entry's id, and its data/audio.json section: the lines it prints are that section's (find them with
   *  cues.ts sectionLine; a section can have two spreads, as verse 2 does). */
  id: string; section: string;
  /** When it comes up, and when the turn out of it starts (song s): none for the last spread, which nothing turns away
   *  from (turnOut). */
  start: number; turnAt?: number;
  /** The leaves it shows: its left page is leaf `left`'s back, its right page leaf `right`'s front (null: no page there,
   *  as on the cover's left and the back cover's right). */
  leaves: { left: number | null; right: number | null };
  /** Its pages' numbers, for its folios: from its leaves, leaf k's front page 2k + 1 and its back page 2k + 2 (0 where it
   *  has no page). The cover's are [0, 1]; after the rip they skip the pages torn out. */
  pages: [number, number];
}
/** When the turn out of a spread starts, for a spread that is turned away from: every one but the last (it throws). */
export function turnOut(c: SpreadCtx): number {
  if (c.turnAt === undefined) throw new Error(`${c.id}: nothing turns away from it (it is the flatplan's last spread)`);
  return c.turnAt;
}
/** Builds a spread from its ctx (spreads/registry.ts). Must not touch the DOM: the guards build every spread under bun. */
export type SpreadFactory = (c: SpreadCtx) => Spread;

/** The open spread in frame with a band of sheets either side. Aimed a little below the page centre: with
 * the tilt the near (bottom) edge looms larger, and at y 0.5 / dist 1.95 the placeholders' camera drift
 * took that edge out of frame. */
export const FRAME_SPREAD: CameraPose = Object.freeze({ x: 0, y: 0.49, dist: 1.98, tilt: 0.1, roll: 0 });

/** The magazine camera's lens: its vertical field of view (degrees) and near and far planes (world units). The one lens:
 *  Magazine's camera's, the focus pass's (focus.ts bakes its planes in), and the tests' that measure it in px (focus,
 *  handheld). */
export const LENS = Object.freeze({ fov: 30, near: 0.02, far: 60 });

/** Put `cam` at pose p: looking at the target on the bed from `dist`, tilted and rolled as CameraPose says. The one
 *  placement: Magazine.render's, and tests/focus.test.ts's, so the focus plane it checks is the one rendered. */
export function placeCamera(cam: THREE.Camera, p: CameraPose) {
  const yaw = p.yaw ?? 0, s = Math.sin(p.tilt) * p.dist, cy = Math.cos(yaw), sy = Math.sin(yaw);
  cam.position.set(p.x + sy * s, p.y - cy * s, Math.cos(p.tilt) * p.dist);
  // (the up vector, rolled, then swung with the view)
  const ux = -Math.sin(p.roll), uy = Math.cos(p.roll);
  cam.up.set(ux * cy - uy * sy, ux * sy + uy * cy, 0);
  cam.lookAt(p.x, p.y, 0);
  cam.updateMatrixWorld();
}

export const lerpPose = (a: CameraPose, b: CameraPose, u: number): CameraPose => ({
  x: lerp(a.x, b.x, u),
  y: lerp(a.y, b.y, u),
  dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), u)), // zoom evenly
  tilt: lerp(a.tilt, b.tilt, u),
  roll: lerp(a.roll, b.roll, u),
  ...(a.yaw || b.yaw ? { yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, u) } : {}),
});

/** A point in page units on one side -> spread space. */
export function pageToWorld(side: Side, u: number, v: number): { x: number; y: number } {
  return { x: (side === 'L' ? u - PAGE.w : u) / PAGE.h, y: 1 - v / PAGE.h };
}
