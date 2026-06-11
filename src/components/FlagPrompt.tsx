// Renders the round prompt. Mode-aware: the "flag-to-map" mode shows a flag; a
// future "name-to-map" mode would show a country name here instead.
import { Flag } from './Flag';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { countryById } from '../data/countries';
import { GAME_MODES } from '../game/modes';
import { t } from '../i18n';

export function FlagPrompt() {
  const targetAlpha2 = useGame((s) => s.targetAlpha2);
  const status = useGame((s) => s.status);
  const lastCorrect = useGame((s) => s.lastCorrect);
  const selectedId = useGame((s) => s.selectedId);
  const language = useSettings((s) => s.language);
  const modeId = useSettings((s) => s.mode);
  const showPickedFlag = useSettings((s) => s.showPickedFlag);
  const mode = GAME_MODES[modeId];

  // Flag size comes from the --fi-size variable set on the overlay (see
  // RoundBoard); falls back to the 3rem base if rendered outside one.
  const flagStyle = { fontSize: 'var(--fi-size, 3rem)' };

  // After a wrong guess (opt-in), show the flag of the country the player picked
  // beside the question flag, at the same size, for comparison.
  const pickedMeta = selectedId ? countryById.get(selectedId) : undefined;
  const showPicked =
    showPickedFlag && status === 'revealed' && !lastCorrect && pickedMeta;

  return (
    <div className="prompt">
      <div className="prompt-text">{t('prompt', language)}</div>
      {mode.prompt === 'flag' && targetAlpha2 && status !== 'empty' && (
        <div className="prompt-flags">
          {/* Empty left cell keeps the question flag centered whether or not
              the picked flag is shown on the right. */}
          <span aria-hidden />
          <Flag alpha2={targetAlpha2} className="flag-big" style={flagStyle} />
          {showPicked && (
            <Flag
              alpha2={pickedMeta.alpha2}
              className="flag-big prompt-flag-picked"
              style={flagStyle}
            />
          )}
        </div>
      )}
    </div>
  );
}
