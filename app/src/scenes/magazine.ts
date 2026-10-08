// The magazine on the sheets: the video's one long scene. Hosts the spreads of the flatplan (spreads/flatplan.ts: the cover, then each spread in the
// issue's running order), turns a page as each comes up, closes the magazine at the end, and flies the camera from
// spread to spread.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { H, SCALE, W, clearRT, makeRT } from '../engine/gl';
import { Book, type BookPose } from '../engine/page';
import { settleLift } from '../engine/curl';
import { LAMP, LAMP_ON } from '../engine/lamp';
import { LIN } from '../engine/palette';
import { Sheets } from './magazine/sheets';
import { Focus, focusDistance } from './magazine/focus';
import { FaceCache, faceId } from './magazine/faces';
import { type Face, bookLeaves, magState, sinceLanding, visibleFaces } from './magazine/schedule';
import { foldFaces, restPanels } from './magazine/schedule';
import { bookView } from './magazine/view';
import { type Resolved, resolveFlatplan } from '../spreads/flatplan';
import { type CameraPose, LENS, type Spread, placeCamera } from '../spreads/spread';
import { makeSpreads } from '../spreads/registry';

/** Multisampling of the world: page edges stair-step without it (the sub-frames of motion blur can't smooth them).
 *  Motion blur covers most of the groove's own motion, but not the back half of every beat: once the punch has decayed,
 *  a page edge moves under a pixel per shutter for ~53% of the time while the groove runs. MSAA covers that, and the
 *  moments that hold fully still — the cover (groove off), a drum stop, and the preview's single sample. There, at
 *  HANDHELD's knobs, the camera's drift and the hand (handheld.ts) move an edge at most ~0.13 px per frame; re-measure
 *  if its `amount` changes. */
const MSAA_SAMPLES = 4;

/** The magazine's post: a lens vignette, sensor-like grain (stronger in the shadows) and a touch of contrast (post.ts;
 *  the diagnostic cards keep the engine's defaults). The contrast curve works per channel and pivots at the lamp pool's
 *  paper, its red at the lamp's brightest point (LAMP.peak x the paper's red, so the pivot follows a retuned lamp).
 *  Each channel below the pivot darkens: lit paper's red stays, its green and blue deepen slightly (~1-3 levels), and
 *  near-neutrals gain ~12% saturation, which moves the kiss ~1-2° toward coral (within lamp.ts's 8° budget). The
 *  vignette and the contrast both cost legibility where the lamp is dimmest (the right page's far corner, near a frame
 *  corner at FRAME_SPREAD): re-measure the floor (spec §4) when tuning them. Frozen: every frame returns this one
 *  object; typed on the call, not the const, so the literal keeps its excess-property check. */
export const MAGAZINE_POST = Object.freeze<PostOverrides>({
  vignette: 0.35, grain: 0.035, grainShadow: 1, contrast: 0.12, contrastPivot: LAMP.peak * LIN.paper[0],
});

export default class Magazine extends Scene {
  cam = new THREE.PerspectiveCamera(LENS.fov, W / H, LENS.near, LENS.far);
  /** Everything in the world is lit by the lamp, its shader including LAMP_GLSL (lamp.ts), and writes alpha 1 — all but
   *  the sheets, which write 0: focus.ts takes alpha 0 for the backdrop and blurs it more. So anything added here (a prop
   *  on the bed, M4) must include LAMP_GLSL and write alpha 1, and join tests/lamp.test.ts's surface check, which knows
   *  only the book's and the sheets' materials. */
  world = new THREE.Scene();
  /** The world renders here (multisampled), then is focused into the scene's output (focus.ts), which reads its
   *  resolved depth. */
  private msaa = makeRT(W, H, { samples: MSAA_SAMPLES, depthTexture: new THREE.DepthTexture(W * SCALE, H * SCALE) });
  private focus = new Focus();
  book = new Book();
  sheets = new Sheets();
  /** The flatplan, timed and laid on the leaves (resolveFlatplan): spread k is spreads[k], coming up at plan[k].start. */
  plan: Resolved[] = [];
  spreads: Spread[] = [];
  starts: number[] = [];
  faces!: FaceCache;
  /** The camera at t: the spread's pose (or a turn's blend), the groove, the hand (view.ts). */
  view!: (t: number) => CameraPose;

  override init() {
    const { audio, lyrics } = this.ctx;
    this.plan = resolveFlatplan(audio, lyrics);
    this.spreads = makeSpreads(audio, lyrics, this.plan);
    this.starts = this.plan.map((e) => e.start);
    this.faces = new FaceCache(this.spreads);
    this.world.add(this.sheets.mesh, this.book.group);
    this.view = bookView(this.spreads, this.starts, audio, lyrics.lines);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    const st = magState(this.plan, t);
    // the fold-out's panels, a gatefold spread's (spread.ts Spread.panels), decide what shows of it (foldFaces)
    const panelsOf = (k: number) => this.spreads[k]!.panels?.(t) ?? null;
    const faces = foldFaces(visibleFaces(st, this.plan), st, panelsOf);
    // a piece of one of the open spread's pages, while it's loose (spread.ts Cutout): its front is the 'C' face
    const cutout = this.spreads[st.open]!.cutout, loose = st.turnP === null ? cutout?.loose(t) ?? null : null;
    const cutFace: Face | undefined = loose ? { spread: st.open, side: 'C' } : undefined;
    const tex = this.faces.update([...Object.values(faces), cutFace].filter((x): x is Face => !!x), t);
    const T = (x?: Face) => (x ? tex.get(faceId(x)) : undefined);
    const lift = this.spreads[st.open]!.lift?.(t) ?? 0; // (the open spread's: during a turn, the one turned away from)
    LAMP_ON.value = this.spreads[st.open]!.lamp?.(t) ?? 1;
    const sl = sinceLanding(this.plan, t);
    const pose: BookPose = { ...bookLeaves(st, this.plan), turnP: st.turnP, lift, settle: sl === null ? 0 : settleLift(sl),
      left: T(faces.left), turnFront: T(faces.turnFront), turnBack: T(faces.turnBack), right: T(faces.right),
      panels: restPanels(st, panelsOf), aFront: T(faces.aFront), aBack: T(faces.aBack), bFront: T(faces.bFront), bBack: T(faces.bBack),
      ...(cutout && loose ? { cut: { side: cutout.side, shape: cutout.shape, x: cutout.x, y: cutout.y, rx: cutout.rx, ry: cutout.ry, tab: cutout.tab, motion: cutout.motion, ...loose }, cutFace: T(cutFace) } : {}) };
    this.book.pose(pose);
    // the camera: the spread's pose (after a turn starts, the blend between the two spreads'), the groove, the hand
    const view = this.view(t);
    placeCamera(this.cam, view);
    this.sheets.update(this.book.footprint(pose), lift);
    clearRT(renderer, this.msaa, [0, 0, 0]);
    renderer.setRenderTarget(this.msaa);
    // (three resolves the samples into msaa.texture at the end of render, and the depth into msaa.depthTexture — from
    // one sub-sample, not their average: focus.ts)
    renderer.render(this.world, this.cam);
    // focused on the page at the camera's target, which the camera looks at from the pose's dist (focus.ts)
    this.focus.render(renderer, this.msaa, out, focusDistance(view));
    return MAGAZINE_POST;
  }

  override dispose() {
    this.faces.dispose(); // (the engine never disposes a scene whose init threw)
    this.book.dispose();
    this.sheets.dispose();
    this.focus.dispose();
    this.msaa.dispose();
    this.world.clear();
  }
}
