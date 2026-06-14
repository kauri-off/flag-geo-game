// Shared constants and pure helpers for the flag-selection (difficulty) filter.
// Used by the one DifficultyPicker component so free practice, challenge setup
// and online rooms all offer identical options. Keep this the single source for
// the option lists and the default filter.
import { CONTINENTS, countries, type SizeBucket } from '../data/countries';
import { mapIds } from '../map/world';
import type { DifficultyFilter } from '../store/settingsStore';

export type { DifficultyFilter };
export { CONTINENTS };

/** Sensible default: every country on the map, no size or scope restriction. */
export const DEFAULT_DIFFICULTY: DifficultyFilter = {
  continents: [],
  size: 'all',
  scope: 'all',
};

export const SIZES: { value: SizeBucket | 'all'; key: 'sizeAll' | 'sizeSmall' | 'sizeMedium' | 'sizeLarge' }[] = [
  { value: 'all', key: 'sizeAll' },
  { value: 'small', key: 'sizeSmall' },
  { value: 'medium', key: 'sizeMedium' },
  { value: 'large', key: 'sizeLarge' },
];

// Counts shown on the scope chips. Computed once from the countries actually
// present on the map.
const onMapCountries = countries.filter((c) => mapIds.has(c.id));
export const SCOPES: {
  value: 'all' | 'un';
  key: 'scopeAll' | 'scopeUn';
  desc: 'scopeAllDesc' | 'scopeUnDesc';
  count: number;
}[] = [
  { value: 'all', key: 'scopeAll', desc: 'scopeAllDesc', count: onMapCountries.length },
  {
    value: 'un',
    key: 'scopeUn',
    desc: 'scopeUnDesc',
    count: onMapCountries.filter((c) => c.unMember).length,
  },
];

/** Return a new filter with `continent` toggled in the allowed set. */
export function toggleContinent(filter: DifficultyFilter, continent: string): DifficultyFilter {
  const has = filter.continents.includes(continent);
  return {
    ...filter,
    continents: has
      ? filter.continents.filter((c) => c !== continent)
      : [...filter.continents, continent],
  };
}
