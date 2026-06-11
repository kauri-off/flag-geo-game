// Pure stat aggregation. Used for both all-time (from history) and session views.
import type { RoundRecord, SessionStats, Stats } from './types';

export function statsFromRounds(rounds: RoundRecord[]): Stats {
  const correctRounds = rounds.filter((r) => r.correct);
  const times = correctRounds.map((r) => r.timeMs);
  return {
    rounds: rounds.length,
    correct: correctRounds.length,
    accuracy: rounds.length ? correctRounds.length / rounds.length : 0,
    avgTimeMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    bestTimeMs: times.length ? Math.min(...times) : null,
  };
}

export function statsFromSession(s: SessionStats): Stats {
  return {
    rounds: s.rounds,
    correct: s.correct,
    accuracy: s.rounds ? s.correct / s.rounds : 0,
    avgTimeMs: s.times.length ? s.times.reduce((a, b) => a + b, 0) / s.times.length : null,
    bestTimeMs: s.times.length ? Math.min(...s.times) : null,
  };
}

export function formatTime(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatAccuracy(acc: number): string {
  return `${Math.round(acc * 100)}%`;
}
