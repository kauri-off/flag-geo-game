// Shared game-domain types. Independent of React and of any specific renderer.

export interface RoundRecord {
  /** Unique id for the record. */
  id: string;
  /** Epoch ms when the round was completed. */
  date: number;
  /** Game mode key, e.g. "flag-to-map". */
  mode: string;
  /** How the round was played. Absent on records from older versions (practice). */
  kind?: 'practice' | 'challenge';
  /** Alpha-2 of the shown flag. */
  flagAlpha2: string;
  /** Numeric ISO id of the correct country. */
  targetId: string;
  /** English name of the correct country (stored for a language-agnostic log). */
  targetName: string;
  /** Numeric ISO id the player picked, or null if none. */
  guessId: string | null;
  /** English name the player picked, or null. */
  guessName: string | null;
  /** Whether the guess was correct. */
  correct: boolean;
  /** Elapsed time in ms (performance.now precision). */
  timeMs: number;
}

export interface SessionStats {
  rounds: number;
  correct: number;
  /** Times (ms) of correct rounds only, for avg/best. */
  times: number[];
}

export interface Stats {
  rounds: number;
  correct: number;
  accuracy: number; // 0..1
  avgTimeMs: number | null;
  bestTimeMs: number | null;
}
