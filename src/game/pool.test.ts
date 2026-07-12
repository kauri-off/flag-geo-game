import { describe, it, expect, beforeEach } from 'vitest';
import { buildPool, nextFromBag, resetBag } from './pool';
import { sizeBucket, type CountryMeta } from '../data/countries';
import { DEFAULT_DIFFICULTY } from './difficulty';

const meta = (id: string): CountryMeta => ({
  id,
  alpha2: id,
  alpha3: id,
  area: 100_000,
  continent: 'Europe',
  subregion: '',
  unMember: true,
});

describe('buildPool', () => {
  it('returns the whole on-map pool for the default filter', () => {
    expect(buildPool(DEFAULT_DIFFICULTY).length).toBeGreaterThan(150);
  });

  it('restricts by continent', () => {
    const pool = buildPool({ ...DEFAULT_DIFFICULTY, continents: ['Europe'] });
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((c) => c.continent === 'Europe')).toBe(true);
  });

  it('restricts by size bucket', () => {
    const pool = buildPool({ ...DEFAULT_DIFFICULTY, size: 'large' });
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((c) => sizeBucket(c.area) === 'large')).toBe(true);
  });

  it('the UN scope is a strict subset of all countries', () => {
    const all = buildPool(DEFAULT_DIFFICULTY);
    const un = buildPool({ ...DEFAULT_DIFFICULTY, scope: 'un' });
    expect(un.length).toBeGreaterThan(0);
    expect(un.length).toBeLessThan(all.length);
    expect(un.every((c) => c.unMember)).toBe(true);
  });
});

describe('nextFromBag', () => {
  beforeEach(() => resetBag());

  it('returns null for an empty pool', () => {
    expect(nextFromBag([], 'k')).toBeNull();
  });

  it('always returns the only country of a one-entry pool', () => {
    const only = meta('1');
    expect(nextFromBag([only], 'k')).toBe(only);
    expect(nextFromBag([only], 'k')).toBe(only);
  });

  it('draws every country once before any repeat', () => {
    const pool = ['1', '2', '3', '4', '5'].map(meta);
    const seen = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const c = nextFromBag(pool, 'k');
      expect(c).not.toBeNull();
      seen.add(c!.id);
    }
    expect(seen.size).toBe(pool.length);
  });

  it('never repeats the previous country across a bag refill', () => {
    const pool = ['1', '2', '3'].map(meta);
    let last: string | undefined;
    // Enough draws to cross several refill boundaries.
    for (let i = 0; i < 30; i++) {
      const c = nextFromBag(pool, 'k', last);
      expect(c!.id).not.toBe(last);
      last = c!.id;
    }
  });

  it('rebuilds the bag when the key (filters) changes', () => {
    const pool = ['1', '2', '3', '4'].map(meta);
    nextFromBag(pool, 'a');
    const smaller = pool.slice(0, 2);
    // New key: draws must come from the new pool even mid-bag.
    for (let i = 0; i < 4; i++) {
      const c = nextFromBag(smaller, 'b');
      expect(['1', '2']).toContain(c!.id);
    }
  });
});
