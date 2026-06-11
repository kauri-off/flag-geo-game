// Persistent log of every completed round. This is the persistence boundary for
// long-term data; session-only state lives in gameStore.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RoundRecord } from '../game/types';

export interface HistoryState {
  rounds: RoundRecord[];
  addRound: (round: RoundRecord) => void;
  clear: () => void;
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      rounds: [],
      addRound: (round) =>
        // newest first; cap the log so localStorage can't grow unbounded.
        set((s) => ({ rounds: [round, ...s.rounds].slice(0, 1000) })),
      clear: () => set({ rounds: [] }),
    }),
    { name: 'flag-geo-history' },
  ),
);
