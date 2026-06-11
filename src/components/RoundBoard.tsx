// The interactive round: prompt, countdown, map, feedback and controls, plus the
// keyboard handling and the answer-timeout. Shared by free practice (GameScreen)
// and the scored Challenge run, so both behave identically.
import { useEffect, type CSSProperties } from 'react';
import { WorldMap } from './WorldMap';
import { FlagPrompt } from './FlagPrompt';
import { GameControls } from './GameControls';
import { Feedback } from './Feedback';
import { Timer } from './Timer';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function RoundBoard() {
  const status = useGame((s) => s.status);
  const startedAt = useGame((s) => s.startedAt);
  const challenge = useGame((s) => s.challenge);
  const confirm = useGame((s) => s.confirm);
  const next = useGame((s) => s.next);
  const language = useSettings((s) => s.language);
  const confirmMode = useSettings((s) => s.confirmMode);
  const practiceSeconds = useSettings((s) => s.answerSeconds);
  const flagSize = useSettings((s) => s.flagSize);

  // A challenge sets its own per-answer limit; free practice uses the setting.
  const answerSeconds = challenge ? challenge.config.timeLimitSec : practiceSeconds;

  // Single source for the flag font-size: drives both the flags and the overlay
  // width (sized to fit two flags) so the prompt text wraps instead of stretching
  // the panel. 100% => 3rem (the overlay's base).
  const overlayStyle = { '--fi-size': `${(flagSize / 100) * 3}rem` } as CSSProperties;

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

  // Answer timer: when it runs out, lock in the round as a timeout. Re-armed on
  // every new round (startedAt changes) and disabled when the limit is 0.
  useEffect(() => {
    if (status !== 'guessing' || answerSeconds <= 0) return;
    const id = window.setTimeout(() => {
      const g = useGame.getState();
      if (g.status === 'guessing') g.timeUp();
    }, answerSeconds * 1000);
    return () => clearTimeout(id);
  }, [status, startedAt, answerSeconds]);

  if (status === 'empty') {
    return (
      <>
        <FlagPrompt />
        <div className="pool-empty">{t('poolEmpty', language)}</div>
      </>
    );
  }

  return (
    <>
      <div className="map-area">
        <WorldMap
          overlay={
            // Flag prompt + countdown float over the top-left corner of the map.
            <div className="map-overlay" style={overlayStyle}>
              <FlagPrompt />
              <Timer seconds={answerSeconds} />
            </div>
          }
        />
        <Feedback />
      </div>
      <GameControls />
    </>
  );
}
