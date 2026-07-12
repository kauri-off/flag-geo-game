import { describe, it, expect } from 'vitest';
import {
  roundPoints,
  analyzeChallenge,
  MAX_POINTS,
  MIN_POINTS,
  PERFECT_SEC,
  type ChallengeState,
} from './challenge';
import { DEFAULT_DIFFICULTY } from './difficulty';

describe('roundPoints', () => {
  it('scores 0 for a wrong answer regardless of time', () => {
    expect(roundPoints(false, 500, 10)).toBe(0);
    expect(roundPoints(false, 60_000, 0)).toBe(0);
  });

  it('scores full points for a fast correct answer', () => {
    expect(roundPoints(true, 0, 10)).toBe(MAX_POINTS);
    expect(roundPoints(true, PERFECT_SEC * 1000, 10)).toBe(MAX_POINTS);
  });

  it('scores the floor at or beyond the time limit', () => {
    expect(roundPoints(true, 10_000, 10)).toBe(MIN_POINTS);
    expect(roundPoints(true, 25_000, 10)).toBe(MIN_POINTS);
  });

  it('decays linearly between the perfect window and the limit', () => {
    // Halfway between PERFECT_SEC (3s) and a 13s limit is 8s.
    expect(roundPoints(true, 8000, 13)).toBe(
      Math.round(MAX_POINTS - 0.5 * (MAX_POINTS - MIN_POINTS)),
    );
  });

  it('falls back to the reference limit when the run is untimed', () => {
    // No limit: the 15s reference applies, so 15s+ correct answers score the floor.
    expect(roundPoints(true, 15_000, 0)).toBe(MIN_POINTS);
    expect(roundPoints(true, 2000, 0)).toBe(MAX_POINTS);
  });
});

describe('analyzeChallenge', () => {
  it('aggregates a finished run', () => {
    const state: ChallengeState = {
      config: { rounds: 3, timeLimitSec: 10, attempts: 1, difficulty: DEFAULT_DIFFICULTY },
      results: [
        { targetId: '840', correct: true, timedOut: false, timeMs: 2000, points: 1000 },
        { targetId: '250', correct: true, timedOut: false, timeMs: 6000, points: 700 },
        { targetId: '392', correct: false, timedOut: true, timeMs: 10_000, points: 0 },
      ],
      score: 1700,
    };
    const a = analyzeChallenge(state);
    expect(a.rounds).toBe(3);
    expect(a.correct).toBe(2);
    expect(a.accuracy).toBeCloseTo(2 / 3);
    expect(a.avgTimeMs).toBe(4000); // over correct answers only
    expect(a.bestTimeMs).toBe(2000);
    expect(a.perfect).toBe(1); // only the 2s answer is within PERFECT_SEC
    expect(a.timedOut).toBe(1);
    expect(a.score).toBe(1700);
    expect(a.maxScore).toBe(3000);
  });

  it('handles an empty run without dividing by zero', () => {
    const a = analyzeChallenge({
      config: { rounds: 5, timeLimitSec: 0, attempts: 1, difficulty: DEFAULT_DIFFICULTY },
      results: [],
      score: 0,
    });
    expect(a.accuracy).toBe(0);
    expect(a.avgTimeMs).toBeNull();
    expect(a.bestTimeMs).toBeNull();
  });
});
