// Room lobby: the player list, room code to share, the live match settings
// (editable by the host), host-transfer controls, and the start button.
import { useEffect, useState } from 'react';
import { Flag } from '../components/Flag';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';
import { RoomSettings } from './RoomSettings';

export function Lobby() {
  const language = useSettings((s) => s.language);
  const { room, players, selfId, countdown } = useOnline();
  const startMatch = useOnline((s) => s.startMatch);
  const leaveRoom = useOnline((s) => s.leaveRoom);
  const updateConfig = useOnline((s) => s.updateConfig);
  const transferHost = useOnline((s) => s.transferHost);
  const kickPlayer = useOnline((s) => s.kickPlayer);
  const [copied, setCopied] = useState(false);

  // The server announces the countdown once (e.g. 3); tick it down locally so the
  // banner actually counts 3 → 2 → 1 instead of showing a frozen number.
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (countdown == null) {
      setRemaining(null);
      return;
    }
    setRemaining(countdown);
    let n = countdown;
    const id = window.setInterval(() => {
      n -= 1;
      setRemaining(Math.max(n, 0));
      if (n <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdown]);

  if (!room) return null;
  const isHost = selfId === room.hostId;
  const code = room.code;
  const starting = countdown != null;

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="lobby">
      <div className="lobby-head">
        <div className="room-code-box">
          <span className="muted">{t('roomCode', language)}</span>
          <code className="room-code">{code}</code>
          <button className="btn ghost small" onClick={copy}>
            {copied ? t('copied', language) : t('copy', language)}
          </button>
        </div>
        <button className="btn ghost small lobby-leave" onClick={leaveRoom}>
          {t('leaveRoom', language)}
        </button>
      </div>

      {starting && (
        <div className="countdown-banner">
          {t('startingIn', language)} {remaining ?? countdown}…
        </div>
      )}

      <section className="lobby-settings">
        <h3>{t('roomSettings', language)}</h3>
        <RoomSettings
          config={room.config}
          editable={isHost && !starting}
          onChange={updateConfig}
        />
      </section>

      <h3>
        {t('players', language)} ({players.length})
      </h3>
      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id} className={`player-chip ${p.connected ? '' : 'offline'}`}>
            <Flag alpha2={p.avatar} className="player-flag" />
            <span className="player-name">{p.nickname}</span>
            {p.id === room.hostId && <span className="badge">{t('host', language)}</span>}
            {p.id === selfId && <span className="badge you">{t('you', language)}</span>}
            {isHost && !starting && p.id !== selfId && p.connected && (
              <button
                className="btn ghost small make-host"
                onClick={() => transferHost(p.id)}
                title={t('makeHost', language)}
              >
                {t('makeHost', language)}
              </button>
            )}
            {isHost && !starting && p.id !== selfId && (
              <button
                className="btn ghost small kick"
                onClick={() => kickPlayer(p.id)}
                title={t('kick', language)}
              >
                {t('kick', language)}
              </button>
            )}
          </li>
        ))}
      </ul>

      {isHost ? (
        <button className="btn primary" disabled={players.length < 1 || starting} onClick={startMatch}>
          {t('startMatch', language)}
        </button>
      ) : (
        <p className="muted">{t('waitingForHost', language)}</p>
      )}
    </div>
  );
}
