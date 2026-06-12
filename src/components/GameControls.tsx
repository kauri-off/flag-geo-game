// Confirm / Next controls. The on-screen buttons are full Spacebar alternatives
// (mobile-friendly); the keyboard handling lives in GameScreen.
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function GameControls() {
  const status = useGame((s) => s.status);
  const selectedId = useGame((s) => s.selectedId);
  const confirm = useGame((s) => s.confirm);
  const next = useGame((s) => s.next);
  const challenge = useGame((s) => s.challenge);
  const language = useSettings((s) => s.language);
  const confirmMode = useSettings((s) => s.confirmMode);

  if (status === 'revealed') {
    // In a challenge the Next button lives in the HUD, next to Quit.
    if (challenge) return null;
    return (
      <div className="controls game-controls">
        <button className="btn primary big" onClick={next}>
          {t('next', language)}
        </button>
        <span className="hint">{t('pressSpaceNext', language)}</span>
      </div>
    );
  }

  if (status === 'guessing') {
    if (confirmMode === 'spacebar') {
      return (
        <div className="controls game-controls">
          <button
            className="btn primary big"
            onClick={confirm}
            disabled={!selectedId}
          >
            {t('confirm', language)}
          </button>
          {/* The "select a country" prompt is hidden during a challenge. */}
          {(selectedId || !challenge) && (
            <span className="hint">
              {selectedId ? t('pressSpace', language) : t('selectACountry', language)}
            </span>
          )}
        </div>
      );
    }
    // Click-to-confirm: only the prompt, and not during a challenge.
    if (challenge) return null;
    return (
      <div className="controls game-controls">
        <span className="hint">{t('selectACountry', language)}</span>
      </div>
    );
  }

  return null;
}
