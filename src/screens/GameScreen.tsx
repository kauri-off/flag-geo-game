// Free-practice screen: an endless round loop. The round mechanics live in the
// shared RoundBoard; this screen only handles starting rounds and yielding to an
// active challenge.
import { useEffect } from 'react';
import { RoundBoard } from '../components/RoundBoard';
import { useGame } from '../store/gameStore';
import { useUi } from '../store/uiStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

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
      <RoundBoard />
    </div>
  );
}
