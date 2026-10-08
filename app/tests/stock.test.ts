import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { AudioData } from '../src/engine/audio';
import { Lyrics } from '../src/engine/lyrics';
import { Book, COVER_STOCK, PAPER_STOCK, type Leaf, type Stock } from '../src/engine/page';
import { type Face, TURN_S, bookLeaves, magState, visibleFaces } from '../src/scenes/magazine/schedule';
import { resolveFlatplan } from '../src/spreads/flatplan';

const data = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dir, '../../data', f), 'utf8'));
const plan = resolveFlatplan(new AudioData(data('audio.json')), new Lyrics(data('lyrics.json')));
/** The outsides are varnished: the cover's face, and the back cover's, the last spread's left page (TREATMENT §7). */
const stockOf = (f: Face): Stock =>
  (plan[f.spread]!.id === 'cover' && f.side === 'R') || (plan[f.spread]!.id === 'backcover' && f.side === 'L') ? COVER_STOCK : PAPER_STOCK;
const tex = () => ({ print: new THREE.Texture(), marks: new THREE.Texture() });
const stock = (l: Leaf, s: 'F' | 'B') => (l.mat.uniforms[`uStock${s}`]!.value as THREE.Vector3).toArray();

test('every face shows its own stock, through every turn and the rip too (stock follows the leaf)', () => {
  const book = new Book(), varnished = new Set<string>();
  for (const [k, e] of plan.entries()) for (const d of [null, 0, 0.25, 0.5, 0.75, 0.999]) {
    if (d !== null && k === 0) continue; // (the cover's start is no turn)
    const t = d === null ? (plan[k + 1]?.start ?? 171) - 0.5 : e.start + d * TURN_S, s = magState(plan, t), f = visibleFaces(s, plan);
    book.pose({ ...bookLeaves(s, plan), turnP: s.turnP, lift: 0, settle: 0,
      left: f.left && tex(), right: f.right && tex(), turnFront: f.turnFront && tex(), turnBack: f.turnBack && tex() });
    if (f.left) expect(stock(book.left, 'B')).toEqual([...stockOf(f.left)]);
    if (f.right) expect(stock(book.right, 'F')).toEqual([...stockOf(f.right)]);
    if (f.turnFront) expect(stock(book.turning, 'F')).toEqual([...stockOf(f.turnFront)]);
    if (f.turnBack) expect(stock(book.turning, 'B')).toEqual([...stockOf(f.turnBack)]);
    for (const [role, x] of Object.entries(f)) if (stockOf(x) === COVER_STOCK) varnished.add(`${plan[x.spread]!.id} ${role}`);
  }
  // both covers, at rest and on the turning leaf: the front as it opens, the back as it closes
  expect([...varnished].sort()).toEqual(['backcover left', 'backcover turnBack', 'cover right', 'cover turnFront']);
  book.dispose();
});
