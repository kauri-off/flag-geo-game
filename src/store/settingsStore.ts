// Settings store: the single source of truth for all configurable game options.
// Persisted to localStorage. New options should be added here (and given a sane
// default) so the rest of the app reads them from one place.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../i18n';
import type { SizeBucket } from '../data/countries';
import { DEFAULT_MODE, type GameModeId } from '../game/modes';

export type ConfirmMode = 'spacebar' | 'click';

export interface DifficultyFilter {
  /** Allowed continents; empty array means "all continents". */
  continents: string[];
  /** Country-size bucket, or 'all'. */
  size: SizeBucket | 'all';
  /**
   * Recognition scope: 'un' = UN member states only, 'all' = also include
   * dependencies & territories. Optional/absent is treated as 'all' (keeps
   * older persisted settings and challenge configs valid).
   */
  scope?: 'un' | 'all';
}

export interface SettingsState {
  mode: GameModeId;
  language: Language;
  showLabels: boolean;
  confirmMode: ConfirmMode;
  difficulty: DifficultyFilter;
  soundOn: boolean;
  /** Sound effect volume, 0–100. */
  volume: number;
  /** On a wrong guess, also show the flag of the country the player picked. */
  showPickedFlag: boolean;
  /** Seconds allowed per round before it auto-reveals as a timeout. 0 = no limit. */
  answerSeconds: number;
  /**
   * Clicking the ocean selects the nearest country whose centroid is within this
   * radius (base map/viewBox units). 0 = off (ocean clicks do nothing).
   */
  oceanSnapRadius: number;

  setMode: (mode: GameModeId) => void;
  setLanguage: (lang: Language) => void;
  setShowLabels: (v: boolean) => void;
  setConfirmMode: (m: ConfirmMode) => void;
  toggleContinent: (continent: string) => void;
  setSize: (size: SizeBucket | 'all') => void;
  setScope: (scope: 'un' | 'all') => void;
  setSoundOn: (v: boolean) => void;
  setVolume: (v: number) => void;
  setShowPickedFlag: (v: boolean) => void;
  setAnswerSeconds: (s: number) => void;
  setOceanSnapRadius: (r: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      mode: DEFAULT_MODE,
      language: 'en',
      showLabels: true,
      confirmMode: 'click',
      difficulty: { continents: [], size: 'all', scope: 'all' },
      soundOn: true,
      volume: 80,
      showPickedFlag: false,
      answerSeconds: 10,
      oceanSnapRadius: 25,

      setMode: (mode) => set({ mode }),
      setLanguage: (language) => set({ language }),
      setShowLabels: (showLabels) => set({ showLabels }),
      setConfirmMode: (confirmMode) => set({ confirmMode }),
      toggleContinent: (continent) =>
        set((s) => {
          const has = s.difficulty.continents.includes(continent);
          return {
            difficulty: {
              ...s.difficulty,
              continents: has
                ? s.difficulty.continents.filter((c) => c !== continent)
                : [...s.difficulty.continents, continent],
            },
          };
        }),
      setSize: (size) =>
        set((s) => ({ difficulty: { ...s.difficulty, size } })),
      setScope: (scope) =>
        set((s) => ({ difficulty: { ...s.difficulty, scope } })),
      setSoundOn: (soundOn) => set({ soundOn }),
      setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, Math.round(volume))) }),
      setShowPickedFlag: (showPickedFlag) => set({ showPickedFlag }),
      setAnswerSeconds: (answerSeconds) =>
        set({ answerSeconds: Math.min(60, Math.max(0, Math.round(answerSeconds))) }),
      setOceanSnapRadius: (oceanSnapRadius) =>
        set({ oceanSnapRadius: Math.min(60, Math.max(0, Math.round(oceanSnapRadius))) }),
    }),
    { name: 'flag-geo-settings' },
  ),
);
