// Server-wide leaderboard: the top match results recorded by the server. Shown
// in the browse view; data is pushed live over the lobby stream (see
// RoomList's watchLobby), updating whenever any room finishes a match.
import { Flag } from '../components/Flag';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t, plural } from '../i18n';

export function Leaderboard() {
  const language = useSettings((s) => s.language);
  const leaderboard = useOnline((s) => s.leaderboard);

  return (
    <section className="panel leaderboard-panel">
      <h3>{t('leaderboard', language)}</h3>
      {leaderboard.length === 0 ? (
        <p className="muted">{t('leaderboardEmpty', language)}</p>
      ) : (
        <ol className="leaderboard-list">
          {leaderboard.map((row, i) => (
            <li key={`${row.nickname}-${row.playedAt}-${i}`} className="leaderboard-row">
              <span className="rank">{i + 1}</span>
              <Flag alpha2={row.avatar} className="standing-flag" />
              <span className="standing-name"><span className="standing-nick">{row.nickname}</span></span>
              <span className="standing-detail muted">
                {row.games} {plural('games', row.games, language)}
              </span>
              <span className="standing-score">{row.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
