// One controlled flag-selection (difficulty) picker, shared by free practice,
// challenge setup and online rooms so every mode offers the same scope,
// continent and size options. Holds no state: emits a new DifficultyFilter via
// onChange.
import { t, type Language } from '../i18n';
import {
  CONTINENTS,
  SCOPES,
  SIZES,
  toggleContinent,
  type DifficultyFilter,
} from '../game/difficulty';

export function DifficultyPicker({
  value,
  onChange,
  lang,
}: {
  value: DifficultyFilter;
  onChange: (next: DifficultyFilter) => void;
  lang: Language;
}) {
  return (
    <>
      <section className="settings-group">
        <h3>{t('difficulty', lang)} · {t('scope', lang)}</h3>
        <div className="chip-row">
          {SCOPES.map((sc) => (
            <button
              key={sc.value}
              className={`chip ${(value.scope ?? 'all') === sc.value ? 'on' : ''}`}
              title={t(sc.desc, lang)}
              onClick={() => onChange({ ...value, scope: sc.value })}
            >
              {t(sc.key, lang)} ({sc.count})
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('difficulty', lang)} · {t('continents', lang)}</h3>
        <div className="chip-row">
          {CONTINENTS.map((c) => (
            <button
              key={c}
              className={`chip ${value.continents.includes(c) ? 'on' : ''}`}
              onClick={() => onChange(toggleContinent(value, c))}
            >
              {c}
            </button>
          ))}
          {value.continents.length === 0 && (
            <span className="muted">({t('all', lang)})</span>
          )}
        </div>
      </section>

      <section className="settings-group">
        <h3>{t('difficulty', lang)} · {t('size', lang)}</h3>
        <div className="chip-row">
          {SIZES.map((sz) => (
            <button
              key={sz.value}
              className={`chip ${value.size === sz.value ? 'on' : ''}`}
              onClick={() => onChange({ ...value, size: sz.value })}
            >
              {t(sz.key, lang)}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
