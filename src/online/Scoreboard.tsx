// Live standings shown during a match. Joins the server's standings (id+score)
// with the player roster (nickname+avatar) and sorts by score.
import { Flag } from '../components/Flag';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';

export function Scoreboard() {
  const language = useSettings((s) => s.language);
  const { standings, players, selfId } = useOnline();

  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = standings
    .map((s) => ({ ...s, player: byId.get(s.playerId) }))
    .sort((a, b) => b.score - a.score);

  return (
    <aside className="live-scoreboard">
      <h4>{t('score', language)}</h4>
      <ol className="standing-list">
        {rows.map((r, i) => (
          <li
            key={r.playerId}
            className={`standing-row ${r.playerId === selfId ? 'self' : ''} ${
              r.answered ? 'answered' : ''
            }`}
          >
            <span className="rank">{i + 1}</span>
            {r.player && <Flag alpha2={r.player.avatar} className="standing-flag" />}
            <span className="standing-name">{r.player?.nickname ?? '—'}</span>
            <span className="standing-score">{r.score}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
