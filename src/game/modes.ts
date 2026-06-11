// Game mode registry. Each mode describes what the player is shown and how the
// map behaves, while the scoring loop (gameStore) stays mode-agnostic. Adding a
// new mode (e.g. "find country by name") means adding one entry here plus a
// prompt renderer — no changes to the store, persistence or map.
import type { Language } from '../i18n';

export type GameModeId = 'flag-to-map';

export interface GameMode {
  id: GameModeId;
  /** How the target is presented to the player. */
  prompt: 'flag' | 'name';
  /** Localised human label for the mode. */
  label: Record<Language, string>;
}

export const GAME_MODES: Record<GameModeId, GameMode> = {
  'flag-to-map': {
    id: 'flag-to-map',
    prompt: 'flag',
    label: { en: 'Flag → Map', ru: 'Флаг → Карта' },
  },
  // Future:
  // 'name-to-map': { id: 'name-to-map', prompt: 'name', label: {...} },
};

export const DEFAULT_MODE: GameModeId = 'flag-to-map';
