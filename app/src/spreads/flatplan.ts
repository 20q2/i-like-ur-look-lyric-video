// The issue's running order: which spread comes up, when, how,
// and on which leaves. Spreads are not one per section: verse 2 has two, the bridge's comes up a bar early (on the drop),
// the ripped-out page takes a leaf away, and the outro closes the magazine. Times are rules on the data, so re-aligning
// the song moves them.
import type { AudioData } from '../engine/audio';
import type { Lyrics } from '../engine/lyrics';
import { LEAVES } from '../engine/page';
import { CAM_BLEND_S } from '../scenes/magazine/schedule';
import { sectionLine } from './cues';
import { downbeatAtOrAfter } from './shots';
import type { SpreadCtx } from './spread';

export type At =
  | { section: string } // the section's start
  | { downbeatAtOrAfter: { section: string; line: string; word: number } } // the first downbeat at or after that word
  | { barBefore: string } // the last downbeat before that section's start: a bar before it, as sections start on one
  | { beatsAfterPrev: number }; // n beats after the previous entry
export type How = 'turn' | 'rip';
/** A spread of the issue: `section` is its data/audio.json section, whose lines it prints. The first entry is the closed
 *  magazine (the cover) and has no `how`; every other entry turns unless it rips. */
export interface Entry { id: string; section: string; at: At; how?: How }
export const FLATPLAN: readonly Entry[] = Object.freeze(([
  { id: 'cover', section: 'intro1', at: { section: 'intro1' } },
  { id: 'getthelook', section: 'verse1', at: { section: 'verse1' } },
  { id: 'memoriam', section: 'prechorus1', at: { section: 'prechorus1' } },
  { id: 'coverstory', section: 'chorus1', at: { section: 'chorus1' } },
  { id: 'perfume', section: 'verse2', at: { section: 'verse2' } },
  { id: 'accessories', section: 'verse2', at: { downbeatAtOrAfter: { section: 'verse2', line: 'already on a leash', word: 1 } } },
  { id: 'corrections', section: 'prechorus2', at: { section: 'prechorus2' } },
  { id: 'contactsheet', section: 'chorus2', at: { section: 'chorus2' } },
  { id: 'specimen', section: 'postchorus1', at: { section: 'postchorus1' } },
  { id: 'whoworeit', section: 'bridge1', at: { barBefore: 'bridge1' } },
  { id: 'ransom', section: 'chorus3', at: { section: 'chorus3' }, how: 'rip' },
  { id: 'classifieds', section: 'postchorus2', at: { section: 'postchorus2' } },
  { id: 'insideback', section: 'outro1', at: { section: 'outro1' } },
  { id: 'backcover', section: 'outro1', at: { beatsAfterPrev: 2 } },
] as Entry[]).map((e) => Object.freeze(e)));

/** An entry, timed: when it comes up (song s), and how (null for the first: the closed magazine, up from the start). */
export interface Timed { id: string; section: string; start: number; how: How | null }
/** An entry, timed and laid on the leaves. */
export interface Resolved extends Timed {
  /** The leaves shown: the left page is `left`'s back, the right page `right`'s front (null: none). */
  left: number | null; right: number | null;
  /** Leaves still in the book, and on the left pile, while this spread is up. */
  n: number; onLeft: number;
}

function fail(e: Entry, i: number, why: string): never { throw new Error(`flatplan: ${e.id} (entry ${i}): ${why}`); }

/**
 * Each entry's start, from its rule on the data, and how it comes up — unchecked: the preview's review aids (main.ts)
 * keep working on a running order the magazine rejects (resolveFlatplan). Throws, naming the entry, only where a rule
 * can't be followed: an unknown section, line or word, or a rule after nothing.
 */
