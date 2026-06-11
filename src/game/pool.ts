// Builds the set of eligible quiz countries from the difficulty filters.
// Only countries that exist on the map AND have a flag/metadata are eligible.
import { countries, sizeBucket, type CountryMeta } from '../data/countries';
import { mapIds } from '../map/world';
import type { DifficultyFilter } from '../store/settingsStore';

export function buildPool(filter: DifficultyFilter): CountryMeta[] {
  return countries.filter((c) => {
    if (!mapIds.has(c.id)) return false;
    if (filter.continents.length && !filter.continents.includes(c.continent)) {
      return false;
    }
    if (filter.size !== 'all' && sizeBucket(c.area) !== filter.size) {
      return false;
    }
    return true;
  });
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Shuffle-bag picker. Pure random-with-replacement clusters badly (some
// countries appear 5× while others never show), which feels broken. Instead we
// shuffle the whole pool and draw without replacement, so every country comes up
// once before any repeat. The bag is rebuilt when the pool changes (key) or runs
// out, and we avoid an immediate repeat across the refill boundary.
let bag: CountryMeta[] = [];
let bagKey = '';

export function nextFromBag(
  pool: CountryMeta[],
  key: string,
  lastId?: string,
): CountryMeta | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  if (key !== bagKey || bag.length === 0) {
    bag = shuffle(pool.slice());
    bagKey = key;
    // The next draw pops from the end; make sure it isn't the country we just
    // showed (can happen right after a refill).
    if (lastId && bag[bag.length - 1].id === lastId) {
      [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
    }
  }
  return bag.pop() ?? null;
}
