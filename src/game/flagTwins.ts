// Some countries have flags that are visually (near-)identical, so a flag-only
// quiz can't fairly distinguish them. We treat each group as interchangeable:
// guessing any member of the same group as the target counts as correct.
//
// Keyed by numeric ISO 3166-1 codes (matching CountryMeta.id):
//   642 Romania   / 148 Chad        — blue-yellow-red vertical tricolor
//   360 Indonesia / 492 Monaco      — red-white horizontal bicolor
//   250 France + overseas territories that fly the plain blue-white-red
//       tricolor: 652 St Barthélemy, 663 St Martin, 312 Guadeloupe,
//       638 Réunion, 175 Mayotte, 666 St Pierre & Miquelon, 876 Wallis & Futuna
//   826 United Kingdom / 654 St Helena, Ascension & Tristan da Cunha
const TWIN_GROUPS: string[][] = [
  ['642', '148'],
  ['360', '492'],
  ['250', '652', '663', '312', '638', '175', '666', '876'],
  ['826', '654'],
];

// id -> set of acceptable ids (including itself).
const twinLookup = new Map<string, Set<string>>();
for (const group of TWIN_GROUPS) {
  const set = new Set(group);
  for (const id of group) twinLookup.set(id, set);
}

/** True when two countries share an indistinguishable flag (or are the same). */
export function sameFlag(a: string, b: string): boolean {
  if (a === b) return true;
  return twinLookup.get(a)?.has(b) ?? false;
}
