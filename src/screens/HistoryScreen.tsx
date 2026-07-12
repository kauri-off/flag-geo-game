// All-time history: aggregate stats, the flags the player misses most, and a
// scrollable log of every round, filterable by practice/challenge.
import { useEffect, useMemo, useState } from 'react';
import { Flag } from '../components/Flag';
import { StatsRow } from '../components/StatsRow';
import { useHistory } from '../store/historyStore';
import { useSettings } from '../store/settingsStore';
import { statsFromRounds, formatTime, formatAccuracy } from '../game/stats';
import { countryName, t, type Language } from '../i18n';
import type { RoundRecord } from '../game/types';

type KindFilter = 'all' | 'practice' | 'challenge';

/** Rows shown initially / added per "Show more" click. */
const PAGE_SIZE = 100;

// A flag qualifies as "missed" once it has enough attempts to mean something
// and isn't at 100%.
const WEAK_MIN_ATTEMPTS = 3;
const WEAK_LIMIT = 10;

interface WeakEntry {
  targetId: string;
  flagAlpha2: string;
  targetName: string;
  attempts: number;
  correct: number;
}

function weakestFlags(rounds: RoundRecord[]): WeakEntry[] {
  const byTarget = new Map<string, WeakEntry>();
  for (const r of rounds) {
    let e = byTarget.get(r.targetId);
    if (!e) {
      e = {
        targetId: r.targetId,
        flagAlpha2: r.flagAlpha2,
        targetName: r.targetName,
        attempts: 0,
        correct: 0,
      };
      byTarget.set(r.targetId, e);
    }
    e.attempts++;
    if (r.correct) e.correct++;
  }
  return [...byTarget.values()]
    .filter((e) => e.attempts >= WEAK_MIN_ATTEMPTS && e.correct < e.attempts)
    .sort(
      (a, b) =>
        a.correct / a.attempts - b.correct / b.attempts || b.attempts - a.attempts,
    )
    .slice(0, WEAK_LIMIT);
}

// Clear button with a two-step confirmation: the first click arms it (and it
// disarms itself after a few seconds), the second click actually wipes.
function ClearHistoryButton({ onClear, language }: { onClear: () => void; language: Language }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      className={`btn ${armed ? 'danger' : ''}`}
      onClick={() => {
        if (armed) {
          onClear();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
    >
      {t(armed ? 'confirmClearHistory' : 'clearHistory', language)}
    </button>
  );
}

export function HistoryScreen() {
  const rounds = useHistory((s) => s.rounds);
  const clear = useHistory((s) => s.clear);
  const language = useSettings((s) => s.language);

  const [kind, setKind] = useState<KindFilter>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Records from before the kind field existed count as practice.
  const filtered = useMemo(
    () =>
      kind === 'all'
        ? rounds
        : rounds.filter((r) =>
            kind === 'challenge' ? r.kind === 'challenge' : r.kind !== 'challenge',
          ),
    [rounds, kind],
  );
  const stats = useMemo(() => statsFromRounds(filtered), [filtered]);
  const weakest = useMemo(() => weakestFlags(filtered), [filtered]);

  const dateFmt = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const pickKind = (k: KindFilter) => {
    setKind(k);
    setVisible(PAGE_SIZE); // restart paging for the new slice
  };

  const kindChips: { value: KindFilter; key: 'all' | 'practice' | 'challenge' }[] = [
    { value: 'all', key: 'all' },
    { value: 'practice', key: 'practice' },
    { value: 'challenge', key: 'challenge' },
  ];

  return (
    <div className="history">
      <div className="section-title">{t('allTimeStats', language)}</div>
      <div className="chip-row">
        {kindChips.map((c) => (
          <button
            key={c.value}
            className={`chip ${kind === c.value ? 'on' : ''}`}
            onClick={() => pickKind(c.value)}
          >
            {t(c.key, language)}
          </button>
        ))}
      </div>
      <StatsRow stats={stats} language={language} />

      {weakest.length > 0 && (
        <>
          <div className="section-title">{t('weakFlags', language)}</div>
          <div className="weak-flags">
            {weakest.map((e) => (
              <div key={e.targetId} className="weak-flag">
                <Flag alpha2={e.flagAlpha2} />
                <span className="weak-flag-name">
                  {countryName(e.targetId, language, e.targetName)}
                </span>
                <span className="weak-flag-score">
                  {e.correct}/{e.attempts} · {formatAccuracy(e.correct / e.attempts)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {filtered.length === 0 ? (
        <div className="empty-note">{t('noHistory', language)}</div>
      ) : (
        <>
          <div className="table-actions">
            <ClearHistoryButton onClear={clear} language={language} />
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
                {filtered.slice(0, visible).map((r) => (
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
          {filtered.length > visible && (
            <div className="table-actions" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                {t('showMore', language)} ({filtered.length - visible})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
