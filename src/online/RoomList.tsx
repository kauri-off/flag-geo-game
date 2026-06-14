// Browse view: your identity, a create-room form, join-by-code, the list of open
// rooms, and the server leaderboard. Match settings are configured inside the
// room (see RoomSettings), not here — a new room starts with sensible defaults.
import { useEffect, useState } from 'react';
import { Flag } from '../components/Flag';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';
import type { RoomSummary } from './protocol';
import { DEFAULT_CONFIG } from './RoomSettings';
import { Leaderboard } from './Leaderboard';

export function RoomList() {
  const language = useSettings((s) => s.language);
  const { nickname, avatar, rooms, status, error } = useOnline();
  const refreshRooms = useOnline((s) => s.refreshRooms);
  const createRoom = useOnline((s) => s.createRoom);
  const joinRoom = useOnline((s) => s.joinRoom);
  const disconnect = useOnline((s) => s.disconnect);

  const [roomPassword, setRoomPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  useEffect(() => {
    void refreshRooms();
    const id = window.setInterval(() => void refreshRooms(), 5000);
    return () => clearInterval(id);
  }, [refreshRooms]);

  const busy = status === 'busy';

  const onCreate = () => {
    void createRoom(DEFAULT_CONFIG, roomPassword.trim() || undefined);
  };

  return (
    <div className="room-browser">
      <div className="online-identity">
        {avatar && <Flag alpha2={avatar} className="identity-flag" />}
        <strong>{nickname}</strong>
        <button className="btn ghost small" onClick={disconnect}>
          {t('disconnect', language)}
        </button>
      </div>

      {error && <div className="online-error">{error}</div>}

      <div className="online-columns">
        <section className="panel create-room">
          <h3>{t('createRoom', language)}</h3>
          <p className="muted">{t('createRoomHint', language)}</p>
          <label className="field">
            <span>
              {t('roomPassword', language)} <em>({t('optional', language)})</em>
            </span>
            <input
              type="password"
              className="text-input"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={busy} onClick={onCreate}>
            {t('createRoom', language)}
          </button>
        </section>

        <section className="panel join-room">
          <h3>{t('joinByCode', language)}</h3>
          <div className="join-row">
            <input
              type="text"
              className="text-input code-input"
              placeholder={t('roomCode', language)}
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <input
              type="password"
              className="text-input small"
              placeholder={t('roomPassword', language)}
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || joinCode.length < 4}
              onClick={() => void joinRoom(joinCode, joinPassword || undefined)}
            >
              {t('joinRoom', language)}
            </button>
          </div>

          <div className="rooms-header">
            <h3>{t('rooms', language)}</h3>
            <button className="btn ghost small" onClick={() => void refreshRooms()}>
              {t('refresh', language)}
            </button>
          </div>
          {rooms.length === 0 ? (
            <p className="muted">{t('noRooms', language)}</p>
          ) : (
            <ul className="room-list">
              {rooms.map((r) => (
                <RoomCard key={r.code} room={r} busy={busy} onJoin={joinRoom} />
              ))}
            </ul>
          )}
        </section>

        <Leaderboard />
      </div>
    </div>
  );
}

function RoomCard({
  room,
  busy,
  onJoin,
}: {
  room: RoomSummary;
  busy: boolean;
  onJoin: (code: string, password?: string) => Promise<void>;
}) {
  const language = useSettings((s) => s.language);
  const [pw, setPw] = useState('');
  return (
    <li className="room-card">
      <div className="room-card-main">
        <span className="room-card-code">{room.code}</span>
        <span className="muted">
          {room.players}/{room.maxPlayers} · {room.phase}
        </span>
      </div>
      {room.hasPassword && (
        <input
          type="password"
          className="text-input small"
          placeholder={t('roomPassword', language)}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      )}
      <button
        className="btn small"
        disabled={busy || room.players >= room.maxPlayers}
        onClick={() => void onJoin(room.code, pw || undefined)}
      >
        {t('joinRoom', language)}
      </button>
    </li>
  );
}
