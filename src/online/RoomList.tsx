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
  const { nickname, avatar, account, rooms, status, error } = useOnline();
  const watchLobby = useOnline((s) => s.watchLobby);
  const stopLobbyWatch = useOnline((s) => s.stopLobbyWatch);
  const createRoom = useOnline((s) => s.createRoom);
  const joinRoom = useOnline((s) => s.joinRoom);
  const disconnect = useOnline((s) => s.disconnect);
  const logout = useOnline((s) => s.logout);

  const displayName = account ? account.username : nickname;
  const displayAvatar = account ? account.avatar : avatar;

  const [roomPassword, setRoomPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  // Live room list + leaderboard: the server pushes updates over a stream that
  // stays open while this view is mounted (replacing the old 5s poll).
  useEffect(() => {
    watchLobby();
    return () => stopLobbyWatch();
  }, [watchLobby, stopLobbyWatch]);

  const busy = status === 'busy';

  const onCreate = () => {
    void createRoom(DEFAULT_CONFIG, roomPassword.trim() || undefined);
  };

  return (
    <div className="room-browser">
      <div className="online-identity">
        {displayAvatar && <Flag alpha2={displayAvatar} className="identity-flag" />}
        <strong>{displayName}</strong>
        <button className="btn ghost small" onClick={account ? logout : disconnect}>
          {t(account ? 'logOut' : 'disconnect', language)}
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
