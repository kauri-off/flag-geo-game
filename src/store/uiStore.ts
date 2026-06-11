// Lightweight UI navigation state (which screen is showing). Not persisted.
import { create } from 'zustand';

export type Screen = 'play' | 'challenge' | 'history' | 'settings';

interface UiState {
  screen: Screen;
  setScreen: (s: Screen) => void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'play',
  setScreen: (screen) => set({ screen }),
}));
