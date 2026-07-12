// Free-practice screen: an endless round loop. The round mechanics live in the
// shared RoundBoard; this screen only handles starting rounds, showing the live
// session stats and yielding to an active challenge.
import { useEffect } from 'react';
import { RoundBoard } from '../components/RoundBoard';
import { useGame } from '../store/gameStore';
import { useUi } from '../store/uiStore';
import { useSettings } from '../store/settingsStore';
import { statsFromSession, formatTime, formatAccuracy } from '../game/stats';
import { t } from '../i18n';

// Live session stats, floating top-right like the challenge HUD (practice and
// challenge never show at once, so the spot is free). Hidden until a round has
// been answered so a fresh screen isn't cluttered.
function SessionHud() {
  const session = useGame((s) => s.session);
  const resetSession = useGame((s) => s.resetSession);
  const language = useSettings((s) => s.language);

  if (session.rounds === 0) return null;
  const stats = statsFromSession(session);

  return (
    <div className="challenge-hud session-hud">
      <div className="hud-item">
        <span className="hud-key">{t('sessionStats', language)}</span>
        <span className="hud-val">{stats.correct}/{stats.rounds}</span>
      </div>
      <div className="hud-item">
        <span className="hud-key">{t('accuracy', language)}</span>
        <span className="hud-val">{formatAccuracy(stats.accuracy)}</span>
      </div>
      <div className="hud-item">
        <span className="hud-key">{t('avgTime', language)}</span>
        <span className="hud-val">{formatTime(stats.avgTimeMs)}</span>
      </div>
      <div className="hud-actions">
        <button
          className="btn"
          onClick={resetSession}
          title={t('resetStats', language)}
          aria-label={t('resetStats', language)}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}

export function GameScreen() {
  const status = useGame((s) => s.status);
  const newRound = useGame((s) => s.newRound);
  const challenge = useGame((s) => s.challenge);
  const endChallenge = useGame((s) => s.endChallenge);
  const setScreen = useUi((s) => s.setScreen);
  const language = useSettings((s) => s.language);

  // Only a *running* challenge owns the board. A finished one is just leftover
  // results, so practice may reclaim the board.
  const challengeActive = !!challenge && status !== 'finished';

  useEffect(() => {
    if (challenge && status === 'finished') {
      // Entering practice on a completed run: drop it and start practising.
      endChallenge();
      newRound();
    } else if (!challengeActive && (status === 'idle' || status === 'empty')) {
      newRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A running challenge owns the shared game state; send the player to its screen
  // rather than clobbering its round here.
  if (challengeActive) {
    return (
      <div className="pool-empty">
        <p>{t('challengeInProgress', language)}</p>
        <button className="btn primary" onClick={() => setScreen('challenge')}>
          {t('goToChallenge', language)}
        </button>
      </div>
    );
  }

  return (
    <div className="game">
      <SessionHud />
      <RoundBoard />
    </div>
  );
}
