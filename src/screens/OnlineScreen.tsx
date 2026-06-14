// Online multiplayer screen. Switches between connect, room browser and the live
// room (lobby / countdown / race / results) based on the online store's view and
// the server-reported room phase.
import { useEffect } from 'react';
import { ConnectPanel } from '../online/ConnectPanel';
import { RoomList } from '../online/RoomList';
import { Lobby } from '../online/Lobby';
import { OnlineRound } from '../online/OnlineRound';
import { MatchResults } from '../online/MatchResults';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function OnlineScreen() {
  const language = useSettings((s) => s.language);
  const view = useOnline((s) => s.view);
  const phase = useOnline((s) => s.phase);
  const status = useOnline((s) => s.status);

  // After a page reload we keep the room token but not the live room state; if one
  // is present, reconnect into the same seat and let the server restore state.
  useEffect(() => {
    const s = useOnline.getState();
    if (s.roomToken && s.view !== 'room') s.reconnectRoom();
  }, []);

  if (view === 'connect') {
    return (
      <div className="online-screen">
        <ConnectPanel />
      </div>
    );
  }

  if (view === 'browse') {
    return (
      <div className="online-screen">
        <RoomList />
      </div>
    );
  }

  // view === 'room'
  return (
    <div className="online-screen">
      {status === 'connecting' && <div className="conn-status">{t('connecting', language)}</div>}
      {status === 'closed' && <div className="conn-status warn">{t('connectionLost', language)}</div>}
      {phase === 'finished'
        ? <MatchResults />
        : phase === 'inRound' || phase === 'intermission'
          ? <OnlineRound />
          : <Lobby />}
    </div>
  );
}
