// Countdown bar shown while guessing, when an answer time limit is in effect.
// Purely a display: the actual timeout is fired by RoundBoard. A value of 0 for
// `seconds` means "no limit", and the timer renders nothing.
import { useEffect, useState } from 'react';
import { useGame } from '../store/gameStore';

export function Timer({ seconds }: { seconds: number }) {
  const status = useGame((s) => s.status);
  const startedAt = useGame((s) => s.startedAt);
  const [now, setNow] = useState(() => performance.now());

  const running = status === 'guessing' && seconds > 0;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [running, startedAt]);

  if (!running) return null;

  const remaining = Math.max(0, seconds - (now - startedAt) / 1000);
  const pct = Math.max(0, Math.min(100, (remaining / seconds) * 100));
  const low = remaining <= 3;

  return (
    <div className={`timer ${low ? 'low' : ''}`}>
      <div className="timer-bar" style={{ width: `${pct}%` }} />
      <span className="timer-val">{remaining.toFixed(1)}s</span>
    </div>
  );
}
