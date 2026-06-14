// End-of-match standings with the winner highlighted, plus a return-to-lobby
// button so the host can start another round.
import { Flag } from '../components/Flag';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function MatchResults() {
  const language = useSettings((s) => s.language);
  const { matchResult, selfId } = useOnline();
  const backToLobby = useOnline((s) => s.backToLobby);
  const leaveRoom = useOnline((s) => s.leaveRoom);

  if (!matchResult) return null;
  const { standings, winnerId } = matchResult;

  return (
    <div className="match-results panel">
      <h2>{t('matchOver', language)}</h2>
      <ol className="final-standings">
        {standings.map((s, i) => (
          <li
            key={s.playerId}
            className={`standing-row ${s.playerId === winnerId ? 'winner' : ''} ${
              s.playerId === selfId ? 'self' : ''
            }`}
          >
            <span className="rank">{i + 1}</span>
            <Flag alpha2={s.avatar} className="standing-flag" />
            <span className="standing-name">
              {s.nickname}
              {s.playerId === winnerId && <span className="badge">🏆 {t('winner', language)}</span>}
            </span>
            <span className="standing-detail muted">
              {s.correct}/{s.rounds}
            </span>
            <span className="standing-score">{s.score}</span>
          </li>
        ))}
      </ol>
      <div className="results-actions">
        <button className="btn primary" onClick={backToLobby}>
          {t('rematch', language)}
        </button>
        <button className="btn ghost" onClick={leaveRoom}>
          {t('leaveRoom', language)}
        </button>
      </div>
    </div>
  );
}
