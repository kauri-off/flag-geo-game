// Lightweight UI navigation state (which screen is showing). Not persisted.
import { create } from 'zustand';

export type Screen = 'play' | 'challenge' | 'online' | 'history' | 'settings';

interface UiState {
  screen: Screen;
  setScreen: (s: Screen) => void;
  /** Bumped to ask the map to fly-zoom into the current target country. The
   *  value is just a nonce; the map reads which country from the game store. */
  mapZoomNonce: number;
  requestMapZoom: () => void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'play',
  setScreen: (screen) => set({ screen }),
  mapZoomNonce: 0,
  requestMapZoom: () => set((s) => ({ mapZoomNonce: s.mapZoomNonce + 1 })),
}));
