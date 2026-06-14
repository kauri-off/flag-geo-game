// Some countries have flags that are visually (near-)identical, so a flag-only
// quiz can't fairly distinguish them. Two cases, handled differently:
//
//  1. Pixel-identical artwork (dependent territories flying their parent's flag:
//     French overseas collectivities, Heard Island, St Helena, ...). These are
//     derived automatically from the flag-icons set in flagTwins.generated.ts.
//     For each such group ONE representative stays guessable and the rest are
//     marked non-guessable in src/map/world.ts — so an indistinguishable flag is
//     never shown. They're still listed here so sameFlag() stays correct.
//
//  2. Perceptual near-twins that flag-icons renders DIFFERENTLY but a player
//     still can't tell apart (Indonesia/Monaco). Artwork hashing can't catch
//     these, so they're maintained by hand below. Both members stay guessable;
//     guessing either one counts as correct.
//
// Keyed by numeric ISO 3166-1 codes (matching CountryMeta.id):
//   360 Indonesia / 492 Monaco — red-white horizontal bicolor
import { ARTWORK_TWIN_GROUPS, NON_GUESSABLE_TWIN_IDS } from './flagTwins.generated';

const MANUAL_TWIN_GROUPS: string[][] = [
  ['360', '492'],
];

const TWIN_GROUPS: string[][] = [...ARTWORK_TWIN_GROUPS, ...MANUAL_TWIN_GROUPS];

// id -> set of acceptable ids (including itself).
const twinLookup = new Map<string, Set<string>>();
for (const group of TWIN_GROUPS) {
  const set = new Set(group);
  for (const id of group) twinLookup.set(id, set);
}

/** Ids that fly another country's identical flag and so are excluded from play. */
export const nonGuessableTwins = new Set(NON_GUESSABLE_TWIN_IDS);

/** True when two countries share an indistinguishable flag (or are the same). */
export function sameFlag(a: string, b: string): boolean {
  if (a === b) return true;
  return twinLookup.get(a)?.has(b) ?? false;
}
