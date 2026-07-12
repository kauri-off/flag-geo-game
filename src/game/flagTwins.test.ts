import { describe, it, expect } from 'vitest';
import { sameFlag, nonGuessableTwins } from './flagTwins';
import { ARTWORK_TWIN_GROUPS } from './flagTwins.generated';

describe('sameFlag', () => {
  it('is reflexive', () => {
    expect(sameFlag('840', '840')).toBe(true);
  });

  it('accepts the Indonesia/Monaco near-twins in both directions', () => {
    expect(sameFlag('360', '492')).toBe(true);
    expect(sameFlag('492', '360')).toBe(true);
  });

  it('rejects unrelated flags', () => {
    expect(sameFlag('360', '840')).toBe(false);
    expect(sameFlag('250', '276')).toBe(false);
  });
});

describe('artwork twin groups', () => {
  it('keeps at least one guessable representative per group', () => {
    for (const group of ARTWORK_TWIN_GROUPS) {
      expect(group.some((id) => !nonGuessableTwins.has(id))).toBe(true);
    }
  });

  it('members of a group are mutually acceptable answers', () => {
    for (const group of ARTWORK_TWIN_GROUPS) {
      for (const a of group) {
        for (const b of group) {
          expect(sameFlag(a, b)).toBe(true);
        }
      }
    }
  });
});
