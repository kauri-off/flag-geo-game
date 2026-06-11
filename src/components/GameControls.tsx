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
  const language = useSettings((s) => s.language);
  const confirmMode = useSettings((s) => s.confirmMode);

  if (status === 'revealed') {
    return (
      <div className="controls">
        <button className="btn primary big" onClick={next}>
          {t('next', language)}
        </button>
        <span className="hint">{t('pressSpaceNext', language)}</span>
      </div>
    );
  }

  if (status === 'guessing') {
    return (
      <div className="controls">
        {confirmMode === 'spacebar' ? (
          <>
            <button
              className="btn primary big"
              onClick={confirm}
              disabled={!selectedId}
            >
              {t('confirm', language)}
            </button>
            <span className="hint">
              {selectedId ? t('pressSpace', language) : t('selectACountry', language)}
            </span>
          </>
        ) : (
          <span className="hint">{t('selectACountry', language)}</span>
        )}
      </div>
    );
  }

  return null;
}
