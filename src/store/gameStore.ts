// Core game loop (session state, not persisted). Orchestrates the other modules:
// reads the difficulty pool from settings, records finished rounds into history,
// and keeps live session stats. Kept renderer-agnostic.
import { create } from 'zustand';
import { buildPool, nextFromBag } from '../game/pool';
import { sameFlag } from '../game/flagTwins';
import type { RoundRecord, SessionStats } from '../game/types';
import { countryById } from '../data/countries';
import { countryName } from '../i18n';
import { playSelect, playCorrect, playWrong } from '../game/sound';
import { roundPoints, type ChallengeConfig, type ChallengeState } from '../game/challenge';
import { useSettings } from './settingsStore';
import { useHistory } from './historyStore';

export type RoundStatus = 'idle' | 'guessing' | 'revealed' | 'empty' | 'finished';

export interface GameState {
  status: RoundStatus;
  /** Numeric ISO id of the country to find. */
  targetId: string | null;
  /** Alpha-2 of the shown flag. */
  targetAlpha2: string | null;
  /** Country the player has currently picked. */
  selectedId: string | null;
  /** performance.now() timestamp when the round started. */
  startedAt: number;
  /** performance.now() timestamp the answer clock was paused at, or null if running. */
  pausedAt: number | null;
  /** Result of the just-revealed round. */
  lastCorrect: boolean | null;
  lastTimeMs: number | null;
  /** The just-revealed round ended because the answer timer ran out. */
  lastTimedOut: boolean;
  /** Guesses still available this round (challenge multi-attempt; 1 otherwise). */
  attemptsLeft: number;
  /** Countries already guessed wrong this round, kept for the red highlight. */
  wrongPicks: string[];
  session: SessionStats;
  /** Active scored run, or null during free practice. */
  challenge: ChallengeState | null;

  /** True while an online match owns the board: the server drives rounds and
   *  scores answers, so newRound()/the answer timer are disabled and confirm()
   *  submits to the server instead of recording history. */
  online: boolean;
  /** Index of the current online round (echoed back on submit). */
  onlineRoundIndex: number;
  /** The online room's per-answer limit (seconds) for the countdown bar. */
  onlineTimeLimitSec: number;
  /** True once the player has submitted this online round (locks the board). */
  answeredOnline: boolean;
  /** Submit hook wired up by the online store; null when offline. */
  submitOnline: ((roundIndex: number, countryId: string) => void) | null;

  newRound: () => void;
  select: (id: string) => void;
  confirm: () => void;
  timeUp: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  resetSession: () => void;
  startChallenge: (config: ChallengeConfig) => void;
  endChallenge: () => void;

  setOnline: (on: boolean, submit?: (roundIndex: number, countryId: string) => void) => void;
  setOnlineRound: (r: { index: number; alpha2: string; targetId: string; timeLimitSec: number }) => void;
  applyOnlineResult: (r: { targetId: string; correct: boolean; timeMs: number; timedOut: boolean }) => void;
}

const emptySession = (): SessionStats => ({ rounds: 0, correct: 0, times: [] });

