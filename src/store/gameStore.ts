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
import { useSettings } from './settingsStore';
import { useHistory } from './historyStore';

export type RoundStatus = 'idle' | 'guessing' | 'revealed' | 'empty';

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
  /** Result of the just-revealed round. */
  lastCorrect: boolean | null;
  lastTimeMs: number | null;
  session: SessionStats;

  newRound: () => void;
  select: (id: string) => void;
  confirm: () => void;
  next: () => void;
  resetSession: () => void;
}

const emptySession = (): SessionStats => ({ rounds: 0, correct: 0, times: [] });

export const useGame = create<GameState>((set, get) => ({
  status: 'idle',
  targetId: null,
  targetAlpha2: null,
  selectedId: null,
  startedAt: 0,
  lastCorrect: null,
  lastTimeMs: null,
  session: emptySession(),

  newRound: () => {
    const { difficulty } = useSettings.getState();
    const pool = buildPool(difficulty);
    // Key the shuffle bag to the active filters so it refills when they change.
    const key = `${difficulty.size}|${[...difficulty.continents].sort().join(',')}`;
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
      startedAt: performance.now(),
    });
  },

  select: (id) => {
    const { status } = get();
    if (status !== 'guessing') return;
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
    const { status, targetId, targetAlpha2, selectedId, startedAt } = get();
    if (status !== 'guessing' || !targetId || !targetAlpha2) return;

    const timeMs = performance.now() - startedAt;
    // Accept a country whose flag is indistinguishable from the target's.
    const correct = !!selectedId && sameFlag(selectedId, targetId);
    const settings = useSettings.getState();
    const mode = settings.mode;

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

    set((s) => ({
      status: 'revealed',
      lastCorrect: correct,
      lastTimeMs: timeMs,
      session: {
        rounds: s.session.rounds + 1,
        correct: s.session.correct + (correct ? 1 : 0),
        times: correct ? [...s.session.times, timeMs] : s.session.times,
      },
    }));
  },

  next: () => get().newRound(),

  resetSession: () => set({ session: emptySession() }),
}));