export function timeFlatplan(audio: AudioData, lyrics: Lyrics, plan: readonly Entry[] = FLATPLAN): Timed[] {
  const out: Timed[] = [];
  const sectionStart = (e: Entry, i: number, name: string) =>
    audio.sections.find((s) => s.name === name)?.start ?? fail(e, i, `no section "${name}" (the song has ${audio.sections.map((s) => s.name).join(', ')})`);
  const lineOf = (e: Entry, i: number, section: string, text: string) => {
    try { return sectionLine(lyrics, section, text); } catch (err) { return fail(e, i, (err as Error).message); }
  };
  plan.forEach((e, i) => {
    sectionStart(e, i, e.section); // (its own section must exist too: its lines are printed from it)
    const at = e.at;
    let start: number;
    if ('section' in at) start = sectionStart(e, i, at.section);
    else if ('downbeatAtOrAfter' in at) {
      const { section, line, word } = at.downbeatAtOrAfter;
      sectionStart(e, i, section);
      const l = lineOf(e, i, section, line);
      const w = l.words[word] ?? fail(e, i, `"${l.text}" has no word ${word} (its words are 0–${l.words.length - 1})`);
      start = downbeatAtOrAfter(audio, w.start);
    } else if ('barBefore' in at) {
      const s = sectionStart(e, i, at.barBefore);
      start = audio.downbeats.findLast((d) => d < s - 1e-6) ?? fail(e, i, `no downbeat before ${at.barBefore}'s start (${s})`);
    } else {
      const prev = out[i - 1] ?? fail(e, i, 'beatsAfterPrev: there is no previous entry');
      start = audio.timeOfBeat(audio.beatAt(prev.start) + at.beatsAfterPrev);
    }
    out.push({ id: e.id, section: e.section, start, how: i === 0 ? null : e.how ?? 'turn' });
  });
  return out;
}

/**
 * The flatplan, timed (timeFlatplan) and laid on the book's LEAVES leaves. From the closed magazine (no left page, leaf
 * 0's front on the right, all its leaves on the right pile), each entry after the first brings up the next leaf on the
 * right: a turn moves the right page's leaf over to the left pile, so it shows its back as the left page; a rip tears it
 * out, so the left page stays and the book has a leaf fewer. Past the last leaf the right page is none: the last turn
 * closes the magazine onto its back cover, every leaf on the left.
 * Throws, naming the entry, unless the first entry is the closed magazine (no `how`), each id is used once (SPREADS
 * keys the modules by it), the starts strictly increase, the page turns (and rips) are CAM_BLEND_S apart or more — the
 * next would cut the camera's move off, and its blend would start over from the old spread's pose (the first entry's
 * start is no turn) — and there is a right page to turn or rip.
 */
export function resolveFlatplan(audio: AudioData, lyrics: Lyrics, plan: readonly Entry[] = FLATPLAN): Resolved[] {
  const timed = timeFlatplan(audio, lyrics, plan);
  if (plan[0]?.how !== undefined) fail(plan[0], 0, `the first entry is the closed magazine, up from the start, which takes no \`how\` (this one has '${plan[0].how}')`);
  let left: number | null = null, right: number | null = 0, n = LEAVES, onLeft = 0;
  return timed.map((e, i) => {
    const twin = timed.findIndex((x) => x.id === e.id);
    if (twin !== i) fail(plan[i]!, i, `entry ${twin} has this id too: each spread's id is its own`);
    if (i > 0) {
      const p = timed[i - 1]!;
      if (!(e.start > p.start)) fail(plan[i]!, i, `starts at ${e.start}, not after ${p.id} (${p.start}): the starts must strictly increase`);
      if (i >= 2 && e.start < p.start + CAM_BLEND_S) fail(plan[i]!, i, `its ${e.how} at ${e.start} is closer to ${p.id}'s at ${p.start} than CAM_BLEND_S (${CAM_BLEND_S} s)`);
      if (right === null) fail(plan[i]!, i, `there is no right page to ${e.how}: ${p.id} closed the magazine`);
      if (e.how === 'turn') { left = right; onLeft++; } else n--;
      right = right + 1 < LEAVES ? right + 1 : null;
    }
    return { ...e, left, right, n, onLeft };
  });
}

/** The ctx entry i of a resolved plan is built with (registry.ts makeSpreads): its pages follow its leaves (leaf k's
 *  front is page 2k + 1, its back page 2k + 2; 0 where it has no page: the cover's are [0, 1]). */
export function spreadCtx(audio: AudioData, lyrics: Lyrics, plan: readonly Resolved[], i: number): SpreadCtx {
  const e = plan[i]!, { left, right } = e;
  return {
    audio, lyrics, id: e.id, section: e.section, start: e.start, turnAt: plan[i + 1]?.start, leaves: { left, right },
    pages: [left === null ? 0 : left * 2 + 2, right === null ? 0 : right * 2 + 1],
  };
}
