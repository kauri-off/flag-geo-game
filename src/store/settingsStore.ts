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
}

export interface SettingsState {
  mode: GameModeId;
  language: Language;
  showLabels: boolean;
  confirmMode: ConfirmMode;
  difficulty: DifficultyFilter;
  /** On-screen map width as a percentage of the available area (40–100). */
  mapSize: number;
  soundOn: boolean;
  /** Sound effect volume, 0–100. */
  volume: number;
  /** On a wrong guess, also show the flag of the country the player picked. */
  showPickedFlag: boolean;
  /** Seconds allowed per round before it auto-reveals as a timeout. 0 = no limit. */
  answerSeconds: number;
  /** Size of the question flag, as a percentage of the default (50–200). */
  flagSize: number;

  setMode: (mode: GameModeId) => void;
  setLanguage: (lang: Language) => void;
  setShowLabels: (v: boolean) => void;
  setConfirmMode: (m: ConfirmMode) => void;
  toggleContinent: (continent: string) => void;
  setSize: (size: SizeBucket | 'all') => void;
  setMapSize: (pct: number) => void;
  setSoundOn: (v: boolean) => void;
  setVolume: (v: number) => void;
  setShowPickedFlag: (v: boolean) => void;
  setAnswerSeconds: (s: number) => void;
  setFlagSize: (n: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      mode: DEFAULT_MODE,
      language: 'en',
      showLabels: true,
      confirmMode: 'click',
      difficulty: { continents: [], size: 'all' },
      mapSize: 100,
      soundOn: true,
      volume: 80,
      showPickedFlag: false,
      answerSeconds: 10,
      flagSize: 100,

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
      setMapSize: (mapSize) =>
        set({ mapSize: Math.min(100, Math.max(40, Math.round(mapSize))) }),
      setSoundOn: (soundOn) => set({ soundOn }),
      setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, Math.round(volume))) }),
      setShowPickedFlag: (showPickedFlag) => set({ showPickedFlag }),
      setAnswerSeconds: (answerSeconds) =>
        set({ answerSeconds: Math.min(60, Math.max(0, Math.round(answerSeconds))) }),
      setFlagSize: (flagSize) =>
        set({ flagSize: Math.min(200, Math.max(50, Math.round(flagSize))) }),
    }),
    { name: 'flag-geo-settings' },
  ),
);
