// Challenge mode: a finite, scored run. The player configures the length, the
// per-answer time limit and the difficulty up front; each correct answer earns
// points that decay the longer it takes. Kept as pure data + functions so the
// game store stays renderer-agnostic and the scoring is easy to test/tweak.
import type { DifficultyFilter } from '../store/settingsStore';

export interface ChallengeConfig {
  /** Number of rounds in the run. */
  rounds: number;
  /** Seconds allowed per answer; 0 = no limit. */
  timeLimitSec: number;
  /** Guesses allowed per round before it's locked as wrong; 1 = single guess. */
  attempts: number;
  difficulty: DifficultyFilter;
}

export interface ChallengeRoundResult {
  targetId: string;
  correct: boolean;
  timedOut: boolean;
  timeMs: number;
  points: number;
}

export interface ChallengeState {
  config: ChallengeConfig;
  results: ChallengeRoundResult[];
  score: number;
}

/** Answer this fast (or faster) and you bank the full points. */
export const PERFECT_SEC = 3;
export const MAX_POINTS = 1000;
/** A correct-but-slow answer never scores less than this. */
export const MIN_POINTS = 100;
/** Reference limit used to scale scoring when the run has no time limit. */
const NO_LIMIT_REF_SEC = 15;

/**
 * Points for a single round: full marks for a correct answer within PERFECT_SEC,
 * decaying linearly to MIN_POINTS at the time limit, and 0 for a wrong/missed one.
 */
export function roundPoints(correct: boolean, timeMs: number, timeLimitSec: number): number {
  if (!correct) return 0;
  const seconds = timeMs / 1000;
  if (seconds <= PERFECT_SEC) return MAX_POINTS;
  const limit = timeLimitSec > 0 ? timeLimitSec : NO_LIMIT_REF_SEC;
  if (seconds >= limit) return MIN_POINTS;
  const frac = (seconds - PERFECT_SEC) / (limit - PERFECT_SEC); // 0..1
  return Math.round(MAX_POINTS - frac * (MAX_POINTS - MIN_POINTS));
}

export interface ChallengeAnalysis {
  rounds: number;
  correct: number;
  accuracy: number; // 0..1
  avgTimeMs: number | null;
  bestTimeMs: number | null;
  /** Correct answers given within PERFECT_SEC. */
  perfect: number;
  timedOut: number;
  score: number;
  maxScore: number;
}

/** End-of-run summary for the analysis screen. */
export function analyzeChallenge(state: ChallengeState): ChallengeAnalysis {
  const { results } = state;
  const correct = results.filter((r) => r.correct);
  const times = correct.map((r) => r.timeMs);
  return {
    rounds: results.length,
    correct: correct.length,
    accuracy: results.length ? correct.length / results.length : 0,
    avgTimeMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    bestTimeMs: times.length ? Math.min(...times) : null,
    perfect: correct.filter((r) => r.timeMs / 1000 <= PERFECT_SEC).length,
    timedOut: results.filter((r) => r.timedOut).length,
    score: state.score,
    maxScore: results.length * MAX_POINTS,
  };
}

export const DEFAULT_CHALLENGE: ChallengeConfig = {
  rounds: 20,
  timeLimitSec: 10,
  attempts: 1,
  difficulty: { continents: [], size: 'all' },
};

/** Preset round counts offered in the setup form. */
export const ROUND_PRESETS = [10, 20, 50, 100] as const;

/** Preset per-round guess counts offered in the setup form. */
export const ATTEMPT_PRESETS = [1, 2, 3] as const;
