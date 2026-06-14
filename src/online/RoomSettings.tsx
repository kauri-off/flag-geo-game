// Room match settings (rounds, time per answer, country scope). Rendered inside
// the lobby: editable by the host, read-only for everyone else. Every change is
// pushed to the server, which broadcasts it so all players see the live config.
import { useSettings } from '../store/settingsStore';
import { t } from '../i18n';
import type { RoomConfig } from './protocol';

const ROUND_PRESETS = [5, 10, 20] as const;
const TIME_PRESETS = [5, 10, 15, 0] as const;

export const DEFAULT_CONFIG: RoomConfig = {
  rounds: 10,
  timeLimitSec: 10,
  attempts: 1,
  difficulty: { continents: [], size: 'all', scope: 'all' },
};

export function RoomSettings({
  config,
  editable,
  onChange,
}: {
  config: RoomConfig;
  editable: boolean;
  onChange: (config: RoomConfig) => void;
}) {
  const language = useSettings((s) => s.language);
  const unOnly = config.difficulty.scope === 'un';

  const setRounds = (rounds: number) => onChange({ ...config, rounds });
  const setTimeLimit = (timeLimitSec: number) => onChange({ ...config, timeLimitSec });
  const setUnOnly = (un: boolean) =>
    onChange({ ...config, difficulty: { ...config.difficulty, scope: un ? 'un' : 'all' } });

  // Non-host players get a compact, read-only summary of the live config.
  if (!editable) {
    return (
      <div className="room-settings readonly">
        <span className="muted">
          {config.rounds} {t('rounds', language).toLowerCase()} ·{' '}
          {config.timeLimitSec === 0 ? t('noLimit', language) : `${config.timeLimitSec}s`}
          {unOnly && <> · {t('scopeUn', language)}</>}
        </span>
      </div>
    );
  }

  return (
    <div className="room-settings">
      <div className="field">
        <span>{t('rounds', language)}</span>
        <div className="chip-row">
          {ROUND_PRESETS.map((r) => (
            <button key={r} className={`chip ${config.rounds === r ? 'on' : ''}`} onClick={() => setRounds(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('timeLimit', language)}</span>
        <div className="chip-row">
          {TIME_PRESETS.map((s) => (
            <button
              key={s}
              className={`chip ${config.timeLimitSec === s ? 'on' : ''}`}
              onClick={() => setTimeLimit(s)}
            >
              {s === 0 ? t('noLimit', language) : `${s}s`}
            </button>
          ))}
        </div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={unOnly} onChange={(e) => setUnOnly(e.target.checked)} />
        <span>{t('scopeUn', language)}</span>
      </label>
    </div>
  );
}
