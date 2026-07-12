import { describe, it, expect } from 'vitest';
import { statsFromRounds, statsFromSession, formatTime, formatAccuracy } from './stats';
import type { RoundRecord } from './types';

const round = (correct: boolean, timeMs: number): RoundRecord => ({
  id: `${timeMs}`,
  date: 0,
  mode: 'flag-to-map',
  flagAlpha2: 'fr',
  targetId: '250',
  targetName: 'France',
  guessId: correct ? '250' : '276',
  guessName: correct ? 'France' : 'Germany',
  correct,
  timeMs,
});

describe('statsFromRounds', () => {
  it('returns empty stats for no rounds', () => {
    expect(statsFromRounds([])).toEqual({
      rounds: 0,
      correct: 0,
      accuracy: 0,
      avgTimeMs: null,
      bestTimeMs: null,
    });
  });

  it('averages times over correct rounds only', () => {
    const s = statsFromRounds([round(true, 2000), round(false, 9000), round(true, 4000)]);
    expect(s.rounds).toBe(3);
    expect(s.correct).toBe(2);
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.avgTimeMs).toBe(3000);
    expect(s.bestTimeMs).toBe(2000);
  });
});

describe('statsFromSession', () => {
  it('mirrors the session counters', () => {
    const s = statsFromSession({ rounds: 4, correct: 3, times: [1000, 2000, 3000] });
    expect(s.accuracy).toBe(0.75);
    expect(s.avgTimeMs).toBe(2000);
    expect(s.bestTimeMs).toBe(1000);
  });
});

describe('formatting', () => {
  it('formats times', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime(750)).toBe('750 ms');
    expect(formatTime(2345)).toBe('2.35 s');
  });

  it('formats accuracy as a rounded percentage', () => {
    expect(formatAccuracy(0)).toBe('0%');
    expect(formatAccuracy(2 / 3)).toBe('67%');
    expect(formatAccuracy(1)).toBe('100%');
  });
});
