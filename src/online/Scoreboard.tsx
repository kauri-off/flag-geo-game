// Live standings shown during a match. Joins the server's standings (id+score)
// with the player roster (nickname+avatar) and sorts by score. During the
// intermission it also shows each player's outcome for the round just finished
// (✓ +points / ✗) and crowns the round's winner, so you can see how opponents
// did before the next round changes the totals.
import { Flag } from '../components/Flag';
import { useOnline } from '../store/onlineStore';
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';
import type { RoundPlayerResult } from './protocol';

/** Winner of a single round: most points (>0), fastest answer breaking ties. */
function roundWinner(results: RoundPlayerResult[]): string | null {
  let best: RoundPlayerResult | null = null;
  for (const r of results) {
    if (r.points <= 0) continue;
    if (!best || r.points > best.points || (r.points === best.points && r.timeMs < best.timeMs)) {
      best = r;
    }
  }
  return best?.playerId ?? null;
}

export function Scoreboard() {
  const language = useSettings((s) => s.language);
  const { standings, players, selfId, phase, lastResult } = useOnline();

  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = standings
    .map((s) => ({ ...s, player: byId.get(s.playerId) }))
    .sort((a, b) => b.score - a.score);

  const showRound = phase === 'intermission' && !!lastResult;
  const resultById = new Map((lastResult?.results ?? []).map((r) => [r.playerId, r]));
  const winnerId = showRound ? roundWinner(lastResult!.results) : null;

  return (
    <aside className="live-scoreboard">
      <h4>{t('score', language)}</h4>
      <ol className="standing-list">
        {rows.map((r, i) => {
          const res = resultById.get(r.playerId);
          return (
            <li
              key={r.playerId}
              className={`standing-row ${r.playerId === selfId ? 'self' : ''} ${
                !showRound && r.answered ? 'answered' : ''
              } ${showRound && r.playerId === winnerId ? 'winner' : ''}`}
            >
              <span className="rank">{i + 1}</span>
              {r.player && <Flag alpha2={r.player.avatar} className="standing-flag" />}
              <span className="standing-name">
                <span className="standing-nick">{r.player?.nickname ?? '—'}</span>
                {showRound && r.playerId === winnerId && <span className="round-crown">👑</span>}
              </span>
              {showRound && res && (
                <span className={`round-delta ${res.correct ? 'ok' : 'bad'}`}>
                  {res.correct ? `+${res.points}` : '✗'}
                </span>
              )}
              <span className="standing-score">{r.score}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
