// Room match settings (rounds, time per answer, country scope). Rendered inside
// the lobby: editable by the host, read-only for everyone else. Every change is
// pushed to the server, which broadcasts it so all players see the live config.
import { useSettings, type DifficultyFilter } from '../store/settingsStore';
import { t } from '../i18n';
import { DEFAULT_DIFFICULTY } from '../game/difficulty';
import { DifficultyPicker } from '../components/DifficultyPicker';
import type { RoomConfig } from './protocol';

const ROUND_PRESETS = [5, 10, 20] as const;
const TIME_PRESETS = [5, 10, 15, 0] as const;

export const DEFAULT_CONFIG: RoomConfig = {
  rounds: 10,
  timeLimitSec: 10,
  attempts: 1,
  difficulty: DEFAULT_DIFFICULTY,
  registeredOnly: false,
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
  const { continents, size, scope } = config.difficulty;

  const setRounds = (rounds: number) => onChange({ ...config, rounds });
  const setTimeLimit = (timeLimitSec: number) => onChange({ ...config, timeLimitSec });

  // Non-host players get a compact, read-only summary of the live config.
  if (!editable) {
    const filters = [
      continents.length ? continents.join(', ') : null,
      size !== 'all' ? t(`size${size[0].toUpperCase()}${size.slice(1)}` as 'sizeSmall', language) : null,
      scope === 'un' ? t('scopeUn', language) : null,
    ].filter(Boolean);
    return (
      <div className="room-settings readonly">
        <span className="muted">
          {config.rounds} {t('rounds', language).toLowerCase()} ·{' '}
          {config.timeLimitSec === 0 ? t('noLimit', language) : `${config.timeLimitSec}s`}
          {filters.map((f) => (
            <span key={f as string}> · {f}</span>
          ))}
          {config.registeredOnly && <span> · {t('registeredOnly', language)}</span>}
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
      <DifficultyPicker
        value={config.difficulty as DifficultyFilter}
        lang={language}
        onChange={(d) => onChange({ ...config, difficulty: d })}
      />
      <label className="field toggle-field">
        <input
          type="checkbox"
          checked={config.registeredOnly}
          onChange={(e) => onChange({ ...config, registeredOnly: e.target.checked })}
        />
        <span>
          {t('registeredOnly', language)}
          <small className="hint">{t('registeredOnlyHint', language)}</small>
        </span>
      </label>
    </div>
  );
}
