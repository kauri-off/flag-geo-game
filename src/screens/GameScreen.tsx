// Composes the playable round: prompt + map + controls + live session stats.
// Owns the Spacebar handling that ties the keyboard to the store actions.
import { useEffect } from 'react';
import { WorldMap } from '../components/WorldMap';
import { FlagPrompt } from '../components/FlagPrompt';
import { GameControls } from '../components/GameControls';
import { Feedback } from '../components/Feedback';
import { StatsRow } from '../components/StatsRow';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { statsFromSession } from '../game/stats';
import { t } from '../i18n';

export function GameScreen() {
  const status = useGame((s) => s.status);
  const newRound = useGame((s) => s.newRound);
  const confirm = useGame((s) => s.confirm);
  const next = useGame((s) => s.next);
  const session = useGame((s) => s.session);
  const language = useSettings((s) => s.language);
  const confirmMode = useSettings((s) => s.confirmMode);

  // Start the first round when entering an idle game.
  useEffect(() => {
    if (status === 'idle' || status === 'empty') newRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spacebar: confirm during a guess (spacebar mode), advance after reveal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      const s = useGame.getState();
      if (s.status === 'revealed') next();
      else if (s.status === 'guessing' && confirmMode === 'spacebar') confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, next, confirmMode]);

  return (
    <div className="game">
      <FlagPrompt />
      {status === 'empty' ? (
        <div className="pool-empty">{t('poolEmpty', language)}</div>
      ) : (
        <>
          <div className="map-area">
            <WorldMap />
            <Feedback />
          </div>
          <GameControls />
        </>
      )}
      <div className="session-stats">
        <div className="section-title">{t('sessionStats', language)}</div>
        <StatsRow stats={statsFromSession(session)} language={language} />
      </div>
    </div>
  );
}
