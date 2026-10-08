// Which module prints each of the flatplan's spreads (spreads/flatplan.ts; docs/TREATMENT.md §4), by its id: the cover,
// the spreads built so far, and a placeholder for each of the rest until its module exists (a spread in progress needs
// no stub: an id without a module gets its placeholder, with its share of its section's lines). Factories must not touch
// the DOM (canvas, fonts, Path2D): the guards build every spread under bun (tests/sung.test.ts). Do font-dependent work
// on first draw, and cache it. A spread module must not import this file (it imports every spread): the factory types
// are in spread.ts, the ctx in flatplan.ts.
import type { AudioData } from '../engine/audio';
import type { Line, Lyrics } from '../engine/lyrics';
import { accessories } from './accessories';
import { backcover } from './backcover';
import { classifieds } from './classifieds';
import { contactsheet } from './contactsheet';
import { cover } from './cover';
import { corrections } from './corrections';
import { coverstory } from './coverstory';
import { type Resolved, type Timed, resolveFlatplan, spreadCtx } from './flatplan';
import { getthelook } from './getthelook';
import { insideback } from './insideback';
import { memoriam } from './memoriam';
import { perfume } from './perfume';
import { placeholder } from './placeholder';
import { ransom } from './ransom';
import { specimen } from './specimen';
import { type Spread, type SpreadFactory, turnOut } from './spread';
import { whoworeit } from './whoworeit';

export const SPREADS: Readonly<Record<string, SpreadFactory>> = Object.freeze({
  cover: (c) => cover(c.audio, c.lyrics, turnOut(c)), // (its turn out is the flip, into spread 1)
  getthelook, memoriam, coverstory, perfume, accessories, corrections, contactsheet, specimen, whoworeit, ransom, classifieds,
  insideback, backcover,
});

/** A line may start up to this long (s) before the spread that prints it comes up: a pickup into its turn ("I want you
 *  to dress" starts 0.21 s before verse 2's, "But you're already on a leash" 0.25 s before the accessories'). */
const PICKUP_S = 1;
/** The lyric lines the placeholder for spread i prints: its section's, split between the section's spreads where each
 *  comes up, less PICKUP_S — so verse 2's two split it at "But you're" — and every line of a section on one of them. */
export function placeholderLines(lyrics: Lyrics, plan: readonly Timed[], i: number): Line[] {
  const section = plan[i]!.section, own = plan.flatMap((e, j) => (e.section === section ? [j] : []));
  // the section's last spread up by PICKUP_S after the line starts; its first, for a line that starts before them all
  const spreadOf = (l: Line) => own.findLast((j) => plan[j]!.start <= l.start + PICKUP_S) ?? own[0];
  return lyrics.lines.filter((l) => l.section === section && spreadOf(l) === i);
}

/** The book's spreads, one per entry of the flatplan (`plan`: resolveFlatplan's), in its order: each entry's module from
 *  SPREADS (its own entries only), or a placeholder. */
export function makeSpreads(audio: AudioData, lyrics: Lyrics, plan: readonly Resolved[] = resolveFlatplan(audio, lyrics)): Spread[] {
  // every lyric line must belong to one of the audio's sections, and one some spread prints: a tag renamed after
  // re-alignment would otherwise silently empty its placeholder
  const names = new Set(audio.sections.map((s) => s.name)), printed = new Set(plan.map((e) => e.section));
  for (const l of lyrics.lines) {
    if (!names.has(l.section)) {
      throw new Error(`lyric line ${l.i} ("${l.text}") is tagged "${l.section}", which is not an audio section (${[...names].join(', ')})`);
    }
    if (!printed.has(l.section)) throw new Error(`lyric line ${l.i} ("${l.text}") is in ${l.section}, which no spread of the flatplan prints`);
  }
  return plan.map((e, i) => {
    const ctx = spreadCtx(audio, lyrics, plan, i);
    return Object.hasOwn(SPREADS, e.id) ? SPREADS[e.id]!(ctx) : placeholder(ctx, placeholderLines(lyrics, plan, i));
  });
}
