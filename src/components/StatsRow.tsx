// Compact reusable stats display (rounds, accuracy, avg/best time).
import type { Stats } from '../game/types';
import type { Language } from '../i18n';
import { t } from '../i18n';
import { formatTime, formatAccuracy } from '../game/stats';

export function StatsRow({ stats, language }: { stats: Stats; language: Language }) {
  return (
    <div className="stats-row">
      <div className="stat">
        <div className="stat-val">{stats.correct}/{stats.rounds}</div>
        <div className="stat-key">{t('round', language)}</div>
      </div>
      <div className="stat">
        <div className="stat-val">{formatAccuracy(stats.accuracy)}</div>
        <div className="stat-key">{t('accuracy', language)}</div>
      </div>
      <div className="stat">
        <div className="stat-val">{formatTime(stats.avgTimeMs)}</div>
        <div className="stat-key">{t('avgTime', language)}</div>
      </div>
      <div className="stat">
        <div className="stat-val">{formatTime(stats.bestTimeMs)}</div>
        <div className="stat-key">{t('bestTime', language)}</div>
      </div>
    </div>
  );
}
