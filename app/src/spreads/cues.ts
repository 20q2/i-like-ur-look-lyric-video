// Finding a spread's cues in the data: its lyric lines by text (within its own section: the chorus repeats), and
// kick-timed cue lists as the cover uses.
import type { AudioData } from '../engine/audio';
import { inkAt } from '../engine/layout';
import { type Line, type Lyrics, type Word, norm } from '../engine/lyrics';

/** The one line of `section` whose text contains `text`, compared as `norm` sees them (lowercase letters and digits
 *  only: case, quotes, punctuation and spaces don't matter, as in Lyrics.findWords). Throws if no line or more than one
 *  does: give enough of the line to tell it from the section's others. */
export function sectionLine(lyrics: Lyrics, section: string, text: string): Line {
  const n = norm(text);
  if (!n) throw new Error(`sectionLine: "${text}" has no letters or digits to look for`);
  const lines = lyrics.lines.filter((x) => x.section === section), hits = lines.filter((x) => norm(x.text).includes(n));
  if (hits.length === 1) return hits[0]!;
  if (!hits.length) throw new Error(`no line of ${section} contains "${text}" (it has: ${lines.map((x) => x.text).join(' / ')})`);
  throw new Error(`${hits.length} lines of ${section} contain "${text}": ${hits.map((x) => `"${x.text}"`).join(', ')} (give more of the one you mean)`);
}
/** n cue times in [from, to), in order: the kicks there, then, if there are fewer kicks than cues, the rest spread
 *  evenly between the last kick (or `from`) and `to`. (The first n kicks: with kicks every ~0.22 s, n cues bunch at
 *  the window's start. To spread them across it, kicksAcross.) */
export function onKicks(audio: AudioData, n: number, from: number, to: number): number[] {
  const at = audio.events('kick', from, to).map(([t]) => t).slice(0, n);
  const last = at[at.length - 1] ?? from, missing = n - at.length;
  for (let j = 1; j <= missing; j++) at.push(last + ((to - last) * j) / (missing + 1));
  return at;
}
/** n cue times spread across [from, to): the k-th is the first kick at or after from + k·(to − from)/n not already
 *  taken (falling back to that even time where no kick is left before the next slot), in order. So a drawing's stroke
 *  groups cued across a line run from its first word to its last, each on a kick. */
export function kicksAcross(audio: AudioData, n: number, from: number, to: number): number[] {
  if (!(Number.isInteger(n) && n >= 0)) throw new Error(`kicksAcross: n must be a whole number of cues, not ${n}`);
  if (n > 0 && !(to > from)) throw new Error(`kicksAcross: an empty window, ${from} to ${to}`);
  const kicks = audio.events('kick', from, to).map(([t]) => t), out: number[] = [];
  let i = 0; // kicks before kicks[i] are taken, or passed over
  for (let k = 0; k < n; k++) {
    const slot = from + (k * (to - from)) / n, next = from + ((k + 1) * (to - from)) / n;
    while (i < kicks.length && kicks[i]! < slot) i++;
    out.push(i < kicks.length && kicks[i]! < next ? kicks[i++]! : slot);
  }
  return out;
}
/** When a word reaches full ink (inkAt, quantised): the first t with inkAt(w, t) = 1. inkAt only grows with t, so
 *  bisect the word's span for it. Throws if the word never gets there within its span (a zero-length word: inkAt is 0
 *  at its end). */
export function inkedAt(w: Word): number {
  let lo = w.start, hi = w.end;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (inkAt(w, m) >= 1) hi = m; else lo = m; }
  if (inkAt(w, hi) < 1) throw new Error(`"${w.w}" (line ${w.line}, word ${w.index}) never reaches full ink within its span (${w.start}–${w.end})`);
  return hi;
}