export const useGame = create<GameState>((set, get) => ({
  status: 'idle',
  targetId: null,
  targetAlpha2: null,
  selectedId: null,
  startedAt: 0,
  pausedAt: null,
  lastCorrect: null,
  lastTimeMs: null,
  lastTimedOut: false,
  attemptsLeft: 1,
  wrongPicks: [],
  session: emptySession(),
  challenge: null,

  online: false,
  onlineRoundIndex: 0,
  onlineTimeLimitSec: 0,
  answeredOnline: false,
  submitOnline: null,

  newRound: () => {
    // Online rounds are driven by the server; the local loop is a no-op.
    if (get().online) return;
    const { challenge } = get();
    // A finished challenge run stops here; the screen switches to the analysis.
    if (challenge && challenge.results.length >= challenge.config.rounds) {
      set({ status: 'finished' });
      return;
    }
    // Challenges run their own difficulty; free practice reads it from settings.
    const difficulty = challenge
      ? challenge.config.difficulty
      : useSettings.getState().difficulty;
    const pool = buildPool(difficulty);
    // Key the shuffle bag to the active filters so it refills when they change.
    const key = `${difficulty.scope ?? 'all'}|${difficulty.size}|${[...difficulty.continents].sort().join(',')}`;
    const target = nextFromBag(pool, key, get().targetId ?? undefined);
    if (!target) {
      set({ status: 'empty', targetId: null, targetAlpha2: null, selectedId: null });
      return;
    }
    set({
      status: 'guessing',
      targetId: target.id,
      targetAlpha2: target.alpha2,
      selectedId: null,
      lastCorrect: null,
      lastTimeMs: null,
      lastTimedOut: false,
      attemptsLeft: challenge ? challenge.config.attempts ?? 1 : 1,
      wrongPicks: [],
      startedAt: performance.now(),
      pausedAt: null,
    });
  },

  select: (id) => {
    const { status, wrongPicks, online, answeredOnline } = get();
    if (status !== 'guessing') return;
    // Once an online answer is locked in, the board is read-only until reveal.
    if (online && answeredOnline) return;
    // A country already guessed wrong this round can't be picked again.
    if (wrongPicks.includes(id)) return;
    set({ selectedId: id });
    const settings = useSettings.getState();
    // In click-to-confirm mode the result sound follows immediately, so skip the
    // pick blip to avoid stacking two sounds.
    if (settings.confirmMode === 'click') {
      get().confirm();
    } else if (settings.soundOn) {
      playSelect();
    }
  },

  confirm: () => {
    // Online: submit the pick to the server (authoritative) and lock the board.
    // The reveal arrives later via applyOnlineResult.
    const s0 = get();
    if (s0.online) {
      if (s0.status !== 'guessing' || s0.answeredOnline || !s0.selectedId || !s0.submitOnline) {
        return;
      }
      if (useSettings.getState().soundOn) playSelect();
      s0.submitOnline(s0.onlineRoundIndex, s0.selectedId);
      set({ answeredOnline: true });
      return;
    }

    const { status, targetId, targetAlpha2, selectedId, startedAt, challenge, attemptsLeft, lastTimedOut, wrongPicks } = get();
    if (status !== 'guessing' || !targetId || !targetAlpha2) return;

    const timeMs = performance.now() - startedAt;
    // Accept a country whose flag is indistinguishable from the target's.
    const correct = !!selectedId && sameFlag(selectedId, targetId);
    const settings = useSettings.getState();
    const mode = settings.mode;

    // Challenge multi-attempt: a wrong (non-timeout) guess with tries to spare
    // doesn't end the round — mark the pick and let the player try again.
    if (challenge && selectedId && !correct && !lastTimedOut && attemptsLeft > 1) {
      if (settings.soundOn) playWrong();
      set({
        attemptsLeft: attemptsLeft - 1,
        wrongPicks: [...wrongPicks, selectedId],
        selectedId: null,
      });
      return;
    }

    if (settings.soundOn) (correct ? playCorrect : playWrong)();

    const record: RoundRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: Date.now(),
      mode,
      flagAlpha2: targetAlpha2,
      targetId,
      targetName: countryName(targetId, 'en', countryById.get(targetId)?.alpha3),
      guessId: selectedId,
      guessName: selectedId
        ? countryName(selectedId, 'en', countryById.get(selectedId)?.alpha3)
        : null,
      correct,
      timeMs,
    };

    useHistory.getState().addRound(record);

    set((s) => {
      const next: Partial<GameState> = {
        status: 'revealed',
        lastCorrect: correct,
        lastTimeMs: timeMs,
        session: {
          rounds: s.session.rounds + 1,
          correct: s.session.correct + (correct ? 1 : 0),
          times: correct ? [...s.session.times, timeMs] : s.session.times,
        },
      };
      if (s.challenge) {
        const points = roundPoints(correct, timeMs, s.challenge.config.timeLimitSec);
        next.challenge = {
          ...s.challenge,
          score: s.challenge.score + points,
          results: [
            ...s.challenge.results,
            { targetId, correct, timedOut: s.lastTimedOut, timeMs, points },
          ],
        };
      }
      return next;
    });
  },

  timeUp: () => {
    if (get().status !== 'guessing') return;
    // Flag the round as timed out, then lock in whatever (if anything) is picked.
    set({ lastTimedOut: true });
    get().confirm();
  },

  // Freeze the answer clock while the board is off-screen (e.g. the player opened
  // settings). Only a live guess has a clock to pause; a no-op otherwise.
  pause: () => {
    const { status, pausedAt } = get();
    if (status !== 'guessing' || pausedAt !== null) return;
    set({ pausedAt: performance.now() });
  },

  // Resume by shifting startedAt forward over the paused span, so elapsed time
  // excludes it. Both the countdown bar and the timeout key off startedAt, so
  // they stay in sync instead of drifting by however long the board was away.
  resume: () => {
    const { pausedAt, startedAt } = get();
    if (pausedAt === null) return;
    set({ startedAt: startedAt + (performance.now() - pausedAt), pausedAt: null });
  },

  next: () => get().newRound(),

  resetSession: () => set({ session: emptySession() }),

  startChallenge: (config) => {
    // Fresh run: clear any leftover target so the first pick is unbiased.
    set({ challenge: { config, results: [], score: 0 }, targetId: null });
    get().newRound();
  },

  endChallenge: () => set({ challenge: null, status: 'idle' }),

  setOnline: (on, submit) =>
    set({
      online: on,
      submitOnline: on ? submit ?? get().submitOnline : null,
      // Leaving online mode parks the board until the next (offline) round.
      ...(on ? {} : { status: 'idle', selectedId: null, answeredOnline: false }),
    }),

  // Called when the server starts a round: show the flag and accept clicks.
  setOnlineRound: ({ index, alpha2, targetId, timeLimitSec }) =>
    set({
      online: true,
      status: 'guessing',
      onlineRoundIndex: index,
      onlineTimeLimitSec: timeLimitSec,
      answeredOnline: false,
      targetId,
      targetAlpha2: alpha2,
      selectedId: null,
      wrongPicks: [],
      attemptsLeft: 1,
      lastCorrect: null,
      lastTimeMs: null,
      lastTimedOut: false,
      startedAt: performance.now(),
      pausedAt: null,
    }),

  // Called when the server reveals the round: flip to the green/red result. The
  // authoritative target id comes from the server so the highlight is correct.
  applyOnlineResult: ({ targetId, correct, timeMs, timedOut }) => {
    if (useSettings.getState().soundOn) (correct ? playCorrect : playWrong)();
    set({
      status: 'revealed',
      targetId,
      lastCorrect: correct,
      lastTimeMs: timeMs,
      lastTimedOut: timedOut,
    });
  },
}));
