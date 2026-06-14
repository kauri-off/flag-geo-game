// The live race view. The shared RoundBoard paints the full-screen map plus its
// own fixed overlays (flag prompt, timer, controls, feedback); on top of that we
// float a fixed HUD (top-right, like the challenge HUD) with the round counter
// and the live scoreboard. The board submits answers to the server because
// useGame.online is set.
import { useEffect, useState } from 'react';
import { RoundBoard } from '../components/RoundBoard';
import { Scoreboard } from './Scoreboard';
import { useOnline } from '../store/onlineStore';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

// Counts down the gap between rounds so the cooldown is visible. After the last
// round the same pause precedes the final results, so the label adapts.
function IntermissionPill() {
  const language = useSettings((s) => s.language);
  const until = useOnline((s) => s.intermissionUntil);
  const round = useOnline((s) => s.round);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  if (until == null) return null;
  const secs = Math.max(0, Math.ceil((until - now) / 1000));
  const isLast = round ? round.index + 1 >= round.total : false;
  const label = isLast ? t('resultsIn', language) : t('nextRoundIn', language);
  return (
    <div className="round-timer">
      <span className="round-timer-label">{label}</span>
      <span className="round-timer-secs">{secs}s</span>
    </div>
  );
}

export function OnlineRound() {
  const language = useSettings((s) => s.language);
  const round = useOnline((s) => s.round);
  const phase = useOnline((s) => s.phase);
  const status = useGame((s) => s.status);
  const answered = useGame((s) => s.answeredOnline);

  return (
    <>
      <RoundBoard />
      {phase === 'intermission' && <IntermissionPill />}
      <div className="online-hud">
        {round && (
          <div className="online-hud-round">
            <span className="hud-key">{t('round', language)}</span>
            <span className="hud-val">
              {round.index + 1}/{round.total}
            </span>
          </div>
        )}
        {phase !== 'intermission' && answered && status === 'guessing' && (
          <div className="waiting-pill">{t('waitingForResult', language)}</div>
        )}
        <Scoreboard />
      </div>
    </>
  );
}
