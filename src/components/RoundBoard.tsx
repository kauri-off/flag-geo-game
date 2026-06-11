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

  // A challenge sets its own per-answer limit; free practice uses the setting.
  const answerSeconds = challenge ? challenge.config.timeLimitSec : practiceSeconds;

  // Flag font-size: drives both the flags and the overlay width (sized to fit two
  // flags) so the prompt text wraps instead of stretching the panel. Fixed at 6rem
  // (what the old "flag size" setting produced at 200%).
  const overlayStyle = { '--fi-size': '6rem' } as CSSProperties;

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

  // Pause the answer clock while the board is unmounted (the player navigated to
  // another screen) and resume it on return, so the timer doesn't keep "running"
  // off-screen and desync from the visible countdown.
  useEffect(() => {
    useGame.getState().resume();
    return () => useGame.getState().pause();
  }, []);

  // Answer timer: when it runs out, lock in the round as a timeout. Re-armed on
  // every new round and on resume (both change startedAt) and disabled when the
  // limit is 0. Fires after the *remaining* time so a partly-elapsed round isn't
  // granted the full limit again after navigating away and back.
  useEffect(() => {
    if (status !== 'guessing' || answerSeconds <= 0) return;
    const remaining = answerSeconds * 1000 - (performance.now() - startedAt);
    const id = window.setTimeout(() => {
      const g = useGame.getState();
      if (g.status === 'guessing') g.timeUp();
    }, Math.max(0, remaining));
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
