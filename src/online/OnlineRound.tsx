// The live race view. The shared RoundBoard paints the full-screen map plus its
// own fixed overlays (flag prompt, timer, controls, feedback); on top of that we
// float a fixed HUD (top-right, like the challenge HUD) with the round counter
// and the live scoreboard. The board submits answers to the server because
// useGame.online is set.
import { RoundBoard } from '../components/RoundBoard';
import { Scoreboard } from './Scoreboard';
import { useOnline } from '../store/onlineStore';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function OnlineRound() {
  const language = useSettings((s) => s.language);
  const round = useOnline((s) => s.round);
  const status = useGame((s) => s.status);
  const answered = useGame((s) => s.answeredOnline);

  return (
    <>
      <RoundBoard />
      <div className="online-hud">
        {round && (
          <div className="online-hud-round">
            <span className="hud-key">{t('round', language)}</span>
            <span className="hud-val">
              {round.index + 1}/{round.total}
            </span>
          </div>
        )}
        {answered && status === 'guessing' && (
          <div className="waiting-pill">{t('waitingForResult', language)}</div>
        )}
        <Scoreboard />
      </div>
    </>
  );
}
