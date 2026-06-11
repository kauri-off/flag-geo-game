// All-time history: aggregate stats plus a scrollable log of every round.
import { Flag } from '../components/Flag';
import { StatsRow } from '../components/StatsRow';
import { useHistory } from '../store/historyStore';
import { useSettings } from '../store/settingsStore';
import { statsFromRounds, formatTime } from '../game/stats';
import { countryName, t } from '../i18n';

export function HistoryScreen() {
  const rounds = useHistory((s) => s.rounds);
  const clear = useHistory((s) => s.clear);
  const language = useSettings((s) => s.language);

  const stats = statsFromRounds(rounds);
  const dateFmt = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <div className="history">
      <div className="section-title">{t('allTimeStats', language)}</div>
      <StatsRow stats={stats} language={language} />

      {rounds.length === 0 ? (
        <div className="empty-note">{t('noHistory', language)}</div>
      ) : (
        <>
          <div className="table-actions">
            <button className="btn danger" onClick={clear}>
              {t('clearHistory', language)}
            </button>
          </div>
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>{t('flag', language)}</th>
                  <th>{t('guessed', language)}</th>
                  <th>{t('answer', language)}</th>
                  <th>{t('time', language)}</th>
                  <th>{t('result', language)}</th>
                  <th>{t('date', language)}</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id} className={r.correct ? 'row-ok' : 'row-bad'}>
                    <td><Flag alpha2={r.flagAlpha2} /></td>
                    <td>{r.guessId ? countryName(r.guessId, language, r.guessName ?? undefined) : '—'}</td>
                    <td>{countryName(r.targetId, language, r.targetName)}</td>
                    <td>{formatTime(r.timeMs)}</td>
                    <td>{r.correct ? '✓' : '✗'}</td>
                    <td>{dateFmt.format(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
